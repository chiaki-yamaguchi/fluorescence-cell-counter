importScripts('tiff.js','detect.js');

async function read(file) {
  if (/\.tiff?$/i.test(file.name) || file.type === 'image/tiff') return readTiff(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file);
  try {
    const {width:w,height:h} = bitmap;
    if (w*h > 12000000) throw new Error('Images must not exceed 12 megapixels.');
    const context = new OffscreenCanvas(w,h).getContext('2d');
    context.drawImage(bitmap,0,0);
    const {data} = context.getImageData(0,0,w,h);
    const planes = [0,1,2].map(c => Float32Array.from({length:w*h}, (_, i) => data[i*4+c]));
    return {w,h,planes};
  } finally {
    bitmap.close();
  }
}

const colors = {red:[1,0,0],green:[0,1,0],blue:[0,0,1],magenta:[1,0,1],cyan:[0,1,1],yellow:[1,1,0]};

function extract({planes,w,h}, mode, color) {
  if (mode === 'off') return null;
  if (planes.length === 1) return planes[0];
  if (mode === 'gray') return planes[0].map((r,i) => 0.213*r + 0.715*planes[1][i] + 0.072*planes[2][i]);
  const rgb = colors[mode] || color.slice(1).match(/../g).map(c => parseInt(c,16)/255);
  const max = Math.max(...rgb);
  if (!max) throw new Error('Choose a custom color other than black.');
  const active = rgb.map((v,c) => ({weight:v/max,c})).filter(({weight}) => weight >= 0.08);
  if (active.length === 1) return planes[active[0].c];
  const values = new Float32Array(w*h);
  for (let i = 0; i < values.length; i++) {
    let intensity = 255;
    for (const {weight,c} of active) intensity = Math.min(intensity,planes[c][i]/weight);
    values[i] = intensity;
  }
  return values;
}

self.onmessage = async ({data:{file, paired, config, analyze}}) => {
  try {
    const original = await read(file);
    const secondary = paired ? await read(paired) : original;
    if (config.manual) {
      const rgb = image => (image.planes.length === 1 ? Array(3).fill(image.planes[0]) : image.planes)
        .map(plane => Uint8ClampedArray.from(plane));
      const result = {enabledA:!config.greenOnly,enabledB:!!paired || config.greenOnly};
      if (analyze) {
        Object.assign(result,{a:[],b:[],pairs:[]});
        self.postMessage({result});
      } else {
        if (result.enabledA) result.red = {w:original.w,h:original.h,rgb:rgb(original)};
        if (result.enabledB) result.green = {w:secondary.w,h:secondary.h,rgb:rgb(secondary)};
        const buffers = [result.red,result.green].filter(Boolean).flatMap(image => image.rgb.map(plane => plane.buffer));
        self.postMessage({result},buffers);
      }
      return;
    }
    const {w,h} = original;
    if (secondary.w !== w || secondary.h !== h) throw new Error('Channel A and B images must have the same dimensions.');
    const a = extract(original,config.modeA,config.colorA);
    const b = extract(secondary,config.modeB,config.colorB);
    const result = {w,h, enabledA:!!a, enabledB:!!b};
    if (analyze) {
      result.a = a ? detect(a,w,h,config.diameter,config.thresholdA) : [];
      result.b = b ? detect(b,w,h,config.diameter,config.thresholdB) : [];
      result.pairs = pairPoints(result.a,result.b,config.match);
    } else {
      const rgb = original.planes.length === 1 ? Array(3).fill(original.planes[0]) : original.planes;
      result.original = rgb.map(p => Uint8ClampedArray.from(p));
      result.planeA = a;
      result.planeB = b;
    }
    const buffers = [result.planeA,result.planeB,...(result.original || [])].filter(Boolean).map(p => p.buffer);
    self.postMessage({result},[...new Set(buffers)]);
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
