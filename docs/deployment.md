# OpenHarvest v2 — Deployment Runbook

> Deploying the Vite SPA to the server host and serving it via Caddy. Also covers
> the load-bearing gotchas that bit us during the v2 launch.

---

## What v2 is and where it lives

- **Production URL:** [`https://your-server.example.com/openharvest/`](https://your-server.example.com/openharvest/)
- **Static dist on server:** `/opt/homelab/openharvest/`
- **Reverse proxy / static server:** Caddy in the `vaultwarden` compose
  stack at `/opt/homelab/vaultwarden/`
- **Backend API (unchanged):** `openharvest-api` container in the
  `openharvest` compose stack, reachable from Caddy at
  `openharvest-api:5000` over the `openharvest-net` Docker network

Caddy is configured to:

1. Reverse-proxy `/openharvest/api/*` and `/openharvest/hubs/*` to the
   API, **stripping** the `/openharvest` prefix on the way through
2. Serve static files for everything else under `/openharvest/*` from
   the bind-mounted dist directory, with SPA fallback to `index.html`

---

## Deploy command sequence

Run from a Windows shell with `ssh` and `scp` against your server host
in your SSH config. Five commands, in order:

```bash
cd C:\openharvest\frontend-v2
npm run build
scp -r dist/* <your-server>:/tmp/openharvest-dist-tmp/
ssh <your-server> 'sudo rm -rf /opt/homelab/openharvest && sudo mkdir -p /opt/homelab/openharvest && sudo cp -r /tmp/openharvest-dist-tmp/* /opt/homelab/openharvest/ && sudo chown -R <user>:<user> /opt/homelab/openharvest && rm -rf /tmp/openharvest-dist-tmp'
ssh <your-server> 'cd /opt/homelab/vaultwarden && sudo docker compose up -d --force-recreate caddy'
```

Then verify:

```bash
# 200 + HTML body containing "OpenHarvest v2"
curl -sI https://your-server.example.com/openharvest/ | head -5

# 200 + JSON array (possibly empty)
curl -s https://your-server.example.com/openharvest/api/v1/gardens/ids

# 101 (Switching Protocols) on the negotiate handshake — actually returns
# 200 with a JSON negotiateVersion document
curl -s https://your-server.example.com/openharvest/hubs/garden/negotiate?negotiateVersion=1
```

---

## Gotchas (load-bearing)

These each cost real time to discover. Don't lose them.

### 1. Caddy bind-mount inode caching

Caddy's container has `/opt/homelab/openharvest:/opt/homelab/openharvest:ro`
mounted in. When you `sudo mv` or `sudo rm -rf` the host directory and
re-create it, the **host inode changes** but the Docker bind mount
inside the running container keeps pointing at the old (now-orphaned)
inode. The container literally cannot see the new files.

`caddy reload` does **not** fix it. `docker restart caddy` does **not**
fix it. The only working incantation is:

```bash
sudo docker compose up -d --force-recreate caddy
```

This destroys and recreates the container, which re-resolves the bind
mount. **This is the second time it has bit us.** If you see "old
content still serving after deploy," this is why.

### 2. `uri strip_prefix /openharvest` is required in API + hub blocks

The .NET backend has an optional `app.UsePathBase(...)` call gated on
the `OpenHarvest:PathBase` config key (env var
`OpenHarvest__PathBase`). **That env var is NOT set on the deployed
`openharvest-api` container** (verified 2026-04-27). So Kestrel does
not strip the prefix internally — every request hits the API with the
full `/openharvest/api/...` path, and ASP.NET routing returns 404
because the controllers are registered at `api/v1/...` (no prefix).

Caddy compensates with:

```caddy
handle /openharvest/api/* {
    uri strip_prefix /openharvest
    reverse_proxy openharvest-api:5000
}
handle /openharvest/hubs/* {
    uri strip_prefix /openharvest
    reverse_proxy openharvest-api:5000
}
```

> The inline comment in the live Caddyfile currently claims the backend
> uses `UsePathBase` and we use `handle` to "preserve the prefix" —
> that comment is **stale and wrong** as of 2026-04-27. The reality is
> `uri strip_prefix` does the actual stripping. If you ever set
> `OpenHarvest__PathBase=/openharvest` on the API container, you'll
> need to remove the `uri strip_prefix` lines or you'll double-strip.

Don't remove those `uri strip_prefix` lines without first checking the
container env vars (`sudo docker inspect openharvest-api | grep -i
pathbase`).

### 3. Caddy needs the static dist mounted in

v1 was reverse-proxy-only (Caddy → `openharvest-api:5000`, the API
served `wwwroot/`), so Caddy's `docker-compose.yml` never had a
bind mount for OpenHarvest static files. v2 is the **first
static-served service on this Caddy.** We had to add:

```yaml
volumes:
  - /opt/homelab/openharvest:/opt/homelab/openharvest:ro
  - /opt/homelab/openharvest-v2:/opt/homelab/openharvest-v2:ro  # legacy mount
  # ...other Caddy volumes
```

to `/opt/homelab/vaultwarden/docker-compose.yml`. Future static
services on this Caddy need their own bind mount **and** their own
`handle_path` block. There is no shared static root.

---

## Caddy block layout

Current block, sanitized, inside the `your-server.example.com` site
in `/opt/homelab/vaultwarden/Caddyfile`:

```caddy
# --- OpenHarvest v2 (canonical /openharvest/) ---
# Order matters: API + hubs first (most specific), static-serve last.

# REST API → backend, prefix stripped at the proxy boundary
handle /openharvest/api/* {
    uri strip_prefix /openharvest
    reverse_proxy openharvest-api:5000
}

# SignalR hub → same backend, same strip
handle /openharvest/hubs/* {
    uri strip_prefix /openharvest
    reverse_proxy openharvest-api:5000
}

# Static SPA — handle_path strips the prefix before file lookup, so
# index.html and assets/ resolve relative to /opt/homelab/openharvest.
# try_files falls back to index.html for SPA client-side routes.
handle_path /openharvest/* {
    root * /opt/homelab/openharvest
    try_files {path} /index.html
    file_server
}

# Bare /openharvest → /openharvest/ (so the trailing slash isn't required)
redir /openharvest /openharvest/

# Legacy bookmarks: /openharvest-v2(/...) → /openharvest/
@v2legacy path /openharvest-v2 /openharvest-v2/*
handle @v2legacy {
    header Location "/openharvest/"
    respond 301
}
```

Ordering rationale: Caddy evaluates `handle` blocks by specificity, but
keeping the most-specific blocks (`/api/*`, `/hubs/*`) physically first
makes the file readable. The static-serve block at the bottom is the
catch-all for everything under `/openharvest/*`.

---

## Homepage tile

The tile on the server homepage lives in
`/opt/homelab/homepage/config/services.yaml`. Edit in place — Homepage
hot-reloads on file change, no restart needed. The tile points at
`https://your-server.example.com/openharvest/`.

---

## Backups left on server

The deploy script doesn't currently snapshot the dist (it just
clobbers), but other Caddy / Compose work has left timestamped
backups. Files you may find lying around on the server:

| Path | What | Safe to delete? |
|---|---|---|
| `/opt/homelab/vaultwarden/Caddyfile.bak.<unix-ts>` | Caddyfile prior to a given edit | Yes, after a few days of stable serving |
| `/opt/homelab/vaultwarden/docker-compose.yml.bak.<unix-ts>` | Compose prior to a given edit | Same |
| `/opt/homelab/homepage/config/services.yaml.bak.<unix-ts>` | Homepage config prior to a given edit | Same |
| `/opt/homelab/openharvest-v2/` | Post-promotion artifact directory (was `/openharvest-v2` URL before promotion to canonical `/openharvest/`) | Yes, once you're confident in v2; keeping it around makes the legacy redirect block above harmless |

---

## Rollback

If v2 is broken and you need to fall back to v1 (the .NET API's
embedded `wwwroot`):

1. Restore the prior Caddyfile:
   ```bash
   ssh <your-server> 'sudo cp /opt/homelab/vaultwarden/Caddyfile.bak.<latest> /opt/homelab/vaultwarden/Caddyfile'
   ```
   Or hand-edit: replace the four `handle` / `handle_path` /
   `redir` blocks under the `OpenHarvest v2` comment with a single
   block:
   ```caddy
   handle /openharvest/* {
       reverse_proxy openharvest-api:5000
   }
   ```
   (The API container's `wwwroot/` static assets are still inside the
   image — backend never went down.)

2. Optional: clear the static dist so nothing is serving it:
   ```bash
   ssh <your-server> 'sudo rm -rf /opt/homelab/openharvest'
   ```

3. **Force-recreate Caddy** (see Gotcha #1):
   ```bash
   ssh <your-server> 'cd /opt/homelab/vaultwarden && sudo docker compose up -d --force-recreate caddy'
   ```

4. Verify:
   ```bash
   curl -sI https://your-server.example.com/openharvest/
   ```
   You should see the v1 PWA response — Babylon.js, no Pascal viewer.

The backend (`openharvest-api`, `openharvest-worker`,
`openharvest-postgres`, `openharvest-redis`, `openharvest-minio`) was
never touched during the v2 promotion, so rollback is purely a
Caddy / static-files concern.
