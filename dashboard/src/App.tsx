import React, { useState, useEffect, useCallback } from 'react';
import { api, setToken, clearToken } from './api';
import {
  Activity, Server, Users, Shield, Database, Wifi, AlertTriangle,
  BarChart3, RefreshCw, LogIn, LogOut, Zap, HardDrive, Clock, Layers,
  Plus, Trash2, X, Settings, UserPlus, Play, Square, Search, BookOpen
} from 'lucide-react';

interface DashboardData {
  cluster: any;
  servers: any;
  matchmaking: any;
  connections: any;
  state: any;
  alerts: any;
  snapshots: any;
}

function StatCard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-dark-800 rounded-xl p-5 border border-dark-700 hover:border-primary-500/40 transition-all">
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon size={20} />
        </div>
        <span className="text-dark-400 text-sm font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {sub && <div className="text-dark-400 text-xs mt-1">{sub}</div>}
    </div>
  );
}

function AlertBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-400',
    warning: 'bg-yellow-500/20 text-yellow-400',
    info: 'bg-blue-500/20 text-blue-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[severity] || colors.info}`}>
      {severity.toUpperCase()}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    healthy: 'bg-green-400', running: 'bg-green-400', active: 'bg-green-400',
    unhealthy: 'bg-red-400', stopped: 'bg-dark-500', degraded: 'bg-yellow-400',
    starting: 'bg-blue-400', draining: 'bg-yellow-400',
  };
  return <span className={`w-2 h-2 rounded-full inline-block ${colors[status] || 'bg-dark-500'}`} />;
}

function LoginScreen({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api.login(username, password);
      if (result.success && result.token) {
        onLogin(result.token);
      } else {
        setError(result.error || 'Login failed');
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-950">
      <div className="bg-dark-800 rounded-2xl p-8 w-full max-w-md border border-dark-700 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-primary-500/20 rounded-xl">
            <Zap size={28} className="text-primary-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Sync Engine</h1>
            <p className="text-dark-400 text-sm">Real-time Data Orchestration</p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-dark-300 text-sm mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-dark-900 border border-dark-600 rounded-lg px-4 py-2.5 text-white focus:border-primary-500 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-dark-300 text-sm mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-dark-900 border border-dark-600 rounded-lg px-4 py-2.5 text-white focus:border-primary-500 focus:outline-none transition-colors"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 hover:bg-primary-500 text-white rounded-lg py-2.5 font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <LogIn size={18} />
            {loading ? 'Connecting...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

type TabId = 'overview' | 'servers' | 'matches' | 'alerts' | 'state' | 'settings' | 'docs';

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [alerts, setAlerts] = useState<any>({ active: [], history: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabId>('overview');
  const [servers, setServers] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [entities, setEntities] = useState<any[]>([]);
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [newServer, setNewServer] = useState({ mode: 'casual', map: '', maxPlayers: 10 });
  const [showCreateEntity, setShowCreateEntity] = useState(false);
  const [newEntity, setNewEntity] = useState({ type: 'player', ownerId: 'system', data: '{"name":"New Entity"}' });
  const [showMatchmaking, setShowMatchmaking] = useState(false);
  const [mmForm, setMmForm] = useState({ playerId: '', mode: 'casual', skillRating: 1000 });
  const [entityFilter, setEntityFilter] = useState({ type: '', owner: '' });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [dashboard, alertData] = await Promise.all([
        api.getDashboard(),
        api.getAlerts(),
      ]);
      setData(dashboard);
      setAlerts(alertData);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadServers = useCallback(async () => {
    try {
      const res = await api.getServers();
      setServers(res.servers || []);
    } catch {}
  }, []);

  const loadMatches = useCallback(async () => {
    try {
      const res = await api.getMatches();
      setMatches(res.matches || []);
    } catch {}
  }, []);

  const loadEntities = useCallback(async () => {
    try {
      const res = await api.getEntities();
      setEntities(res.entities || []);
    } catch {}
  }, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleCreateServer = async () => {
    try {
      await api.createServer(newServer);
      setShowCreateServer(false);
      setNewServer({ mode: 'casual', map: '', maxPlayers: 10 });
      await loadServers();
      showToast('Server created successfully');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteServer = async (id: string) => {
    try {
      await api.deleteServer(id);
      await loadServers();
      showToast('Server deleted');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleCreateEntity = async () => {
    try {
      let parsedData = {};
      try { parsedData = JSON.parse(newEntity.data); } catch { parsedData = {}; }
      await api.createEntity({ type: newEntity.type, ownerId: newEntity.ownerId, data: parsedData });
      setShowCreateEntity(false);
      setNewEntity({ type: 'player', ownerId: 'system', data: '{"name":"New Entity"}' });
      await loadEntities();
      showToast('Entity created successfully');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteEntity = async (id: string) => {
    try {
      await api.deleteEntity(id);
      await loadEntities();
      showToast('Entity deleted');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleEnqueue = async () => {
    try {
      await api.enqueueMatchmaking({
        playerId: mmForm.playerId || `player-${Date.now()}`,
        mode: mmForm.mode,
        skillRating: mmForm.skillRating,
      });
      setShowMatchmaking(false);
      showToast('Player added to matchmaking queue');
      await loadMatches();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleEndMatch = async (id: string) => {
    try {
      await api.endMatch(id);
      await loadMatches();
      showToast('Match ended');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleTakeSnapshot = async () => {
    try {
      await api.takeSnapshot();
      showToast('Snapshot taken');
      refresh();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (tab === 'servers') loadServers();
    if (tab === 'matches') loadMatches();
    if (tab === 'state') loadEntities();
  }, [tab, loadServers, loadMatches, loadEntities]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
        <div className="flex items-center gap-3 text-dark-400">
          <RefreshCw size={24} className="animate-spin" />
          <span>Loading dashboard...</span>
        </div>
      </div>
    );
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const formatUptime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
  };

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'servers', label: 'Servers', icon: Server },
    { id: 'matches', label: 'Matches', icon: Users },
    { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
    { id: 'state', label: 'State', icon: Database },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'docs', label: 'Docs', icon: BookOpen },
  ];

  const filteredEntities = entities.filter((e: any) => {
    if (entityFilter.type && e.type !== entityFilter.type) return false;
    if (entityFilter.owner && !e.ownerId?.includes(entityFilter.owner)) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-dark-950">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[100] px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl transition-all ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <header className="bg-dark-900 border-b border-dark-700 px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-primary-500/20 rounded-lg">
            <Zap size={22} className="text-primary-400" />
          </div>
          <h1 className="text-lg font-bold text-white">Sync Engine</h1>
          {data?.cluster && (
            <span className="text-xs bg-dark-700 text-dark-300 px-2 py-0.5 rounded-full ml-2">
              Node: {data.cluster.localNode?.id?.slice(0, 8) || 'N/A'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {alerts.active?.length > 0 && (
            <span className="flex items-center gap-1 text-yellow-400 text-sm">
              <AlertTriangle size={16} />
              {alerts.active.length} active
            </span>
          )}
          <button onClick={refresh} className="text-dark-400 hover:text-white transition-colors p-1" title="Refresh">
            <RefreshCw size={18} />
          </button>
          <button onClick={onLogout} className="flex items-center gap-1.5 text-dark-400 hover:text-red-400 transition-colors text-sm" title="Logout">
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <nav className="w-56 bg-dark-900 border-r border-dark-700 min-h-[calc(100vh-52px)] p-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-1 ${
                tab === t.id ? 'bg-primary-600/20 text-primary-400' : 'text-dark-400 hover:text-white hover:bg-dark-800'
              }`}
            >
              <t.icon size={18} />
              {t.label}
            </button>
          ))}
        </nav>

        {/* Main Content */}
        <main className="flex-1 p-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          {tab === 'overview' && data && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold text-white">Dashboard Overview</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={Wifi} label="Connections" value={data.connections?.activeConnections ?? 0} sub={`${data.connections?.messagesReceived ?? 0} msgs received`} color="bg-green-500/20 text-green-400" />
                <StatCard icon={Server} label="Game Servers" value={data.servers?.running ?? 0} sub={`${data.servers?.total ?? 0} total`} color="bg-blue-500/20 text-blue-400" />
                <StatCard icon={Users} label="Active Matches" value={data.matchmaking?.activeMatches ?? 0} sub={`${data.matchmaking?.queuedPlayers ?? 0} queued`} color="bg-purple-500/20 text-purple-400" />
                <StatCard icon={Database} label="Entities" value={data.state?.entities ?? 0} sub={`v${data.state?.version ?? 0}`} color="bg-orange-500/20 text-orange-400" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={Shield} label="Cluster Nodes" value={data.cluster?.totalNodes ?? 0} sub={`Leader: ${data.cluster?.isLeader ? 'This node' : data.cluster?.leaderId?.slice(0, 8) || 'None'}`} color="bg-cyan-500/20 text-cyan-400" />
                <StatCard icon={AlertTriangle} label="Active Alerts" value={data.alerts?.activeAlerts ?? 0} sub={`${data.alerts?.totalRules ?? 0} rules`} color="bg-yellow-500/20 text-yellow-400" />
                <StatCard icon={HardDrive} label="Snapshots" value={data.snapshots?.storedSnapshots ?? 0} sub={`Latest v${data.snapshots?.latestVersion ?? 0}`} color="bg-teal-500/20 text-teal-400" />
                <StatCard icon={Activity} label="Data Transfer" value={formatBytes((data.connections?.bytesSent ?? 0) + (data.connections?.bytesReceived ?? 0))} sub={`${formatBytes(data.connections?.bytesSent ?? 0)} sent`} color="bg-indigo-500/20 text-indigo-400" />
              </div>

              {/* Cluster Info */}
              <div className="bg-dark-800 rounded-xl p-5 border border-dark-700">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Layers size={20} className="text-primary-400" />
                  Cluster State
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-dark-400">Status</span>
                    <p className="text-white font-medium flex items-center gap-2 mt-1">
                      <StatusDot status={data.cluster?.totalNodes > 0 ? 'healthy' : 'unhealthy'} />
                      {data.cluster?.totalNodes > 0 ? 'Healthy' : 'Initializing'}
                    </p>
                  </div>
                  <div>
                    <span className="text-dark-400">Term</span>
                    <p className="text-white font-medium mt-1">{data.cluster?.term ?? 0}</p>
                  </div>
                  <div>
                    <span className="text-dark-400">Total Players</span>
                    <p className="text-white font-medium mt-1">{data.servers?.totalPlayers ?? 0}</p>
                  </div>
                  <div>
                    <span className="text-dark-400">Matches Created</span>
                    <p className="text-white font-medium mt-1">{data.matchmaking?.totalMatchesCreated ?? 0}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'servers' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Game Servers</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowCreateServer(!showCreateServer)}
                    className="flex items-center gap-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                  >
                    <Plus size={16} />
                    Add Server
                  </button>
                  <button onClick={loadServers} className="text-dark-400 hover:text-white transition-colors p-1">
                    <RefreshCw size={18} />
                  </button>
                </div>
              </div>

              {showCreateServer && (
                <div className="bg-dark-800 rounded-xl p-5 border border-primary-500/30 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-white font-semibold">Create Game Server</h3>
                    <button onClick={() => setShowCreateServer(false)} className="text-dark-400 hover:text-white transition-colors">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-dark-300 text-sm mb-1">Mode</label>
                      <select
                        value={newServer.mode}
                        onChange={(e) => setNewServer({ ...newServer, mode: e.target.value })}
                        className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                      >
                        <option value="casual">Casual</option>
                        <option value="ranked">Ranked</option>
                        <option value="deathmatch">Deathmatch</option>
                        <option value="capture">Capture</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-dark-300 text-sm mb-1">Map</label>
                      <input
                        type="text"
                        value={newServer.map}
                        onChange={(e) => setNewServer({ ...newServer, map: e.target.value })}
                        placeholder="e.g. dust2, arena, forest"
                        className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-white placeholder-dark-500 focus:border-primary-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-dark-300 text-sm mb-1">Max Players</label>
                      <input
                        type="number"
                        value={newServer.maxPlayers}
                        onChange={(e) => setNewServer({ ...newServer, maxPlayers: parseInt(e.target.value) || 2 })}
                        min={2}
                        max={100}
                        className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={handleCreateServer}
                      className="bg-green-600 hover:bg-green-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5"
                    >
                      <Plus size={16} />
                      Create Server
                    </button>
                  </div>
                </div>
              )}

              {servers.length === 0 ? (
                <div className="bg-dark-800 rounded-xl p-8 border border-dark-700 text-center text-dark-400">
                  No game servers running. Click "Add Server" to create one.
                </div>
              ) : (
                <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-dark-900">
                      <tr>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">ID</th>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">Mode</th>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">Map</th>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">Status</th>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">Players</th>
                        <th className="text-right text-dark-400 font-medium px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {servers.map((s: any) => (
                        <tr key={s.id} className="border-t border-dark-700 hover:bg-dark-700/50">
                          <td className="px-4 py-3 text-dark-300 font-mono text-xs">{s.id?.slice(0, 12)}</td>
                          <td className="px-4 py-3 text-white">{s.mode}</td>
                          <td className="px-4 py-3 text-dark-300">{s.map || '-'}</td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-2"><StatusDot status={s.status} /> {s.status}</span>
                          </td>
                          <td className="px-4 py-3 text-white">{s.currentPlayers}/{s.maxPlayers}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleDeleteServer(s.id)}
                              className="text-dark-500 hover:text-red-400 transition-colors p-1"
                              title="Delete server"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'matches' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Matches & Matchmaking</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowMatchmaking(!showMatchmaking)}
                    className="flex items-center gap-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                  >
                    <UserPlus size={16} />
                    Queue Player
                  </button>
                  <button onClick={loadMatches} className="text-dark-400 hover:text-white transition-colors p-1">
                    <RefreshCw size={18} />
                  </button>
                </div>
              </div>

              {showMatchmaking && (
                <div className="bg-dark-800 rounded-xl p-5 border border-primary-500/30 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-white font-semibold">Add Player to Matchmaking Queue</h3>
                    <button onClick={() => setShowMatchmaking(false)} className="text-dark-400 hover:text-white"><X size={18} /></button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-dark-300 text-sm mb-1">Player ID</label>
                      <input type="text" value={mmForm.playerId} onChange={(e) => setMmForm({ ...mmForm, playerId: e.target.value })}
                        placeholder="auto-generated if empty"
                        className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-white placeholder-dark-500 focus:border-primary-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-dark-300 text-sm mb-1">Mode</label>
                      <select value={mmForm.mode} onChange={(e) => setMmForm({ ...mmForm, mode: e.target.value })}
                        className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-white focus:border-primary-500 focus:outline-none">
                        <option value="casual">Casual</option>
                        <option value="ranked">Ranked</option>
                        <option value="deathmatch">Deathmatch</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-dark-300 text-sm mb-1">Skill Rating</label>
                      <input type="number" value={mmForm.skillRating} onChange={(e) => setMmForm({ ...mmForm, skillRating: parseInt(e.target.value) || 1000 })}
                        min={0} max={5000}
                        className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-white focus:border-primary-500 focus:outline-none" />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button onClick={handleEnqueue} className="bg-green-600 hover:bg-green-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5">
                      <Play size={16} /> Enqueue
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard icon={Users} label="Active Matches" value={data?.matchmaking?.activeMatches ?? 0} color="bg-purple-500/20 text-purple-400" />
                <StatCard icon={Clock} label="Queued Players" value={data?.matchmaking?.queuedPlayers ?? 0} color="bg-yellow-500/20 text-yellow-400" />
                <StatCard icon={Activity} label="Total Created" value={data?.matchmaking?.totalMatchesCreated ?? 0} color="bg-green-500/20 text-green-400" />
              </div>

              {matches.length === 0 ? (
                <div className="bg-dark-800 rounded-xl p-8 border border-dark-700 text-center text-dark-400">
                  No matches found. Queue players above to start matchmaking.
                </div>
              ) : (
                <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-dark-900">
                      <tr>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">Match ID</th>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">Mode</th>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">Status</th>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">Players</th>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">Created</th>
                        <th className="text-right text-dark-400 font-medium px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.map((m: any) => (
                        <tr key={m.id} className="border-t border-dark-700 hover:bg-dark-700/50">
                          <td className="px-4 py-3 text-dark-300 font-mono text-xs">{m.id?.slice(0, 12)}</td>
                          <td className="px-4 py-3 text-white">{m.mode}</td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-2"><StatusDot status={m.status} /> {m.status}</span>
                          </td>
                          <td className="px-4 py-3 text-white">{m.players?.length || 0}/{m.maxPlayers}</td>
                          <td className="px-4 py-3 text-dark-300">{new Date(m.createdAt).toLocaleTimeString()}</td>
                          <td className="px-4 py-3 text-right">
                            {m.status === 'active' && (
                              <button onClick={() => handleEndMatch(m.id)} className="text-dark-500 hover:text-red-400 transition-colors p-1" title="End match">
                                <Square size={16} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'alerts' && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white">Alerts</h2>

              {alerts.active?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-dark-400 uppercase tracking-wider">Active</h3>
                  {alerts.active.map((a: any) => (
                    <div key={a.id} className="bg-dark-800 rounded-xl p-4 border border-dark-700 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <AlertTriangle size={18} className="text-yellow-400" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-white font-medium">{a.name}</span>
                            <AlertBadge severity={a.severity} />
                          </div>
                          <p className="text-dark-400 text-sm mt-0.5">{a.message}</p>
                        </div>
                      </div>
                      <button
                        onClick={async () => { await api.acknowledgeAlert(a.id); showToast('Alert acknowledged'); refresh(); }}
                        className="text-xs text-dark-400 hover:text-white border border-dark-600 rounded px-3 py-1 transition-colors"
                      >
                        Acknowledge
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-sm font-medium text-dark-400 uppercase tracking-wider">History</h3>
                {(alerts.history?.length || 0) === 0 ? (
                  <div className="bg-dark-800 rounded-xl p-8 border border-dark-700 text-center text-dark-400">
                    No alert history
                  </div>
                ) : (
                  alerts.history?.slice(-20).reverse().map((a: any, i: number) => (
                    <div key={i} className="bg-dark-800 rounded-lg p-3 border border-dark-700 flex items-center gap-3">
                      <AlertBadge severity={a.severity} />
                      <span className="text-white text-sm">{a.name}</span>
                      <span className="text-dark-500 text-xs ml-auto flex items-center gap-1">
                        <Clock size={12} />
                        {new Date(a.firedAt).toLocaleString()}
                      </span>
                      <StatusDot status={a.status === 'resolved' ? 'healthy' : a.status === 'active' ? 'degraded' : 'stopped'} />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === 'state' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">State Explorer</h2>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowCreateEntity(!showCreateEntity)}
                    className="flex items-center gap-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors">
                    <Plus size={16} /> Add Entity
                  </button>
                  <button onClick={handleTakeSnapshot}
                    className="text-xs text-primary-400 hover:text-primary-300 border border-primary-500/30 rounded px-3 py-1.5 transition-colors">
                    Take Snapshot
                  </button>
                  <button onClick={loadEntities} className="text-dark-400 hover:text-white transition-colors p-1">
                    <RefreshCw size={18} />
                  </button>
                </div>
              </div>

              {showCreateEntity && (
                <div className="bg-dark-800 rounded-xl p-5 border border-primary-500/30 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-white font-semibold">Create Entity</h3>
                    <button onClick={() => setShowCreateEntity(false)} className="text-dark-400 hover:text-white"><X size={18} /></button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-dark-300 text-sm mb-1">Type</label>
                      <input type="text" value={newEntity.type} onChange={(e) => setNewEntity({ ...newEntity, type: e.target.value })}
                        placeholder="player, npc, item..."
                        className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-white placeholder-dark-500 focus:border-primary-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-dark-300 text-sm mb-1">Owner ID</label>
                      <input type="text" value={newEntity.ownerId} onChange={(e) => setNewEntity({ ...newEntity, ownerId: e.target.value })}
                        className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-white focus:border-primary-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-dark-300 text-sm mb-1">Data (JSON)</label>
                      <input type="text" value={newEntity.data} onChange={(e) => setNewEntity({ ...newEntity, data: e.target.value })}
                        className="w-full bg-dark-900 border border-dark-600 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-primary-500 focus:outline-none" />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button onClick={handleCreateEntity} className="bg-green-600 hover:bg-green-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5">
                      <Plus size={16} /> Create Entity
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={Database} label="Total Entities" value={entities.length} color="bg-blue-500/20 text-blue-400" />
                <StatCard icon={Layers} label="State Version" value={data?.state?.version ?? 0} color="bg-purple-500/20 text-purple-400" />
                <StatCard icon={HardDrive} label="Snapshots" value={data?.snapshots?.storedSnapshots ?? 0} color="bg-teal-500/20 text-teal-400" />
                <StatCard icon={Activity} label="Filtered" value={filteredEntities.length} sub={entities.length !== filteredEntities.length ? `of ${entities.length}` : 'showing all'} color="bg-orange-500/20 text-orange-400" />
              </div>

              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-2.5 text-dark-500" />
                  <input type="text" value={entityFilter.type} onChange={(e) => setEntityFilter({ ...entityFilter, type: e.target.value })}
                    placeholder="Filter by type..."
                    className="w-full bg-dark-800 border border-dark-600 rounded-lg pl-9 pr-3 py-2 text-white text-sm placeholder-dark-500 focus:border-primary-500 focus:outline-none" />
                </div>
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-2.5 text-dark-500" />
                  <input type="text" value={entityFilter.owner} onChange={(e) => setEntityFilter({ ...entityFilter, owner: e.target.value })}
                    placeholder="Filter by owner..."
                    className="w-full bg-dark-800 border border-dark-600 rounded-lg pl-9 pr-3 py-2 text-white text-sm placeholder-dark-500 focus:border-primary-500 focus:outline-none" />
                </div>
              </div>

              {filteredEntities.length === 0 ? (
                <div className="bg-dark-800 rounded-xl p-8 border border-dark-700 text-center text-dark-400">
                  {entities.length === 0 ? 'No entities in state. Click "Add Entity" to create one.' : 'No entities match your filter.'}
                </div>
              ) : (
                <div className="bg-dark-800 rounded-xl border border-dark-700 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-dark-900">
                      <tr>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">ID</th>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">Type</th>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">Owner</th>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">Version</th>
                        <th className="text-left text-dark-400 font-medium px-4 py-3">Updated</th>
                        <th className="text-right text-dark-400 font-medium px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntities.slice(0, 100).map((e: any) => (
                        <tr key={e.id} className="border-t border-dark-700 hover:bg-dark-700/50">
                          <td className="px-4 py-3 text-dark-300 font-mono text-xs">{e.id?.slice(0, 12)}</td>
                          <td className="px-4 py-3 text-white">{e.type}</td>
                          <td className="px-4 py-3 text-dark-300 font-mono text-xs">{e.ownerId?.slice(0, 12)}</td>
                          <td className="px-4 py-3 text-white">{e.version}</td>
                          <td className="px-4 py-3 text-dark-300">{new Date(e.updatedAt).toLocaleTimeString()}</td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => handleDeleteEntity(e.id)} className="text-dark-500 hover:text-red-400 transition-colors p-1" title="Delete entity">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'settings' && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold text-white">Settings & Info</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-dark-800 rounded-xl p-5 border border-dark-700">
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2"><Server size={18} className="text-primary-400" /> Server</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-dark-400">API URL</span><span className="text-white font-mono">http://localhost:8080/api/v1</span></div>
                    <div className="flex justify-between"><span className="text-dark-400">WebSocket</span><span className="text-white font-mono">ws://localhost:8080</span></div>
                    <div className="flex justify-between"><span className="text-dark-400">Metrics</span><span className="text-white font-mono">/api/v1/metrics</span></div>
                    <div className="flex justify-between"><span className="text-dark-400">Health</span><span className="text-white font-mono">/api/v1/health</span></div>
                  </div>
                </div>

                <div className="bg-dark-800 rounded-xl p-5 border border-dark-700">
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2"><Shield size={18} className="text-green-400" /> Cluster</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-dark-400">Node ID</span><span className="text-white font-mono">{data?.cluster?.localNode?.id || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="text-dark-400">Leader</span><span className="text-white">{data?.cluster?.isLeader ? 'This node' : data?.cluster?.leaderId || 'None'}</span></div>
                    <div className="flex justify-between"><span className="text-dark-400">Term</span><span className="text-white">{data?.cluster?.term ?? 0}</span></div>
                    <div className="flex justify-between"><span className="text-dark-400">Total Nodes</span><span className="text-white">{data?.cluster?.totalNodes ?? 0}</span></div>
                  </div>
                </div>

                <div className="bg-dark-800 rounded-xl p-5 border border-dark-700">
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2"><Wifi size={18} className="text-blue-400" /> Connections</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-dark-400">Active</span><span className="text-white">{data?.connections?.activeConnections ?? 0}</span></div>
                    <div className="flex justify-between"><span className="text-dark-400">Messages Sent</span><span className="text-white">{data?.connections?.messagesSent ?? 0}</span></div>
                    <div className="flex justify-between"><span className="text-dark-400">Messages Received</span><span className="text-white">{data?.connections?.messagesReceived ?? 0}</span></div>
                    <div className="flex justify-between"><span className="text-dark-400">Bytes Sent</span><span className="text-white">{formatBytes(data?.connections?.bytesSent ?? 0)}</span></div>
                  </div>
                </div>

                <div className="bg-dark-800 rounded-xl p-5 border border-dark-700">
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2"><HardDrive size={18} className="text-teal-400" /> Persistence</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-dark-400">Snapshots</span><span className="text-white">{data?.snapshots?.storedSnapshots ?? 0}</span></div>
                    <div className="flex justify-between"><span className="text-dark-400">Latest Version</span><span className="text-white">v{data?.snapshots?.latestVersion ?? 0}</span></div>
                    <div className="flex justify-between"><span className="text-dark-400">State Entities</span><span className="text-white">{data?.state?.entities ?? 0}</span></div>
                    <div className="flex justify-between"><span className="text-dark-400">State Version</span><span className="text-white">v{data?.state?.version ?? 0}</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'docs' && (
            <div className="space-y-6 max-w-4xl">
              <h2 className="text-xl font-bold text-white">Quick Start Guide</h2>

              <div className="bg-dark-800 rounded-xl p-5 border border-dark-700 space-y-3">
                <h3 className="text-white font-semibold">1. Create a Game Server</h3>
                <p className="text-dark-400 text-sm">Go to the <b className="text-white">Servers</b> tab and click <b className="text-primary-400">Add Server</b>. Choose a mode, map, and max players.</p>
              </div>

              <div className="bg-dark-800 rounded-xl p-5 border border-dark-700 space-y-3">
                <h3 className="text-white font-semibold">2. Queue Players for Matchmaking</h3>
                <p className="text-dark-400 text-sm">Go to the <b className="text-white">Matches</b> tab and click <b className="text-primary-400">Queue Player</b>. Add multiple players and the matchmaker will create matches automatically.</p>
              </div>

              <div className="bg-dark-800 rounded-xl p-5 border border-dark-700 space-y-3">
                <h3 className="text-white font-semibold">3. Manage Entities</h3>
                <p className="text-dark-400 text-sm">Go to the <b className="text-white">State</b> tab to create, view, and delete entities. Use filters to find specific entity types.</p>
              </div>

              <div className="bg-dark-800 rounded-xl p-5 border border-dark-700 space-y-3">
                <h3 className="text-white font-semibold">4. Connect via WebSocket</h3>
                <pre className="bg-dark-900 rounded-lg p-3 text-sm text-green-400 font-mono overflow-x-auto">{`const ws = new WebSocket('ws://localhost:8080');

// Authenticate
ws.send(JSON.stringify({ type: 'auth', token: 'YOUR_JWT_TOKEN' }));

// Create entity
ws.send(JSON.stringify({
  type: 'entity_create',
  entityType: 'player',
  data: { name: 'Alice', hp: 100 }
}));

// Update entity
ws.send(JSON.stringify({
  type: 'entity_update',
  entityId: 'ENTITY_ID',
  operations: [{ op: 'set', path: 'hp', value: 90 }]
}));`}</pre>
              </div>

              <div className="bg-dark-800 rounded-xl p-5 border border-dark-700 space-y-3">
                <h3 className="text-white font-semibold">5. REST API</h3>
                <pre className="bg-dark-900 rounded-lg p-3 text-sm text-green-400 font-mono overflow-x-auto">{`# Login
curl -X POST http://localhost:8080/api/v1/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"admin123"}'

# Create server
curl -X POST http://localhost:8080/api/v1/servers \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"mode":"ranked","map":"dust2","maxPlayers":10}'`}</pre>
              </div>

              <div className="bg-dark-800 rounded-xl p-5 border border-primary-500/30 space-y-2">
                <h3 className="text-primary-400 font-semibold">Full Integration Docs</h3>
                <p className="text-dark-400 text-sm">
                  See <code className="text-white bg-dark-900 px-1.5 py-0.5 rounded">INTEGRATION.md</code> in the project root for detailed guides on integrating with <b className="text-white">CS2</b>, <b className="text-white">FiveM</b>, and custom game engines.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);

  const handleLogin = (token: string) => {
    setToken(token);
    setAuthenticated(true);
  };

  const handleLogout = () => {
    clearToken();
    setAuthenticated(false);
  };

  if (!authenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <Dashboard onLogout={handleLogout} />;
}
