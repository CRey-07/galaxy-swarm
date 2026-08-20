'use strict';

const { WebSocketServer } = require('ws');
const TokenBucket = require('./rateLimiter');
const { sanitizeNickname } = require('./sanitize');
const cfg = require('./config');

const VALID_SKINS = new Set(['planet', 'nebula', 'blackhole', 'starcore']);

function originAllowed(origin, allowedOrigins) {
  if (!origin) return allowedOrigins.includes('*');
  return allowedOrigins.includes('*') || allowedOrigins.includes(origin);
}

function attachWebSocketServer(server, world, { allowedOrigins }) {
  const wss = new WebSocketServer({
    server,
    maxPayload: cfg.MAX_WS_PAYLOAD_BYTES,
    verifyClient: (info, done) => {
      const origin = info.origin || info.req.headers.origin;
      if (!originAllowed(origin, allowedOrigins)) {
        done(false, 403, 'Origin not allowed');
        return;
      }
      done(true);
    },
  });

  wss.on('connection', (ws, req) => {
    const bucket = new TokenBucket();
    let player = null;

    ws.on('message', (raw) => {
      // Hard payload cap is enforced by maxPayload above (connection is
      // terminated by ws automatically); this is a secondary guard.
      if (raw.length > cfg.MAX_WS_PAYLOAD_BYTES) return;

      if (!bucket.tryConsume()) return; // silently drop, do not disconnect on burst

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // malformed payload, ignore
      }
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'join': {
          if (player) return; // already joined
          const nickname = sanitizeNickname(msg.nickname);
          const skin = VALID_SKINS.has(msg.skin) ? msg.skin : 'planet';
          player = world.spawnPlayer({ nickname, skin, socket: ws, isBot: false });
          ws.playerId = player.id;
          ws.send(JSON.stringify({ type: 'welcome', id: player.id, world: { w: cfg.WORLD_WIDTH, h: cfg.WORLD_HEIGHT } }));
          break;
        }
        case 'input': {
          if (!player) return;
          const dx = Number(msg.dx);
          const dy = Number(msg.dy);
          if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
          // Clamp to unit-ish vector; server normalizes and derives speed itself.
          world.applyInput(player, {
            dx: Math.max(-1, Math.min(1, dx)),
            dy: Math.max(-1, Math.min(1, dy)),
            boost: !!msg.boost,
          });
          break;
        }
        case 'respawn': {
          if (!player) return;
          if (!player.dead) return;
          // Menu-driven restart: the client re-shows the main menu on death
          // (nickname input, skin picker, Play button) and resubmits both
          // here, rather than opening a brand-new socket/join for a session
          // that already exists server-side.
          if (typeof msg.nickname === 'string') {
            player.nickname = sanitizeNickname(msg.nickname);
          }
          if (VALID_SKINS.has(msg.skin)) {
            player.skin = msg.skin;
          }
          world.respawn(player);
          break;
        }
        case 'viewport': {
          if (!player) return;
          const w = Number(msg.w), h = Number(msg.h);
          if (Number.isFinite(w) && Number.isFinite(h)) {
            player.viewportW = Math.min(4000, Math.max(200, w));
            player.viewportH = Math.min(4000, Math.max(200, h));
          }
          break;
        }
        default:
          break;
      }
    });

    ws.on('close', () => {
      if (player) world.removePlayer(player.id);
    });

    ws.on('error', () => {
      if (player) world.removePlayer(player.id);
    });
  });

  return wss;
}

/**
 * Broadcasts a viewport-culled, delta-compressed snapshot to every connected
 * human socket. Bots need no network traffic. Only entities inside each
 * player's viewport (+margin) are sent, keeping payloads small at scale.
 */
function broadcastState(world) {
  // Computed once per broadcast tick and shared across every socket this
  // call — it's a coarse world-wide aggregate, not per-viewport data, so
  // there's no reason to recompute it per player.
  const radar = world.computeRadarGrid();

  for (const p of world.players.values()) {
    if (p.isBot || !p.socket || p.socket.readyState !== 1) continue;

    const vw = (p.viewportW || 1600) + cfg.VIEWPORT_MARGIN * 2;
    const vh = (p.viewportH || 900) + cfg.VIEWPORT_MARGIN * 2;
    const visible = world.grid.queryRect(p.x, p.y, vw, vh);

    const entities = visible.map((e) => world.snapshotEntity(e));
    // Always include self even if grid rounding misses it near edges.
    entities.push(world.snapshotEntity(p));

    const payload = JSON.stringify({
      type: 'state',
      tick: world.tick,
      self: { x: Math.round(p.x), y: Math.round(p.y), r: Math.round(p.radius), dead: p.dead, score: p.score, reason: p.deathReason || null },
      entities,
      leaderboard: world.leaderboard(),
      radar,
    });
    p.deathReason = null;

    try {
      p.socket.send(payload);
    } catch {
      // socket mid-close; will be cleaned up by 'close' handler
    }
  }
}

module.exports = { attachWebSocketServer, broadcastState };
