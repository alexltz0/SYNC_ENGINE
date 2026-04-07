export type NodeId = string;
export type ServerId = string;
export type SessionId = string;
export type PlayerId = string;
export type MatchId = string;
export type ChannelId = string;
export type EntityId = string;
export type Timestamp = number;

export enum NodeStatus {
  INITIALIZING = 'initializing',
  ACTIVE = 'active',
  DRAINING = 'draining',
  OFFLINE = 'offline',
  SUSPECT = 'suspect',
}

export enum ServerStatus {
  STARTING = 'starting',
  RUNNING = 'running',
  FULL = 'full',
  DRAINING = 'draining',
  STOPPED = 'stopped',
  ERROR = 'error',
}

export enum PlayerStatus {
  CONNECTED = 'connected',
  IN_LOBBY = 'in_lobby',
  IN_MATCH = 'in_match',
  DISCONNECTED = 'disconnected',
  RECONNECTING = 'reconnecting',
}

export enum MatchStatus {
  WAITING = 'waiting',
  STARTING = 'starting',
  IN_PROGRESS = 'in_progress',
  ENDING = 'ending',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export interface NodeInfo {
  id: NodeId;
  host: string;
  port: number;
  region: string;
  zone: string;
  status: NodeStatus;
  load: number;
  connections: number;
  maxConnections: number;
  startedAt: Timestamp;
  lastHeartbeat: Timestamp;
  metadata: Record<string, unknown>;
}

export interface GameServerInfo {
  id: ServerId;
  nodeId: NodeId;
  name: string;
  map: string;
  mode: string;
  status: ServerStatus;
  currentPlayers: number;
  maxPlayers: number;
  tickRate: number;
  uptimeMs: number;
  avgLatencyMs: number;
  metadata: Record<string, unknown>;
}

export interface PlayerInfo {
  id: PlayerId;
  sessionId: SessionId;
  displayName: string;
  status: PlayerStatus;
  serverId?: ServerId;
  matchId?: MatchId;
  connectedAt: Timestamp;
  lastActivity: Timestamp;
  latencyMs: number;
  metadata: Record<string, unknown>;
}

export interface MatchInfo {
  id: MatchId;
  serverId: ServerId;
  mode: string;
  map: string;
  status: MatchStatus;
  players: PlayerId[];
  maxPlayers: number;
  startedAt?: Timestamp;
  endedAt?: Timestamp;
  duration?: number;
  metadata: Record<string, unknown>;
}

export interface SyncMessage {
  id: string;
  type: MessageType;
  channel: ChannelId;
  source: NodeId;
  target?: NodeId;
  payload: unknown;
  timestamp: Timestamp;
  sequence: number;
  ttl: number;
}

export enum MessageType {
  STATE_UPDATE = 'state_update',
  STATE_DELTA = 'state_delta',
  STATE_SNAPSHOT = 'state_snapshot',
  STATE_REQUEST = 'state_request',

  ENTITY_CREATE = 'entity_create',
  ENTITY_UPDATE = 'entity_update',
  ENTITY_DELETE = 'entity_delete',

  EVENT = 'event',
  COMMAND = 'command',
  QUERY = 'query',
  RESPONSE = 'response',

  HEARTBEAT = 'heartbeat',
  HEARTBEAT_ACK = 'heartbeat_ack',

  JOIN = 'join',
  LEAVE = 'leave',

  NODE_ANNOUNCE = 'node_announce',
  NODE_GOODBYE = 'node_goodbye',

  ERROR = 'error',
}

export interface StateSnapshot {
  version: number;
  timestamp: Timestamp;
  entities: Map<EntityId, EntityState>;
  checksum: string;
}

export interface EntityState {
  id: EntityId;
  type: string;
  ownerId: PlayerId;
  data: Record<string, unknown>;
  version: number;
  lastModified: Timestamp;
}

export interface StateDelta {
  entityId: EntityId;
  fromVersion: number;
  toVersion: number;
  operations: DeltaOperation[];
  timestamp: Timestamp;
}

export interface DeltaOperation {
  op: 'set' | 'delete' | 'increment' | 'append' | 'remove';
  path: string;
  value?: unknown;
}

export interface SyncMetrics {
  messagesPerSecond: number;
  bytesPerSecond: number;
  activeConnections: number;
  activeServers: number;
  activePlayers: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  stateUpdatesPerSecond: number;
  conflictsResolved: number;
  snapshotsSaved: number;
  errorsPerSecond: number;
  uptime: number;
}

export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message?: string;
    latencyMs?: number;
  }[];
  timestamp: Timestamp;
}
