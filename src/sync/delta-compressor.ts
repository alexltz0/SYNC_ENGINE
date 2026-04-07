import { StateDelta, DeltaOperation } from '../core/types';
import { createChildLogger } from '../utils/logger';

const log = createChildLogger('DeltaCompressor');

export class DeltaCompressor {
  private compressionRatio: number = 0;
  private totalCompressed: number = 0;

  compress(deltas: StateDelta[]): StateDelta[] {
    if (deltas.length <= 1) return deltas;

    const grouped = new Map<string, StateDelta[]>();
    for (const delta of deltas) {
      const key = delta.entityId;
      const group = grouped.get(key) || [];
      group.push(delta);
      grouped.set(key, group);
    }

    const compressed: StateDelta[] = [];
    for (const [entityId, entityDeltas] of grouped) {
      if (entityDeltas.length === 1) {
        compressed.push(entityDeltas[0]);
        continue;
      }

      const merged = this.mergeEntityDeltas(entityDeltas);
      if (merged) {
        compressed.push(merged);
      }
    }

    const originalCount = deltas.length;
    const compressedCount = compressed.length;
    if (originalCount > 0) {
      this.compressionRatio = 1 - (compressedCount / originalCount);
      this.totalCompressed += (originalCount - compressedCount);
    }

    log.debug('Deltas compressed', { original: originalCount, compressed: compressedCount, ratio: this.compressionRatio.toFixed(2) });
    return compressed;
  }

  private mergeEntityDeltas(deltas: StateDelta[]): StateDelta | null {
    if (deltas.length === 0) return null;

    const sorted = [...deltas].sort((a, b) => a.timestamp - b.timestamp);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    const mergedOps = this.collapseOperations(sorted.flatMap(d => d.operations));

    return {
      entityId: first.entityId,
      fromVersion: first.fromVersion,
      toVersion: last.toVersion,
      operations: mergedOps,
      timestamp: last.timestamp,
    };
  }

  private collapseOperations(operations: DeltaOperation[]): DeltaOperation[] {
    const pathOps = new Map<string, DeltaOperation>();

    for (const op of operations) {
      const existing = pathOps.get(op.path);

      if (!existing) {
        pathOps.set(op.path, { ...op });
        continue;
      }

      switch (op.op) {
        case 'set':
          pathOps.set(op.path, { ...op });
          break;
        case 'delete':
          pathOps.set(op.path, { ...op });
          break;
        case 'increment':
          if (existing.op === 'increment') {
            existing.value = (Number(existing.value) || 0) + (Number(op.value) || 1);
          } else if (existing.op === 'set') {
            existing.value = (Number(existing.value) || 0) + (Number(op.value) || 1);
          } else {
            pathOps.set(op.path, { ...op });
          }
          break;
        case 'append':
        case 'remove':
          pathOps.set(`${op.path}:${op.op}:${JSON.stringify(op.value)}`, { ...op });
          break;
      }
    }

    return Array.from(pathOps.values());
  }

  getStats(): { compressionRatio: number; totalCompressed: number } {
    return { compressionRatio: this.compressionRatio, totalCompressed: this.totalCompressed };
  }
}
