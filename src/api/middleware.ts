import { Request, Response, NextFunction } from 'express';
import { createChildLogger } from '../utils/logger';
import { AuthService, AuthToken } from '../security/auth';
import { RateLimiter } from '../security/rate-limiter';

const log = createChildLogger('APIMiddleware');

declare global {
  namespace Express {
    interface Request {
      authToken?: AuthToken;
      userId?: string;
    }
  }
}

export function createAuthMiddleware(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing authorization header' });
      return;
    }

    const token = header.substring(7);
    const decoded = authService.verifyToken(token);
    if (!decoded) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    req.authToken = decoded;
    req.userId = decoded.userId;
    next();
  };
}

export function createRoleMiddleware(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authToken) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const hasRole = roles.some(role => req.authToken!.roles.includes(role) || req.authToken!.roles.includes('admin'));
    if (!hasRole) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

export function createRateLimitMiddleware(rateLimiter: RateLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const result = rateLimiter.check(key);

    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetAt);

    if (!result.allowed) {
      res.setHeader('Retry-After', Math.ceil((result.retryAfterMs || 1000) / 1000));
      res.status(429).json({ error: 'Too many requests', retryAfterMs: result.retryAfterMs });
      return;
    }

    next();
  };
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    log.info('HTTP request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: duration,
      ip: req.ip,
    });
  });
  next();
}

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
  log.error('Unhandled API error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ error: 'Internal server error' });
}
