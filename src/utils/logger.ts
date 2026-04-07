import * as winston from 'winston';

let logLevel = 'info';
let logFormat = 'json';

try {
  logLevel = process.env.LOG_LEVEL || 'info';
  logFormat = process.env.LOG_FORMAT || 'json';
} catch {}

const formats = [
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
];

if (logFormat === 'json') {
  formats.push(winston.format.json());
} else {
  formats.push(
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} [${level}] ${message}${metaStr}`;
    })
  );
}

export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(...formats),
  defaultMeta: { service: 'sync-engine' },
  transports: [new winston.transports.Console()],
});

export function createChildLogger(component: string, meta?: Record<string, unknown>): winston.Logger {
  return logger.child({ component, ...meta });
}
