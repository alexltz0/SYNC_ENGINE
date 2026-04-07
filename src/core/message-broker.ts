import { createChildLogger } from '../utils/logger';
import { generateId } from '../utils/id';
import { globalEventBus } from './event-bus';
import { RingBuffer } from '../utils/buffer-pool';
import { SyncMessage, MessageType, ChannelId, NodeId } from './types';

const log = createChildLogger('MessageBroker');

export interface Subscription {
  id: string;
  channel: ChannelId;
  handler: (message: SyncMessage) => void | Promise<void>;
  filter?: (message: SyncMessage) => boolean;
}

export interface ChannelInfo {
  id: ChannelId;
  subscriberCount: number;
  messagesDelivered: number;
  messagesDropped: number;
  createdAt: number;
}

export class MessageBroker {
  private channels = new Map<ChannelId, Set<Subscription>>();
  private channelStats = new Map<ChannelId, { delivered: number; dropped: number; createdAt: number }>();
  private messageBuffer: RingBuffer<SyncMessage>;
  private sequenceCounters = new Map<string, number>();
  private readonly nodeId: string;

  constructor(nodeId: string, bufferSize: number = 10000) {
    this.nodeId = nodeId;
    this.messageBuffer = new RingBuffer<SyncMessage>(bufferSize);
  }

  subscribe(channel: ChannelId, handler: (message: SyncMessage) => void | Promise<void>, filter?: (message: SyncMessage) => boolean): Subscription {
    const sub: Subscription = {
      id: generateId(),
      channel,
      handler,
      filter,
    };

    let channelSubs = this.channels.get(channel);
    if (!channelSubs) {
      channelSubs = new Set();
      this.channels.set(channel, channelSubs);
      this.channelStats.set(channel, { delivered: 0, dropped: 0, createdAt: Date.now() });
    }
    channelSubs.add(sub);

    log.debug('Subscription added', { channel, subId: sub.id });
    return sub;
  }

  unsubscribe(subscription: Subscription): void {
    const channelSubs = this.channels.get(subscription.channel);
    if (channelSubs) {
      channelSubs.delete(subscription);
      if (channelSubs.size === 0) {
        this.channels.delete(subscription.channel);
        this.channelStats.delete(subscription.channel);
      }
    }
  }

  async publish(channel: ChannelId, type: MessageType, payload: unknown, target?: NodeId): Promise<void> {
    const seq = this.nextSequence(channel);
    const message: SyncMessage = {
      id: generateId(),
      type,
      channel,
      source: this.nodeId,
      target,
      payload,
      timestamp: Date.now(),
      sequence: seq,
      ttl: 30000,
    };

    this.messageBuffer.push(message);

    const channelSubs = this.channels.get(channel);
    const stats = this.channelStats.get(channel);

    if (!channelSubs || channelSubs.size === 0) {
      if (stats) stats.dropped++;
      return;
    }

    for (const sub of channelSubs) {
      try {
        if (sub.filter && !sub.filter(message)) continue;
        await sub.handler(message);
        if (stats) stats.delivered++;
      } catch (err) {
        log.error('Message handler error', { channel, subId: sub.id, error: (err as Error).message });
        if (stats) stats.dropped++;
      }
    }

    globalEventBus.emitSync('message:published', { channel, type, messageId: message.id });
  }

  publishSync(channel: ChannelId, type: MessageType, payload: unknown): void {
    const seq = this.nextSequence(channel);
    const message: SyncMessage = {
      id: generateId(),
      type,
      channel,
      source: this.nodeId,
      payload,
      timestamp: Date.now(),
      sequence: seq,
      ttl: 30000,
    };

    this.messageBuffer.push(message);

    const channelSubs = this.channels.get(channel);
    if (!channelSubs) return;

    for (const sub of channelSubs) {
      try {
        if (sub.filter && !sub.filter(message)) continue;
        sub.handler(message);
      } catch (err) {
        log.error('Sync message handler error', { channel, error: (err as Error).message });
      }
    }
  }

  broadcast(type: MessageType, payload: unknown): void {
    for (const channel of this.channels.keys()) {
      this.publishSync(channel, type, payload);
    }
  }

  getRecentMessages(channel: ChannelId, count: number = 100): SyncMessage[] {
    const all = this.messageBuffer.toArray();
    return all.filter(m => m.channel === channel).slice(-count);
  }

  getChannelInfo(): ChannelInfo[] {
    const result: ChannelInfo[] = [];
    for (const [id, subs] of this.channels) {
      const stats = this.channelStats.get(id);
      result.push({
        id,
        subscriberCount: subs.size,
        messagesDelivered: stats?.delivered || 0,
        messagesDropped: stats?.dropped || 0,
        createdAt: stats?.createdAt || 0,
      });
    }
    return result;
  }

  hasChannel(channel: ChannelId): boolean {
    return this.channels.has(channel);
  }

  subscriberCount(channel: ChannelId): number {
    return this.channels.get(channel)?.size || 0;
  }

  private nextSequence(channel: string): number {
    const current = this.sequenceCounters.get(channel) || 0;
    const next = current + 1;
    this.sequenceCounters.set(channel, next);
    return next;
  }

  destroy(): void {
    this.channels.clear();
    this.channelStats.clear();
    this.sequenceCounters.clear();
    this.messageBuffer.clear();
  }
}
