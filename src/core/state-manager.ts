import { LRUCache } from 'lru-cache';
import { createChildLogger } from '../utils/logger';
import { generateId } from '../utils/id';
import { globalEventBus } from './event-bus';
import {
  EntityId,
  EntityState,
  StateDelta,
  DeltaOperation,
  StateSnapshot,
  Timestamp,
} from './types';

const log = createChildLogger('StateManager');

export class StateManager {
  private entities = new Map<EntityId, EntityState>();
  private history = new Map<EntityId, StateDelta[]>();
  private version: number = 0;
  private cache: LRUCache<string, any>;
  private readonly maxHistoryPerEntity: number;

  constructor(cacheSize: number = 10000, maxHistoryPerEntity: number = 100) {
    this.cache = new LRUCache<string, any>({ max: cacheSize });
    this.maxHistoryPerEntity = maxHistoryPerEntity;
  }

  getEntity(id: EntityId): EntityState | undefined {
    return this.entities.get(id);
  }

  getAllEntities(): Map<EntityId, EntityState> {
    return new Map(this.entities);
  }

  getEntitiesByType(type: string): EntityState[] {
    const result: EntityState[] = [];
    for (const entity of this.entities.values()) {
      if (entity.type === type) result.push(entity);
    }
    return result;
  }

  getEntitiesByOwner(ownerId: string): EntityState[] {
    const result: EntityState[] = [];
    for (const entity of this.entities.values()) {
      if (entity.ownerId === ownerId) result.push(entity);
    }
    return result;
  }

  createEntity(type: string, ownerId: string, data: Record<string, unknown> = {}, id?: EntityId): EntityState {
    const entityId = id || generateId();
    const now = Date.now();
    this.version++;

    const entity: EntityState = {
      id: entityId,
      type,
      ownerId,
      data,
      version: 1,
      lastModified: now,
    };

    this.entities.set(entityId, entity);
    this.cache.delete(`snapshot`);

    globalEventBus.emitSync('entity:created', { entity });
    log.debug('Entity created', { entityId, type });

    return entity;
  }

  updateEntity(id: EntityId, operations: DeltaOperation[]): EntityState | null {
    const entity = this.entities.get(id);
    if (!entity) {
      log.warn('Entity not found for update', { id });
      return null;
    }

    const fromVersion = entity.version;
    const now = Date.now();

    for (const op of operations) {
      this.applyOperation(entity.data, op);
    }

    entity.version++;
    entity.lastModified = now;
    this.version++;

    const delta: StateDelta = {
      entityId: id,
      fromVersion,
      toVersion: entity.version,
      operations,
      timestamp: now,
    };

    this.addToHistory(id, delta);
    this.cache.delete(`snapshot`);

    globalEventBus.emitSync('entity:updated', { entity, delta });

    return entity;
  }

  deleteEntity(id: EntityId): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;

    this.entities.delete(id);
    this.history.delete(id);
    this.version++;
    this.cache.delete(`snapshot`);

    globalEventBus.emitSync('entity:deleted', { entity });
    log.debug('Entity deleted', { id });

    return true;
  }

  private applyOperation(data: Record<string, unknown>, op: DeltaOperation): void {
    const parts = op.path.split('.');
    let current: Record<string, unknown> = data;

    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (typeof current[key] !== 'object' || current[key] === null) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }

    const lastKey = parts[parts.length - 1];

    switch (op.op) {
      case 'set':
        current[lastKey] = op.value;
        break;
      case 'delete':
        delete current[lastKey];
        break;
      case 'increment':
        current[lastKey] = (Number(current[lastKey]) || 0) + (Number(op.value) || 1);
        break;
      case 'append':
        if (!Array.isArray(current[lastKey])) current[lastKey] = [];
        (current[lastKey] as unknown[]).push(op.value);
        break;
      case 'remove':
        if (Array.isArray(current[lastKey])) {
          current[lastKey] = (current[lastKey] as unknown[]).filter(v => v !== op.value);
        }
        break;
    }
  }

  private addToHistory(entityId: EntityId, delta: StateDelta): void {
    let entityHistory = this.history.get(entityId);
    if (!entityHistory) {
      entityHistory = [];
      this.history.set(entityId, entityHistory);
    }
    entityHistory.push(delta);
    if (entityHistory.length > this.maxHistoryPerEntity) {
      entityHistory.shift();
    }
  }

  getEntityHistory(id: EntityId, since?: number): StateDelta[] {
    const entityHistory = this.history.get(id) || [];
    if (since !== undefined) {
      return entityHistory.filter(d => d.fromVersion >= since);
    }
    return [...entityHistory];
  }

  createSnapshot(): StateSnapshot {
    const cached = this.cache.get('snapshot') as StateSnapshot | undefined;
    if (cached && cached.version === this.version) {
      return cached;
    }

    const snapshot: StateSnapshot = {
      version: this.version,
      timestamp: Date.now(),
      entities: new Map(this.entities),
      checksum: this.computeChecksum(),
    };

    this.cache.set('snapshot', snapshot);
    return snapshot;
  }

  loadSnapshot(snapshot: StateSnapshot): void {
    this.entities = new Map(snapshot.entities);
    this.version = snapshot.version;
    this.history.clear();
    this.cache.delete('snapshot');
    log.info('State loaded from snapshot', { version: snapshot.version, entities: this.entities.size });
    globalEventBus.emitSync('state:loaded', { version: snapshot.version });
  }

  getDeltasSince(version: number): StateDelta[] {
    const deltas: StateDelta[] = [];
    for (const entityHistory of this.history.values()) {
      for (const delta of entityHistory) {
        if (delta.fromVersion >= version) {
          deltas.push(delta);
        }
      }
    }
    return deltas.sort((a, b) => a.timestamp - b.timestamp);
  }

  private computeChecksum(): string {
    let hash = 0;
    for (const [id, entity] of this.entities) {
      const str = `${id}:${entity.version}:${entity.lastModified}`;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
      }
    }
    return hash.toString(16);
  }

  get currentVersion(): number {
    return this.version;
  }

  get entityCount(): number {
    return this.entities.size;
  }

  clear(): void {
    this.entities.clear();
    this.history.clear();
    this.version = 0;
    this.cache.clear();
  }
}
