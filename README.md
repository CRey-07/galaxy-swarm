# Galaxy Swarm

Server-authoritative multiplayer .io space game. Node.js + `ws` WebSocket
backend, vanilla HTML5 Canvas frontend, no build step required.

## Local development

```bash
npm install
npm run dev          # auto-restarts on file change (node --watch)
# or
npm start
```

Open `http://localhost:3000`.

## Architecture

```
src/server/
  index.js        Express app, Helmet/CSP, HTTP server, tick scheduling
  gameLoop.js      World state: physics, collisions, mass/radius, respawn
  wsHandlers.js    WebSocket handshake origin checks, message routing,
                   viewport-culled delta broadcast
  spatialGrid.js   Uniform grid spatial hash for O(~1) collision queries
  bots.js          Server-side bot AI (fills the map to MIN_ENTITIES)
  sanitize.js      Nickname sanitization + profanity blocklist
  rateLimiter.js   Per-socket token-bucket input rate limiter
  config.js        All tunable constants in one place

public/
  index.html       Menu, HUD, modals
  css/style.css    Dark space theme
  js/ui.js         Menu/modal interactions (skin, server, legal, quality)
  js/game.js       Canvas rendering, WS client, input capture, interpolation
  legal/*.html     Privacy Policy, Terms of Service, Contact/DMCA
```

### Server-authoritative model

The client never sends a position — only a normalized direction vector and a
boost flag, at most 30 packets/sec (enforced server-side via a token bucket
in `rateLimiter.js`; excess packets are silently dropped, not disconnected,
to avoid trivial DoS-by-flapping). The server:

- integrates movement itself (`gameLoop.js::_integrateMovement`), clamping
  turn rate and hard-capping speed,
- resolves stardust pickup and core/ring collisions using the spatial grid,
- computes each player's viewport-culled visible entity list and only
  broadcasts those (`wsHandlers.js::broadcastState`), at 20Hz, decoupled
  from the 60Hz physics tick.

This means there is nothing meaningful for a modified client to "cheat" —
it can only ever request a direction, not a position or a kill.

### Collision / elimination rule

A player dies if their **core** overlaps another player's **orbit ring**
(rendered client-side at `radius * 1.6`) or the other player's core directly,
provided the other player is larger. This lets a small, agile core thread
between ring segments and hit a giant's core directly — mirrored exactly
between client rendering and server hit-testing so what you see is what
resolves.

### Bot-fill

`World._maintainBotFill()` runs every tick and keeps total entities
(humans + bots) at `MIN_ENTITIES` (default 20), capped at `MAX_BOTS`. Bots
run the same physics/collision path as humans — no special-cased logic.

## Deployment (Coolify / any Docker host)

1. Push this repo to your Git provider, connect it in Coolify as a
   Dockerfile-based app, expose port `3000`.
2. Set environment variables (see `.env.example`):
   - `ALLOWED_ORIGINS` — **required in production**. Comma-separated list
     of exact origins (`https://yourdomain.com`). Without this, the server
     falls back to accepting any origin and logs a warning on boot.
   - `PORT` — defaults to `3000`.
3. Put Coolify's/your reverse proxy in front for TLS termination; the app
   itself speaks plain HTTP/WS behind the proxy.

### Manual Docker

```bash
docker compose up -d --build
```

The image is a multi-stage Alpine build, runs as a non-root UID (10001),
and the compose file mounts the container filesystem read-only (with a
`tmpfs` `/tmp`) since the app writes nothing to disk at runtime.

## Security checklist implemented

- [x] Server-authoritative physics/collision (60Hz tick)
- [x] Nickname sanitization (XSS/HTML/template metachar stripping + profanity list)
- [x] Per-socket rate limiting (token bucket, 30 pkts/sec)
- [x] WS `maxPayload` cap + origin allowlist on handshake
- [x] Helmet.js with strict CSP, no `unsafe-inline` scripts, `frameAncestors 'none'`
- [x] HTTP-level rate limiting (`express-rate-limit`)
- [x] Non-root, multi-stage, Alpine Docker image + healthcheck
- [x] Viewport culling + delta-style snapshot to limit payload/bandwidth
- [x] Spatial grid partitioning for collision queries

## Known scope notes (read before production launch)

- `.env.example` / `docker-compose.yml` `ALLOWED_ORIGINS` is a placeholder —
  **you must set it to your real domain** before going live.
- The legal pages in `public/legal/` contain `[REPLACE WITH ...]` placeholders
  for your operator identity and contact email — this is legal boilerplate,
  not legal advice; have counsel review before relying on it for KVKK/GDPR
  compliance.
- The profanity list in `sanitize.js` is intentionally minimal; extend via
  `PROFANITY_EXTRA` or swap in a dedicated library/service for production.
- There is no persistent storage/leaderboard-across-sessions by design; add
  Redis/Postgres if you want cross-session leaderboards or accounts.
