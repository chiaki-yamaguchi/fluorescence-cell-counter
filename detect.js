'use strict';

function blur(values, width, height, sigma) {
  const radius = Math.ceil(3 * sigma);
  const kernel = Array.from({length: radius * 2 + 1}, (_, i) => Math.exp(-0.5 * ((i - radius) / sigma) ** 2));
  const sum = kernel.reduce((a, b) => a + b, 0);
  const temp = new Float32Array(values.length);
  const result = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = -radius; k <= radius; k++) {
        value += kernel[k + radius] * values[row + Math.max(0, Math.min(width - 1, x + k))];
      }
      temp[row + x] = value / sum;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = -radius; k <= radius; k++) {
        value += kernel[k + radius] * temp[Math.max(0, Math.min(height - 1, y + k)) * width + x];
      }
      result[y * width + x] = value / sum;
    }
  }
  return result;
}

function detect(values, width, height, diameter, contrast) {
  const candidates = [];
  for (const factor of [0.75, 1, 1.35]) {
    const sigma = diameter * factor / 4;
    const small = blur(values, width, height, sigma * 0.72);
    const large = blur(values, width, height, sigma * 1.7);
    const response = small.map((value, i) => value - large[i]);
    const step = Math.max(1, Math.round(sigma * 0.75));
    const ring = Math.round(sigma * 2);
    const diagonal = Math.round(ring / Math.SQRT2);
    const directions = [ring, ring * width, diagonal * (width + 1), diagonal * (width - 1)];
    for (let y = ring; y < height - ring; y++) {
      for (let x = ring; x < width - ring; x++) {
        const i = y * width + x;
        const value = response[i];
        if (value < contrast || value < 0.13 * large[i]) continue;
        if (value <= response[i - 1] || value < response[i + 1] ||
            value <= response[i - width] || value < response[i + width] ||
            value < response[i - width - 1] || value < response[i - width + 1] ||
            value < response[i + width - 1] || value < response[i + width + 1]) continue;
        const dy = step * width;
        const a = 2 * value - response[i - step] - response[i + step];
        const b = 2 * value - response[i - dy] - response[i + dy];
        const c = (response[i - dy + step] + response[i + dy - step] -
                   response[i - dy - step] - response[i + dy + step]) / 4;
        const trace = a + b;
        if (trace <= 0 || a * b - c * c < 0.16 * trace * trace) continue;
        if (directions.some(offset => small[i] - (small[i - offset] + small[i + offset]) / 2 < value * 0.45)) continue;
        candidates.push({x, y, radius: 2 * sigma, score: value});
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  const spacing = diameter * 0.53;
  const cells = new Map();
  const found = [];
  for (const candidate of candidates) {
    const col = Math.floor(candidate.x / spacing);
    const row = Math.floor(candidate.y / spacing);
    let overlaps = false;
    for (let y = row - 1; y <= row + 1; y++) {
      for (let x = col - 1; x <= col + 1; x++) {
        if ((cells.get(`${x},${y}`) || []).some(point =>
          Math.hypot(point.x - candidate.x, point.y - candidate.y) < spacing)) overlaps = true;
      }
    }
    if (overlaps) continue;
    const key = `${col},${row}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(candidate);
    found.push(candidate);
  }
  return found;
}

function pairPoints(first, second, maxDistance) {
  const edges = [];
  for (let a = 0; a < first.length; a++) {
    for (let b = 0; b < second.length; b++) {
      const d = Math.hypot(first[a].x - second[b].x, first[a].y - second[b].y);
      if (d <= maxDistance) edges.push({a,b,d});
    }
  }
  edges.sort((a,b) => a.d - b.d);
  const usedA = new Set();
  const usedB = new Set();
  return edges.filter(({a,b}) => {
    if (usedA.has(a) || usedB.has(b)) return false;
    usedA.add(a);
    usedB.add(b);
    return true;
  });
}

if (typeof module !== 'undefined') module.exports = {detect, pairPoints};
