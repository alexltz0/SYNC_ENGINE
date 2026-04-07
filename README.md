# Sync Engine

**Enterprise-grade real-time data orchestration platform for massive distributed game server networks.**

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Sync Engine                            │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│  REST    │ WebSocket│ Dashboard│ Metrics  │  Health        │
│  API     │ Server   │   UI     │ Endpoint │  Check         │
├──────────┴──────────┴──────────┴──────────┴────────────────┤
│              Security Layer (JWT, Rate Limiting)            │
├────────────────────────────────────────────────────────────┤
│  Game Server  │  Matchmaker  │  Cluster     │  State       │
│  Manager      │              │  Coordinator │  Synchronizer│
├───────────────┴──────────────┴──────────────┴──────────────┤
│  Event Bus  │  State Manager  │  Message Broker             │
├─────────────┴─────────────────┴────────────────────────────┤
│  Write-Ahead Log  │  Snapshot Manager  │  Metrics Collector │
├───────────────────┴────────────────────┴───────────────────┤
│                    Node.js / TypeScript                     │
└────────────────────────────────────────────────────────────┘
```

## Features

- **Core Engine** — Event bus with middleware & dead-letter queue, state manager with entity CRUD/versioning/snapshots, pub/sub message broker
- **Distributed Clustering** — Node registry, leader election, heartbeat monitoring, cluster state replication
- **Real-time Sync** — CRDT-inspired conflict resolution (LWW, merge, custom), delta compression, peer-to-peer state sync
- **Network Transport** — WebSocket server with binary protocol framing, connection pooling, heartbeat/auth
- **Game Orchestration** — Server lifecycle management, matchmaking with skill-based queues, automatic server provisioning
- **Persistence** — Write-ahead log with file rotation/replay, periodic snapshots, crash recovery
- **Security** — JWT authentication, bcrypt password hashing, tiered rate limiting, role-based access control
- **Monitoring** — Metrics collector with Prometheus export, configurable alert rules, real-time dashboard
- **API** — RESTful admin API with full CRUD for entities/servers/matches/alerts/snapshots
- **Dashboard** — React + TailwindCSS web UI with live overview, server/match/alert/state views

## Quick Start

### Prerequisites
- Node.js >= 18
- npm >= 9

### Install & Run

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Development mode (with auto-reload)
npm run dev

# Production build
npm run build
npm start
```

### Docker

```bash
# Build and run with Docker Compose
docker-compose up -d sync-engine

# Development mode
docker-compose --profile dev up -d sync-engine-dev
```

### Dashboard

```bash
cd dashboard
npm install
npm run dev    # http://localhost:3001
```

## API Reference

All endpoints are prefixed with `/api/v1`. Most require a Bearer token via `Authorization` header.

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Create user account |
| POST | `/auth/login` | Authenticate & get token |

### Health & Metrics
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health check |
| GET | `/metrics` | No | Prometheus metrics |
| GET | `/metrics/json` | Yes | JSON metrics |

### Game Servers
| Method | Path | Description |
|--------|------|-------------|
| GET | `/servers` | List servers (filter by mode/map/status) |
| POST | `/servers` | Create server (admin) |
| GET | `/servers/:id` | Get server details |
| DELETE | `/servers/:id` | Remove server (admin) |

### Matchmaking
| Method | Path | Description |
|--------|------|-------------|
| POST | `/matchmaking/enqueue` | Join matchmaking queue |
| POST | `/matchmaking/dequeue` | Leave queue |
| GET | `/matchmaking/queue` | Queue size |
| GET | `/matchmaking/stats` | Matchmaking statistics |

### Matches
| Method | Path | Description |
|--------|------|-------------|
| GET | `/matches` | All matches |
| GET | `/matches/active` | Active matches |
| GET | `/matches/:id` | Match details |
| POST | `/matches/:id/end` | End match (admin) |

### State / Entities
| Method | Path | Description |
|--------|------|-------------|
| GET | `/state/entities` | List entities (filter by type/owner) |
| POST | `/state/entities` | Create entity |
| GET | `/state/entities/:id` | Get entity |
| PATCH | `/state/entities/:id` | Update entity (operations array) |
| DELETE | `/state/entities/:id` | Delete entity |
| GET | `/state/entities/:id/history` | Entity change history |
| GET | `/state/version` | Current state version |

### Snapshots
| Method | Path | Description |
|--------|------|-------------|
| GET | `/snapshots` | List snapshots |
| POST | `/snapshots` | Take snapshot (admin) |

### Alerts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/alerts` | Active alerts & history |
| POST | `/alerts/:id/acknowledge` | Acknowledge alert (admin) |

### Cluster & Connections
| Method | Path | Description |
|--------|------|-------------|
| GET | `/cluster/state` | Cluster state |
| GET | `/cluster/node` | Local node info |
| GET | `/connections` | WebSocket connection stats |
| GET | `/dashboard/overview` | Full dashboard data |

## WebSocket Protocol

Connect to `ws://host:port` and send JSON messages:

```json
{"type": "entity_create", "entityType": "player", "data": {"name": "Alice"}}
{"type": "entity_update", "entityId": "...", "operations": [{"op": "set", "path": "hp", "value": 90}]}
{"type": "state_request"}
{"type": "join_match", "mode": "ranked", "skillRating": 1500}
{"type": "leave_match", "mode": "ranked"}
```

## Environment Variables

See `.env.example` for all available configuration options including server ports, cluster settings, persistence paths, security parameters, and logging levels.

## Project Structure

```
sync_engine/
├── src/
│   ├── api/           # REST routes & middleware
│   ├── cluster/       # Node registry & coordinator
│   ├── config/        # Environment config with Zod validation
│   ├── core/          # Event bus, state manager, message broker, types
│   ├── monitoring/    # Metrics collector & alerting
│   ├── network/       # WebSocket server, binary protocol, connection pool
│   ├── orchestration/ # Game server manager & matchmaker
│   ├── persistence/   # WAL & snapshot manager
│   ├── security/      # Auth (JWT/bcrypt) & rate limiting
│   ├── sync/          # Conflict resolver, delta compressor, state sync
│   ├── utils/         # Logger, ID gen, timers, buffer pool
│   └── index.ts       # Main entry point
├── dashboard/         # React + Tailwind web dashboard
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## License

MIT
