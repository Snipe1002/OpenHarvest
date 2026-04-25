# OpenHarvest — Deployment

> The same `docker-compose.yml` deploys as a single-host install for self-hosters and as a Docker Swarm stack for the public federated instance. Only the `deploy.replicas` blocks differ.

---

## 1. Topology Overview

```
                         ┌─────────────────────┐
                         │  Traefik (ingress)   │
                         │  TLS, sticky WS,     │
                         │  host routing        │
                         └──────────┬───────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │                │
            ┌───────▼─────┐   ┌─────▼──────┐  ┌─────▼──────┐
            │   API #1    │   │   API #2   │  │  Worker    │
            │  ASP.NET    │   │  ASP.NET   │  │  Background│
            │  Core +     │   │  Core +    │  │  Service   │
            │  SignalR    │   │  SignalR   │  │            │
            └───────┬─────┘   └─────┬──────┘  └─────┬──────┘
                    │               │                │
                    └───────┬───────┴────────┬───────┘
                            │                │
                  ┌─────────▼────────┐  ┌────▼──────────────┐
                  │     Redis        │  │   Postgres        │
                  │ SignalR backplane│  │  Entity store +   │
                  │ + cache          │  │  JSONB components │
                  └──────────────────┘  └───────────────────┘

                  ┌──────────────────┐
                  │      MinIO       │
                  │  Photo blob      │
                  │  S3-compatible   │
                  └──────────────────┘
```

---

## 2. Services

| Service | Image | Stateful | Notes |
|---|---|---|---|
| `traefik` | `traefik:v3` | No | TLS termination, host-based routing, sticky WebSocket sessions |
| `api` | `openharvest-api` (custom) | No | ASP.NET Core: REST + SignalR + PWA static assets |
| `worker` | `openharvest-worker` (custom) | No | BackgroundService: OpenFarm sync, advisor jobs, photo processing |
| `postgres` | `postgres:16` | **Yes** | Entity store. Pin to one node with a volume, or use external managed DB. |
| `redis` | `redis:7` | Soft | SignalR backplane and cache. Cache loss is recoverable. |
| `minio` | `minio/minio` | **Yes** | Photo blob store. Pin to a node with a volume. |

---

## 3. Single-Host Deployment (Self-Hoster)

The simplest deploy — one machine, one compose file, no orchestration.

```bash
git clone https://github.com/Snipe1002/OpenHarvest.git
cd OpenHarvest
cp .env.example .env
# Edit .env to set AI provider key and admin password
docker compose up -d
```

Access via `http://localhost:5000` (or your Traefik-configured hostname).

**Backups:** point `restic` (or your tool of choice) at the `postgres` volume and the `minio` volume. See `runbooks/restore.md` once it exists.

---

## 4. Swarm Deployment (Public Federated Instance)

The same compose file with `deploy:` blocks set:

```yaml
services:
  api:
    image: openharvest-api:latest
    deploy:
      replicas: 2
      restart_policy:
        condition: any
      placement:
        constraints:
          - node.role == worker

  worker:
    image: openharvest-worker:latest
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == worker

  postgres:
    image: postgres:16
    deploy:
      placement:
        constraints:
          - node.labels.openharvest.role == database

  minio:
    image: minio/minio
    deploy:
      placement:
        constraints:
          - node.labels.openharvest.role == storage
```

Deploy with:

```bash
docker stack deploy -c docker-compose.yml -c docker-compose.swarm.yml openharvest
```

Postgres and MinIO are pinned to specific labeled nodes that have the persistent volumes attached. API and worker float across all worker nodes.

---

## 5. Critical Gotchas

### SignalR backplane is mandatory above one API replica

The moment API scales past one replica, two clients on different replicas will not see each other's edits unless their group broadcasts fan out across nodes. Redis is the backplane — do not skip it.

### WebSocket sticky session routing

SignalR negotiates a connection over HTTP, then upgrades to WebSocket. The upgrade must hit the same backend instance that handled the negotiate. Traefik handles this with the appropriate sticky-session config:

```yaml
labels:
  - "traefik.http.services.api.loadbalancer.sticky.cookie=true"
  - "traefik.http.services.api.loadbalancer.sticky.cookie.name=oh_session"
```

Skipping this leads to subtle "the page works but live updates don't" bugs that are painful to track down.

### Postgres backup before public traffic

Postgres backup is non-negotiable before any user data lands on the public instance. WAL archiving + nightly base backup minimum.

### Photo storage grows fast

A user with 50 plants snapping a photo a week generates ~10 GB/year per user. Lifecycle policies and a tiered storage strategy (hot recent / cold older / cold thumbnails) need to be designed early — even if not implemented in v1.

### TLS for self-hosters

Traefik can issue Let's Encrypt certs automatically given a public DNS hostname. Self-hosters on a private network without a public hostname can use Tailscale's HTTPS option, or generate a self-signed cert and accept the browser warning.

---

## 6. Why API + Worker Split

Same codebase, different entrypoints. The API process serves user requests synchronously. The worker process runs:

- Scheduled jobs — OpenFarm crop-data sync nightly
- Event-driven jobs — advisor analysis on photo upload
- Long-running computation — yield projection across a season

Splitting them lets each scale independently and prevents a slow advisor job from blocking a user gesture.

---

## 7. Environment Variables

| Variable | Purpose | Example |
|---|---|---|
| `AI_PROVIDER` | Which `IAiProvider` to wire | `claude` / `openai` / `ollama` |
| `CLAUDE_API_KEY` | Anthropic key (if using Claude) | `sk-ant-…` |
| `OPENAI_API_KEY` | OpenAI key (if using OpenAI) | `sk-…` |
| `OLLAMA_BASE_URL` | Local Ollama endpoint | `http://ollama:11434` |
| `POSTGRES_HOST` | Postgres hostname | `postgres` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Postgres creds | — |
| `REDIS_HOST` | Redis hostname | `redis` |
| `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | MinIO config | — |
| `WEATHER_API_KEY` | Weather provider key | — |
| `ASPNETCORE_URLS` | API listener | `http://+:5000` |

All sensitive values should use Docker secrets in Swarm deployments rather than env file.

---

## 8. Federated Instances

The federation layer (Layer 4) enables instance-to-instance discovery. Each federated instance:

- Publishes a `/.well-known/openharvest` document with public capabilities
- Advertises optional shared layouts and community contributions
- Honors `robots.txt`-style federation policies — opt-in for crawl, signed handshake for full peering

Federation is **off by default** for self-hosters. Public instances opt in.

---

*See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the deeper system design.*
