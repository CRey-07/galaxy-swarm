'use strict';

// ---------- environment ----------
// Centralized here so every module reads env-derived config from one place
// instead of touching process.env directly.
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

const PORT = parseInt(process.env.PORT, 10) || 3000;

// Comma-separated list of allowed origins for CORS + WS handshake checks,
// e.g. "https://galaxyswarm.io,https://www.galaxyswarm.io". Falls back to
// '*' only when unset — fine for local dev, but index.js logs a startup
// warning if this reaches production still unset.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

module.exports = {
  NODE_ENV,
  IS_PRODUCTION,
  PORT,
  ALLOWED_ORIGINS,

  TICK_RATE: 60,                 // server simulation ticks/sec
  BROADCAST_RATE: 30,            // state broadcast ticks/sec (viewport-culled) — raised from 20 to reduce stutter
  WORLD_WIDTH: 6000,
  WORLD_HEIGHT: 6000,
  GRID_CELL_SIZE: 200,           // spatial hash cell size

  MIN_ENTITIES: 20,              // bot-fill target (players + bots)
  MAX_BOTS: 40,

  MAX_NICK_LEN: 15,

  // movement / anti-cheat
  BASE_SPEED: 3.2,               // units/tick at mass=starting mass
  BOOST_MULTIPLIER: 1.8,
  MAX_SPEED_HARD_CAP: 12,        // reject any resolved speed above this (server clamps, doesn't trust client)
  // Turn rate is intentionally near-instant: direction is a pure function of
  // input, and smoothness comes from client-side snapshot interpolation, not
  // from lagging the server's own heading. A cap still exists as a sanity
  // bound, not as the source of perceived responsiveness.
  MAX_TURN_RATE: Math.PI * 2,    // radians/tick allowed direction change (effectively unclamped per tick)

  STARTING_RADIUS: 14,
  MIN_RADIUS: 10,
  MAX_RADIUS: 220,
  RADIUS_PER_MASS: 0.02,

  STARDUST_COUNT: 2200,          // raised from 900 for a denser, more rewarding field
  STARDUST_RADIUS: 3,
  STARDUST_VALUE: 1,
  STARDUST_PICKUP_BUFFER: 6,     // extra forgiveness added on top of edge-to-edge touch distance
  STARDUST_REPLENISH_PER_TICK: 60, // raised from 20 to keep the denser field topped up quickly

  BOOST_DRAIN_PER_TICK: 0.35,    // mass shed while boosting
  BOOST_MIN_RADIUS: 16,          // can't boost below this size
  BOOST_EEJECT_INTERVAL_TICKS: 2, // spawn a trail particle every N ticks while boosting (was 3; tighter trail)

  // magnetic stardust attraction
  MAGNET_RADIUS_BASE: 60,        // flat attraction range added regardless of core size
  MAGNET_RADIUS_MULT: 3,         // attraction range also scales with core radius
  MAGNET_RADIUS_MAX: 420,        // hard cap so giant cores don't vacuum the whole screen
  MAGNET_PULL_STRENGTH: 0.16,    // fraction of remaining distance closed per tick (60Hz)

  // bot lifecycle
  BOT_RESPAWN_DELAY_MS_MIN: 800,  // bots "wait" a beat after death before respawning, for game feel
  BOT_RESPAWN_DELAY_MS_MAX: 2200,

  // radar / minimap
  RADAR_COLS: 14,                 // coarse density grid resolution sent to clients each broadcast
  RADAR_ROWS: 14,
  RADAR_DENSITY_CAP: 9,           // clamp per-cell counts so payload stays small (single-digit ints)

  RING_COUNT_PER_100_RADIUS: 1,  // cosmetic ring scaling, mirrored server-side for hit-radius calc
  RING_ORBIT_RADIUS_FACTOR: 1.6, // ring sits at core.radius * this factor

  // networking / hardening
  MAX_INPUT_HZ: 30,              // rate limit: max input packets/sec per socket
  MAX_WS_PAYLOAD_BYTES: 512,
  VIEWPORT_MARGIN: 200,          // extra px around client viewport for culling

  RESPAWN_INVULN_MS: 1500,
};
