'use strict';

function unpackLzw(bytes, size) {
  const out = new Uint8Array(size);
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  let bit = 0, count = 0, next = 258, width = 9, previous = -1, first = 0;
  while (bit + width <= bytes.length * 8) {
    let code = 0;
    for (let i = 0; i < width; i++, bit++) code = (code << 1) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1);
    if (code === 256) {
      next = 258;
      width = 9;
      previous = -1;
      continue;
    }
    if (code === 257 || count === size) break;
    if (code > next || (code === next && previous < 0)) throw new Error('Invalid TIFF LZW data.');
    const current = code;
    let length = 0;
    if (code === next) {
      stack[length++] = first;
      code = previous;
    }
    while (code >= 258) {
      stack[length++] = suffix[code];
      code = prefix[code];
    }
    first = code;
    stack[length++] = code;
    while (length && count < size) out[count++] = stack[--length];
    if (previous >= 0 && next < 4096) {
      prefix[next] = previous;
      suffix[next++] = first;
      if (width < 12 && next === (1 << width) - 1) width++;
    }
    previous = current;
  }
  if (count !== size) throw new Error('Could not decompress the TIFF strip.');
  return out;
}

function readTiff(buffer) {
  const view = new DataView(buffer);
  const order = view.getUint16(0);
  const little = order === 0x4949;
  const u16 = at => view.getUint16(at, little);
  const u32 = at => view.getUint32(at, little);
  if ((!little && order !== 0x4d4d) || u16(2) !== 42) throw new Error('Unsupported TIFF format.');
  const ifd = u32(4);
  const tags = new Map();
  for (let i = 0; i < u16(ifd); i++) {
    const at = ifd + 2 + 12 * i;
    const type = u16(at + 2);
    if (![1,3,4].includes(type)) continue;
    const count = u32(at + 4);
    const size = type === 1 ? 1 : type === 3 ? 2 : 4;
    if (count > 100000) throw new Error('TIFF tag is too large.');
    const start = count * size <= 4 ? at + 8 : u32(at + 8);
    const read = type === 1 ? offset => view.getUint8(offset) : type === 3 ? u16 : u32;
    tags.set(u16(at), Array.from({length: count}, (_, j) => read(start + j * size)));
  }
  const tag = (id, fallback) => tags.get(id)?.[0] ?? fallback;
  const w = tag(256), h = tag(257), bits = tag(258, 1);
  const photo = tag(262), samples = tag(277, 1), compression = tag(259, 1), predictor = tag(317, 1);
  const offsets = tags.get(273), sizes = tags.get(279), rows = tag(278, h);
  if (!w || !h || w*h > 12000000 || !rows || !offsets || !sizes ||
      ![8,16].includes(bits) || tags.get(258)?.some(b => b !== bits) ||
      ![0,1,2].includes(photo) || (photo === 2 && samples < 3) || samples > 4 || samples < 1 ||
      tag(284,1) !== 1 || tag(339,1) !== 1 || tag(274,1) !== 1 ||
      ![1,5].includes(compression) || ![1,2].includes(predictor)) {
    throw new Error('Supported TIFFs use 8- or 16-bit RGB or grayscale strips with LZW or no compression.');
  }
  const planes = Array.from({length: photo === 2 ? 3 : 1}, () => new Float32Array(w*h));
  const stride = w * samples;
  const bytesPerSample = bits / 8;
  const maximum = bits === 8 ? 255 : 65535;
  for (let y = 0, strip = 0; y < h; y += rows, strip++) {
    if (offsets[strip] === undefined || sizes[strip] === undefined) throw new Error('TIFF strip is missing.');
    const compressed = new Uint8Array(buffer, offsets[strip], sizes[strip]);
    const length = Math.min(rows,h-y) * stride * bytesPerSample;
    const raw = compression === 5 ? unpackLzw(compressed,length) : compressed;
    if (raw.length < length) throw new Error('TIFF pixel data is incomplete.');
    const data = new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
    const previous = new Uint16Array(samples);
    for (let row = 0; row < Math.min(rows,h-y); row++) {
      previous.fill(0);
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < samples; c++) {
          const offset = (row * stride + x * samples + c) * bytesPerSample;
          const value = bits === 8 ? data.getUint8(offset) : data.getUint16(offset,little);
          const pixel = (value + (predictor === 2 ? previous[c] : 0)) & maximum;
          previous[c] = pixel;
          if (c < planes.length) planes[c][(y + row) * w + x] = (photo === 0 ? maximum-pixel : pixel) * 255 / maximum;
        }
      }
    }
  }
  return {w,h,planes};
}

if (typeof module !== 'undefined') module.exports = {readTiff};
