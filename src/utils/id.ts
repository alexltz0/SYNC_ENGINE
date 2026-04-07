import { v4 as uuidv4 } from 'uuid';

export function generateId(): string {
  return uuidv4();
}

export function generateShortId(): string {
  return uuidv4().replace(/-/g, '').substring(0, 12);
}

export function generateNodeId(region: string, zone: string): string {
  return `${region}-${zone}-${generateShortId()}`;
}

export function generateSessionId(): string {
  return `sess-${generateShortId()}`;
}

export function generateServerId(): string {
  return `srv-${generateShortId()}`;
}

export function generateMatchId(): string {
  return `match-${generateShortId()}`;
}
