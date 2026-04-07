import EventEmitter from 'eventemitter3';
import { createChildLogger } from '../utils/logger';
import { generateId } from '../utils/id';

const log = createChildLogger('EventBus');

export interface EventEnvelope {
  id: string;
  event: string;
  payload: unknown;
  source: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type EventHandler = (envelope: EventEnvelope) => void | Promise<void>;

interface EventStats {
  emitted: number;
  handled: number;
  errors: number;
  avgHandleTimeMs: number;
}

export class EventBus {
  private emitter = new EventEmitter();
  private stats = new Map<string, EventStats>();
  private middleware: Array<(envelope: EventEnvelope) => EventEnvelope | null> = [];
  private deadLetterQueue: EventEnvelope[] = [];
  private readonly maxDeadLetters: number;

  constructor(maxDeadLetters: number = 1000) {
    this.maxDeadLetters = maxDeadLetters;
  }

  use(fn: (envelope: EventEnvelope) => EventEnvelope | null): void {
    this.middleware.push(fn);
  }

  on(event: string, handler: EventHandler): () => void {
    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }

  once(event: string, handler: EventHandler): void {
    this.emitter.once(event, handler);
  }

  off(event: string, handler: EventHandler): void {
    this.emitter.off(event, handler);
  }

  async emit(event: string, payload: unknown, source: string = 'system', metadata?: Record<string, unknown>): Promise<void> {
    let envelope: EventEnvelope | null = {
      id: generateId(),
      event,
      payload,
      source,
      timestamp: Date.now(),
      metadata,
    };

    for (const mw of this.middleware) {
      envelope = mw(envelope);
      if (!envelope) {
        log.debug('Event dropped by middleware', { event });
        return;
      }
    }

    const stat = this.getOrCreateStats(event);
    stat.emitted++;

    const listeners = this.emitter.listeners(event);
    if (listeners.length === 0) {
      this.addToDeadLetter(envelope);
      return;
    }

    const start = Date.now();
    try {
      this.emitter.emit(event, envelope);
      stat.handled++;
      const elapsed = Date.now() - start;
      stat.avgHandleTimeMs = (stat.avgHandleTimeMs * 0.9) + (elapsed * 0.1);
    } catch (err) {
      stat.errors++;
      log.error('Event handler error', { event, error: (err as Error).message });
      this.addToDeadLetter(envelope);
    }
  }

  emitSync(event: string, payload: unknown, source: string = 'system'): void {
    const envelope: EventEnvelope = {
      id: generateId(),
      event,
      payload,
      source,
      timestamp: Date.now(),
    };
    this.emitter.emit(event, envelope);
  }

  private addToDeadLetter(envelope: EventEnvelope): void {
    this.deadLetterQueue.push(envelope);
    if (this.deadLetterQueue.length > this.maxDeadLetters) {
      this.deadLetterQueue.shift();
    }
  }

  private getOrCreateStats(event: string): EventStats {
    let stat = this.stats.get(event);
    if (!stat) {
      stat = { emitted: 0, handled: 0, errors: 0, avgHandleTimeMs: 0 };
      this.stats.set(event, stat);
    }
    return stat;
  }

  getStats(): Map<string, EventStats> {
    return new Map(this.stats);
  }

  getDeadLetters(): EventEnvelope[] {
    return [...this.deadLetterQueue];
  }

  clearDeadLetters(): void {
    this.deadLetterQueue.length = 0;
  }

  listenerCount(event: string): number {
    return this.emitter.listenerCount(event);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }

  destroy(): void {
    this.emitter.removeAllListeners();
    this.stats.clear();
    this.deadLetterQueue.length = 0;
    this.middleware.length = 0;
  }
}

export const globalEventBus = new EventBus();
