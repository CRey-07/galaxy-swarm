'use strict';

const { MAX_NICK_LEN } = require('./config');

// Small baseline blocklist. Extend via env PROFANITY_EXTRA="word1,word2" at deploy time.
const BLOCKLIST = new Set([
  'admin', 'moderator', 'nigger', 'faggot', 'retard', 'rape', 'cunt',
  ...(process.env.PROFANITY_EXTRA ? process.env.PROFANITY_EXTRA.split(',') : []),
].map((w) => w.toLowerCase()));

/**
 * Strip HTML/script vectors, control chars, collapse whitespace, enforce length.
 * Never trust this string for anything but display (it is always rendered as
 * textContent on the client, never innerHTML).
 */
function sanitizeNickname(raw) {
  if (typeof raw !== 'string') return 'Player';

  let s = raw
    .replace(/[\u0000-\u001F\u007F]/g, '')      // control chars
    .replace(/<[^>]*>/g, '')                     // strip tag-like sequences
    .replace(/[<>{}[\]`$;]/g, '')                 // strip HTML/SQL/template metacharacters
    .trim()
    .slice(0, MAX_NICK_LEN);

  if (s.length === 0) s = 'Player';

  const lower = s.toLowerCase();
  for (const bad of BLOCKLIST) {
    if (bad.length > 0 && lower.includes(bad)) {
      return 'Player';
    }
  }

  return s;
}

module.exports = { sanitizeNickname };
