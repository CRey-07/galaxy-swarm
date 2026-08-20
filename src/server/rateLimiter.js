'use strict';

const { MAX_INPUT_HZ } = require('./config');

/**
 * Token-bucket limiter, one instance per socket.
 * Refills MAX_INPUT_HZ tokens/sec, capacity = 1.5x that to absorb bursts.
 */
class TokenBucket {
  constructor(ratePerSec = MAX_INPUT_HZ, burst = Math.ceil(MAX_INPUT_HZ * 1.5)) {
    this.rate = ratePerSec;
    this.capacity = burst;
    this.tokens = burst;
    this.last = Date.now();
  }

  tryConsume() {
    const now = Date.now();
    const elapsed = (now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

module.exports = TokenBucket;
