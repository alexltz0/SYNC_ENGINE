import { createChildLogger } from '../utils/logger';
import { globalEventBus } from '../core/event-bus';
import { NodeId, NodeInfo, NodeStatus } from '../core/types';
import { IntervalTimer } from '../utils/timer';

const log = createChildLogger('NodeRegistry');

export class NodeRegistry {
  private nodes = new Map<NodeId, NodeInfo>();
  private readonly localNodeId: NodeId;
  private readonly heartbeatTimeout: number;
  private healthCheckTimer: IntervalTimer;

  constructor(localNodeId: NodeId, heartbeatTimeout: number = 60000) {
    this.localNodeId = localNodeId;
    this.heartbeatTimeout = heartbeatTimeout;
    this.healthCheckTimer = new IntervalTimer(() => this.checkNodeHealth(), 10000);
  }

  start(): void {
    this.healthCheckTimer.start();
    log.info('Node registry started', { localNodeId: this.localNodeId });
  }

  stop(): void {
    this.healthCheckTimer.stop();
  }

  registerNode(info: NodeInfo): void {
    const existing = this.nodes.get(info.id);
    this.nodes.set(info.id, info);

    if (!existing) {
      log.info('Node registered', { nodeId: info.id, region: info.region, zone: info.zone });
      globalEventBus.emitSync('cluster:node_joined', { node: info });
    } else {
      globalEventBus.emitSync('cluster:node_updated', { node: info });
    }
  }

  deregisterNode(nodeId: NodeId): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      this.nodes.delete(nodeId);
      log.info('Node deregistered', { nodeId });
      globalEventBus.emitSync('cluster:node_left', { node });
    }
  }

  updateHeartbeat(nodeId: NodeId, load?: number, connections?: number): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.lastHeartbeat = Date.now();
      if (load !== undefined) node.load = load;
      if (connections !== undefined) node.connections = connections;
      if (node.status === NodeStatus.SUSPECT) {
        node.status = NodeStatus.ACTIVE;
        log.info('Node recovered from suspect state', { nodeId });
      }
    }
  }

  getNode(nodeId: NodeId): NodeInfo | undefined {
    return this.nodes.get(nodeId);
  }

  getActiveNodes(): NodeInfo[] {
    return Array.from(this.nodes.values()).filter(n => n.status === NodeStatus.ACTIVE);
  }

  getAllNodes(): NodeInfo[] {
    return Array.from(this.nodes.values());
  }

  getNodesByRegion(region: string): NodeInfo[] {
    return Array.from(this.nodes.values()).filter(n => n.region === region);
  }

  getNodesByZone(zone: string): NodeInfo[] {
    return Array.from(this.nodes.values()).filter(n => n.zone === zone);
  }

  getLeastLoadedNode(region?: string): NodeInfo | undefined {
    let candidates = this.getActiveNodes();
    if (region) candidates = candidates.filter(n => n.region === region);
    if (candidates.length === 0) return undefined;
    return candidates.sort((a, b) => a.load - b.load)[0];
  }

  private checkNodeHealth(): void {
    const now = Date.now();
    for (const [nodeId, node] of this.nodes) {
      if (nodeId === this.localNodeId) continue;

      const timeSinceHeartbeat = now - node.lastHeartbeat;
      if (timeSinceHeartbeat > this.heartbeatTimeout) {
        if (node.status === NodeStatus.ACTIVE) {
          node.status = NodeStatus.SUSPECT;
          log.warn('Node is suspect', { nodeId, timeSinceHeartbeat });
          globalEventBus.emitSync('cluster:node_suspect', { node });
        } else if (node.status === NodeStatus.SUSPECT && timeSinceHeartbeat > this.heartbeatTimeout * 2) {
          node.status = NodeStatus.OFFLINE;
          log.error('Node is offline', { nodeId, timeSinceHeartbeat });
          globalEventBus.emitSync('cluster:node_offline', { node });
        }
      }
    }
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  get activeNodeCount(): number {
    return this.getActiveNodes().length;
  }
}
