# Sync Engine — Integration Guide

Dieses Dokument beschreibt Schritt für Schritt, wie du die Sync Engine als Backend für verschiedene Game-Server nutzen kannst. Es enthält konkrete Beispiele für **CS2 (Counter-Strike 2)** und **FiveM (GTA V)** sowie eine generische Anleitung für eigene Game Engines.

---

## Inhaltsverzeichnis

1. [Architektur-Überblick](#architektur-überblick)
2. [Voraussetzungen](#voraussetzungen)
3. [Authentifizierung](#authentifizierung)
4. [Server-Registrierung](#server-registrierung)
5. [WebSocket-Verbindung](#websocket-verbindung)
6. [Entity-Synchronisation](#entity-synchronisation)
7. [Matchmaking](#matchmaking)
8. [CS2 Integration](#cs2-integration)
9. [FiveM Integration](#fivem-integration)
10. [Custom Game Engine Integration](#custom-game-engine-integration)
11. [Monitoring & Debugging](#monitoring--debugging)
12. [Troubleshooting](#troubleshooting)

---

## Architektur-Überblick

```
┌──────────────┐     WebSocket / REST     ┌─────────────────┐
│  Game Server │ ◄──────────────────────► │   Sync Engine    │
│  (CS2/FiveM) │                          │   Port 8080      │
└──────────────┘                          ├─────────────────┤
                                          │ - State Sync     │
┌──────────────┐     WebSocket            │ - Matchmaking    │
│  Game Client │ ◄──────────────────────► │ - Persistence    │
│  (Browser)   │                          │ - Monitoring     │
└──────────────┘                          └─────────────────┘
                                                  │
                                          ┌───────┴────────┐
                                          │   Dashboard     │
                                          │   Port 3001     │
                                          └────────────────┘
```

**Kommunikationsfluss:**
1. Game-Server registriert sich bei der Sync Engine (REST API)
2. Sync Engine erstellt einen verwalteten Server-Eintrag
3. Spieler verbinden sich per WebSocket zur Sync Engine
4. Sync Engine synchronisiert State zwischen allen Nodes
5. Game-Server pollt oder streamt State-Updates

---

## Voraussetzungen

- Sync Engine läuft auf `http://localhost:8080`
- Node.js >= 18 installiert
- Dashboard (optional) auf `http://localhost:3001`

```bash
# Sync Engine starten
cd sync_engine
npm install
npm run build
npm start

# Dashboard starten (separates Terminal)
cd dashboard
npm install
npm run dev
```

---

## Authentifizierung

Alle API-Aufrufe (außer `/health` und `/metrics`) benötigen einen JWT-Token.

### Token holen

```bash
# Admin-Login (Standard-Credentials im Dev-Modus)
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
```

**Antwort:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "userId": "abc-123",
  "username": "admin",
  "roles": ["admin"]
}
```

### Eigene User erstellen

```bash
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{"username": "cs2-server-1", "password": "secure-pw", "roles": ["server"]}'
```

### Token verwenden

Bei **jedem** API-Aufruf:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

---

## Server-Registrierung

Bevor ein Game-Server Spieler annehmen kann, muss er sich registrieren.

### Server erstellen

```bash
curl -X POST http://localhost:8080/api/v1/servers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "mode": "ranked",
    "map": "de_dust2",
    "maxPlayers": 10
  }'
```

**Antwort:**
```json
{
  "success": true,
  "server": {
    "id": "srv-abc123",
    "mode": "ranked",
    "map": "de_dust2",
    "maxPlayers": 10,
    "currentPlayers": 0,
    "status": "starting"
  }
}
```

### Alle Server auflisten

```bash
curl http://localhost:8080/api/v1/servers \
  -H "Authorization: Bearer TOKEN"
```

### Server löschen

```bash
curl -X DELETE http://localhost:8080/api/v1/servers/srv-abc123 \
  -H "Authorization: Bearer TOKEN"
```

---

## WebSocket-Verbindung

Für Echtzeit-Kommunikation verbindet sich der Game-Server oder Client per WebSocket.

### Verbindung herstellen

```javascript
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  // Authentifizierung
  ws.send(JSON.stringify({
    type: 'auth',
    token: 'YOUR_JWT_TOKEN'
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Received:', msg);
});

ws.on('close', () => console.log('Disconnected'));
ws.on('error', (err) => console.error('WS Error:', err));
```

### Nachrichten-Typen

| Type | Richtung | Beschreibung |
|------|----------|-------------|
| `auth` | Client → Server | Authentifizierung mit JWT |
| `entity_create` | Client → Server | Entity erstellen |
| `entity_update` | Client → Server | Entity aktualisieren |
| `state_request` | Client → Server | Gesamten State anfragen |
| `join_match` | Client → Server | Matchmaking beitreten |
| `leave_match` | Client → Server | Matchmaking verlassen |
| `state_sync` | Server → Client | State-Update Push |
| `entity_created` | Server → Client | Neue Entity erstellt |
| `entity_updated` | Server → Client | Entity geändert |

---

## Entity-Synchronisation

Entities sind die grundlegenden Datenobjekte (Spieler, NPCs, Items, Fahrzeuge, etc.).

### Entity erstellen

```javascript
ws.send(JSON.stringify({
  type: 'entity_create',
  entityType: 'player',
  data: {
    name: 'Alice',
    hp: 100,
    position: { x: 0, y: 0, z: 0 },
    team: 'CT'
  }
}));
```

### Entity aktualisieren (Operationen)

```javascript
// Wert setzen
ws.send(JSON.stringify({
  type: 'entity_update',
  entityId: 'ENTITY_ID',
  operations: [
    { op: 'set', path: 'hp', value: 75 },
    { op: 'set', path: 'position.x', value: 100.5 }
  ]
}));

// Wert inkrementieren
ws.send(JSON.stringify({
  type: 'entity_update',
  entityId: 'ENTITY_ID',
  operations: [
    { op: 'increment', path: 'kills', value: 1 }
  ]
}));

// Array-Element hinzufügen
ws.send(JSON.stringify({
  type: 'entity_update',
  entityId: 'ENTITY_ID',
  operations: [
    { op: 'append', path: 'inventory', value: 'ak47' }
  ]
}));

// Array-Element entfernen
ws.send(JSON.stringify({
  type: 'entity_update',
  entityId: 'ENTITY_ID',
  operations: [
    { op: 'remove', path: 'inventory', value: 'ak47' }
  ]
}));

// Feld löschen
ws.send(JSON.stringify({
  type: 'entity_update',
  entityId: 'ENTITY_ID',
  operations: [
    { op: 'delete', path: 'temporaryBuff' }
  ]
}));
```

### Verfügbare Operationen

| Operation | Beschreibung | Beispiel |
|-----------|-------------|---------|
| `set` | Wert setzen | `{ op: 'set', path: 'hp', value: 90 }` |
| `increment` | Zahl erhöhen | `{ op: 'increment', path: 'score', value: 10 }` |
| `delete` | Feld löschen | `{ op: 'delete', path: 'buff' }` |
| `append` | Zu Array hinzufügen | `{ op: 'append', path: 'items', value: 'sword' }` |
| `remove` | Aus Array entfernen | `{ op: 'remove', path: 'items', value: 'sword' }` |

### Entities per REST API abfragen

```bash
# Alle Entities
curl http://localhost:8080/api/v1/state/entities \
  -H "Authorization: Bearer TOKEN"

# Nach Typ filtern
curl "http://localhost:8080/api/v1/state/entities?type=player" \
  -H "Authorization: Bearer TOKEN"

# Nach Owner filtern
curl "http://localhost:8080/api/v1/state/entities?owner=user-123" \
  -H "Authorization: Bearer TOKEN"
```

---

## Matchmaking

### Spieler in Warteschlange einreihen

```bash
curl -X POST http://localhost:8080/api/v1/matchmaking/enqueue \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "playerId": "player-001",
    "mode": "ranked",
    "skillRating": 1500,
    "preferredRegion": "eu-west"
  }'
```

### Spieler aus Warteschlange entfernen

```bash
curl -X POST http://localhost:8080/api/v1/matchmaking/dequeue \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"playerId": "player-001", "mode": "ranked"}'
```

### Warteschlange & Statistiken

```bash
# Warteschlange anzeigen
curl http://localhost:8080/api/v1/matchmaking/queue \
  -H "Authorization: Bearer TOKEN"

# Statistiken
curl http://localhost:8080/api/v1/matchmaking/stats \
  -H "Authorization: Bearer TOKEN"
```

### Per WebSocket

```javascript
// Beitreten
ws.send(JSON.stringify({
  type: 'join_match',
  mode: 'ranked',
  skillRating: 1500
}));

// Verlassen
ws.send(JSON.stringify({
  type: 'leave_match',
  mode: 'ranked'
}));
```

---

## CS2 Integration

### Konzept

CS2 (Counter-Strike 2) nutzt einen dedizierten Server (SRCDS). Die Integration funktioniert über ein **Bridge-Plugin**, das zwischen dem CS2-Server und der Sync Engine kommuniziert.

```
┌──────────┐    RCON/Plugin    ┌─────────────┐    REST/WS    ┌──────────────┐
│  CS2     │ ◄──────────────► │ Bridge       │ ◄───────────► │ Sync Engine  │
│  SRCDS   │                  │ (Node.js)    │               │ :8080        │
└──────────┘                  └─────────────┘               └──────────────┘
```

### Schritt 1: Bridge-Service erstellen

Erstelle einen separaten Node.js-Service, der zwischen CS2 und Sync Engine vermittelt.

```bash
mkdir cs2-bridge && cd cs2-bridge
npm init -y
npm install ws node-fetch
```

**cs2-bridge/index.js:**
```javascript
const WebSocket = require('ws');

// ─── Konfiguration ───
const SYNC_ENGINE_URL = 'ws://localhost:8080';
const SYNC_API_URL = 'http://localhost:8080/api/v1';
const CS2_SERVER_NAME = 'CS2-EU-1';
const CS2_MAP = 'de_dust2';
const CS2_MODE = 'ranked';
const CS2_MAX_PLAYERS = 10;

let ws = null;
let token = null;
let serverId = null;

// ─── 1. Bei Sync Engine authentifizieren ───
async function authenticate() {
  const res = await fetch(`${SYNC_API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const data = await res.json();
  token = data.token;
  console.log('[Bridge] Authenticated with Sync Engine');
  return token;
}

// ─── 2. Server registrieren ───
async function registerServer() {
  const res = await fetch(`${SYNC_API_URL}/servers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      mode: CS2_MODE,
      map: CS2_MAP,
      maxPlayers: CS2_MAX_PLAYERS,
    }),
  });
  const data = await res.json();
  serverId = data.server.id;
  console.log(`[Bridge] Server registered: ${serverId}`);
  return serverId;
}

// ─── 3. WebSocket-Verbindung ───
function connectWebSocket() {
  ws = new WebSocket(SYNC_ENGINE_URL);

  ws.on('open', () => {
    console.log('[Bridge] WebSocket connected');
    ws.send(JSON.stringify({ type: 'auth', token }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    handleSyncMessage(msg);
  });

  ws.on('close', () => {
    console.log('[Bridge] WebSocket disconnected, reconnecting...');
    setTimeout(connectWebSocket, 5000);
  });
}

// ─── 4. Sync-Nachrichten verarbeiten ───
function handleSyncMessage(msg) {
  switch (msg.type) {
    case 'entity_updated':
      // State-Update an CS2-Server weiterleiten (z.B. via RCON)
      console.log(`[Bridge] Entity updated: ${msg.entity?.id}`);
      break;
    case 'match_created':
      console.log(`[Bridge] Match created: ${msg.match?.id}`);
      break;
    case 'state_sync':
      console.log(`[Bridge] Full state sync received`);
      break;
  }
}

// ─── 5. CS2-Events an Sync Engine senden ───

// Spieler joined den Server
function onPlayerConnect(steamId, playerName) {
  ws.send(JSON.stringify({
    type: 'entity_create',
    entityType: 'cs2_player',
    data: {
      steamId,
      name: playerName,
      server: serverId,
      team: 'unassigned',
      kills: 0,
      deaths: 0,
      assists: 0,
      score: 0,
      money: 800,
      connected: true,
    },
  }));
}

// Spieler hat einen Kill gemacht
function onPlayerKill(killerEntityId, victimEntityId, weapon, headshot) {
  // Killer-Stats updaten
  ws.send(JSON.stringify({
    type: 'entity_update',
    entityId: killerEntityId,
    operations: [
      { op: 'increment', path: 'kills', value: 1 },
      { op: 'increment', path: 'score', value: headshot ? 2 : 1 },
    ],
  }));

  // Victim-Stats updaten
  ws.send(JSON.stringify({
    type: 'entity_update',
    entityId: victimEntityId,
    operations: [
      { op: 'increment', path: 'deaths', value: 1 },
      { op: 'set', path: 'alive', value: false },
    ],
  }));
}

// Runde endet
function onRoundEnd(winnerTeam, score) {
  ws.send(JSON.stringify({
    type: 'entity_create',
    entityType: 'cs2_round',
    data: {
      server: serverId,
      winner: winnerTeam,
      score,
      timestamp: Date.now(),
    },
  }));
}

// Spieler disconnected
function onPlayerDisconnect(entityId) {
  ws.send(JSON.stringify({
    type: 'entity_update',
    entityId,
    operations: [
      { op: 'set', path: 'connected', value: false },
    ],
  }));
}

// ─── Start ───
async function main() {
  await authenticate();
  await registerServer();
  connectWebSocket();

  console.log(`[Bridge] CS2 Bridge running for server ${serverId}`);
  console.log('[Bridge] Waiting for CS2 events...');

  // Beispiel: Simuliere einen Spieler-Connect
  setTimeout(() => onPlayerConnect('STEAM_0:1:12345', 'TestPlayer'), 3000);
}

main().catch(console.error);
```

### Schritt 2: Bridge starten

```bash
node cs2-bridge/index.js
```

### Schritt 3: CS2 Game Server Events anbinden

Die Bridge muss CS2-Events empfangen. Dazu gibt es mehrere Möglichkeiten:

| Methode | Beschreibung | Schwierigkeit |
|---------|-------------|---------------|
| **RCON-Polling** | Regelmäßig `status` und `stats` via RCON abfragen | Einfach |
| **Log-Parsing** | CS2 Server-Logs in Echtzeit parsen | Mittel |
| **SourceMod Plugin** | Custom Plugin das Events per HTTP/WS sendet | Fortgeschritten |
| **GOTV** | GOTV-Stream parsen für Match-Daten | Fortgeschritten |

**Empfehlung:** Starte mit RCON-Polling für den Prototyp, wechsle dann zu einem SourceMod-Plugin für Produktion.

### Beispiel: RCON-Polling

```javascript
// npm install rcon-srcds
const Rcon = require('rcon-srcds');

const rcon = new Rcon({ host: '127.0.0.1', port: 27015 });

async function pollCS2Status() {
  await rcon.authenticate('your_rcon_password');

  setInterval(async () => {
    try {
      const status = await rcon.execute('status');
      // Parse status output und sende Updates an Sync Engine
      parseAndSyncStatus(status);
    } catch (err) {
      console.error('RCON error:', err);
    }
  }, 5000); // Alle 5 Sekunden
}
```

---

## FiveM Integration

### Konzept

FiveM-Server verwenden Lua/JavaScript für serverseitige Scripte. Die Integration erfolgt direkt über ein **Server-Script**, das per HTTP mit der Sync Engine kommuniziert.

```
┌──────────────┐    Server Script    ┌──────────────┐
│  FiveM       │ ◄─────────────────► │ Sync Engine  │
│  Server      │    HTTP/REST        │ :8080        │
└──────────────┘                     └──────────────┘
```

### Schritt 1: FiveM Server-Resource erstellen

Erstelle eine neue Resource in deinem FiveM-Server:

```
resources/
  sync-bridge/
    fxmanifest.lua
    server.js
    config.js
```

**fxmanifest.lua:**
```lua
fx_version 'cerulean'
game 'gta5'

name 'sync-bridge'
description 'Sync Engine Bridge for FiveM'
author 'Your Name'
version '1.0.0'

server_script 'server.js'

convar_category 'Sync Engine' {
    "Configuration for Sync Engine bridge",
    {
        { "sync_api_url", "API URL", "CV_STRING", "http://localhost:8080/api/v1" },
        { "sync_username", "Username", "CV_STRING", "admin" },
        { "sync_password", "Password", "CV_STRING", "admin123" },
    }
}
```

**config.js:**
```javascript
const CONFIG = {
  API_URL: GetConvar('sync_api_url', 'http://localhost:8080/api/v1'),
  USERNAME: GetConvar('sync_username', 'admin'),
  PASSWORD: GetConvar('sync_password', 'admin123'),
  SERVER_MODE: 'freeplay',
  SERVER_MAP: 'los_santos',
  MAX_PLAYERS: 64,
  SYNC_INTERVAL: 10000, // 10 Sekunden
};

module.exports = CONFIG;
```

**server.js:**
```javascript
const CONFIG = require('./config.js');

let token = null;
let serverId = null;
let playerEntities = new Map(); // source -> entityId

// ─── HTTP Helper ───
async function apiRequest(path, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  try {
    const res = await fetch(`${CONFIG.API_URL}${path}`, options);
    return await res.json();
  } catch (err) {
    console.error(`[Sync] API Error: ${err.message}`);
    return null;
  }
}

// ─── 1. Authentifizierung ───
async function authenticate() {
  const res = await apiRequest('/auth/login', 'POST', {
    username: CONFIG.USERNAME,
    password: CONFIG.PASSWORD,
  });

  if (res?.success) {
    token = res.token;
    console.log('[Sync] Authenticated with Sync Engine');
    return true;
  }

  console.error('[Sync] Authentication failed');
  return false;
}

// ─── 2. Server registrieren ───
async function registerServer() {
  const res = await apiRequest('/servers', 'POST', {
    mode: CONFIG.SERVER_MODE,
    map: CONFIG.SERVER_MAP,
    maxPlayers: CONFIG.MAX_PLAYERS,
  });

  if (res?.success) {
    serverId = res.server.id;
    console.log(`[Sync] Server registered: ${serverId}`);
    return true;
  }

  console.error('[Sync] Server registration failed');
  return false;
}

// ─── 3. Spieler-Events ───

on('playerConnecting', (name, setKickReason, deferrals) => {
  const source = global.source;
  deferrals.defer();

  // Optional: Spieler in Sync Engine prüfen
  deferrals.update(`Syncing player data...`);

  setTimeout(async () => {
    const identifiers = getPlayerIdentifiers(source);
    const steamId = identifiers.find(id => id.startsWith('steam:')) || `fivem:${source}`;

    // Entity in Sync Engine erstellen
    const res = await apiRequest('/state/entities', 'POST', {
      type: 'fivem_player',
      ownerId: steamId,
      data: {
        name,
        steamId,
        server: serverId,
        position: { x: 0, y: 0, z: 0 },
        health: 200,
        armor: 0,
        money: 5000,
        job: 'unemployed',
        connected: true,
        joinedAt: Date.now(),
      },
    });

    if (res?.entity) {
      playerEntities.set(source, res.entity.id);
      console.log(`[Sync] Player ${name} synced: ${res.entity.id}`);
    }

    deferrals.done();
  }, 0);
});

on('playerDropped', async (reason) => {
  const source = global.source;
  const entityId = playerEntities.get(source);

  if (entityId) {
    await apiRequest(`/state/entities/${entityId}`, 'PATCH', {
      operations: [
        { op: 'set', path: 'connected', value: false },
        { op: 'set', path: 'disconnectedAt', value: Date.now() },
        { op: 'set', path: 'disconnectReason', value: reason },
      ],
    });
    playerEntities.delete(source);
    console.log(`[Sync] Player disconnected: ${entityId}`);
  }
});

// ─── 4. Position & Health synchronisieren ───

setInterval(async () => {
  const players = getPlayers();

  for (const playerId of players) {
    const entityId = playerEntities.get(parseInt(playerId));
    if (!entityId) continue;

    const ped = GetPlayerPed(playerId);
    if (!ped) continue;

    const coords = GetEntityCoords(ped);
    const health = GetEntityHealth(ped);
    const armor = GetPedArmour(ped);

    await apiRequest(`/state/entities/${entityId}`, 'PATCH', {
      operations: [
        { op: 'set', path: 'position', value: { x: coords[0], y: coords[1], z: coords[2] } },
        { op: 'set', path: 'health', value: health },
        { op: 'set', path: 'armor', value: armor },
      ],
    });
  }
}, CONFIG.SYNC_INTERVAL);

// ─── 5. Custom Events ───

// Spieler hat ein Fahrzeug gespawnt
RegisterCommand('syncvehicle', async (source, args) => {
  const model = args[0] || 'adder';
  const ped = GetPlayerPed(source);
  const coords = GetEntityCoords(ped);

  const res = await apiRequest('/state/entities', 'POST', {
    type: 'fivem_vehicle',
    ownerId: playerEntities.get(source) || 'system',
    data: {
      model,
      server: serverId,
      position: { x: coords[0], y: coords[1], z: coords[2] },
      health: 1000,
      spawnedAt: Date.now(),
    },
  });

  if (res?.entity) {
    console.log(`[Sync] Vehicle synced: ${res.entity.id}`);
  }
}, false);

// Geld-Transfer
async function transferMoney(fromSource, toSource, amount) {
  const fromEntity = playerEntities.get(fromSource);
  const toEntity = playerEntities.get(toSource);

  if (!fromEntity || !toEntity) return false;

  await apiRequest(`/state/entities/${fromEntity}`, 'PATCH', {
    operations: [{ op: 'increment', path: 'money', value: -amount }],
  });

  await apiRequest(`/state/entities/${toEntity}`, 'PATCH', {
    operations: [{ op: 'increment', path: 'money', value: amount }],
  });

  return true;
}

// ─── Start ───
async function init() {
  const authed = await authenticate();
  if (!authed) {
    console.error('[Sync] Failed to connect. Retrying in 30s...');
    setTimeout(init, 30000);
    return;
  }

  await registerServer();
  console.log('[Sync] FiveM Sync Bridge ready!');
}

// Beim Ressource-Start initialisieren
on('onResourceStart', (resourceName) => {
  if (GetCurrentResourceName() !== resourceName) return;
  init();
});

// Beim Ressource-Stop Server deregistrieren
on('onResourceStop', async (resourceName) => {
  if (GetCurrentResourceName() !== resourceName) return;
  if (serverId) {
    await apiRequest(`/servers/${serverId}`, 'DELETE');
    console.log('[Sync] Server deregistered');
  }
});
```

### Schritt 2: Resource aktivieren

In deiner `server.cfg`:
```
ensure sync-bridge
```

### Schritt 3: Testen

1. FiveM-Server starten
2. In der Server-Konsole sollte stehen: `[Sync] FiveM Sync Bridge ready!`
3. Öffne das Dashboard auf `http://localhost:3001`
4. Unter **Servers** siehst du den registrierten FiveM-Server
5. Wenn Spieler joinen, erscheinen sie unter **State** als `fivem_player` Entities

---

## Custom Game Engine Integration

Für eigene Engines / andere Spiele gelten die gleichen Prinzipien:

### Minimaler Client (JavaScript/TypeScript)

```typescript
class SyncClient {
  private ws: WebSocket;
  private token: string;

  constructor(private url: string) {}

  async connect(username: string, password: string): Promise<void> {
    // 1. Authenticate
    const res = await fetch(`${this.url.replace('ws', 'http')}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    this.token = data.token;

    // 2. Connect WebSocket
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: 'auth', token: this.token }));
    };
  }

  createEntity(type: string, data: any): void {
    this.ws.send(JSON.stringify({ type: 'entity_create', entityType: type, data }));
  }

  updateEntity(id: string, operations: any[]): void {
    this.ws.send(JSON.stringify({ type: 'entity_update', entityId: id, operations }));
  }

  onMessage(handler: (msg: any) => void): void {
    this.ws.onmessage = (e) => handler(JSON.parse(e.data));
  }
}

// Usage:
const client = new SyncClient('ws://localhost:8080');
await client.connect('admin', 'admin123');
client.createEntity('player', { name: 'Hero', hp: 100 });
```

### Minimaler Client (Python)

```python
import asyncio
import json
import websockets
import requests

SYNC_URL = "http://localhost:8080/api/v1"
WS_URL = "ws://localhost:8080"

def authenticate():
    res = requests.post(f"{SYNC_URL}/auth/login",
        json={"username": "admin", "password": "admin123"})
    return res.json()["token"]

async def main():
    token = authenticate()

    async with websockets.connect(WS_URL) as ws:
        # Authentifizieren
        await ws.send(json.dumps({"type": "auth", "token": token}))

        # Spieler erstellen
        await ws.send(json.dumps({
            "type": "entity_create",
            "entityType": "player",
            "data": {"name": "PythonPlayer", "hp": 100}
        }))

        # Auf Updates hören
        async for message in ws:
            data = json.loads(message)
            print(f"Received: {data}")

asyncio.run(main())
```

### Minimaler Client (C# / Unity)

```csharp
using System;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

public class SyncEngineClient
{
    private ClientWebSocket ws;
    private string token;
    private string apiUrl;

    public SyncEngineClient(string apiUrl)
    {
        this.apiUrl = apiUrl;
        this.ws = new ClientWebSocket();
    }

    public async Task ConnectAsync(string username, string password)
    {
        // Authenticate
        using var http = new HttpClient();
        var loginBody = JsonSerializer.Serialize(new { username, password });
        var res = await http.PostAsync($"{apiUrl}/auth/login",
            new StringContent(loginBody, Encoding.UTF8, "application/json"));
        var json = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        token = json.RootElement.GetProperty("token").GetString();

        // WebSocket connect
        var wsUrl = apiUrl.Replace("http", "ws").Replace("/api/v1", "");
        await ws.ConnectAsync(new Uri(wsUrl), CancellationToken.None);

        // Auth message
        await SendAsync(new { type = "auth", token });
    }

    public async Task CreateEntityAsync(string entityType, object data)
    {
        await SendAsync(new { type = "entity_create", entityType, data });
    }

    public async Task UpdateEntityAsync(string entityId, object[] operations)
    {
        await SendAsync(new { type = "entity_update", entityId, operations });
    }

    private async Task SendAsync(object message)
    {
        var json = JsonSerializer.Serialize(message);
        var bytes = Encoding.UTF8.GetBytes(json);
        await ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
    }
}
```

---

## Monitoring & Debugging

### Dashboard

Öffne `http://localhost:3001` und melde dich mit `admin` / `admin123` an.

| Tab | Zeigt |
|-----|-------|
| **Overview** | Connections, Server, Matches, Alerts, Memory |
| **Servers** | Alle registrierten Server + Create/Delete |
| **Matches** | Aktive Matches + Matchmaking-Queue |
| **Alerts** | Aktive Warnungen + History |
| **State** | Alle Entities mit Filter/Suche + Create/Delete |
| **Settings** | Server-Konfiguration, Cluster-Info |
| **Docs** | Quick Start Guide |

### Health Check

```bash
curl http://localhost:8080/api/v1/health
# → { "status": "ok", "uptime": 12345 }
```

### Prometheus Metrics

```bash
curl http://localhost:8080/api/v1/metrics
# → Prometheus-Format für Grafana etc.
```

### Logs

Die Sync Engine loggt im JSON-Format nach stdout. Nutze `jq` zum filtern:

```bash
npm start 2>&1 | jq 'select(.component == "GameServerManager")'
```

---

## Troubleshooting

### "Internal Server Error" beim Login
- Prüfe ob die Sync Engine läuft: `curl http://localhost:8080/api/v1/health`
- Prüfe den Port: Standard ist `8080`, nicht `3000`

### "Unauthorized" bei API-Aufrufen
- Token abgelaufen? Neu einloggen
- Header-Format: `Authorization: Bearer TOKEN` (mit "Bearer " davor!)

### WebSocket verbindet sich nicht
- Prüfe ob der WS-Port erreichbar ist: `ws://localhost:8080`
- Erste Nachricht muss `{ type: "auth", token: "..." }` sein

### Dashboard zeigt keine Daten
- Vite-Proxy prüfen: `dashboard/vite.config.ts` muss auf Port `8080` zeigen
- Dashboard neu starten nach Änderungen: `cd dashboard && npm run dev`

### Entity-Updates kommen nicht an
- Entity-ID prüfen (muss exakt matchen)
- `operations` Array muss valide sein (op, path, value)

### Server registriert sich nicht
- Token gültig? Admin-Rolle nötig für Server-Erstellung
- JSON-Body vollständig? `mode` ist Pflichtfeld

---

## Zusammenfassung

| Feature | REST API | WebSocket | Dashboard |
|---------|----------|-----------|-----------|
| Server erstellen | ✅ POST `/servers` | — | ✅ Servers Tab |
| Server löschen | ✅ DELETE `/servers/:id` | — | ✅ Servers Tab |
| Entity erstellen | ✅ POST `/state/entities` | ✅ `entity_create` | ✅ State Tab |
| Entity updaten | ✅ PATCH `/state/entities/:id` | ✅ `entity_update` | — |
| Entity löschen | ✅ DELETE `/state/entities/:id` | — | ✅ State Tab |
| Matchmaking | ✅ POST `/matchmaking/enqueue` | ✅ `join_match` | ✅ Matches Tab |
| Match beenden | ✅ POST `/matches/:id/end` | — | ✅ Matches Tab |
| Monitoring | ✅ GET `/metrics` | — | ✅ Overview Tab |
| Alerts | ✅ GET `/alerts` | — | ✅ Alerts Tab |
