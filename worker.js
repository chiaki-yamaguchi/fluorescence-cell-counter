importScripts('tiff.js');

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

self.onmessage = async ({data:{redFile, greenFile}}) => {
  try {
    async function readChannel(file) {
      if (!file) return null;
      const {w,h,planes} = await read(file);
      const rgb = (planes.length === 1 ? Array(3).fill(planes[0]) : planes)
        .map(plane => Uint8ClampedArray.from(plane));
      return {w,h,rgb};
    }
    const red = await readChannel(redFile);
    const green = await readChannel(greenFile);
    const buffers = [red,green].filter(Boolean).flatMap(image => image.rgb.map(plane => plane.buffer));
    self.postMessage({result:{red,green}},buffers);
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
