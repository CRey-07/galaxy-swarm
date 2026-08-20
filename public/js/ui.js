'use strict';

// Shared client-side state, read by game.js
window.GS = {
  nickname: 'Player',
  skin: 'planet',
  server: 'eu-west',
  quality: 'high', // 'high' | 'low'
};

(function initUI() {
  const $ = (sel) => document.querySelector(sel);

  // ---------- Quality toggle ----------
  const qualityBtn = $('#qualityToggle');
  const qualityLabel = $('#qualityLabel');
  qualityBtn.addEventListener('click', () => {
    window.GS.quality = window.GS.quality === 'high' ? 'low' : 'high';
    qualityLabel.textContent = window.GS.quality.toUpperCase();
  });

  // ---------- Skin modal ----------
  const skinModal = $('#skinModal');
  const skinPreview = $('#skinPreview');
  const skinDotClasses = {
    planet: 'skin-planet', nebula: 'skin-nebula',
    blackhole: 'skin-blackhole', starcore: 'skin-starcore',
  };

  function applySkinPreview(skin) {
    skinPreview.className = 'skin-preview ' + (skinDotClasses[skin] || '');
  }

  $('#skinBtn').addEventListener('click', () => skinModal.classList.remove('hidden'));

  document.querySelectorAll('.skin-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.skin-option').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      window.GS.skin = btn.dataset.skin;
      applySkinPreview(window.GS.skin);
    });
  });
  document.querySelector('.skin-option[data-skin="planet"]').classList.add('active');

  // ---------- Server modal ----------
  const serverModal = $('#serverModal');
  const serverLabelEl = $('#serverLabel');
  const serverNames = { 'eu-west': 'EU-West', 'us-east': 'US-East', asia: 'Asia-Pacific' };

  $('#serverBtn').addEventListener('click', () => serverModal.classList.remove('hidden'));

  document.querySelectorAll('.server-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.server-option').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      window.GS.server = btn.dataset.server;
      serverLabelEl.textContent = serverNames[btn.dataset.server];
    });
  });
  document.querySelector('.server-option[data-server="eu-west"]').classList.add('active');

  // ---------- Legal modal ----------
  const legalModal = $('#legalModal');
  const legalFrame = $('#legalFrame');
  const legalPages = {
    privacy: '/legal/privacy.html',
    terms: '/legal/terms.html',
    contact: '/legal/contact.html',
  };
  document.querySelectorAll('[data-legal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      legalFrame.src = legalPages[btn.dataset.legal];
      legalModal.classList.remove('hidden');
    });
  });

  // ---------- Close modals ----------
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.modal').classList.add('hidden');
    });
  });
  [skinModal, serverModal, legalModal].forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });

  // ---------- Nickname input sanitization (client-side UX only; server re-validates) ----------
  const nicknameInput = $('#nicknameInput');
  nicknameInput.addEventListener('input', () => {
    nicknameInput.value = nicknameInput.value
      .replace(/[<>{}[\]`$;]/g, '')
      .slice(0, 15);
  });

  // ---------- Join form ----------
  const joinForm = $('#joinForm');
  const joinError = $('#joinError');
  const returnMessage = $('#returnMessage');
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = nicknameInput.value.trim();
    if (raw.length === 0) {
      joinError.textContent = 'Enter a nickname to play.';
      return;
    }
    joinError.textContent = '';
    if (returnMessage) returnMessage.classList.add('hidden'); // clear any stale death message on fresh play
    window.GS.nickname = raw.slice(0, 15);
    window.dispatchEvent(new CustomEvent('gs:play'));
  });

  // Legacy hook: kept functional in case #deathScreen/#respawnBtn are ever
  // re-enabled, but the primary restart path is the main menu Play button
  // (game.js routes death back through the menu, not this screen).
  const respawnBtn = $('#respawnBtn');
  if (respawnBtn) {
    respawnBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('gs:respawn'));
    });
  }
})();
