import { createChildLogger } from '../utils/logger';
import { globalEventBus } from '../core/event-bus';
import { MetricsCollector } from './metrics-collector';
import { IntervalTimer } from '../utils/timer';

const log = createChildLogger('Alerting');

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

export enum AlertStatus {
  ACTIVE = 'active',
  RESOLVED = 'resolved',
  ACKNOWLEDGED = 'acknowledged',
}

export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  condition: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  threshold: number;
  severity: AlertSeverity;
  cooldownMs: number;
  message: string;
}

export interface Alert {
  id: string;
  ruleId: string;
  name: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  value: number;
  threshold: number;
  firedAt: number;
  resolvedAt?: number;
  acknowledgedAt?: number;
}

export class AlertManager {
  private rules: AlertRule[] = [];
  private activeAlerts = new Map<string, Alert>();
  private alertHistory: Alert[] = [];
  private lastFired = new Map<string, number>();
  private readonly metricsCollector: MetricsCollector;
  private checkTimer: IntervalTimer;
  private readonly maxHistory: number;

  constructor(metricsCollector: MetricsCollector, checkIntervalMs: number = 10000, maxHistory: number = 1000) {
    this.metricsCollector = metricsCollector;
    this.maxHistory = maxHistory;
    this.checkTimer = new IntervalTimer(() => this.evaluateRules(), checkIntervalMs);
  }

  start(): void {
    this.checkTimer.start();
    log.info('Alert manager started', { rules: this.rules.length });
  }

  stop(): void {
    this.checkTimer.stop();
  }

  addRule(rule: AlertRule): void {
    this.rules.push(rule);
    log.info('Alert rule added', { id: rule.id, name: rule.name, metric: rule.metric });
  }

  removeRule(ruleId: string): boolean {
    const idx = this.rules.findIndex(r => r.id === ruleId);
    if (idx === -1) return false;
    this.rules.splice(idx, 1);
    return true;
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return false;
    alert.status = AlertStatus.ACKNOWLEDGED;
    alert.acknowledgedAt = Date.now();
    globalEventBus.emitSync('alert:acknowledged', { alert });
    return true;
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  getAlertHistory(): Alert[] {
    return [...this.alertHistory];
  }

  private evaluateRules(): void {
    const now = Date.now();

    for (const rule of this.rules) {
      const value = this.metricsCollector.getGauge(rule.metric);
      const triggered = this.evaluateCondition(value, rule.condition, rule.threshold);

      if (triggered) {
        const lastFiredAt = this.lastFired.get(rule.id) || 0;
        if (now - lastFiredAt < rule.cooldownMs) continue;

        if (!this.activeAlerts.has(rule.id)) {
          const alert: Alert = {
            id: `alert-${rule.id}-${now}`,
            ruleId: rule.id,
            name: rule.name,
            severity: rule.severity,
            status: AlertStatus.ACTIVE,
            message: rule.message.replace('{value}', String(value)).replace('{threshold}', String(rule.threshold)),
            value,
            threshold: rule.threshold,
            firedAt: now,
          };

          this.activeAlerts.set(rule.id, alert);
          this.lastFired.set(rule.id, now);
          this.addToHistory(alert);

          log.warn('Alert fired', { alertId: alert.id, name: rule.name, severity: rule.severity });
          globalEventBus.emitSync('alert:fired', { alert });
        }
      } else {
        const existing = this.activeAlerts.get(rule.id);
        if (existing && existing.status === AlertStatus.ACTIVE) {
          existing.status = AlertStatus.RESOLVED;
          existing.resolvedAt = now;
          this.activeAlerts.delete(rule.id);
          this.addToHistory(existing);

          log.info('Alert resolved', { alertId: existing.id, name: rule.name });
          globalEventBus.emitSync('alert:resolved', { alert: existing });
        }
      }
    }
  }

  private evaluateCondition(value: number, condition: AlertRule['condition'], threshold: number): boolean {
    switch (condition) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'eq': return value === threshold;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      default: return false;
    }
  }

  private addToHistory(alert: Alert): void {
    this.alertHistory.push({ ...alert });
    if (this.alertHistory.length > this.maxHistory) {
      this.alertHistory.shift();
    }
  }

  getStats(): { activeAlerts: number; totalRules: number; historySize: number } {
    return {
      activeAlerts: this.activeAlerts.size,
      totalRules: this.rules.length,
      historySize: this.alertHistory.length,
    };
  }
}
