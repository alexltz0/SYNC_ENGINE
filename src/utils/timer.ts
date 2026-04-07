export class IntervalTimer {
  private handle: ReturnType<typeof setInterval> | null = null;
  private readonly callback: () => void | Promise<void>;
  private readonly intervalMs: number;

  constructor(callback: () => void | Promise<void>, intervalMs: number) {
    this.callback = callback;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.handle) return;
    this.handle = setInterval(async () => {
      try {
        await this.callback();
      } catch (err) {
        console.error('IntervalTimer error:', err);
      }
    }, this.intervalMs);
  }

  stop(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }

  isRunning(): boolean {
    return this.handle !== null;
  }
}

export class Debouncer {
  private handle: ReturnType<typeof setTimeout> | null = null;
  private readonly delayMs: number;

  constructor(delayMs: number) {
    this.delayMs = delayMs;
  }

  debounce(callback: () => void): void {
    if (this.handle) clearTimeout(this.handle);
    this.handle = setTimeout(callback, this.delayMs);
  }

  cancel(): void {
    if (this.handle) {
      clearTimeout(this.handle);
      this.handle = null;
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class Stopwatch {
  private startTime: bigint = BigInt(0);

  start(): void {
    this.startTime = process.hrtime.bigint();
  }

  elapsedMs(): number {
    const elapsed = process.hrtime.bigint() - this.startTime;
    return Number(elapsed) / 1_000_000;
  }

  elapsedUs(): number {
    const elapsed = process.hrtime.bigint() - this.startTime;
    return Number(elapsed) / 1_000;
  }
}
