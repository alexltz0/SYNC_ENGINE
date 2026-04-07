import { createChildLogger } from '../utils/logger';
import { globalEventBus } from '../core/event-bus';
import { generateMatchId } from '../utils/id';
import { IntervalTimer } from '../utils/timer';
import { GameServerManager } from './game-server-manager';
import { MatchId, MatchInfo, MatchStatus, PlayerId, ServerId } from '../core/types';
import { config } from '../config';

const log = createChildLogger('Matchmaker');

export interface MatchRequest {
  playerId: PlayerId;
  mode: string;
  map?: string;
  preferredRegion?: string;
  skillRating?: number;
  metadata?: Record<string, unknown>;
  requestedAt: number;
}

export interface MatchmakingConfig {
  minPlayers: number;
  maxPlayers: number;
  maxWaitTimeMs: number;
  skillRange: number;
  expandSkillOverTime: boolean;
}

const DEFAULT_CONFIG: MatchmakingConfig = {
  minPlayers: 2,
  maxPlayers: 10,
  maxWaitTimeMs: 60000,
  skillRange: 200,
  expandSkillOverTime: true,
};

export class Matchmaker {
  private queue = new Map<string, MatchRequest[]>();
  private matches = new Map<MatchId, MatchInfo>();
  private configs = new Map<string, MatchmakingConfig>();
  private readonly serverManager: GameServerManager;
  private matchmakingTimer: IntervalTimer;

  constructor(serverManager: GameServerManager) {
    this.serverManager = serverManager;
    this.matchmakingTimer = new IntervalTimer(() => this.processQueues(), config.gameServer.matchmakingInterval);
  }

  start(): void {
    this.matchmakingTimer.start();
    log.info('Matchmaker started');
  }

  stop(): void {
    this.matchmakingTimer.stop();
    log.info('Matchmaker stopped');
  }

  setModeConfig(mode: string, cfg: Partial<MatchmakingConfig>): void {
    this.configs.set(mode, { ...DEFAULT_CONFIG, ...cfg });
  }

  enqueue(request: MatchRequest): void {
    const key = request.mode;
    const modeQueue = this.queue.get(key) || [];
    modeQueue.push(request);
    this.queue.set(key, modeQueue);

    log.debug('Player enqueued for matchmaking', { playerId: request.playerId, mode: request.mode });
    globalEventBus.emitSync('matchmaking:enqueued', { request });
  }

  dequeue(playerId: PlayerId, mode: string): boolean {
    const modeQueue = this.queue.get(mode);
    if (!modeQueue) return false;

    const idx = modeQueue.findIndex(r => r.playerId === playerId);
    if (idx === -1) return false;

    modeQueue.splice(idx, 1);
    if (modeQueue.length === 0) this.queue.delete(mode);

    globalEventBus.emitSync('matchmaking:dequeued', { playerId, mode });
    return true;
  }

  getMatch(matchId: MatchId): MatchInfo | undefined {
    return this.matches.get(matchId);
  }

  getAllMatches(): MatchInfo[] {
    return Array.from(this.matches.values());
  }

  getActiveMatches(): MatchInfo[] {
    return Array.from(this.matches.values()).filter(
      m => m.status === MatchStatus.IN_PROGRESS || m.status === MatchStatus.STARTING
    );
  }

  getQueueSize(mode?: string): number {
    if (mode) return this.queue.get(mode)?.length || 0;
    let total = 0;
    for (const q of this.queue.values()) total += q.length;
    return total;
  }

  private processQueues(): void {
    for (const [mode, modeQueue] of this.queue) {
      const cfg = this.configs.get(mode) || DEFAULT_CONFIG;
      this.processQueue(mode, modeQueue, cfg);
    }
  }

  private processQueue(mode: string, queue: MatchRequest[], cfg: MatchmakingConfig): void {
    const now = Date.now();

    const expired = queue.filter(r => now - r.requestedAt > cfg.maxWaitTimeMs);
    for (const req of expired) {
      globalEventBus.emitSync('matchmaking:timeout', { playerId: req.playerId, mode });
    }

    const active = queue.filter(r => now - r.requestedAt <= cfg.maxWaitTimeMs);
    this.queue.set(mode, active);
    if (active.length === 0) {
      this.queue.delete(mode);
      return;
    }

    const sorted = [...active].sort((a, b) => (a.skillRating || 0) - (b.skillRating || 0));

    while (sorted.length >= cfg.minPlayers) {
      const group = sorted.splice(0, Math.min(cfg.maxPlayers, sorted.length));
      if (group.length < cfg.minPlayers) {
        sorted.push(...group);
        break;
      }

      this.createMatch(mode, group, cfg);
    }

    const remaining = sorted.map(s => s.playerId);
    const newQueue = active.filter(r => remaining.includes(r.playerId));
    if (newQueue.length === 0) {
      this.queue.delete(mode);
    } else {
      this.queue.set(mode, newQueue);
    }
  }

  private createMatch(mode: string, players: MatchRequest[], cfg: MatchmakingConfig): void {
    const availableServers = this.serverManager.getAvailableServers().filter(s => s.mode === mode);
    let serverId: ServerId;

    if (availableServers.length > 0) {
      const server = availableServers.sort((a, b) => a.currentPlayers - b.currentPlayers)[0];
      serverId = server.id;
    } else {
      const newServer = this.serverManager.createServer({
        name: `${mode}-auto-${Date.now()}`,
        map: players[0].map || 'default',
        mode,
        maxPlayers: cfg.maxPlayers,
      });
      serverId = newServer.id;
    }

    const matchId = generateMatchId();
    const match: MatchInfo = {
      id: matchId,
      serverId,
      mode,
      map: players[0].map || 'default',
      status: MatchStatus.STARTING,
      players: players.map(p => p.playerId),
      maxPlayers: cfg.maxPlayers,
      startedAt: Date.now(),
      metadata: {},
    };

    this.matches.set(matchId, match);

    for (const player of players) {
      this.serverManager.addPlayer(serverId);
    }

    setTimeout(() => {
      const m = this.matches.get(matchId);
      if (m && m.status === MatchStatus.STARTING) {
        m.status = MatchStatus.IN_PROGRESS;
        globalEventBus.emitSync('match:started', { match: m });
      }
    }, 500);

    log.info('Match created', { matchId, mode, playerCount: players.length, serverId });
    globalEventBus.emitSync('match:created', { match });
  }

  endMatch(matchId: MatchId): boolean {
    const match = this.matches.get(matchId);
    if (!match) return false;

    match.status = MatchStatus.ENDING;
    match.endedAt = Date.now();
    match.duration = match.endedAt - (match.startedAt || match.endedAt);

    for (const playerId of match.players) {
      this.serverManager.removePlayer(match.serverId);
    }

    setTimeout(() => {
      const m = this.matches.get(matchId);
      if (m) {
        m.status = MatchStatus.COMPLETED;
        globalEventBus.emitSync('match:completed', { match: m });
      }
    }, 100);

    globalEventBus.emitSync('match:ending', { match });
    return true;
  }

  getStats(): { queuedPlayers: number; activeMatches: number; completedMatches: number; modes: string[] } {
    let queued = 0;
    for (const q of this.queue.values()) queued += q.length;

    const active = Array.from(this.matches.values()).filter(m => m.status === MatchStatus.IN_PROGRESS).length;
    const completed = Array.from(this.matches.values()).filter(m => m.status === MatchStatus.COMPLETED).length;

    return {
      queuedPlayers: queued,
      activeMatches: active,
      completedMatches: completed,
      modes: Array.from(this.queue.keys()),
    };
  }
}
