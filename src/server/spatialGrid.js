'use strict';

/**
 * Uniform grid spatial hash. Cheaper than a QuadTree to rebuild every tick,
 * which matters at 60Hz with thousands of moving stardust + dozens of players.
 */
class SpatialGrid {
  constructor(cellSize, worldWidth, worldHeight) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(worldWidth / cellSize);
    this.rows = Math.ceil(worldHeight / cellSize);
    this.buckets = new Map(); // "x,y" -> Set(entity)
  }

  _key(cx, cy) {
    return cx + ',' + cy;
  }

  clear() {
    this.buckets.clear();
  }

  _cellCoords(x, y) {
    return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)];
  }

  insert(entity) {
    const [cx, cy] = this._cellCoords(entity.x, entity.y);
    const key = this._key(cx, cy);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new Set();
      this.buckets.set(key, bucket);
    }
    bucket.add(entity);
    entity._cellKey = key;
  }

  /** Returns candidate entities within radius `r` of (x, y). */
  queryRadius(x, y, r) {
    const results = [];
    const minCx = Math.floor((x - r) / this.cellSize);
    const maxCx = Math.floor((x + r) / this.cellSize);
    const minCy = Math.floor((y - r) / this.cellSize);
    const maxCy = Math.floor((y + r) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.buckets.get(this._key(cx, cy));
        if (bucket) {
          for (const e of bucket) results.push(e);
        }
      }
    }
    return results;
  }

  /** Returns candidate entities within a rectangular viewport (for culling). */
  queryRect(x, y, w, h) {
    const results = [];
    const minCx = Math.floor((x - w / 2) / this.cellSize);
    const maxCx = Math.floor((x + w / 2) / this.cellSize);
    const minCy = Math.floor((y - h / 2) / this.cellSize);
    const maxCy = Math.floor((y + h / 2) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.buckets.get(this._key(cx, cy));
        if (bucket) {
          for (const e of bucket) results.push(e);
        }
      }
    }
    return results;
  }
}

module.exports = SpatialGrid;
