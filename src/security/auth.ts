import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { createChildLogger } from '../utils/logger';
import { generateId } from '../utils/id';
import { config } from '../config';

const log = createChildLogger('Auth');

export interface AuthUser {
  id: string;
  username: string;
  passwordHash: string;
  roles: string[];
  createdAt: number;
  lastLogin?: number;
  metadata: Record<string, unknown>;
}

export interface AuthToken {
  userId: string;
  username: string;
  roles: string[];
  iat: number;
  exp: number;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  user?: Omit<AuthUser, 'passwordHash'>;
  error?: string;
}

export class AuthService {
  private users = new Map<string, AuthUser>();
  private tokenBlacklist = new Set<string>();

  async createUser(username: string, password: string, roles: string[] = ['player']): Promise<AuthResult> {
    const existing = Array.from(this.users.values()).find(u => u.username === username);
    if (existing) {
      return { success: false, error: 'Username already exists' };
    }

    const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);
    const user: AuthUser = {
      id: generateId(),
      username,
      passwordHash,
      roles,
      createdAt: Date.now(),
      metadata: {},
    };

    this.users.set(user.id, user);
    log.info('User created', { userId: user.id, username });

    const token = this.generateToken(user);
    const { passwordHash: _, ...safeUser } = user;

    return { success: true, token, user: safeUser };
  }

  async authenticate(username: string, password: string): Promise<AuthResult> {
    const user = Array.from(this.users.values()).find(u => u.username === username);
    if (!user) {
      return { success: false, error: 'Invalid credentials' };
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return { success: false, error: 'Invalid credentials' };
    }

    user.lastLogin = Date.now();
    const token = this.generateToken(user);
    const { passwordHash: _, ...safeUser } = user;

    log.info('User authenticated', { userId: user.id, username });
    return { success: true, token, user: safeUser };
  }

  verifyToken(token: string): AuthToken | null {
    if (this.tokenBlacklist.has(token)) {
      return null;
    }

    try {
      const decoded = jwt.verify(token, config.security.jwtSecret) as AuthToken;
      return decoded;
    } catch (err) {
      return null;
    }
  }

  revokeToken(token: string): void {
    this.tokenBlacklist.add(token);
  }

  hasRole(token: AuthToken, role: string): boolean {
    return token.roles.includes(role) || token.roles.includes('admin');
  }

  hasAnyRole(token: AuthToken, roles: string[]): boolean {
    return roles.some(role => this.hasRole(token, role));
  }

  getUser(userId: string): Omit<AuthUser, 'passwordHash'> | undefined {
    const user = this.users.get(userId);
    if (!user) return undefined;
    const { passwordHash: _, ...safeUser } = user;
    return safeUser;
  }

  getAllUsers(): Omit<AuthUser, 'passwordHash'>[] {
    return Array.from(this.users.values()).map(({ passwordHash: _, ...u }) => u);
  }

  async updatePassword(userId: string, newPassword: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) return false;

    user.passwordHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);
    log.info('Password updated', { userId });
    return true;
  }

  deleteUser(userId: string): boolean {
    const deleted = this.users.delete(userId);
    if (deleted) log.info('User deleted', { userId });
    return deleted;
  }

  private generateToken(user: AuthUser): string {
    return jwt.sign(
      { userId: user.id, username: user.username, roles: user.roles },
      config.security.jwtSecret,
      { expiresIn: config.security.jwtExpiration }
    );
  }

  getStats(): { totalUsers: number; blacklistedTokens: number } {
    return { totalUsers: this.users.size, blacklistedTokens: this.tokenBlacklist.size };
  }
}
