import { createChildLogger } from '../utils/logger';
import { EntityState, StateDelta, DeltaOperation, Timestamp } from '../core/types';

const log = createChildLogger('ConflictResolver');

export enum ConflictStrategy {
  LAST_WRITE_WINS = 'last_write_wins',
  FIRST_WRITE_WINS = 'first_write_wins',
  MERGE = 'merge',
  CUSTOM = 'custom',
}

export interface ConflictResult {
  resolved: boolean;
  entity: EntityState;
  strategy: ConflictStrategy;
  mergedOperations?: DeltaOperation[];
}

export type CustomResolver = (local: EntityState, remote: EntityState, localDelta: StateDelta, remoteDelta: StateDelta) => EntityState;

export class ConflictResolver {
  private defaultStrategy: ConflictStrategy = ConflictStrategy.LAST_WRITE_WINS;
  private customResolvers = new Map<string, CustomResolver>();
  private conflictsResolved: number = 0;
  private conflictsFailed: number = 0;

  setDefaultStrategy(strategy: ConflictStrategy): void {
    this.defaultStrategy = strategy;
  }

  registerResolver(entityType: string, resolver: CustomResolver): void {
    this.customResolvers.set(entityType, resolver);
  }

  resolve(local: EntityState, remote: EntityState, localDelta: StateDelta, remoteDelta: StateDelta): ConflictResult {
    const customResolver = this.customResolvers.get(local.type);
    if (customResolver) {
      return this.resolveWithCustom(local, remote, localDelta, remoteDelta, customResolver);
    }

    switch (this.defaultStrategy) {
      case ConflictStrategy.LAST_WRITE_WINS:
        return this.resolveLastWriteWins(local, remote);
      case ConflictStrategy.FIRST_WRITE_WINS:
        return this.resolveFirstWriteWins(local, remote);
      case ConflictStrategy.MERGE:
        return this.resolveMerge(local, remote, localDelta, remoteDelta);
      default:
        return this.resolveLastWriteWins(local, remote);
    }
  }

  private resolveLastWriteWins(local: EntityState, remote: EntityState): ConflictResult {
    const winner = local.lastModified >= remote.lastModified ? local : remote;
    this.conflictsResolved++;
    log.debug('Conflict resolved (LWW)', { entityId: local.id, winner: winner === local ? 'local' : 'remote' });
    return {
      resolved: true,
      entity: { ...winner },
      strategy: ConflictStrategy.LAST_WRITE_WINS,
    };
  }

  private resolveFirstWriteWins(local: EntityState, remote: EntityState): ConflictResult {
    const winner = local.lastModified <= remote.lastModified ? local : remote;
    this.conflictsResolved++;
    return {
      resolved: true,
      entity: { ...winner },
      strategy: ConflictStrategy.FIRST_WRITE_WINS,
    };
  }

  private resolveMerge(local: EntityState, remote: EntityState, localDelta: StateDelta, remoteDelta: StateDelta): ConflictResult {
    const merged = this.deepMerge(local.data, remote.data);
    const mergedEntity: EntityState = {
      ...local,
      data: merged,
      version: Math.max(local.version, remote.version) + 1,
      lastModified: Date.now(),
    };

    const mergedOps = this.mergeOperations(localDelta.operations, remoteDelta.operations);
    this.conflictsResolved++;

    log.debug('Conflict resolved (merge)', { entityId: local.id });
    return {
      resolved: true,
      entity: mergedEntity,
      strategy: ConflictStrategy.MERGE,
      mergedOperations: mergedOps,
    };
  }

  private resolveWithCustom(
    local: EntityState,
    remote: EntityState,
    localDelta: StateDelta,
    remoteDelta: StateDelta,
    resolver: CustomResolver
  ): ConflictResult {
    try {
      const resolved = resolver(local, remote, localDelta, remoteDelta);
      this.conflictsResolved++;
      return {
        resolved: true,
        entity: resolved,
        strategy: ConflictStrategy.CUSTOM,
      };
    } catch (err) {
      this.conflictsFailed++;
      log.error('Custom resolver failed, falling back to LWW', { entityId: local.id, error: (err as Error).message });
      return this.resolveLastWriteWins(local, remote);
    }
  }

  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...target };
    for (const key of Object.keys(source)) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        result[key] = this.deepMerge(result[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  private mergeOperations(localOps: DeltaOperation[], remoteOps: DeltaOperation[]): DeltaOperation[] {
    const pathMap = new Map<string, DeltaOperation>();
    for (const op of localOps) {
      pathMap.set(op.path, op);
    }
    for (const op of remoteOps) {
      if (!pathMap.has(op.path)) {
        pathMap.set(op.path, op);
      }
    }
    return Array.from(pathMap.values());
  }

  getStats(): { resolved: number; failed: number } {
    return { resolved: this.conflictsResolved, failed: this.conflictsFailed };
  }
}
