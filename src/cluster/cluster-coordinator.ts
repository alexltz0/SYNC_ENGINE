import { createChildLogger } from '../utils/logger';
import { globalEventBus } from '../core/event-bus';
import { MessageBroker } from '../core/message-broker';
import { NodeRegistry } from './node-registry';
import { IntervalTimer } from '../utils/timer';
import { NodeId, NodeInfo, NodeStatus, MessageType } from '../core/types';
import { config } from '../config';

const log = createChildLogger('ClusterCoordinator');

export interface ClusterState {
  leaderId: NodeId | null;
  term: number;
  nodes: NodeInfo[];
  lastElection: number;
}

export class ClusterCoordinator {
  private readonly nodeRegistry: NodeRegistry;
  private readonly broker: MessageBroker;
  private readonly localNode: NodeInfo;
  private leaderId: NodeId | null = null;
  private term: number = 0;
  private readonly clusterChannel = 'cluster:coordination';
  private heartbeatTimer: IntervalTimer;
  private electionTimer: IntervalTimer | null = null;

  constructor(nodeRegistry: NodeRegistry, broker: MessageBroker) {
    this.nodeRegistry = nodeRegistry;
    this.broker = broker;

    this.localNode = {
      id: config.cluster.nodeId,
      host: config.cluster.advertiseHost,
      port: config.cluster.advertisePort,
      region: config.cluster.region,
      zone: config.cluster.zone,
      status: NodeStatus.ACTIVE,
      load: 0,
      connections: 0,
      maxConnections: config.ws.maxConnections,
      startedAt: Date.now(),
      lastHeartbeat: Date.now(),
      metadata: {},
    };

    this.heartbeatTimer = new IntervalTimer(() => this.sendHeartbeat(), config.ws.heartbeatInterval);
    this.setupListeners();
  }

  async start(): Promise<void> {
    this.nodeRegistry.start();
    this.nodeRegistry.registerNode(this.localNode);
    this.heartbeatTimer.start();

    await this.broker.publish(this.clusterChannel, MessageType.NODE_ANNOUNCE, {
      node: this.localNode,
    });

    this.startElection();
    log.info('Cluster coordinator started', { nodeId: this.localNode.id });
  }

  async stop(): Promise<void> {
    this.heartbeatTimer.stop();
    if (this.electionTimer) this.electionTimer.stop();

    await this.broker.publish(this.clusterChannel, MessageType.NODE_GOODBYE, {
      nodeId: this.localNode.id,
    });

    this.nodeRegistry.stop();
    log.info('Cluster coordinator stopped');
  }

  private setupListeners(): void {
    this.broker.subscribe(this.clusterChannel, (message) => {
      switch (message.type) {
        case MessageType.NODE_ANNOUNCE:
          this.handleNodeAnnounce(message.payload as { node: NodeInfo });
          break;
        case MessageType.NODE_GOODBYE:
          this.handleNodeGoodbye(message.payload as { nodeId: NodeId });
          break;
        case MessageType.HEARTBEAT:
          this.handleHeartbeat(message.payload as { nodeId: NodeId; load: number; connections: number });
          break;
      }
    });

    globalEventBus.on('cluster:node_offline', (envelope) => {
      const { node } = envelope.payload as { node: NodeInfo };
      if (node.id === this.leaderId) {
        log.warn('Leader node went offline, starting election');
        this.startElection();
      }
    });
  }

  private handleNodeAnnounce(data: { node: NodeInfo }): void {
    this.nodeRegistry.registerNode(data.node);
    if (this.isLeader()) {
      this.broker.publish(this.clusterChannel, MessageType.NODE_ANNOUNCE, {
        node: this.localNode,
      });
    }
  }

  private handleNodeGoodbye(data: { nodeId: NodeId }): void {
    this.nodeRegistry.deregisterNode(data.nodeId);
    if (data.nodeId === this.leaderId) {
      this.startElection();
    }
  }

  private handleHeartbeat(data: { nodeId: NodeId; load: number; connections: number }): void {
    this.nodeRegistry.updateHeartbeat(data.nodeId, data.load, data.connections);
  }

  private async sendHeartbeat(): Promise<void> {
    this.localNode.lastHeartbeat = Date.now();
    this.localNode.load = this.calculateLoad();

    this.nodeRegistry.updateHeartbeat(this.localNode.id, this.localNode.load, this.localNode.connections);

    await this.broker.publish(this.clusterChannel, MessageType.HEARTBEAT, {
      nodeId: this.localNode.id,
      load: this.localNode.load,
      connections: this.localNode.connections,
    });
  }

  private startElection(): void {
    this.term++;
    const activeNodes = this.nodeRegistry.getActiveNodes();
    if (activeNodes.length === 0) {
      this.leaderId = this.localNode.id;
      log.info('Self-elected as leader (only node)', { term: this.term });
      globalEventBus.emitSync('cluster:leader_elected', { leaderId: this.leaderId, term: this.term });
      return;
    }

    const sorted = [...activeNodes].sort((a, b) => {
      if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt;
      return a.id.localeCompare(b.id);
    });

    this.leaderId = sorted[0].id;
    log.info('Leader elected', { leaderId: this.leaderId, term: this.term, nodeCount: activeNodes.length });
    globalEventBus.emitSync('cluster:leader_elected', { leaderId: this.leaderId, term: this.term });
  }

  private calculateLoad(): number {
    const memUsage = process.memoryUsage();
    const heapUsed = memUsage.heapUsed / memUsage.heapTotal;
    const connectionRatio = this.localNode.connections / Math.max(this.localNode.maxConnections, 1);
    return Math.min(1, (heapUsed * 0.4 + connectionRatio * 0.6));
  }

  isLeader(): boolean {
    return this.leaderId === this.localNode.id;
  }

  getLeaderId(): NodeId | null {
    return this.leaderId;
  }

  getLocalNode(): NodeInfo {
    return { ...this.localNode };
  }

  getClusterState(): ClusterState {
    return {
      leaderId: this.leaderId,
      term: this.term,
      nodes: this.nodeRegistry.getAllNodes(),
      lastElection: Date.now(),
    };
  }

  updateConnectionCount(count: number): void {
    this.localNode.connections = count;
  }
}
