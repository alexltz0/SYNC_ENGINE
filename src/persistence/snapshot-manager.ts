import * as fs from 'fs';
import * as path from 'path';
import { createChildLogger } from '../utils/logger';
import { globalEventBus } from '../core/event-bus';
import { StateManager } from '../core/state-manager';
import { WriteAheadLog } from './write-ahead-log';
import { IntervalTimer } from '../utils/timer';
import { StateSnapshot, EntityState } from '../core/types';
import { config } from '../config';

const log = createChildLogger('SnapshotManager');

interface SnapshotMeta {
  version: number;
  timestamp: number;
  entityCount: number;
  checksum: string;
  filename: string;
  sizeBytes: number;
}

export class SnapshotManager {
  private readonly snapshotDir: string;
  private readonly stateManager: StateManager;
  private readonly wal: WriteAheadLog;
  private snapshotTimer: IntervalTimer;
  private snapshots: SnapshotMeta[] = [];
  private readonly maxSnapshots: number;
  private snapshotsTaken: number = 0;

  constructor(stateManager: StateManager, wal: WriteAheadLog, maxSnapshots: number = 10) {
    this.snapshotDir = config.persistence.snapshotPath;
    this.stateManager = stateManager;
    this.wal = wal;
    this.maxSnapshots = maxSnapshots;

    this.snapshotTimer = new IntervalTimer(() => { this.takeSnapshot(); }, config.persistence.snapshotInterval);

    if (!fs.existsSync(this.snapshotDir)) {
      fs.mkdirSync(this.snapshotDir, { recursive: true });
    }
  }

  start(): void {
    this.loadSnapshotIndex();
    this.snapshotTimer.start();
    log.info('Snapshot manager started', { dir: this.snapshotDir, interval: config.persistence.snapshotInterval });
  }

  stop(): void {
    this.snapshotTimer.stop();
    this.takeSnapshot();
    log.info('Snapshot manager stopped');
  }

  takeSnapshot(): SnapshotMeta | null {
    try {
      const snapshot = this.stateManager.createSnapshot();
      const filename = `snapshot-${snapshot.version}-${snapshot.timestamp}.json`;
      const filePath = path.join(this.snapshotDir, filename);

      const serializable = {
        version: snapshot.version,
        timestamp: snapshot.timestamp,
        checksum: snapshot.checksum,
        entities: Object.fromEntries(snapshot.entities),
      };

      const content = JSON.stringify(serializable);
      fs.writeFileSync(filePath, content, 'utf-8');

      const meta: SnapshotMeta = {
        version: snapshot.version,
        timestamp: snapshot.timestamp,
        entityCount: snapshot.entities.size,
        checksum: snapshot.checksum,
        filename,
        sizeBytes: Buffer.byteLength(content, 'utf-8'),
      };

      this.snapshots.push(meta);
      this.snapshotsTaken++;
      this.pruneOldSnapshots();

      this.wal.appendCheckpoint(snapshot.version);

      globalEventBus.emitSync('snapshot:taken', { meta });
      log.info('Snapshot taken', { version: snapshot.version, entities: snapshot.entities.size, size: meta.sizeBytes });

      return meta;
    } catch (err) {
      log.error('Failed to take snapshot', { error: (err as Error).message });
      return null;
    }
  }

  loadLatestSnapshot(): boolean {
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!latest) {
      log.info('No snapshots found');
      return false;
    }

    return this.loadSnapshot(latest.filename);
  }

  loadSnapshot(filename: string): boolean {
    const filePath = path.join(this.snapshotDir, filename);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as {
        version: number;
        timestamp: number;
        checksum: string;
        entities: Record<string, EntityState>;
      };

      const entityMap = new Map<string, EntityState>();
      for (const [id, entity] of Object.entries(data.entities)) {
        entityMap.set(id, entity);
      }

      const snapshot: StateSnapshot = {
        version: data.version,
        timestamp: data.timestamp,
        entities: entityMap,
        checksum: data.checksum,
      };

      this.stateManager.loadSnapshot(snapshot);
      log.info('Snapshot loaded', { version: data.version, entities: entityMap.size });
      return true;
    } catch (err) {
      log.error('Failed to load snapshot', { filename, error: (err as Error).message });
      return false;
    }
  }

  recoverState(): boolean {
    const loaded = this.loadLatestSnapshot();
    if (!loaded) {
      log.info('No snapshot to recover from, starting fresh');
    }

    const fromSequence = loaded ? this.stateManager.currentVersion : 0;
    const walEntries = this.wal.replay(fromSequence);

    let applied = 0;
    for (const entry of walEntries) {
      if (entry.type === 'delta') {
        try {
          const delta = JSON.parse(entry.data);
          this.stateManager.updateEntity(delta.entityId, delta.operations);
          applied++;
        } catch {
          log.warn('Failed to apply WAL entry', { sequence: entry.sequence });
        }
      }
    }

    log.info('State recovery complete', { snapshotLoaded: loaded, walEntriesApplied: applied });
    return true;
  }

  private pruneOldSnapshots(): void {
    while (this.snapshots.length > this.maxSnapshots) {
      const oldest = this.snapshots.shift();
      if (oldest) {
        try {
          fs.unlinkSync(path.join(this.snapshotDir, oldest.filename));
          log.debug('Old snapshot pruned', { filename: oldest.filename });
        } catch {}
      }
    }
  }

  private loadSnapshotIndex(): void {
    try {
      const files = fs.readdirSync(this.snapshotDir)
        .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
        .sort();

      this.snapshots = [];
      for (const filename of files) {
        const filePath = path.join(this.snapshotDir, filename);
        try {
          const stat = fs.statSync(filePath);
          const match = filename.match(/snapshot-(\d+)-(\d+)\.json/);
          if (match) {
            this.snapshots.push({
              version: parseInt(match[1]),
              timestamp: parseInt(match[2]),
              entityCount: 0,
              checksum: '',
              filename,
              sizeBytes: stat.size,
            });
          }
        } catch {}
      }

      log.info('Snapshot index loaded', { count: this.snapshots.length });
    } catch {}
  }

  getSnapshots(): SnapshotMeta[] {
    return [...this.snapshots];
  }

  getStats(): { snapshotsTaken: number; storedSnapshots: number; latestVersion: number } {
    return {
      snapshotsTaken: this.snapshotsTaken,
      storedSnapshots: this.snapshots.length,
      latestVersion: this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1].version : 0,
    };
  }
}
