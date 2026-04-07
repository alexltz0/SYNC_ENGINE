import { WebSocketServer, WebSocket, RawData } from 'ws';
import { createServer, IncomingMessage, Server as HttpServer } from 'http';
import { createChildLogger } from '../utils/logger';
import { globalEventBus } from '../core/event-bus';
import { generateSessionId } from '../utils/id';
import { BinaryProtocol, PacketType } from './protocol';
import { IntervalTimer } from '../utils/timer';
import { config } from '../config';

const log = createChildLogger('WebSocketServer');

export interface ClientConnection {
  id: string;
  ws: WebSocket;
  sessionId: string;
  ip: string;
  connectedAt: number;
  lastActivity: number;
  latencyMs: number;
  authenticated: boolean;
  metadata: Record<string, unknown>;
}

export interface WSServerStats {
  totalConnections: number;
  activeConnections: number;
  messagesReceived: number;
  messagesSent: number;
  bytesReceived: number;
  bytesSent: number;
  errors: number;
}

export class SyncWebSocketServer {
  private wss: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private clients = new Map<string, ClientConnection>();
  private protocol = new BinaryProtocol();
  private heartbeatTimer: IntervalTimer;
  private stats: WSServerStats = {
    totalConnections: 0,
    activeConnections: 0,
    messagesReceived: 0,
    messagesSent: 0,
    bytesReceived: 0,
    bytesSent: 0,
    errors: 0,
  };

  private onMessageHandler?: (clientId: string, data: Buffer) => void;
  private onConnectHandler?: (client: ClientConnection) => void;
  private onDisconnectHandler?: (clientId: string, reason: string) => void;
  private onAuthHandler?: (clientId: string, token: string) => Promise<boolean>;

  constructor() {
    this.heartbeatTimer = new IntervalTimer(() => this.checkHeartbeats(), config.ws.heartbeatInterval);
  }

  onMessage(handler: (clientId: string, data: Buffer) => void): void {
    this.onMessageHandler = handler;
  }

  onConnect(handler: (client: ClientConnection) => void): void {
    this.onConnectHandler = handler;
  }

  onDisconnect(handler: (clientId: string, reason: string) => void): void {
    this.onDisconnectHandler = handler;
  }

  onAuth(handler: (clientId: string, token: string) => Promise<boolean>): void {
    this.onAuthHandler = handler;
  }

  start(httpServerInstance?: HttpServer): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (httpServerInstance) {
          this.httpServer = httpServerInstance;
          this.wss = new WebSocketServer({ server: httpServerInstance, maxPayload: config.ws.maxPayloadSize });
        } else {
          this.httpServer = createServer();
          this.wss = new WebSocketServer({ server: this.httpServer, maxPayload: config.ws.maxPayloadSize });
        }

        this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
          this.handleConnection(ws, req);
        });

        this.wss.on('error', (err) => {
          log.error('WebSocket server error', { error: err.message });
          this.stats.errors++;
        });

        if (!httpServerInstance) {
          this.httpServer.listen(config.ws.port, () => {
            log.info('WebSocket server started', { port: config.ws.port });
            this.heartbeatTimer.start();
            resolve();
          });
        } else {
          this.heartbeatTimer.start();
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.heartbeatTimer.stop();

      for (const client of this.clients.values()) {
        client.ws.close(1001, 'Server shutting down');
      }
      this.clients.clear();

      if (this.wss) {
        this.wss.close(() => {
          if (this.httpServer) {
            this.httpServer.close(() => resolve());
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    if (this.clients.size >= config.ws.maxConnections) {
      ws.close(1013, 'Server at capacity');
      return;
    }

    const sessionId = generateSessionId();
    const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown').split(',')[0].trim();

    const client: ClientConnection = {
      id: sessionId,
      ws,
      sessionId,
      ip,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      latencyMs: 0,
      authenticated: false,
      metadata: {},
    };

    this.clients.set(sessionId, client);
    this.stats.totalConnections++;
    this.stats.activeConnections = this.clients.size;

    log.info('Client connected', { sessionId, ip });

    ws.on('message', (data: RawData) => {
      this.handleMessage(sessionId, data);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.handleDisconnect(sessionId, `${code}: ${reason.toString()}`);
    });

    ws.on('error', (err) => {
      log.error('Client connection error', { sessionId, error: err.message });
      this.stats.errors++;
    });

    ws.on('pong', () => {
      client.lastActivity = Date.now();
    });

    const handshakePayload = BinaryProtocol.encodeJSON({
      sessionId,
      serverTime: Date.now(),
      heartbeatInterval: config.ws.heartbeatInterval,
    });
    const packet = this.protocol.encode(PacketType.HANDSHAKE, handshakePayload);
    ws.send(packet);

    if (this.onConnectHandler) {
      this.onConnectHandler(client);
    }
    globalEventBus.emitSync('ws:client_connected', { sessionId, ip });
  }

  private handleMessage(clientId: string, data: RawData): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.lastActivity = Date.now();
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    this.stats.messagesReceived++;
    this.stats.bytesReceived += buf.length;

    const packet = this.protocol.decode(buf);
    if (!packet) {
      log.warn('Invalid packet received', { clientId });
      return;
    }

    switch (packet.type) {
      case PacketType.HANDSHAKE_ACK:
        this.handleHandshakeAck(clientId, packet.payload);
        break;
      case PacketType.HEARTBEAT:
        this.sendToClient(clientId, PacketType.HEARTBEAT_ACK, Buffer.alloc(0));
        break;
      case PacketType.DATA:
        if (this.onMessageHandler) {
          this.onMessageHandler(clientId, packet.payload);
        }
        break;
      case PacketType.DISCONNECT:
        client.ws.close(1000, 'Client disconnect');
        break;
      case PacketType.BATCH:
        this.handleBatch(clientId, packet.payload);
        break;
    }
  }

  private handleHandshakeAck(clientId: string, payload: Buffer): void {
    try {
      const data = BinaryProtocol.decodeJSON<{ authToken?: string }>(payload);
      const client = this.clients.get(clientId);
      if (!client) return;

      if (data.authToken && this.onAuthHandler) {
        this.onAuthHandler(clientId, data.authToken).then(authenticated => {
          client.authenticated = authenticated;
          if (!authenticated) {
            const errPayload = BinaryProtocol.encodeJSON({ error: 'Authentication failed' });
            this.sendToClient(clientId, PacketType.ERROR, errPayload);
            client.ws.close(4001, 'Authentication failed');
          }
        });
      } else {
        client.authenticated = true;
      }
    } catch (err) {
      log.error('Handshake ACK error', { clientId, error: (err as Error).message });
    }
  }

  private handleBatch(clientId: string, payload: Buffer): void {
    const packets = this.protocol.decodeBatch(payload);
    for (const packet of packets) {
      if (packet.type === PacketType.DATA && this.onMessageHandler) {
        this.onMessageHandler(clientId, packet.payload);
      }
    }
  }

  private handleDisconnect(clientId: string, reason: string): void {
    this.clients.delete(clientId);
    this.stats.activeConnections = this.clients.size;
    log.info('Client disconnected', { clientId, reason });

    if (this.onDisconnectHandler) {
      this.onDisconnectHandler(clientId, reason);
    }
    globalEventBus.emitSync('ws:client_disconnected', { sessionId: clientId, reason });
  }

  sendToClient(clientId: string, type: PacketType, payload: Buffer): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;

    const packet = this.protocol.encode(type, payload);
    client.ws.send(packet);
    this.stats.messagesSent++;
    this.stats.bytesSent += packet.length;
    return true;
  }

  broadcast(type: PacketType, payload: Buffer, exclude?: string[]): void {
    const packet = this.protocol.encode(type, payload);
    const excludeSet = exclude ? new Set(exclude) : null;

    for (const [id, client] of this.clients) {
      if (excludeSet && excludeSet.has(id)) continue;
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(packet);
        this.stats.messagesSent++;
        this.stats.bytesSent += packet.length;
      }
    }
  }

  broadcastJSON(data: unknown, exclude?: string[]): void {
    const payload = BinaryProtocol.encodeJSON(data);
    this.broadcast(PacketType.DATA, payload, exclude);
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    const timeout = config.ws.heartbeatInterval * 2;

    for (const [id, client] of this.clients) {
      if (now - client.lastActivity > timeout) {
        log.warn('Client heartbeat timeout', { clientId: id });
        client.ws.terminate();
        this.handleDisconnect(id, 'heartbeat timeout');
      } else if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping();
      }
    }
  }

  getClient(clientId: string): ClientConnection | undefined {
    return this.clients.get(clientId);
  }

  getClients(): Map<string, ClientConnection> {
    return this.clients;
  }

  getStats(): WSServerStats {
    return { ...this.stats };
  }

  get connectionCount(): number {
    return this.clients.size;
  }
}
