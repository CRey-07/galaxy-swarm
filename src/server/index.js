'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const cfg = require('./config');
const { World } = require('./gameLoop');
const { attachWebSocketServer, broadcastState } = require('./wsHandlers');

const app = express();

// Parsed once in config.js from process.env.ALLOWED_ORIGINS — kept as a
// local alias here purely for readability in this file.
const ALLOWED_ORIGINS = cfg.ALLOWED_ORIGINS;

app.disable('x-powered-by');
app.use(compression());

// Coolify (and most PaaS setups) terminate TLS at a reverse proxy (Traefik/
// Caddy) in front of this container, so req.ip would otherwise resolve to
// the proxy's internal IP for every request — breaking express-rate-limit's
// per-client accounting (everyone shares one bucket) and any future IP-based
// logic. Trusting exactly one hop is the standard, safe setting for this
// topology (vs. `true`, which would trust an arbitrary X-Forwarded-For chain
// and let a client spoof its own IP).
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // inline styles used for dynamic HUD colors
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  })
);

app.use((req, res, next) => {
  if (ALLOWED_ORIGINS.includes('*')) return next();
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  next();
});

// Basic HTTP-level rate limiting (separate from the WS input token bucket).
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.static(path.join(__dirname, '..', '..', 'public'), {
  maxAge: '1h',
  index: 'index.html',
}));

app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));

const server = http.createServer(app);

const world = new World();
attachWebSocketServer(server, world, { allowedOrigins: ALLOWED_ORIGINS });

// Server-authoritative simulation loop, decoupled from broadcast rate.
setInterval(() => world.step(), 1000 / cfg.TICK_RATE);
setInterval(() => broadcastState(world), 1000 / cfg.BROADCAST_RATE);

server.listen(cfg.PORT, () => {
  console.log(`Galaxy Swarm server listening on :${cfg.PORT} (NODE_ENV=${cfg.NODE_ENV})`);
  if (ALLOWED_ORIGINS.includes('*')) {
    const level = cfg.IS_PRODUCTION ? 'ERROR' : 'WARNING';
    console.warn(`${level}: ALLOWED_ORIGINS not set — accepting connections from any origin. Set this in production.`);
  }
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
