'use strict';

const SpatialGrid = require('./spatialGrid');
const { randomBotName, updateBotIntent } = require('./bots');
const cfg = require('./config');

let nextEntityId = 1;
const genId = () => nextEntityId++;

class World {
  constructor() {
    this.players = new Map();   // id -> player entity (humans + bots)
    this.stardust = new Map();  // id -> dust entity
    this.grid = new SpatialGrid(cfg.GRID_CELL_SIZE, cfg.WORLD_WIDTH, cfg.WORLD_HEIGHT);
    this.tick = 0;

    this._seedStardust();
    this._maintainBotFill();
  }

  // ---------- spawning ----------

  _randomPos() {
    return {
      x: 200 + Math.random() * (cfg.WORLD_WIDTH - 400),
      y: 200 + Math.random() * (cfg.WORLD_HEIGHT - 400),
    };
  }

  _seedStardust() {
    for (let i = 0; i < cfg.STARDUST_COUNT; i++) {
      this._spawnStardust();
    }
  }

  _spawnStardust() {
    const { x, y } = this._randomPos();
    const id = genId();
    this.stardust.set(id, {
      id, type: 'dust', x, y,
      radius: cfg.STARDUST_RADIUS,
      hue: Math.floor(Math.random() * 360),
    });
  }

  spawnPlayer({ nickname, skin, socket, isBot }) {
    const { x, y } = this._randomPos();
    const id = genId();
    const player = {
      id,
      type: 'player',
      isBot: !!isBot,
      socket: socket || null,
      nickname,
      skin: skin || 'planet',
      x, y,
      dirX: 0, dirY: -1,        // facing/movement direction actually applied
      targetDirX: 0, targetDirY: -1, // desired direction (input or bot AI)
      radius: cfg.STARTING_RADIUS,
      mass: this._radiusToMass(cfg.STARTING_RADIUS),
      wantsBoost: false,
      boosting: false,
      dead: false,
      spawnedAt: Date.now(),
      lastInputAt: Date.now(),
      score: 0,
    };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  _maintainBotFill() {
    // Count only ALIVE entities toward the fill target. Dead bots awaiting
    // their respawn timer (see _respawnDueBots) still occupy a map slot but
    // must not block new bots from being created — otherwise the pool of
    // *active* entities silently drains every time a bot dies, which was
    // the original bug: total players.size stayed constant while alive
    // bots dwindled.
    const aliveHumans = [...this.players.values()].filter((p) => !p.isBot && !p.dead).length;
    const aliveBots = [...this.players.values()].filter((p) => p.isBot && !p.dead).length;
    const aliveTotal = aliveHumans + aliveBots;
    const target = Math.min(cfg.MIN_ENTITIES, aliveHumans + cfg.MAX_BOTS);

    let botsToSpawn = Math.max(0, target - aliveTotal);
    // Also respect the hard MAX_BOTS ceiling against total bot count
    // (alive + awaiting respawn) so we never runaway-spawn.
    const totalBots = [...this.players.values()].filter((p) => p.isBot).length;
    botsToSpawn = Math.min(botsToSpawn, Math.max(0, cfg.MAX_BOTS - totalBots));

    for (let i = 0; i < botsToSpawn; i++) {
      this.spawnPlayer({ nickname: randomBotName(), skin: 'planet', isBot: true });
    }
  }

  /**
   * Bots don't linger dead forever like a human waiting at a menu — they
   * respawn on their own after a short, randomized delay so the map keeps
   * feeling alive. This is what actually keeps entity count at
   * MIN_ENTITIES continuously; _maintainBotFill alone only tops up the
   * *count*, it doesn't revive existing bots.
   */
  _respawnDueBots() {
    const now = Date.now();
    for (const p of this.players.values()) {
      if (!p.isBot || !p.dead) continue;
      if (p.botRespawnAt && now >= p.botRespawnAt) {
        this.respawn(p);
        p.nickname = randomBotName();
        p.botRespawnAt = null;
      }
    }
  }

  // ---------- physics helpers ----------

  _radiusToMass(r) {
    return (r - cfg.MIN_RADIUS) / cfg.RADIUS_PER_MASS;
  }

  _massToRadius(m) {
    const r = cfg.MIN_RADIUS + m * cfg.RADIUS_PER_MASS;
    return Math.min(cfg.MAX_RADIUS, Math.max(cfg.MIN_RADIUS, r));
  }

  /** Ring orbit radius mirrors the client's cosmetic rendering, used for hit tests. */
  _ringRadius(player) {
    return player.radius * cfg.RING_ORBIT_RADIUS_FACTOR;
  }

  // ---------- input intake (called from ws handler; never trust magnitude) ----------

  applyInput(player, input) {
    if (player.dead) return;
    // Only accept a direction vector; server derives speed itself. No
    // deadzone/angle-snap: any nonzero vector — including tiny mouse drift
    // of a fraction of a pixel — updates the target heading immediately.
    if (typeof input.dx === 'number' && typeof input.dy === 'number') {
      const len = Math.hypot(input.dx, input.dy);
      if (len > 0 && Number.isFinite(len)) {
        player.targetDirX = input.dx / len;
        player.targetDirY = input.dy / len;
      }
    }
    player.wantsBoost = !!input.boost;
    player.lastInputAt = Date.now();
  }

  // ---------- main tick ----------

  step() {
    this.tick += 1;
    this.grid.clear();

    for (const p of this.players.values()) {
      if (p.dead) continue;
      if (p.isBot) updateBotIntent(p, this);
      this._integrateMovement(p);
      this.grid.insert(p);
    }
    for (const d of this.stardust.values()) {
      this.grid.insert(d);
    }

    this._applyMagnetism();
    this._resolveDustCollection();
    this._resolveCoreCollisions();
    this._replenishStardust();
    this._respawnDueBots();
    this._maintainBotFill();
  }

  _integrateMovement(p) {
    // Direction snaps directly to the player's target heading every tick.
    // Position itself only ever advances by one server-computed step, so
    // there is no teleport risk from removing the old turn-rate clamp —
    // that clamp was actually the source of the perceived "tık tık" stutter
    // (heading lagging a tick or more behind the mouse). Perceived smoothness
    // now comes entirely from client-side snapshot interpolation instead.
    p.dirX = p.targetDirX;
    p.dirY = p.targetDirY;

    // Bigger cores are slightly slower (mass-speed tradeoff), server-computed only.
    const sizeFactor = Math.max(0.45, 1 - (p.radius - cfg.STARTING_RADIUS) / 400);
    let speed = cfg.BASE_SPEED * sizeFactor;

    p.boosting = p.wantsBoost && p.radius > cfg.BOOST_MIN_RADIUS;
    if (p.boosting) {
      speed *= cfg.BOOST_MULTIPLIER;
      p.mass = Math.max(this._radiusToMass(cfg.MIN_RADIUS), p.mass - cfg.BOOST_DRAIN_PER_TICK);
      p.radius = this._massToRadius(p.mass);
      if (this.tick % cfg.BOOST_EEJECT_INTERVAL_TICKS === 0) this._ejectBoostDust(p);
    }

    speed = Math.min(speed, cfg.MAX_SPEED_HARD_CAP);

    // Per-axis clamp with radius-aware padding: each axis is bounded
    // independently, so a diagonal move into a corner still lets the
    // player slide freely along whichever axis isn't blocked, instead of
    // freezing outright. Padding uses the player's own radius (not a fixed
    // constant) so the core visually stays inside the map at any size.
    const padX = Math.min(p.radius, cfg.WORLD_WIDTH / 2 - 1);
    const padY = Math.min(p.radius, cfg.WORLD_HEIGHT / 2 - 1);
    p.x = Math.min(cfg.WORLD_WIDTH - padX, Math.max(padX, p.x + p.dirX * speed));
    p.y = Math.min(cfg.WORLD_HEIGHT - padY, Math.max(padY, p.y + p.dirY * speed));
  }

  _ejectBoostDust(p) {
    // Small lateral jitter so consecutive trail particles fan out slightly
    // instead of stacking in a single-file line — reads as a particle trail
    // rather than a string of beads.
    const jitter = (Math.random() - 0.5) * 0.6;
    const perpX = -p.dirY, perpY = p.dirX;
    const behindX = p.x - p.dirX * (p.radius + 10) + perpX * jitter * p.radius * 0.5;
    const behindY = p.y - p.dirY * (p.radius + 10) + perpY * jitter * p.radius * 0.5;
    const id = genId();
    this.stardust.set(id, {
      id, type: 'dust', x: behindX, y: behindY,
      radius: cfg.STARDUST_RADIUS, hue: Math.floor(Math.random() * 360),
    });
  }

  /**
   * Magnetic attraction: dust within each alive player's attraction radius
   * (always larger than the pickup hitbox) is pulled smoothly toward that
   * player's core each tick, so it visibly streams in before being consumed
   * by _resolveDustCollection() later this same tick or a following one.
   * Runs before collision/pickup so freshly-pulled-in dust can be collected
   * the moment it crosses the pickup threshold, in the same tick.
   *
   * Simplification: if a dust particle sits in more than one player's
   * attraction radius simultaneously, the last player processed this tick
   * "wins" it (Map iteration order). Good enough for gameplay feel; a full
   * nearest-attractor resolution isn't worth the extra pass at this scale.
   */
  _applyMagnetism() {
    const pull = cfg.MAGNET_PULL_STRENGTH;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const magnetRadius = Math.min(
        cfg.MAGNET_RADIUS_MAX,
        p.radius * cfg.MAGNET_RADIUS_MULT + cfg.MAGNET_RADIUS_BASE
      );
      const pickupRadius = p.radius + cfg.STARDUST_RADIUS + cfg.STARDUST_PICKUP_BUFFER;

      const nearby = this.grid.queryRadius(p.x, p.y, magnetRadius);
      for (const e of nearby) {
        if (e.type !== 'dust') continue;
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const dist = Math.hypot(dx, dy);
        // Already within pickup range — let collection handle it untouched,
        // pulling further would just cause jitter right at consumption.
        if (dist <= pickupRadius || dist > magnetRadius) continue;
        e.x += dx * pull;
        e.y += dy * pull;
      }
    }
  }

  _resolveDustCollection() {
    // Pickup triggers as soon as the core's outer edge touches the dust's
    // outer edge, plus a small forgiveness buffer — not a center-to-center
    // check — so grazing a dust particle at any point on the core's rim
    // counts as collection.
    const buffer = cfg.STARDUST_PICKUP_BUFFER;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const nearby = this.grid.queryRadius(p.x, p.y, p.radius + cfg.STARDUST_RADIUS + buffer + 20);
      for (const e of nearby) {
        if (e.type !== 'dust') continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < p.radius + e.radius + buffer) {
          this.stardust.delete(e.id);
          p.mass += cfg.STARDUST_VALUE;
          p.radius = this._massToRadius(p.mass);
          p.score += cfg.STARDUST_VALUE;
        }
      }
    }
  }

  _replenishStardust() {
    const deficit = cfg.STARDUST_COUNT - this.stardust.size;
    for (let i = 0; i < Math.min(deficit, cfg.STARDUST_REPLENISH_PER_TICK); i++) this._spawnStardust();
  }

  /**
   * Elimination rule: a player dies if their CORE overlaps another player's
   * ORBIT RING (not the other's core). A smaller core can thread the gap
   * between ring segments and destroy a larger player by hitting its core
   * directly. We approximate "ring band" as an annulus around the core.
   */
  _resolveCoreCollisions() {
    const ringBand = 10; // ring visual thickness, mirrored from client cosmetics

    for (const a of this.players.values()) {
      if (a.dead) continue;
      const invulnA = Date.now() - a.spawnedAt < cfg.RESPAWN_INVULN_MS;
      if (invulnA) continue;

      const nearby = this.grid.queryRadius(a.x, a.y, a.radius + this._ringRadius(a) + 40);
      for (const b of nearby) {
        if (b.type !== 'player' || b === a || b.dead) continue;
        const invulnB = Date.now() - b.spawnedAt < cfg.RESPAWN_INVULN_MS;
        if (invulnB) continue;

        const dist = Math.hypot(a.x - b.x, a.y - b.y);

        // a's core vs b's ring band
        const bRing = this._ringRadius(b);
        const hitsBRing = dist > bRing - ringBand - a.radius && dist < bRing + ringBand + a.radius;
        // a's core vs b's core (direct core-core contact also ends the smaller one)
        const hitsBCore = dist < a.radius + b.radius;

        if (hitsBCore) {
          if (a.radius < b.radius) this._kill(a, b);
          else if (b.radius < a.radius) this._kill(b, a);
          continue;
        }
        if (hitsBRing && b.radius > a.radius) {
          this._kill(a, b);
        }
      }
    }
  }

  _kill(victim, killer) {
    if (victim.dead) return;
    victim.dead = true;
    // Convert a portion of the victim's mass into stardust scattered at death site.
    const dustCount = Math.min(40, Math.floor(victim.mass / 4));
    for (let i = 0; i < dustCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * victim.radius;
      const id = genId();
      this.stardust.set(id, {
        id, type: 'dust',
        x: victim.x + Math.cos(angle) * dist,
        y: victim.y + Math.sin(angle) * dist,
        radius: cfg.STARDUST_RADIUS,
        hue: Math.floor(Math.random() * 360),
      });
    }
    if (killer) {
      killer.mass += victim.mass * 0.25;
      killer.radius = this._massToRadius(killer.mass);
      killer.score += Math.floor(victim.mass * 0.25);
    }
    victim.deathReason = killer ? `Destroyed by ${killer.nickname}` : 'Destroyed';

    if (victim.isBot) {
      const span = cfg.BOT_RESPAWN_DELAY_MS_MAX - cfg.BOT_RESPAWN_DELAY_MS_MIN;
      victim.botRespawnAt = Date.now() + cfg.BOT_RESPAWN_DELAY_MS_MIN + Math.random() * span;
    }
  }

  respawn(player) {
    const { x, y } = this._randomPos();
    player.x = x;
    player.y = y;
    player.dead = false;
    player.mass = this._radiusToMass(cfg.STARTING_RADIUS);
    player.radius = cfg.STARTING_RADIUS;
    player.score = 0;
    player.spawnedAt = Date.now();
  }

  // ---------- snapshot for broadcast (delta + viewport culled by caller) ----------

  snapshotEntity(e) {
    if (e.type === 'player') {
      return {
        id: e.id, t: 'p', n: e.nickname, s: e.skin,
        x: Math.round(e.x), y: Math.round(e.y), r: Math.round(e.radius),
        b: e.boosting ? 1 : 0, d: e.dead ? 1 : 0, sc: e.score,
      };
    }
    return { id: e.id, t: 'd', x: Math.round(e.x), y: Math.round(e.y), r: e.radius, h: e.hue };
  }

  leaderboard(limit = 10) {
    return [...this.players.values()]
      .filter((p) => !p.dead)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((p) => ({ n: p.nickname, sc: p.score, bot: p.isBot }));
  }

  /**
   * Coarse world-wide density grid for the client minimap/radar —
   * intentionally cheap and low-resolution (default 14x14 cells) rather
   * than sending exact positions of everything on the map, which would
   * defeat the point of viewport culling elsewhere in the protocol.
   * Counts are clamped to RADAR_DENSITY_CAP so every cell is a single
   * small integer.
   */
  computeRadarGrid() {
    const cols = cfg.RADAR_COLS;
    const rows = cfg.RADAR_ROWS;
    const dust = new Array(cols * rows).fill(0);
    const enemies = new Array(cols * rows).fill(0);
    const cellW = cfg.WORLD_WIDTH / cols;
    const cellH = cfg.WORLD_HEIGHT / rows;
    const cap = cfg.RADAR_DENSITY_CAP;

    const cellIndex = (x, y) => {
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / cellW)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(y / cellH)));
      return cy * cols + cx;
    };

    for (const d of this.stardust.values()) {
      const idx = cellIndex(d.x, d.y);
      dust[idx] = Math.min(cap, dust[idx] + 1);
    }
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const idx = cellIndex(p.x, p.y);
      enemies[idx] = Math.min(cap, enemies[idx] + 1);
    }

    return { cols, rows, dust, enemies };
  }
}

module.exports = { World };
