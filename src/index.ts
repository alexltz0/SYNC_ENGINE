import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';

import { config, ensureDataDirs } from './config';
import { logger, createChildLogger } from './utils/logger';
import { globalEventBus, EventBus } from './core/event-bus';
import { StateManager } from './core/state-manager';
import { MessageBroker } from './core/message-broker';
import { ConflictResolver } from './sync/conflict-resolver';
import { StateSynchronizer } from './sync/state-synchronizer';
import { NodeRegistry } from './cluster/node-registry';
import { ClusterCoordinator } from './cluster/cluster-coordinator';
import { SyncWebSocketServer } from './network/websocket-server';
import { ConnectionPool } from './network/connection-pool';
import { BinaryProtocol, PacketType } from './network/protocol';
import { GameServerManager } from './orchestration/game-server-manager';
import { Matchmaker } from './orchestration/matchmaker';
import { WriteAheadLog } from './persistence/write-ahead-log';
import { SnapshotManager } from './persistence/snapshot-manager';
import { AuthService } from './security/auth';
import { RateLimiter, TieredRateLimiter } from './security/rate-limiter';
import { MetricsCollector } from './monitoring/metrics-collector';
import { AlertManager, AlertSeverity } from './monitoring/alerting';
import { createRouter, APIContext } from './api/routes';
import { requestLogger, errorHandler } from './api/middleware';

const log = createChildLogger('Main');

class SyncEngine {
  private app = express();
  private httpServer = createServer(this.app);

  private stateManager = new StateManager();
  private broker = new MessageBroker(config.cluster.nodeId);
  private conflictResolver = new ConflictResolver();
  private synchronizer: StateSynchronizer;

  private nodeRegistry = new NodeRegistry(config.cluster.nodeId);
  private clusterCoordinator: ClusterCoordinator;

  private wsServer = new SyncWebSocketServer();
  private connectionPool = new ConnectionPool();

  private serverManager = new GameServerManager(config.cluster.nodeId);
  private matchmaker: Matchmaker;

  private wal = new WriteAheadLog(config.persistence.walPath);
  private snapshotManager: SnapshotManager;

  private authService = new AuthService();
  private rateLimiter = new RateLimiter();
  private tieredRateLimiter = new TieredRateLimiter();

  private metricsCollector = new MetricsCollector();
  private alertManager: AlertManager;

  private startTime = Date.now();

  constructor() {
    this.synchronizer = new StateSynchronizer(
      this.stateManager,
      this.broker,
      this.conflictResolver,
    );

    this.clusterCoordinator = new ClusterCoordinator(this.nodeRegistry, this.broker);
    this.matchmaker = new Matchmaker(this.serverManager);
    this.snapshotManager = new SnapshotManager(this.stateManager, this.wal);
    this.alertManager = new AlertManager(this.metricsCollector);

    this.setupExpress();
    this.setupWebSocket();
    this.setupMetrics();
    this.setupAlerts();
    this.setupEventListeners();
  }

  private setupExpress(): void {
    this.app.use(helmet({ contentSecurityPolicy: false }));
    this.app.use(cors());
    this.app.use(compression());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(requestLogger);

    const ctx: APIContext = {
      authService: this.authService,
      rateLimiter: this.rateLimiter,
      serverManager: this.serverManager,
      matchmaker: this.matchmaker,
      stateManager: this.stateManager,
      clusterCoordinator: this.clusterCoordinator,
      metricsCollector: this.metricsCollector,
      alertManager: this.alertManager,
      wsServer: this.wsServer,
      snapshotManager: this.snapshotManager,
    };

    this.app.use('/api/v1', createRouter(ctx));

    this.app.use('/dashboard', express.static('dashboard/dist'));

    this.app.use(errorHandler as any);
  }

  private setupWebSocket(): void {
    this.wsServer.onConnect((client) => {
      this.metricsCollector.incrementCounter('ws_connections_total');
      this.clusterCoordinator.updateConnectionCount(this.wsServer.connectionCount);
      log.debug('Client connected to WS', { sessionId: client.sessionId });
    });

    this.wsServer.onDisconnect((clientId, reason) => {
      this.metricsCollector.incrementCounter('ws_disconnections_total');
      this.clusterCoordinator.updateConnectionCount(this.wsServer.connectionCount);
    });

    this.wsServer.onMessage((clientId, data) => {
      this.metricsCollector.incrementCounter('ws_messages_received_total');
      try {
        const message = BinaryProtocol.decodeJSON(data);
        this.handleClientMessage(clientId, message);
      } catch (err) {
        log.error('Failed to process client message', { clientId, error: (err as Error).message });
      }
    });

    this.wsServer.onAuth(async (clientId, token) => {
      const decoded = this.authService.verifyToken(token);
      return decoded !== null;
    });
  }

  private handleClientMessage(clientId: string, message: any): void {
    switch (message.type) {
      case 'entity_update':
        if (message.entityId && message.operations) {
          this.stateManager.updateEntity(message.entityId, message.operations);
        }
        break;
      case 'entity_create':
        if (message.entityType) {
          const entity = this.stateManager.createEntity(message.entityType, clientId, message.data || {});
          const payload = BinaryProtocol.encodeJSON({ type: 'entity_created', entity });
          this.wsServer.sendToClient(clientId, PacketType.DATA, payload);
        }
        break;
      case 'state_request':
        const snapshot = this.stateManager.createSnapshot();
        const serializable = {
          type: 'state_snapshot',
          version: snapshot.version,
          entities: Object.fromEntries(snapshot.entities),
        };
        const payload = BinaryProtocol.encodeJSON(serializable);
        this.wsServer.sendToClient(clientId, PacketType.DATA, payload);
        break;
      case 'join_match':
        if (message.mode) {
          this.matchmaker.enqueue({
            playerId: clientId,
            mode: message.mode,
            map: message.map,
            skillRating: message.skillRating,
            requestedAt: Date.now(),
          });
        }
        break;
      case 'leave_match':
        if (message.mode) {
          this.matchmaker.dequeue(clientId, message.mode);
        }
        break;
      default:
        log.debug('Unknown client message type', { clientId, type: message.type });
    }
  }

  private setupMetrics(): void {
    this.metricsCollector.registerCollector(() => {
      const wsStats = this.wsServer.getStats();
      const serverStats = this.serverManager.getStats();
      const matchStats = this.matchmaker.getStats();
      const uptime = Date.now() - this.startTime;

      return {
        sync_active_connections: wsStats.activeConnections,
        sync_messages_received: wsStats.messagesReceived,
        sync_messages_sent: wsStats.messagesSent,
        sync_bytes_received: wsStats.bytesReceived,
        sync_bytes_sent: wsStats.bytesSent,
        sync_active_servers: serverStats.running,
        sync_total_players: serverStats.totalPlayers,
        sync_active_matches: matchStats.activeMatches,
        sync_queued_players: matchStats.queuedPlayers,
        sync_state_version: this.stateManager.currentVersion,
        sync_entity_count: this.stateManager.entityCount,
        sync_uptime_ms: uptime,
        sync_memory_heap_used: process.memoryUsage().heapUsed,
        sync_memory_heap_total: process.memoryUsage().heapTotal,
        sync_memory_rss: process.memoryUsage().rss,
      };
    });
  }

  private setupAlerts(): void {
    this.alertManager.addRule({
      id: 'high_memory',
      name: 'High Memory Usage',
      metric: 'sync_memory_heap_used',
      condition: 'gt',
      threshold: 1024 * 1024 * 1024,
      severity: AlertSeverity.WARNING,
      cooldownMs: 300000,
      message: 'Heap memory usage is {value} bytes, exceeding threshold of {threshold} bytes',
    });

    this.alertManager.addRule({
      id: 'high_connections',
      name: 'High Connection Count',
      metric: 'sync_active_connections',
      condition: 'gt',
      threshold: config.ws.maxConnections * 0.9,
      severity: AlertSeverity.WARNING,
      cooldownMs: 60000,
      message: 'Connection count {value} is approaching limit of {threshold}',
    });

    this.alertManager.addRule({
      id: 'no_connections',
      name: 'No Active Connections',
      metric: 'sync_active_connections',
      condition: 'eq',
      threshold: 0,
      severity: AlertSeverity.INFO,
      cooldownMs: 60000,
      message: 'No active WebSocket connections',
    });
  }

  private setupEventListeners(): void {
    globalEventBus.on('entity:updated', (envelope) => {
      const { delta } = envelope.payload as any;
      if (delta) {
        this.wal.appendDelta(delta);
      }
    });

    globalEventBus.on('cluster:leader_elected', (envelope) => {
      const { leaderId, term } = envelope.payload as any;
      log.info('Leader elected event', { leaderId, term });
    });

    globalEventBus.on('match:created', (envelope) => {
      const { match } = envelope.payload as any;
      this.metricsCollector.incrementCounter('matches_created_total');
      this.wsServer.broadcastJSON({ type: 'match_created', match });
    });

    globalEventBus.on('server:started', (envelope) => {
      const { server } = envelope.payload as any;
      this.metricsCollector.incrementCounter('servers_started_total');
    });

    globalEventBus.on('alert:fired', (envelope) => {
      const { alert } = envelope.payload as any;
      log.warn('ALERT', { name: alert.name, severity: alert.severity, message: alert.message });
    });
  }

  async start(): Promise<void> {
    log.info('Starting Sync Engine...', { nodeId: config.cluster.nodeId, env: config.env });

    ensureDataDirs();

    this.wal.start();
    this.snapshotManager.start();
    this.snapshotManager.recoverState();

    await this.clusterCoordinator.start();
    this.synchronizer.start();

    this.serverManager.start();
    this.matchmaker.start();

    this.rateLimiter.start();
    this.tieredRateLimiter.addTier('per_second', 1000, 50);
    this.tieredRateLimiter.addTier('per_minute', 60000, 1000);

    this.metricsCollector.start();
    this.alertManager.start();
    this.connectionPool.start();

    await this.wsServer.start(this.httpServer);

    await this.createDefaultAdmin();

    return new Promise((resolve) => {
      this.httpServer.listen(config.server.port, config.server.host, () => {
        log.info(`Sync Engine started successfully`, {
          http: `http://${config.server.host}:${config.server.port}`,
          ws: `ws://${config.server.host}:${config.server.port}`,
          api: `http://${config.server.host}:${config.server.port}/api/v1`,
          health: `http://${config.server.host}:${config.server.port}/api/v1/health`,
          metrics: `http://${config.server.host}:${config.server.port}/api/v1/metrics`,
        });
        resolve();
      });
    });
  }

  private async createDefaultAdmin(): Promise<void> {
    if (config.isDev) {
      const result = await this.authService.createUser('admin', 'admin123', ['admin']);
      if (result.success) {
        log.info('Default admin user created', { username: 'admin', token: result.token });
      }
    }
  }

  async stop(): Promise<void> {
    log.info('Shutting down Sync Engine...');

    this.alertManager.stop();
    this.metricsCollector.stop();
    this.matchmaker.stop();
    this.serverManager.stop();
    this.synchronizer.stop();
    await this.clusterCoordinator.stop();
    this.connectionPool.stop();
    await this.wsServer.stop();
    this.rateLimiter.stop();
    this.tieredRateLimiter.stop();
    this.snapshotManager.stop();
    this.wal.stop();
    globalEventBus.destroy();

    return new Promise((resolve) => {
      this.httpServer.close(() => {
        log.info('Sync Engine stopped');
        resolve();
      });
    });
  }
}

const engine = new SyncEngine();

process.on('SIGINT', async () => {
  await engine.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await engine.stop();
  process.exit(0);
});

process.on('unhandledRejection', (reason: any) => {
  log.error('Unhandled rejection', { error: reason?.message || reason });
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

engine.start().catch((err) => {
  log.error('Failed to start Sync Engine', { error: err.message });
  process.exit(1);
});

export { SyncEngine };
