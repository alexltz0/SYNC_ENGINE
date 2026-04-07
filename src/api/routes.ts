import { Router, Request, Response } from 'express';
import { createAuthMiddleware, createRoleMiddleware, createRateLimitMiddleware } from './middleware';
import { AuthService } from '../security/auth';
import { RateLimiter } from '../security/rate-limiter';
import { GameServerManager } from '../orchestration/game-server-manager';
import { Matchmaker } from '../orchestration/matchmaker';
import { StateManager } from '../core/state-manager';
import { ClusterCoordinator } from '../cluster/cluster-coordinator';
import { MetricsCollector } from '../monitoring/metrics-collector';
import { AlertManager } from '../monitoring/alerting';
import { SyncWebSocketServer } from '../network/websocket-server';
import { SnapshotManager } from '../persistence/snapshot-manager';
import { HealthCheck } from '../core/types';

export interface APIContext {
  authService: AuthService;
  rateLimiter: RateLimiter;
  serverManager: GameServerManager;
  matchmaker: Matchmaker;
  stateManager: StateManager;
  clusterCoordinator: ClusterCoordinator;
  metricsCollector: MetricsCollector;
  alertManager: AlertManager;
  wsServer: SyncWebSocketServer;
  snapshotManager: SnapshotManager;
}

export function createRouter(ctx: APIContext): Router {
  const router = Router();
  const auth = createAuthMiddleware(ctx.authService);
  const adminOnly = createRoleMiddleware('admin');
  const rateLimit = createRateLimitMiddleware(ctx.rateLimiter);

  router.use(rateLimit);

  // ─── Health ───
  router.get('/health', (req: Request, res: Response) => {
    const health: HealthCheck = {
      status: 'healthy',
      checks: [
        { name: 'api', status: 'pass' },
        { name: 'websocket', status: ctx.wsServer.connectionCount >= 0 ? 'pass' : 'fail' },
        { name: 'state', status: ctx.stateManager.entityCount >= 0 ? 'pass' : 'fail' },
      ],
      timestamp: Date.now(),
    };

    const hasFailure = health.checks.some(c => c.status === 'fail');
    health.status = hasFailure ? 'unhealthy' : 'healthy';
    res.status(hasFailure ? 503 : 200).json(health);
  });

  // ─── Auth ───
  router.post('/auth/register', async (req: Request, res: Response) => {
    try {
      const { username, password, roles } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: 'Username and password required' });
        return;
      }
      const result = await ctx.authService.createUser(username, password, roles);
      res.status(result.success ? 201 : 400).json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/auth/login', async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: 'Username and password required' });
        return;
      }
      const result = await ctx.authService.authenticate(username, password);
      res.status(result.success ? 200 : 401).json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─── Cluster ───
  router.get('/cluster/state', auth, (req: Request, res: Response) => {
    res.json(ctx.clusterCoordinator.getClusterState());
  });

  router.get('/cluster/node', auth, (req: Request, res: Response) => {
    res.json(ctx.clusterCoordinator.getLocalNode());
  });

  // ─── Game Servers ───
  router.get('/servers', auth, (req: Request, res: Response) => {
    const { mode, map, status } = req.query;
    let servers = ctx.serverManager.getAllServers();
    if (mode) servers = servers.filter(s => s.mode === mode);
    if (map) servers = servers.filter(s => s.map === map);
    if (status) servers = servers.filter(s => s.status === status);
    res.json({ servers, total: servers.length });
  });

  router.post('/servers', auth, adminOnly, (req: Request, res: Response) => {
    try {
      const server = ctx.serverManager.createServer(req.body);
      res.status(201).json(server);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/servers/:id', auth, (req: Request, res: Response) => {
    const server = ctx.serverManager.getServer(req.params.id);
    if (!server) { res.status(404).json({ error: 'Server not found' }); return; }
    res.json(server);
  });

  router.delete('/servers/:id', auth, adminOnly, (req: Request, res: Response) => {
    const removed = ctx.serverManager.removeServer(req.params.id);
    if (!removed) { res.status(404).json({ error: 'Server not found' }); return; }
    res.json({ success: true });
  });

  router.get('/servers/stats/summary', auth, (req: Request, res: Response) => {
    res.json(ctx.serverManager.getStats());
  });

  // ─── Matchmaking ───
  router.post('/matchmaking/enqueue', auth, (req: Request, res: Response) => {
    try {
      const { mode, map, preferredRegion, skillRating } = req.body;
      if (!mode) { res.status(400).json({ error: 'Mode required' }); return; }
      ctx.matchmaker.enqueue({
        playerId: req.userId!,
        mode,
        map,
        preferredRegion,
        skillRating,
        requestedAt: Date.now(),
      });
      res.json({ success: true, queueSize: ctx.matchmaker.getQueueSize(mode) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/matchmaking/dequeue', auth, (req: Request, res: Response) => {
    const { mode } = req.body;
    const removed = ctx.matchmaker.dequeue(req.userId!, mode);
    res.json({ success: removed });
  });

  router.get('/matchmaking/queue', auth, (req: Request, res: Response) => {
    const mode = req.query.mode as string | undefined;
    res.json({ queueSize: ctx.matchmaker.getQueueSize(mode) });
  });

  router.get('/matches', auth, (req: Request, res: Response) => {
    res.json({ matches: ctx.matchmaker.getAllMatches() });
  });

  router.get('/matches/active', auth, (req: Request, res: Response) => {
    res.json({ matches: ctx.matchmaker.getActiveMatches() });
  });

  router.get('/matches/:id', auth, (req: Request, res: Response) => {
    const match = ctx.matchmaker.getMatch(req.params.id);
    if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
    res.json(match);
  });

  router.post('/matches/:id/end', auth, adminOnly, (req: Request, res: Response) => {
    const ended = ctx.matchmaker.endMatch(req.params.id);
    if (!ended) { res.status(404).json({ error: 'Match not found' }); return; }
    res.json({ success: true });
  });

  router.get('/matchmaking/stats', auth, (req: Request, res: Response) => {
    res.json(ctx.matchmaker.getStats());
  });

  // ─── State / Entities ───
  router.get('/state/entities', auth, (req: Request, res: Response) => {
    const { type, owner } = req.query;
    let entities;
    if (type) entities = ctx.stateManager.getEntitiesByType(type as string);
    else if (owner) entities = ctx.stateManager.getEntitiesByOwner(owner as string);
    else entities = Array.from(ctx.stateManager.getAllEntities().values());
    res.json({ entities, total: entities.length, version: ctx.stateManager.currentVersion });
  });

  router.get('/state/entities/:id', auth, (req: Request, res: Response) => {
    const entity = ctx.stateManager.getEntity(req.params.id);
    if (!entity) { res.status(404).json({ error: 'Entity not found' }); return; }
    res.json(entity);
  });

  router.post('/state/entities', auth, (req: Request, res: Response) => {
    const { type, data } = req.body;
    if (!type) { res.status(400).json({ error: 'Type required' }); return; }
    const entity = ctx.stateManager.createEntity(type, req.userId!, data);
    res.status(201).json(entity);
  });

  router.patch('/state/entities/:id', auth, (req: Request, res: Response) => {
    const { operations } = req.body;
    if (!operations || !Array.isArray(operations)) {
      res.status(400).json({ error: 'Operations array required' });
      return;
    }
    const entity = ctx.stateManager.updateEntity(req.params.id, operations);
    if (!entity) { res.status(404).json({ error: 'Entity not found' }); return; }
    res.json(entity);
  });

  router.delete('/state/entities/:id', auth, (req: Request, res: Response) => {
    const deleted = ctx.stateManager.deleteEntity(req.params.id);
    if (!deleted) { res.status(404).json({ error: 'Entity not found' }); return; }
    res.json({ success: true });
  });

  router.get('/state/entities/:id/history', auth, (req: Request, res: Response) => {
    const since = req.query.since ? parseInt(req.query.since as string) : undefined;
    const history = ctx.stateManager.getEntityHistory(req.params.id, since);
    res.json({ history });
  });

  router.get('/state/version', auth, (req: Request, res: Response) => {
    res.json({ version: ctx.stateManager.currentVersion, entityCount: ctx.stateManager.entityCount });
  });

  // ─── Snapshots ───
  router.post('/snapshots', auth, adminOnly, (req: Request, res: Response) => {
    const meta = ctx.snapshotManager.takeSnapshot();
    if (!meta) { res.status(500).json({ error: 'Snapshot failed' }); return; }
    res.status(201).json(meta);
  });

  router.get('/snapshots', auth, (req: Request, res: Response) => {
    res.json({ snapshots: ctx.snapshotManager.getSnapshots() });
  });

  // ─── Monitoring ───
  router.get('/metrics', (req: Request, res: Response) => {
    res.type('text/plain').send(ctx.metricsCollector.toPrometheus());
  });

  router.get('/metrics/json', auth, (req: Request, res: Response) => {
    res.json(ctx.metricsCollector.getAllMetrics());
  });

  router.get('/alerts', auth, (req: Request, res: Response) => {
    res.json({
      active: ctx.alertManager.getActiveAlerts(),
      history: ctx.alertManager.getAlertHistory(),
    });
  });

  router.post('/alerts/:id/acknowledge', auth, adminOnly, (req: Request, res: Response) => {
    const acked = ctx.alertManager.acknowledgeAlert(req.params.id);
    res.json({ success: acked });
  });

  // ─── WebSocket Stats ───
  router.get('/connections', auth, (req: Request, res: Response) => {
    res.json(ctx.wsServer.getStats());
  });

  // ─── Dashboard Stats ───
  router.get('/dashboard/overview', auth, (req: Request, res: Response) => {
    res.json({
      cluster: ctx.clusterCoordinator.getClusterState(),
      servers: ctx.serverManager.getStats(),
      matchmaking: ctx.matchmaker.getStats(),
      connections: ctx.wsServer.getStats(),
      state: { version: ctx.stateManager.currentVersion, entities: ctx.stateManager.entityCount },
      alerts: ctx.alertManager.getStats(),
      snapshots: ctx.snapshotManager.getStats(),
    });
  });

  return router;
}
