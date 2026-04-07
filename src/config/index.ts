import { z } from 'zod';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('0.0.0.0'),

  CLUSTER_NODE_ID: z.string().default(`node-${process.pid}`),
  CLUSTER_REGION: z.string().default('local'),
  CLUSTER_ZONE: z.string().default('local-1'),
  CLUSTER_ADVERTISE_HOST: z.string().default('localhost'),
  CLUSTER_ADVERTISE_PORT: z.coerce.number().default(8080),
  CLUSTER_SEEDS: z.string().default(''),

  WS_PORT: z.coerce.number().default(9090),
  WS_MAX_CONNECTIONS: z.coerce.number().default(10000),
  WS_HEARTBEAT_INTERVAL: z.coerce.number().default(30000),
  WS_MAX_PAYLOAD_SIZE: z.coerce.number().default(65536),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().default(''),
  REDIS_DB: z.coerce.number().default(0),
  REDIS_KEY_PREFIX: z.string().default('sync:'),

  DB_PATH: z.string().default('./data/sync_engine.db'),
  WAL_PATH: z.string().default('./data/wal'),
  SNAPSHOT_PATH: z.string().default('./data/snapshots'),
  SNAPSHOT_INTERVAL: z.coerce.number().default(300000),

  JWT_SECRET: z.string().default('dev-secret-change-in-production'),
  JWT_EXPIRATION: z.coerce.number().default(86400),
  BCRYPT_ROUNDS: z.coerce.number().default(12),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  METRICS_ENABLED: z.coerce.boolean().default(true),
  METRICS_PORT: z.coerce.number().default(9100),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_FORMAT: z.enum(['json', 'text']).default('json'),

  MAX_GAME_SERVERS: z.coerce.number().default(1000),
  DEFAULT_TICK_RATE: z.coerce.number().default(64),
  MAX_PLAYERS_PER_SERVER: z.coerce.number().default(100),
  MATCHMAKING_INTERVAL: z.coerce.number().default(5000),
  SERVER_TIMEOUT: z.coerce.number().default(60000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  server: {
    port: env.PORT,
    host: env.HOST,
  },

  cluster: {
    nodeId: env.CLUSTER_NODE_ID,
    region: env.CLUSTER_REGION,
    zone: env.CLUSTER_ZONE,
    advertiseHost: env.CLUSTER_ADVERTISE_HOST,
    advertisePort: env.CLUSTER_ADVERTISE_PORT,
    seeds: env.CLUSTER_SEEDS ? env.CLUSTER_SEEDS.split(',').map(s => s.trim()) : [],
  },

  ws: {
    port: env.WS_PORT,
    maxConnections: env.WS_MAX_CONNECTIONS,
    heartbeatInterval: env.WS_HEARTBEAT_INTERVAL,
    maxPayloadSize: env.WS_MAX_PAYLOAD_SIZE,
  },

  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    keyPrefix: env.REDIS_KEY_PREFIX,
  },

  persistence: {
    dbPath: path.resolve(env.DB_PATH),
    walPath: path.resolve(env.WAL_PATH),
    snapshotPath: path.resolve(env.SNAPSHOT_PATH),
    snapshotInterval: env.SNAPSHOT_INTERVAL,
  },

  security: {
    jwtSecret: env.JWT_SECRET,
    jwtExpiration: env.JWT_EXPIRATION,
    bcryptRounds: env.BCRYPT_ROUNDS,
    rateLimit: {
      window: env.RATE_LIMIT_WINDOW,
      maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
    },
  },

  monitoring: {
    enabled: env.METRICS_ENABLED,
    port: env.METRICS_PORT,
    logLevel: env.LOG_LEVEL,
    logFormat: env.LOG_FORMAT,
  },

  gameServer: {
    maxServers: env.MAX_GAME_SERVERS,
    defaultTickRate: env.DEFAULT_TICK_RATE,
    maxPlayersPerServer: env.MAX_PLAYERS_PER_SERVER,
    matchmakingInterval: env.MATCHMAKING_INTERVAL,
    serverTimeout: env.SERVER_TIMEOUT,
  },
} as const;

export type Config = typeof config;

export function ensureDataDirs(): void {
  const dirs = [
    path.dirname(config.persistence.dbPath),
    config.persistence.walPath,
    config.persistence.snapshotPath,
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
