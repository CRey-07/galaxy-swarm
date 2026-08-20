'use strict';

const { WORLD_WIDTH, WORLD_HEIGHT } = require('./config');

const BOT_NAMES = [
  'Nova', 'Quasar', 'Vortex', 'Pulsar', 'Comet', 'Cinder', 'Ember', 'Orion',
  'Lyra', 'Zenith', 'Halo', 'Drift', 'Ion', 'Flux', 'Rift', 'Astra',
];

let botSeq = 0;

function randomBotName() {
  botSeq += 1;
  const base = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  return `${base}-${botSeq}`;
}

/**
 * Very lightweight bot brain: wander toward nearest stardust cluster,
 * flee from cores that are significantly bigger, and occasionally boost
 * toward much smaller cores. Runs entirely server-side, so it obeys the
 * same physics/collision rules as human players.
 */
function updateBotIntent(bot, world) {
  const nearby = world.grid.queryRadius(bot.x, bot.y, 400);

  let threat = null;
  let prey = null;
  let minThreatDist = Infinity;
  let minPreyDist = Infinity;

  for (const e of nearby) {
    if (e === bot || e.type !== 'player' || e.dead) continue;
    const d = Math.hypot(e.x - bot.x, e.y - bot.y);
    if (e.radius > bot.radius * 1.25 && d < minThreatDist) {
      threat = e;
      minThreatDist = d;
    } else if (bot.radius > e.radius * 1.25 && d < minPreyDist) {
      prey = e;
      minPreyDist = d;
    }
  }

  if (threat && minThreatDist < 260) {
    const dx = bot.x - threat.x;
    const dy = bot.y - threat.y;
    const len = Math.hypot(dx, dy) || 1;
    bot.targetDirX = dx / len;
    bot.targetDirY = dy / len;
    bot.wantsBoost = minThreatDist < 140;
    return;
  }

  if (prey && minPreyDist < 300) {
    const dx = prey.x - bot.x;
    const dy = prey.y - bot.y;
    const len = Math.hypot(dx, dy) || 1;
    bot.targetDirX = dx / len;
    bot.targetDirY = dy / len;
    bot.wantsBoost = minPreyDist < 150;
    return;
  }

  // Wander: pick a new random heading periodically.
  if (!bot._wanderUntil || Date.now() > bot._wanderUntil) {
    const angle = Math.random() * Math.PI * 2;
    bot.targetDirX = Math.cos(angle);
    bot.targetDirY = Math.sin(angle);
    bot._wanderUntil = Date.now() + 2000 + Math.random() * 3000;
  }
  bot.wantsBoost = false;

  // Steer back toward center if drifting off the world edge.
  const margin = 300;
  if (bot.x < margin || bot.x > WORLD_WIDTH - margin ||
      bot.y < margin || bot.y > WORLD_HEIGHT - margin) {
    const dx = WORLD_WIDTH / 2 - bot.x;
    const dy = WORLD_HEIGHT / 2 - bot.y;
    const len = Math.hypot(dx, dy) || 1;
    bot.targetDirX = dx / len;
    bot.targetDirY = dy / len;
  }
}

module.exports = { randomBotName, updateBotIntent };
