const BASE_URL = '/api/v1';

let authToken: string | null = null;

export function setToken(token: string) {
  authToken = token;
}

export function getToken(): string | null {
  return authToken;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export function clearToken() {
  authToken = null;
}

export const api = {
  health: () => request<any>('/health'),

  login: (username: string, password: string) =>
    request<any>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  register: (username: string, password: string, roles?: string[]) =>
    request<any>('/auth/register', { method: 'POST', body: JSON.stringify({ username, password, roles }) }),

  getDashboard: () => request<any>('/dashboard/overview'),

  getServers: () => request<any>('/servers'),
  getServer: (id: string) => request<any>(`/servers/${id}`),
  createServer: (data: any) => request<any>('/servers', { method: 'POST', body: JSON.stringify(data) }),
  deleteServer: (id: string) => request<any>(`/servers/${id}`, { method: 'DELETE' }),

  getMatches: () => request<any>('/matches'),
  getActiveMatches: () => request<any>('/matches/active'),
  endMatch: (id: string) => request<any>(`/matches/${id}/end`, { method: 'POST' }),

  enqueueMatchmaking: (data: any) =>
    request<any>('/matchmaking/enqueue', { method: 'POST', body: JSON.stringify(data) }),
  dequeueMatchmaking: (data: any) =>
    request<any>('/matchmaking/dequeue', { method: 'POST', body: JSON.stringify(data) }),
  getMatchmakingQueue: () => request<any>('/matchmaking/queue'),

  getEntities: (params?: { type?: string; owner?: string }) => {
    const qs = new URLSearchParams(params as any).toString();
    return request<any>(`/state/entities${qs ? `?${qs}` : ''}`);
  },
  createEntity: (data: any) => request<any>('/state/entities', { method: 'POST', body: JSON.stringify(data) }),
  deleteEntity: (id: string) => request<any>(`/state/entities/${id}`, { method: 'DELETE' }),
  updateEntity: (id: string, operations: any[]) =>
    request<any>(`/state/entities/${id}`, { method: 'PATCH', body: JSON.stringify({ operations }) }),
  getStateVersion: () => request<any>('/state/version'),

  getAlerts: () => request<any>('/alerts'),
  acknowledgeAlert: (id: string) => request<any>(`/alerts/${id}/acknowledge`, { method: 'POST' }),

  getMetrics: () => request<any>('/metrics/json'),
  getConnections: () => request<any>('/connections'),

  getCluster: () => request<any>('/cluster/state'),
  getLocalNode: () => request<any>('/cluster/node'),

  getSnapshots: () => request<any>('/snapshots'),
  takeSnapshot: () => request<any>('/snapshots', { method: 'POST' }),

  getMatchmakingStats: () => request<any>('/matchmaking/stats'),
};
