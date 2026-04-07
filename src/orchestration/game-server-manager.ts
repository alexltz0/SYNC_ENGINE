import { createChildLogger } from '../utils/logger';
import { globalEventBus } from '../core/event-bus';
import { generateServerId } from '../utils/id';
import { IntervalTimer } from '../utils/timer';
import { ServerId, GameServerInfo, ServerStatus, NodeId } from '../core/types';
import { config } from '../config';

const log = createChildLogger('GameServerManager');

export interface GameServerConfig {
  name: string;
  map: string;
  mode: string;
  maxPlayers?: number;
  tickRate?: number;
  metadata?: Record<string, unknown>;
}

export class GameServerManager {
  private servers = new Map<ServerId, GameServerInfo>();
  private readonly nodeId: NodeId;
  private healthCheckTimer: IntervalTimer;

  constructor(nodeId: NodeId) {
    this.nodeId = nodeId;
    this.healthCheckTimer = new IntervalTimer(() => this.checkServerHealth(), 10000);
  }

  start(): void {
    this.healthCheckTimer.start();
    log.info('Game server manager started');
  }

  stop(): void {
    this.healthCheckTimer.stop();
    for (const server of this.servers.values()) {
      server.status = ServerStatus.STOPPED;
    }
    log.info('Game server manager stopped');
  }

  createServer(cfg: GameServerConfig): GameServerInfo {
    if (this.servers.size >= config.gameServer.maxServers) {
      throw new Error(`Maximum server limit reached (${config.gameServer.maxServers})`);
    }

    const id = generateServerId();
    const server: GameServerInfo = {
      id,
      nodeId: this.nodeId,
      name: cfg.name,
      map: cfg.map,
      mode: cfg.mode,
      status: ServerStatus.STARTING,
      currentPlayers: 0,
      maxPlayers: cfg.maxPlayers || config.gameServer.maxPlayersPerServer,
      tickRate: cfg.tickRate || config.gameServer.defaultTickRate,
      uptimeMs: 0,
      avgLatencyMs: 0,
      metadata: cfg.metadata || {},
    };

    this.servers.set(id, server);

    setTimeout(() => {
      const srv = this.servers.get(id);
      if (srv && srv.status === ServerStatus.STARTING) {
        srv.status = ServerStatus.RUNNING;
        globalEventBus.emitSync('server:started', { server: srv });
        log.info('Game server started', { serverId: id, name: cfg.name, map: cfg.map });
      }
    }, 100);

    globalEventBus.emitSync('server:created', { server });
    return server;
  }

  stopServer(serverId: ServerId): boolean {
    const server = this.servers.get(serverId);
    if (!server) return false;

    server.status = ServerStatus.DRAINING;
    globalEventBus.emitSync('server:draining', { server });

    setTimeout(() => {
      const srv = this.servers.get(serverId);
      if (srv) {
        srv.status = ServerStatus.STOPPED;
        globalEventBus.emitSync('server:stopped', { server: srv });
        log.info('Game server stopped', { serverId });
      }
    }, 1000);

    return true;
  }

  removeServer(serverId: ServerId): boolean {
    const server = this.servers.get(serverId);
    if (!server) return false;

    if (server.status !== ServerStatus.STOPPED) {
      this.stopServer(serverId);
    }

    this.servers.delete(serverId);
    globalEventBus.emitSync('server:removed', { serverId });
    return true;
  }

  getServer(serverId: ServerId): GameServerInfo | undefined {
    return this.servers.get(serverId);
  }

  getAllServers(): GameServerInfo[] {
    return Array.from(this.servers.values());
  }

  getRunningServers(): GameServerInfo[] {
    return Array.from(this.servers.values()).filter(
      s => s.status === ServerStatus.RUNNING
    );
  }

  getAvailableServers(): GameServerInfo[] {
    return this.getRunningServers().filter(s => s.currentPlayers < s.maxPlayers);
  }

  getServersByMode(mode: string): GameServerInfo[] {
    return this.getRunningServers().filter(s => s.mode === mode);
  }

  getServersByMap(map: string): GameServerInfo[] {
    return this.getRunningServers().filter(s => s.map === map);
  }

  addPlayer(serverId: ServerId): boolean {
    const server = this.servers.get(serverId);
    if (!server || server.status !== ServerStatus.RUNNING) return false;
    if (server.currentPlayers >= server.maxPlayers) return false;

    server.currentPlayers++;
    if (server.currentPlayers >= server.maxPlayers) {
      server.status = ServerStatus.FULL;
    }

    globalEventBus.emitSync('server:player_joined', { serverId, playerCount: server.currentPlayers });
    return true;
  }

  removePlayer(serverId: ServerId): boolean {
    const server = this.servers.get(serverId);
    if (!server) return false;

    server.currentPlayers = Math.max(0, server.currentPlayers - 1);
    if (server.status === ServerStatus.FULL && server.currentPlayers < server.maxPlayers) {
      server.status = ServerStatus.RUNNING;
    }

    globalEventBus.emitSync('server:player_left', { serverId, playerCount: server.currentPlayers });
    return true;
  }

  updateServerLatency(serverId: ServerId, latencyMs: number): void {
    const server = this.servers.get(serverId);
    if (server) {
      server.avgLatencyMs = (server.avgLatencyMs * 0.8) + (latencyMs * 0.2);
    }
  }

  private checkServerHealth(): void {
    for (const server of this.servers.values()) {
      if (server.status === ServerStatus.RUNNING || server.status === ServerStatus.FULL) {
        server.uptimeMs += 10000;
      }

      if (server.status === ServerStatus.ERROR) {
        log.warn('Server in error state', { serverId: server.id });
        globalEventBus.emitSync('server:error', { server });
      }
    }
  }

  getStats(): { total: number; running: number; full: number; stopped: number; totalPlayers: number } {
    let running = 0, full = 0, stopped = 0, totalPlayers = 0;
    for (const server of this.servers.values()) {
      switch (server.status) {
        case ServerStatus.RUNNING: running++; break;
        case ServerStatus.FULL: full++; break;
        case ServerStatus.STOPPED: stopped++; break;
      }
      totalPlayers += server.currentPlayers;
    }
    return { total: this.servers.size, running, full, stopped, totalPlayers };
  }
}
