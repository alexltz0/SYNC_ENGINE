import { createChildLogger } from '../utils/logger';
import { IntervalTimer } from '../utils/timer';
import { SyncMetrics } from '../core/types';

const log = createChildLogger('MetricsCollector');

export interface MetricPoint {
  name: string;
  value: number;
  timestamp: number;
  labels: Record<string, string>;
}

export interface MetricSeries {
  name: string;
  points: MetricPoint[];
  type: 'counter' | 'gauge' | 'histogram';
}

export class MetricsCollector {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private series = new Map<string, MetricPoint[]>();
  private readonly maxSeriesPoints: number;
  private collectTimer: IntervalTimer | null = null;
  private collectors: Array<() => Record<string, number>> = [];

  constructor(maxSeriesPoints: number = 1000) {
    this.maxSeriesPoints = maxSeriesPoints;
  }

  start(intervalMs: number = 5000): void {
    this.collectTimer = new IntervalTimer(() => this.collect(), intervalMs);
    this.collectTimer.start();
    log.info('Metrics collector started', { intervalMs });
  }

  stop(): void {
    if (this.collectTimer) {
      this.collectTimer.stop();
      this.collectTimer = null;
    }
  }

  registerCollector(collector: () => Record<string, number>): void {
    this.collectors.push(collector);
  }

  incrementCounter(name: string, value: number = 1, labels: Record<string, string> = {}): void {
    const key = this.buildKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.buildKey(name, labels);
    this.gauges.set(key, value);
  }

  recordHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.buildKey(name, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);
    if (values.length > 10000) values.shift();
    this.histograms.set(key, values);
  }

  getCounter(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(this.buildKey(name, labels)) || 0;
  }

  getGauge(name: string, labels: Record<string, string> = {}): number {
    return this.gauges.get(this.buildKey(name, labels)) || 0;
  }

  getHistogramStats(name: string, labels: Record<string, string> = {}): { min: number; max: number; avg: number; p50: number; p95: number; p99: number; count: number } | null {
    const values = this.histograms.get(this.buildKey(name, labels));
    if (!values || values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      min: sorted[0],
      max: sorted[count - 1],
      avg: sum / count,
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
      count,
    };
  }

  getSeries(name: string): MetricPoint[] {
    return this.series.get(name) || [];
  }

  private collect(): void {
    const now = Date.now();

    for (const collector of this.collectors) {
      try {
        const metrics = collector();
        for (const [name, value] of Object.entries(metrics)) {
          this.setGauge(name, value);
          this.addToSeries(name, value, now);
        }
      } catch (err) {
        log.error('Metric collector error', { error: (err as Error).message });
      }
    }
  }

  private addToSeries(name: string, value: number, timestamp: number): void {
    let points = this.series.get(name);
    if (!points) {
      points = [];
      this.series.set(name, points);
    }
    points.push({ name, value, timestamp, labels: {} });
    if (points.length > this.maxSeriesPoints) {
      points.shift();
    }
  }

  private buildKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  getAllMetrics(): { counters: Record<string, number>; gauges: Record<string, number>; histograms: Record<string, ReturnType<MetricsCollector['getHistogramStats']>> } {
    const counters: Record<string, number> = {};
    const gauges: Record<string, number> = {};
    const histograms: Record<string, ReturnType<MetricsCollector['getHistogramStats']>> = {};

    for (const [key, value] of this.counters) counters[key] = value;
    for (const [key, value] of this.gauges) gauges[key] = value;
    for (const [key] of this.histograms) {
      histograms[key] = this.getHistogramStats(key);
    }

    return { counters, gauges, histograms };
  }

  toPrometheus(): string {
    const lines: string[] = [];

    for (const [key, value] of this.counters) {
      lines.push(`# TYPE ${key.split('{')[0]} counter`);
      lines.push(`${key} ${value}`);
    }

    for (const [key, value] of this.gauges) {
      lines.push(`# TYPE ${key.split('{')[0]} gauge`);
      lines.push(`${key} ${value}`);
    }

    return lines.join('\n');
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.series.clear();
  }
}
