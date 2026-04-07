export class BufferPool {
  private pool: Buffer[] = [];
  private readonly bufferSize: number;
  private readonly maxPoolSize: number;

  constructor(bufferSize: number = 4096, maxPoolSize: number = 1000) {
    this.bufferSize = bufferSize;
    this.maxPoolSize = maxPoolSize;
  }

  acquire(): Buffer {
    const buf = this.pool.pop();
    if (buf) {
      buf.fill(0);
      return buf;
    }
    return Buffer.alloc(this.bufferSize);
  }

  release(buf: Buffer): void {
    if (buf.length === this.bufferSize && this.pool.length < this.maxPoolSize) {
      this.pool.push(buf);
    }
  }

  get size(): number {
    return this.pool.length;
  }

  drain(): void {
    this.pool.length = 0;
  }
}

export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head: number = 0;
  private tail: number = 0;
  private count: number = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  push(item: T): boolean {
    if (this.count === this.capacity) {
      return false;
    }
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
    return true;
  }

  pop(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.buffer[this.head];
    this.buffer[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    return item;
  }

  peek(): T | undefined {
    if (this.count === 0) return undefined;
    return this.buffer[this.head];
  }

  get length(): number {
    return this.count;
  }

  get isFull(): boolean {
    return this.count === this.capacity;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  toArray(): T[] {
    const result: T[] = [];
    let idx = this.head;
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[idx] as T);
      idx = (idx + 1) % this.capacity;
    }
    return result;
  }
}
