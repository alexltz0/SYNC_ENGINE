import { EventBus, EventEnvelope } from '../event-bus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  afterEach(() => {
    bus.destroy();
  });

  it('should emit and receive events', async () => {
    const received: EventEnvelope[] = [];
    bus.on('test', (env) => { received.push(env); });

    await bus.emit('test', { data: 'hello' }, 'test-source');

    expect(received.length).toBe(1);
    expect(received[0].event).toBe('test');
    expect(received[0].payload).toEqual({ data: 'hello' });
    expect(received[0].source).toBe('test-source');
  });

  it('should handle once listeners', async () => {
    let count = 0;
    bus.once('test', () => { count++; });

    await bus.emit('test', null);
    await bus.emit('test', null);

    expect(count).toBe(1);
  });

  it('should support unsubscribe via returned function', async () => {
    let count = 0;
    const unsub = bus.on('test', () => { count++; });

    await bus.emit('test', null);
    unsub();
    await bus.emit('test', null);

    expect(count).toBe(1);
  });

  it('should send unhandled events to dead letter queue', async () => {
    await bus.emit('unhandled', { foo: 'bar' });

    const dead = bus.getDeadLetters();
    expect(dead.length).toBe(1);
    expect(dead[0].event).toBe('unhandled');
  });

  it('should apply middleware', async () => {
    bus.use((env) => {
      if (env.event === 'blocked') return null;
      return env;
    });

    const received: EventEnvelope[] = [];
    bus.on('allowed', (env) => { received.push(env); });
    bus.on('blocked', (env) => { received.push(env); });

    await bus.emit('allowed', null);
    await bus.emit('blocked', null);

    expect(received.length).toBe(1);
    expect(received[0].event).toBe('allowed');
  });

  it('should track stats', async () => {
    bus.on('test', () => {});
    await bus.emit('test', null);
    await bus.emit('test', null);

    const stats = bus.getStats();
    const testStat = stats.get('test');
    expect(testStat).toBeDefined();
    expect(testStat!.emitted).toBe(2);
    expect(testStat!.handled).toBe(2);
  });

  it('should emit sync events', () => {
    let received = false;
    bus.on('sync-test', () => { received = true; });
    bus.emitSync('sync-test', null);
    expect(received).toBe(true);
  });

  it('should report listener count', () => {
    bus.on('test', () => {});
    bus.on('test', () => {});
    expect(bus.listenerCount('test')).toBe(2);
    expect(bus.listenerCount('other')).toBe(0);
  });

  it('should clear dead letters', async () => {
    await bus.emit('dead', null);
    expect(bus.getDeadLetters().length).toBe(1);
    bus.clearDeadLetters();
    expect(bus.getDeadLetters().length).toBe(0);
  });
});
