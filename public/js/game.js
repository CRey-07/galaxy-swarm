'use strict';

(function GalaxySwarmClient() {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const menuOverlay = document.getElementById('menuOverlay');
  const hud = document.getElementById('hud');
  const deathScreen = document.getElementById('deathScreen');
  const leaderboardEl = document.getElementById('leaderboard');
  const leaderboardToggleEl = document.getElementById('leaderboardToggle');
  const scoreDisplayEl = document.getElementById('scoreDisplay');
  const returnMessageEl = document.getElementById('returnMessage');
  const nicknameInput = document.getElementById('nicknameInput');
  const boostHintEl = document.getElementById('boostHint');
  const boostBtnEl = document.getElementById('boostBtn');

  // Matches server BROADCAST_RATE (src/server/config.js). Used purely for
  // client-side interpolation timing, not networking logic.
  const BROADCAST_INTERVAL_MS = 1000 / 30;

  // ---------- Touch/device detection ----------
  // Feature-detected once at load, not inferred from window width — a
  // desktop browser resized to a narrow window is still a desktop browser
  // and should never see touch-only controls.
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  if (isTouchDevice) document.body.classList.add('touch-device');

  // Declared up front because layoutMobileControls() (called from the
  // initial resizeCanvas() below) depends on both — a `const` declared
  // later in this scope would still be in its temporal dead zone at that
  // point and throw on load.
  const RADAR_MARGIN = 24;
  function getRadarSize() {
    return Math.max(80, Math.min(150, window.innerWidth * 0.26));
  }

  let ws = null;
  let myId = null;
  let hasJoined = false;        // true once the server has an active player entity for us
  let worldSize = { w: 6000, h: 6000 };
  let latestState = null;       // most recent full snapshot from server
  let prevState = null;         // snapshot before that (for interpolation)
  let stateReceivedAt = 0;
  let camera = { x: 3000, y: 3000 };
  let playing = false;
  let starfield = [];

  // ---------- Responsive canvas / high-DPI ----------
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    layoutMobileControls();
  }
  window.addEventListener('resize', resizeCanvas);
  // orientationchange fires before innerWidth/innerHeight settle on some
  // mobile browsers; a short delay avoids sizing against stale values.
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 120));
  resizeCanvas();

  function buildStarfield() {
    starfield = [];
    const count = window.GS.quality === 'low' ? 120 : 320;
    for (let i = 0; i < count; i++) {
      starfield.push({
        x: Math.random() * worldSize.w,
        y: Math.random() * worldSize.h,
        r: Math.random() * 1.6 + 0.3,
        a: Math.random() * 0.6 + 0.2,
      });
    }
  }

  // ---------- Networking ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'join', nickname: window.GS.nickname, skin: window.GS.skin }));
      sendViewport();
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === 'welcome') {
        myId = msg.id;
        hasJoined = true;
        worldSize = msg.world;
        buildStarfield();
        prevState = null;
        latestState = null;
      } else if (msg.type === 'state') {
        prevState = latestState;
        latestState = msg;
        stateReceivedAt = performance.now();

        if (msg.self.dead && playing) {
          returnToMenu(msg.self.reason);
        }
      }
    });

    ws.addEventListener('close', () => {
      hasJoined = false;
      if (playing) returnToMenu('Connection lost');
    });
  }

  function sendViewport() {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'viewport', w: window.innerWidth, h: window.innerHeight }));
  }

  // ==================================================================
  // Input: mouse (desktop) + full touch engine (mobile)
  // ==================================================================
  let mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let mouseBoosting = false;    // desktop: mousedown or held click
  let keyBoosting = false;      // desktop: spacebar held
  let touchBtnBoosting = false; // mobile: dedicated BOOST button held
  let doubleTapHolding = false; // mobile: double-tap-and-hold anywhere

  function currentBoostState() {
    return mouseBoosting || keyBoosting || touchBtnBoosting || doubleTapHolding;
  }

  // ---------- Desktop mouse ----------
  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  window.addEventListener('mousedown', () => { mouseBoosting = true; });
  window.addEventListener('mouseup', () => { mouseBoosting = false; });
  window.addEventListener('keydown', (e) => { if (e.code === 'Space') { keyBoosting = true; e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') { keyBoosting = false; } });

  // ---------- Mobile touch engine ----------
  // Movement is driven by whichever touch is NOT on the boost button; that
  // touch's identifier is tracked explicitly so a second finger pressing
  // BOOST doesn't hijack the movement vector (or vice versa) — full
  // multi-touch support, not "last touch wins".
  let moveTouchId = null;
  let lastTapAt = 0;
  let lastTapTouchId = null;
  const DOUBLE_TAP_WINDOW_MS = 320;

  function isOnBoostButton(target) {
    return isTouchDevice && boostBtnEl && (target === boostBtnEl || boostBtnEl.contains(target));
  }

  canvas.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (isOnBoostButton(t.target)) continue; // handled by boostBtn's own listeners
      if (moveTouchId === null) {
        moveTouchId = t.identifier;
        mouse.x = t.clientX;
        mouse.y = t.clientY;

        // Double-tap-and-hold detection: two taps landing within the window
        // both start a *new* moveTouch (since the finger lifted between
        // taps), so we compare timestamps across touchstarts rather than
        // needing a persistent single touch.
        const now = performance.now();
        if (now - lastTapAt < DOUBLE_TAP_WINDOW_MS) {
          doubleTapHolding = true;
        }
        lastTapAt = now;
        lastTapTouchId = t.identifier;
      }
    }
  }, { passive: true }); // no preventDefault needed here; touch-action:none on the canvas already blocks native gestures

  window.addEventListener('touchmove', (e) => {
    let handled = false;
    for (const t of e.changedTouches) {
      if (t.identifier === moveTouchId) {
        mouse.x = t.clientX;
        mouse.y = t.clientY;
        handled = true;
      }
    }
    // Actively block page scroll/pinch/bounce for any touch move under our
    // control; touch-action:none is the primary defense, this is a backup
    // for browsers that still dispatch a cancelable scroll gesture.
    if (handled && e.cancelable) e.preventDefault();
  }, { passive: false });

  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === moveTouchId) {
        moveTouchId = null;
      }
      if (t.identifier === lastTapTouchId) {
        doubleTapHolding = false;
        lastTapTouchId = null;
      }
    }
  }
  window.addEventListener('touchend', endTouch, { passive: true });
  window.addEventListener('touchcancel', endTouch, { passive: true });

  // ---------- Dedicated BOOST button ----------
  if (boostBtnEl) {
    const onBoostStart = (e) => {
      e.preventDefault();
      e.stopPropagation(); // don't let this touch also register as a movement touch
      touchBtnBoosting = true;
      boostBtnEl.classList.add('pressed');
    };
    const onBoostEnd = (e) => {
      e.preventDefault();
      touchBtnBoosting = false;
      boostBtnEl.classList.remove('pressed');
    };
    boostBtnEl.addEventListener('touchstart', onBoostStart, { passive: false });
    boostBtnEl.addEventListener('touchend', onBoostEnd, { passive: false });
    boostBtnEl.addEventListener('touchcancel', onBoostEnd, { passive: false });
    // Also support mouse for hybrid touch/mouse devices (e.g. touchscreen laptops).
    boostBtnEl.addEventListener('mousedown', (e) => { e.stopPropagation(); touchBtnBoosting = true; boostBtnEl.classList.add('pressed'); });
    boostBtnEl.addEventListener('mouseup', () => { touchBtnBoosting = false; boostBtnEl.classList.remove('pressed'); });
    boostBtnEl.addEventListener('mouseleave', () => { touchBtnBoosting = false; boostBtnEl.classList.remove('pressed'); });
  }

  // ---------- Prevent default mobile browser gestures globally ----------
  // Safari-specific pinch-zoom gesture events (not covered by touch-action).
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('gestureend', (e) => e.preventDefault());
  // Long-press context menu / callout.
  document.addEventListener('contextmenu', (e) => { if (isTouchDevice) e.preventDefault(); });

  function inputLoop() {
    if (playing && ws && ws.readyState === 1) {
      // Direction is always computed relative to the exact current cursor
      // (or active touch) position, sent every input tick — the server
      // applies it immediately without its own turn-rate lag, so heading
      // tracks the input precisely rather than snapping late.
      const dx = mouse.x - window.innerWidth / 2;
      const dy = mouse.y - window.innerHeight / 2;
      ws.send(JSON.stringify({ type: 'input', dx, dy, boost: currentBoostState() }));
    }
    setTimeout(inputLoop, 1000 / 30); // matches server MAX_INPUT_HZ
  }

  // ---------- Mobile control layout ----------
  // Keeps the BOOST button positioned flush beside the radar panel, and the
  // boost-hint text clear of both — all three are responsively sized, so
  // this recomputes on every resize rather than relying on static CSS.
  function layoutMobileControls() {
    const radarSize = getRadarSize();
    const bottom = RADAR_MARGIN;

    if (boostBtnEl) {
      boostBtnEl.style.bottom = bottom + 'px';
      boostBtnEl.style.right = (RADAR_MARGIN + radarSize + 14) + 'px';
    }

    const hintBottom = bottom + radarSize + 12;
    if (boostHintEl) {
      boostHintEl.style.bottom = hintBottom + 'px';
      boostHintEl.style.right = RADAR_MARGIN + 'px';
    }
  }

  // ---------- Context-aware hint text + control visibility ----------
  function applyDeviceContext() {
    if (boostHintEl) {
      boostHintEl.textContent = isTouchDevice
        ? 'Tap & hold or press BOOST button'
        : 'Hold SPACE or click to boost';
    }
  }
  applyDeviceContext();

  // ---------- Collapsible leaderboard (<=768px) ----------
  let leaderboardCollapsed = window.innerWidth <= 768;
  function applyLeaderboardCollapsedState() {
    if (!leaderboardEl) return;
    leaderboardEl.classList.toggle('collapsed', leaderboardCollapsed);
    if (leaderboardToggleEl) leaderboardToggleEl.setAttribute('aria-expanded', String(!leaderboardCollapsed));
  }
  applyLeaderboardCollapsedState();

  if (leaderboardToggleEl) {
    leaderboardToggleEl.addEventListener('click', () => {
      leaderboardCollapsed = !leaderboardCollapsed;
      applyLeaderboardCollapsedState();
    });
  }
  window.addEventListener('resize', () => {
    // Only auto-apply the responsive default while the player hasn't made
    // an explicit choice this session; once they've tapped the toggle we
    // stop overriding it on resize/rotate.
    if (!layoutMobileControls._userToggled) {
      leaderboardCollapsed = window.innerWidth <= 768;
      applyLeaderboardCollapsedState();
    }
  });
  if (leaderboardToggleEl) {
    leaderboardToggleEl.addEventListener('click', () => { layoutMobileControls._userToggled = true; });
  }

  // ---------- Game flow ----------
  window.addEventListener('gs:play', () => {
    menuOverlay.classList.add('hidden');
    deathScreen.classList.add('hidden');
    hud.classList.remove('hidden');
    if (isTouchDevice && boostBtnEl) boostBtnEl.classList.remove('hidden');
    playing = true;
    layoutMobileControls();

    if (hasJoined && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'respawn', nickname: window.GS.nickname, skin: window.GS.skin }));
    } else {
      connect();
    }
  });

  function returnToMenu(reason) {
    playing = false;
    hud.classList.add('hidden');
    deathScreen.classList.add('hidden');
    if (boostBtnEl) boostBtnEl.classList.add('hidden');
    touchBtnBoosting = false;
    doubleTapHolding = false;

    if (nicknameInput && !nicknameInput.value) {
      nicknameInput.value = window.GS.nickname || '';
    }
    if (returnMessageEl) {
      returnMessageEl.textContent = reason
        ? `${reason} — ready for another run?`
        : 'Your core was consumed — ready for another run?';
      returnMessageEl.classList.remove('hidden');
    }
    menuOverlay.classList.remove('hidden');
  }

  // ---------- Rendering helpers ----------
  const SKIN_COLORS = {
    planet: { core: ['#bff3ff', '#5fd3ff', '#1b6fe0'], ring: '#5fd3ff' },
    nebula: { core: ['#e2bfff', '#9c6bff', '#5327a8'], ring: '#9c6bff' },
    blackhole: { core: ['#3a1a5c', '#000000', '#000000'], ring: '#9c6bff' },
    starcore: { core: ['#fff6d1', '#ffcf5f', '#ff8a3d'], ring: '#ffcf5f' },
  };

  function drawBackground() {
    ctx.fillStyle = '#05060d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(window.innerWidth / 2 - camera.x, window.innerHeight / 2 - camera.y);

    ctx.strokeStyle = 'rgba(95, 211, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 150;
    const startX = Math.floor((camera.x - window.innerWidth) / gridSize) * gridSize;
    const endX = camera.x + window.innerWidth;
    const startY = Math.floor((camera.y - window.innerHeight) / gridSize) * gridSize;
    const endY = camera.y + window.innerHeight;
    for (let x = startX; x < endX; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, startY); ctx.lineTo(x, endY); ctx.stroke();
    }
    for (let y = startY; y < endY; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(endX, y); ctx.stroke();
    }

    for (const s of starfield) {
      if (Math.abs(s.x - camera.x) > window.innerWidth || Math.abs(s.y - camera.y) > window.innerHeight) continue;
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#f4f6ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawEntity(e, isSelf) {
    const screenX = e.x - camera.x + window.innerWidth / 2;
    const screenY = e.y - camera.y + window.innerHeight / 2;

    if (e.t === 'd') {
      ctx.fillStyle = `hsl(${e.h}, 85%, 70%)`;
      ctx.beginPath();
      ctx.arc(screenX, screenY, e.r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (e.d) return;
    const colors = SKIN_COLORS[e.s] || SKIN_COLORS.planet;
    const highQuality = window.GS.quality === 'high';

    ctx.strokeStyle = colors.ring;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = highQuality ? 3 : 2;
    ctx.beginPath();
    ctx.arc(screenX, screenY, e.r * 1.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (highQuality) {
      const grad = ctx.createRadialGradient(
        screenX - e.r * 0.3, screenY - e.r * 0.3, e.r * 0.1,
        screenX, screenY, e.r
      );
      grad.addColorStop(0, colors.core[0]);
      grad.addColorStop(0.55, colors.core[1]);
      grad.addColorStop(1, colors.core[2]);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = colors.core[1];
    }
    ctx.beginPath();
    ctx.arc(screenX, screenY, e.r, 0, Math.PI * 2);
    ctx.fill();

    if (e.b) {
      ctx.strokeStyle = colors.core[0];
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(screenX, screenY, e.r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = isSelf ? '#bff3ff' : '#f4f6ff';
    ctx.font = '12px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(e.n, screenX, screenY - e.r - 12);
  }

  function updateHUD() {
    if (!latestState) return;
    scoreDisplayEl.textContent = `Mass: ${latestState.self.score}`;

    const rows = latestState.leaderboard
      .map((row) => `<li class="${row.n === window.GS.nickname ? 'me' : ''}">${escapeHtml(row.n)} — ${row.sc}</li>`)
      .join('');
    leaderboardEl.innerHTML = `<h3>LEADERBOARD</h3><ol>${rows}</ol>`;
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // ---------- Radar / minimap ----------
  // (RADAR_MARGIN / getRadarSize are declared near the top of this file —
  // layoutMobileControls() needs them before this point in load order.)

  function drawMinimap(state) {
    if (!state || !state.radar) return;
    const dpr = window.devicePixelRatio || 1;
    const RADAR_SIZE = getRadarSize();

    const x0 = window.innerWidth - RADAR_SIZE - RADAR_MARGIN;
    const y0 = window.innerHeight - RADAR_SIZE - RADAR_MARGIN;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = 'rgba(16, 21, 44, 0.72)';
    ctx.strokeStyle = 'rgba(95, 211, 255, 0.35)';
    ctx.lineWidth = 1;
    roundedRect(x0, y0, RADAR_SIZE, RADAR_SIZE, 10);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    roundedRect(x0, y0, RADAR_SIZE, RADAR_SIZE, 10);
    ctx.clip();

    const { cols, rows, dust, enemies } = state.radar;
    const cellW = RADAR_SIZE / cols;
    const cellH = RADAR_SIZE / rows;

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const v = dust[cy * cols + cx];
        if (v <= 0) continue;
        const alpha = Math.min(0.5, v * 0.07);
        ctx.fillStyle = `rgba(255, 207, 95, ${alpha})`;
        ctx.fillRect(x0 + cx * cellW, y0 + cy * cellH, cellW + 0.5, cellH + 0.5);
      }
    }
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const v = enemies[cy * cols + cx];
        if (v <= 0) continue;
        const alpha = Math.min(0.55, v * 0.14);
        ctx.fillStyle = `rgba(255, 95, 122, ${alpha})`;
        ctx.fillRect(x0 + cx * cellW, y0 + cy * cellH, cellW + 0.5, cellH + 0.5);
      }
    }

    const px = x0 + (state.self.x / worldSize.w) * RADAR_SIZE;
    const py = y0 + (state.self.y / worldSize.h) * RADAR_SIZE;
    ctx.fillStyle = '#bff3ff';
    ctx.strokeStyle = '#05060d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    ctx.strokeStyle = 'rgba(95, 211, 255, 0.35)';
    roundedRect(x0, y0, RADAR_SIZE, RADAR_SIZE, 10);
    ctx.stroke();

    ctx.fillStyle = 'rgba(139, 146, 184, 0.9)';
    ctx.font = '10px Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('RADAR', x0 + 8, y0 + 14);

    ctx.restore();
  }

  function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function getInterpolatedEntities() {
    if (!latestState) return [];
    if (!prevState) return latestState.entities;

    const elapsed = performance.now() - stateReceivedAt;
    const t = Math.max(0, Math.min(1.15, elapsed / BROADCAST_INTERVAL_MS));

    const prevById = new Map();
    for (const e of prevState.entities) prevById.set(e.id, e);

    return latestState.entities.map((cur) => {
      const prev = prevById.get(cur.id);
      if (!prev || prev.t !== cur.t) return cur;
      return {
        ...cur,
        x: prev.x + (cur.x - prev.x) * t,
        y: prev.y + (cur.y - prev.y) * t,
        r: prev.r + (cur.r - prev.r) * t,
      };
    });
  }

  // ---------- Main render loop ----------
  function render() {
    requestAnimationFrame(render);
    if (!latestState) { drawBackground(); return; }

    camera.x += (latestState.self.x - camera.x) * 0.2;
    camera.y += (latestState.self.y - camera.y) * 0.2;

    drawBackground();

    for (const e of getInterpolatedEntities()) {
      drawEntity(e, e.id === myId);
    }
    updateHUD();
    drawMinimap(latestState);
  }

  window.addEventListener('resize', sendViewport);
  inputLoop();
  requestAnimationFrame(render);
})();
