import { WebSocket } from 'ws';
import { createChildLogger } from '../utils/logger';
import { IntervalTimer } from '../utils/timer';

const log = createChildLogger('ConnectionPool');

export interface PooledConnection {
  id: string;
  ws: WebSocket;
  host: string;
  port: number;
  createdAt: number;
  lastUsed: number;
  inUse: boolean;
  errorCount: number;
}

export class ConnectionPool {
  private connections = new Map<string, PooledConnection[]>();
  private readonly maxPerHost: number;
  private readonly idleTimeoutMs: number;
  private readonly maxErrors: number;
  private cleanupTimer: IntervalTimer;

  constructor(maxPerHost: number = 5, idleTimeoutMs: number = 60000, maxErrors: number = 3) {
    this.maxPerHost = maxPerHost;
    this.idleTimeoutMs = idleTimeoutMs;
    this.maxErrors = maxErrors;
    this.cleanupTimer = new IntervalTimer(() => this.cleanup(), 30000);
  }

  start(): void {
    this.cleanupTimer.start();
  }

  stop(): void {
    this.cleanupTimer.stop();
    for (const connections of this.connections.values()) {
      for (const conn of connections) {
        conn.ws.close(1001, 'Pool shutting down');
      }
    }
    this.connections.clear();
  }

  async acquire(host: string, port: number): Promise<PooledConnection | null> {
    const key = `${host}:${port}`;
    const pool = this.connections.get(key) || [];

    const available = pool.find(c => !c.inUse && c.ws.readyState === WebSocket.OPEN);
    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();
      return available;
    }

    if (pool.length >= this.maxPerHost) {
      log.warn('Connection pool exhausted', { host, port, poolSize: pool.length });
      return null;
    }

    try {
      const conn = await this.createConnection(host, port);
      pool.push(conn);
      this.connections.set(key, pool);
      return conn;
    } catch (err) {
      log.error('Failed to create pooled connection', { host, port, error: (err as Error).message });
      return null;
    }
  }

  release(connection: PooledConnection): void {
    connection.inUse = false;
    connection.lastUsed = Date.now();
  }

  remove(connection: PooledConnection): void {
    const key = `${connection.host}:${connection.port}`;
    const pool = this.connections.get(key);
    if (pool) {
      const idx = pool.indexOf(connection);
      if (idx >= 0) pool.splice(idx, 1);
      if (pool.length === 0) this.connections.delete(key);
    }
    if (connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.close(1000);
    }
  }

  private createConnection(host: string, port: number): Promise<PooledConnection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${host}:${port}`);
      const id = `${host}:${port}:${Date.now()}`;

      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error('Connection timeout'));
      }, 10000);

      ws.on('open', () => {
        clearTimeout(timeout);
        const conn: PooledConnection = {
          id,
          ws,
          host,
          port,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          inUse: true,
          errorCount: 0,
        };
        resolve(conn);
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, pool] of this.connections) {
      const active = pool.filter(conn => {
        if (conn.inUse) return true;
        if (conn.errorCount >= this.maxErrors) {
          conn.ws.close(1000);
          return false;
        }
        if (now - conn.lastUsed > this.idleTimeoutMs) {
          conn.ws.close(1000);
          return false;
        }
        if (conn.ws.readyState !== WebSocket.OPEN) {
          return false;
        }
        return true;
      });

      if (active.length === 0) {
        this.connections.delete(key);
      } else {
        this.connections.set(key, active);
      }
    }
  }

  getStats(): { totalConnections: number; activeConnections: number; hosts: number } {
    let total = 0;
    let active = 0;
    for (const pool of this.connections.values()) {
      total += pool.length;
      active += pool.filter(c => c.inUse).length;
    }
    return { totalConnections: total, activeConnections: active, hosts: this.connections.size };
  }
}
