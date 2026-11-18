'use strict';

// Smooth small intensity fluctuations without quantizing the TIFF samples.
function smoothSample(plane, width, height, x, y) {
  let sum = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const row = Math.max(0,Math.min(height-1,y+dy))*width;
    for (let dx = -1; dx <= 1; dx++) {
      const column = Math.max(0,Math.min(width-1,x+dx));
      sum += plane[row+column]*(2-Math.abs(dx))*(2-Math.abs(dy));
    }
  }
  return sum/16;
}

// Trace between sample centers at the local intensity cutoff.
function traceOutline(values, mask, side, x, y, cutoff) {
  const outline = [];
  for (let row = 0; row < side-1; row++) {
    for (let column = 0; column < side-1; column++) {
      const i = row*side+column;
      const corners = [i,i+1,i+side+1,i+side];
      const inside = corners.map(pixel => mask[pixel]);
      const count = inside.reduce((sum,value) => sum+value,0);
      if (count === 0 || count === 4) continue;
      const coordinates = [[0,0],[1,0],[1,1],[0,1]];
      const crossings = [];
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge+1)%4;
        if (inside[edge] === inside[next]) continue;
        const a = values[corners[edge]];
        const b = values[corners[next]];
        const t = (a-cutoff)*(b-cutoff) < 0 ? (cutoff-a)/(b-a) : 0.5;
        const [ax,ay] = coordinates[edge];
        const [bx,by] = coordinates[next];
        crossings.push([x+column+0.5+ax+t*(bx-ax),y+row+0.5+ay+t*(by-ay)]);
      }
      if (crossings.length === 4 && inside[0]) crossings.push(crossings.shift());
      outline.push(...crossings.flat());
    }
  }
  return outline;
}

// Grow the connected bright region around a detection using its local background.
function measureCell(plane, width, height, point, diameter, minimumContrast) {
  const radius = Math.ceil(diameter * 0.95);
  const side = 2 * radius + 1;
  const {x, y} = point;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const values = new Float32Array(side * side).fill(-1);
  const background = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const distance = dx*dx + dy*dy;
      const px = x + dx;
      const py = y + dy;
      if (distance > radius*radius || px < 0 || py < 0 || px >= width || py >= height) continue;
      const value = smoothSample(plane,width,height,px,py);
      values[(dy+radius)*side + dx+radius] = value;
      if (distance >= (radius-2)**2) background.push(value);
    }
  }
  if (!background.length) return null;
  background.sort((a,b) => a-b);
  const baseline = background[Math.floor(background.length/2)];
  const seed = radius*side + radius;
  const core = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) core.push(values[seed+dy*side+dx]);
  }
  core.sort((a,b) => a-b);
  const contrast = core[4] - baseline;
  if (contrast < minimumContrast) return null;
  const cutoff = baseline + 0.5*contrast;
  if (values[seed] < cutoff) return null;
  const queue = [seed];
  const mask = new Uint8Array(values.length);
  mask[seed] = 1;
  const offsets = [-1,1,-side,side];
  for (let i = 0; i < queue.length; i++) {
    const pixel = queue[i];
    const dx = pixel%side - radius;
    const dy = Math.floor(pixel/side) - radius;
    if (dx*dx + dy*dy >= (radius-1)**2 ||
        x+dx === 0 || x+dx === width-1 || y+dy === 0 || y+dy === height-1) return null;
    for (const offset of offsets) {
      const neighbor = pixel + offset;
      if (mask[neighbor] || values[neighbor] < cutoff) continue;
      mask[neighbor] = 1;
      queue.push(neighbor);
    }
  }
  const area = queue.length;
  if (area < 5) return null;
  const outline = traceOutline(values,mask,side,x-radius,y-radius,cutoff);
  return {area, diameter:2*Math.sqrt(area/Math.PI), outline};
}
