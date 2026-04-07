import { createChildLogger } from '../utils/logger';
import { globalEventBus } from '../core/event-bus';
import { MessageBroker } from '../core/message-broker';
import { StateManager } from '../core/state-manager';
import { ConflictResolver } from './conflict-resolver';
import { DeltaCompressor } from './delta-compressor';
import { IntervalTimer } from '../utils/timer';
import { MessageType, StateDelta, EntityState, NodeId } from '../core/types';

const log = createChildLogger('StateSynchronizer');

export interface SyncPeer {
  nodeId: NodeId;
  lastSyncVersion: number;
  lastSyncTime: number;
  syncCount: number;
  errorCount: number;
}

export class StateSynchronizer {
  private peers = new Map<NodeId, SyncPeer>();
  private readonly stateManager: StateManager;
  private readonly broker: MessageBroker;
  private readonly conflictResolver: ConflictResolver;
  private readonly deltaCompressor: DeltaCompressor;
  private readonly syncChannel: string;
  private syncTimer: IntervalTimer;
  private pendingDeltas: StateDelta[] = [];
  private readonly batchSize: number;
  private syncsPerformed: number = 0;

  constructor(
    stateManager: StateManager,
    broker: MessageBroker,
    conflictResolver: ConflictResolver,
    syncIntervalMs: number = 50,
    batchSize: number = 100
  ) {
    this.stateManager = stateManager;
    this.broker = broker;
    this.conflictResolver = conflictResolver;
    this.deltaCompressor = new DeltaCompressor();
    this.syncChannel = 'sync:state';
    this.batchSize = batchSize;

    this.syncTimer = new IntervalTimer(() => this.flushDeltas(), syncIntervalMs);

    this.setupListeners();
  }

  private setupListeners(): void {
    globalEventBus.on('entity:updated', (envelope) => {
      const { delta } = envelope.payload as { entity: EntityState; delta: StateDelta };
      this.pendingDeltas.push(delta);
    });

    this.broker.subscribe(this.syncChannel, async (message) => {
      if (message.type === MessageType.STATE_DELTA) {
        await this.handleRemoteDelta(message.source, message.payload as StateDelta[]);
      } else if (message.type === MessageType.STATE_SNAPSHOT) {
        await this.handleRemoteSnapshot(message.source, message.payload as { version: number; entities: Record<string, EntityState> });
      } else if (message.type === MessageType.STATE_REQUEST) {
        await this.handleStateRequest(message.source, message.payload as { sinceVersion: number });
      }
    });
  }

  start(): void {
    this.syncTimer.start();
    log.info('State synchronizer started');
  }

  stop(): void {
    this.syncTimer.stop();
    this.flushDeltas();
    log.info('State synchronizer stopped');
  }

  addPeer(nodeId: NodeId): void {
    if (!this.peers.has(nodeId)) {
      this.peers.set(nodeId, {
        nodeId,
        lastSyncVersion: 0,
        lastSyncTime: 0,
        syncCount: 0,
        errorCount: 0,
      });
      log.info('Sync peer added', { nodeId });
    }
  }

  removePeer(nodeId: NodeId): void {
    this.peers.delete(nodeId);
    log.info('Sync peer removed', { nodeId });
  }

  private async flushDeltas(): Promise<void> {
    if (this.pendingDeltas.length === 0) return;

    const batch = this.pendingDeltas.splice(0, this.batchSize);
    const compressed = this.deltaCompressor.compress(batch);

    await this.broker.publish(this.syncChannel, MessageType.STATE_DELTA, compressed);
    this.syncsPerformed++;
  }

  private async handleRemoteDelta(source: NodeId, deltas: StateDelta[]): Promise<void> {
    const peer = this.peers.get(source);

    for (const delta of deltas) {
      const localEntity = this.stateManager.getEntity(delta.entityId);

      if (!localEntity) {
        this.stateManager.updateEntity(delta.entityId, delta.operations);
        continue;
      }

      if (localEntity.version < delta.fromVersion) {
        this.stateManager.updateEntity(delta.entityId, delta.operations);
      } else if (localEntity.version === delta.fromVersion) {
        this.stateManager.updateEntity(delta.entityId, delta.operations);
      } else {
        const localDelta = this.stateManager.getEntityHistory(delta.entityId).pop();
        if (localDelta) {
          const remoteEntity: EntityState = {
            ...localEntity,
            version: delta.toVersion,
            lastModified: delta.timestamp,
          };
          for (const op of delta.operations) {
            this.applyOperationToData(remoteEntity.data, op);
          }

          const result = this.conflictResolver.resolve(localEntity, remoteEntity, localDelta, delta);
          if (result.resolved) {
            const ops = result.mergedOperations || delta.operations;
            this.stateManager.updateEntity(delta.entityId, ops);
          }
        }
      }
    }

    if (peer) {
      peer.lastSyncVersion = this.stateManager.currentVersion;
      peer.lastSyncTime = Date.now();
      peer.syncCount++;
    }
  }

  private applyOperationToData(data: Record<string, unknown>, op: { op: string; path: string; value?: unknown }): void {
    const parts = op.path.split('.');
    let current: Record<string, unknown> = data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof current[parts[i]] !== 'object' || current[parts[i]] === null) {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    const lastKey = parts[parts.length - 1];
    if (op.op === 'set') current[lastKey] = op.value;
    else if (op.op === 'delete') delete current[lastKey];
  }

  private async handleRemoteSnapshot(source: NodeId, snapshot: { version: number; entities: Record<string, EntityState> }): Promise<void> {
    log.info('Received remote snapshot', { source, version: snapshot.version });
    const entityMap = new Map(Object.entries(snapshot.entities));
    this.stateManager.loadSnapshot({
      version: snapshot.version,
      timestamp: Date.now(),
      entities: entityMap,
      checksum: '',
    });
  }

  private async handleStateRequest(source: NodeId, request: { sinceVersion: number }): Promise<void> {
    const deltas = this.stateManager.getDeltasSince(request.sinceVersion);
    if (deltas.length > 0) {
      await this.broker.publish(this.syncChannel, MessageType.STATE_DELTA, deltas, source);
    } else {
      const snapshot = this.stateManager.createSnapshot();
      const serializable = {
        version: snapshot.version,
        entities: Object.fromEntries(snapshot.entities),
      };
      await this.broker.publish(this.syncChannel, MessageType.STATE_SNAPSHOT, serializable, source);
    }
  }

  requestFullSync(fromNode: NodeId): void {
    this.broker.publish(this.syncChannel, MessageType.STATE_REQUEST, { sinceVersion: 0 }, fromNode);
  }

  getPeers(): SyncPeer[] {
    return Array.from(this.peers.values());
  }

  getStats(): { syncsPerformed: number; pendingDeltas: number; peerCount: number; compressionStats: ReturnType<DeltaCompressor['getStats']> } {
    return {
      syncsPerformed: this.syncsPerformed,
      pendingDeltas: this.pendingDeltas.length,
      peerCount: this.peers.size,
      compressionStats: this.deltaCompressor.getStats(),
    };
  }
}
