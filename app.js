'use strict';
const $ = id => document.getElementById(id);
const options = {red:'Red',green:'Green',blue:'Blue',magenta:'Magenta',cyan:'Cyan',yellow:'Yellow',gray:'Luminance',custom:'Custom color',off:'Off'};
const parameters = ['modeA','modeB','colorA','colorB','thresholdA','thresholdB','diameter','match'];
for (const channel of ['A','B']) {
  const mode = $('mode'+channel);
  for (const [value,label] of Object.entries(options)) mode.add(new Option(label,value));
  mode.value = channel === 'A' ? 'red' : 'green';
  mode.onchange = () => { $('color'+channel).disabled = mode.value !== 'custom'; };
}

const worker = new Worker('worker.js');
let fields = [];
let preview = null;
let selected = null;
let sizeCache = new WeakMap();
let manualView = 'a';
let requestPending = false;
const current = () => fields[Number($('field').value)];
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
let pendingWorker;
worker.onmessage = ({data}) => {
  const {resolve,reject} = pendingWorker;
  pendingWorker = null;
  if (data.error) reject(new Error(data.error));
  else resolve(data.result);
};
worker.onerror = event => {
  pendingWorker?.reject(new Error(event.message || 'Could not start image analysis.'));
  pendingWorker = null;
};

function processImage(field, analyze) {
  return new Promise((resolve,reject) => {
    pendingWorker = {resolve,reject};
    worker.postMessage({file:field.file,paired:field.paired,config:field.config,analyze});
  });
}

function setBusy(value) {
  requestPending = value;
  for (const id of ['run','field','files','paired']) $(id).disabled = value;
}

function channelLabel(config, channel) {
  const mode = config['mode'+channel];
  if (mode === 'off') return 'Channel '+channel;
  return mode === 'custom' ? config['color'+channel] : options[mode];
}

function countRatioPercent({a,b,enabledA,enabledB}) {
  return enabledA && enabledB && a.length ? (100*b.length/a.length).toFixed(2) : '';
}

function applyZoom() {
  const zoom = $('zoom').value;
  const viewer = $('viewer');
  const fit = zoom === 'fit';
  viewer.classList.toggle('zoomed',!fit);
  viewer.classList.toggle('fit',fit && !canvas.hidden);
  if (!fit) {
    canvas.style.width = `${canvas.width*Number(zoom)}px`;
    return;
  }
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const top = viewer.getBoundingClientRect().top + window.scrollY;
  const availableHeight = Math.max(160,viewportHeight-top-12);
  canvas.style.width = `${Math.floor(Math.min(viewer.clientWidth,availableHeight*canvas.width/canvas.height))}px`;
}

$('zoom').onchange = applyZoom;
window.addEventListener('resize',applyZoom);
window.visualViewport?.addEventListener('resize',applyZoom);

function updateMethod() {
  const manual = $('method').value === 'manual';
  $('autoSettings').hidden = manual;
  for (const input of $('autoSettings').querySelectorAll('input[type=number]')) input.disabled = manual;
  $('files').multiple = !manual;
  $('primaryLabel').textContent = manual ? 'Red image (RBPMS)' : 'Select images';
  $('secondaryLabel').textContent = manual ? 'Green image (EGFP)' : 'Separate image for channel B';
  $('pairedHint').textContent = manual ? 'You can count using either image alone.' : 'Optional registered image paired with a single primary image.';
  $('run').textContent = manual ? 'Open images' : 'Run detection';
}
$('method').onchange = updateMethod;
updateMethod();

for (const [id,key] of [['redImage','a'],['greenImage','b'],['bothImages','merge']]) {
  $(id).onclick = () => {
    if (requestPending || !preview || $(id).disabled) return;
    manualView = key;
    selected = null;
    display();
  };
}

const toneInputs = ['brightnessA','contrastA','brightnessB','contrastB'];
function updateTone() {
  for (const id of toneInputs) $(id+'Value').textContent = `${$(id).value}%`;
  display();
}
for (const id of toneInputs) $(id).oninput = updateTone;
$('resetTone').onclick = () => {
  for (const id of toneInputs) $(id).value = 100;
  updateTone();
};

function toneMapper(channel) {
  const gain = Number($('brightness'+channel).value)/100;
  const contrast = Number($('contrast'+channel).value)/100;
  const table = Uint8ClampedArray.from({length:256}, (_, value) => {
    const level = value/255;
    const adjusted = level <= 0.5
      ? 0.5*(2*level)**contrast
      : 1-0.5*(2*(1-level))**contrast;
    return 255*gain*adjusted;
  });
  return value => table[Math.max(0,Math.min(255,Math.round(value)))];
}

function display() {
  const field = current();
  if (!field || !preview) return;
  const manual = field.config.manual;
  const manualMerge = manual && manualView === 'merge';
  const source = manual ? preview[manualView === 'b' ? 'green' : 'red'] : preview;
  const {w,h,planeA,planeB} = source;
  const original = manual ? source.rgb : source.original;
  const {result} = field;
  const view = manual ? manualView : $('view').value;
  const image = ctx.createImageData(w,h);
  const merged = view === 'merge';
  const showA = merged || view === 'a';
  const adjustA = toneMapper('A');
  const adjustB = toneMapper('B');
  $('toneControls').hidden = false;
  $('toneA').hidden = !result.enabledA;
  $('toneB').hidden = !result.enabledB;
  const showB = merged || view === 'b';
  for (let i=0;i<w*h;i++) {
    const j = i*4;
    if (manualMerge) {
      image.data[j] = adjustA(preview.red.rgb[0][i]);
      image.data[j+1] = adjustB(preview.green.rgb[1][i]);
    } else if (manual) {
      const adjust = view === 'a' ? adjustA : adjustB;
      for (let c=0;c<3;c++) image.data[j+c] = adjust(original[c][i]);
    } else if (view === 'original') {
      image.data[j] = adjustA(original[0][i]);
      image.data[j+1] = adjustB(original[1][i]);
      image.data[j+2] = original[2][i];
    } else {
      const a = showA ? adjustA(planeA?.[i] ?? 0) : 0;
      const b = showB ? adjustB(planeB?.[i] ?? 0) : 0;
      image.data[j] = merged ? a : a+b;
      image.data[j+1] = merged ? b : a+b;
      image.data[j+2] = merged ? 0 : a+b;
    }
    image.data[j+3] = 255;
  }
  canvas.width = w;
  canvas.height = h;
  $('zoomBar').hidden = false;
  $('imagePixels').textContent = `${w} × ${h} px`;
  canvas.hidden = false;
  canvas.classList.toggle('edit',manual || Boolean($('edit').value) && view !== 'original');
  $('manualBar').hidden = !manual;
  $('viewControl').hidden = $('editControl').hidden = manual;
  $('reviewHelp').hidden = manual;
  $('redImage').disabled = !result.enabledA;
  $('greenImage').disabled = !result.enabledB;
  $('bothImages').disabled = !manual || !preview.red || !preview.green ||
    preview.red.w !== preview.green.w || preview.red.h !== preview.green.h;
  $('bothImages').title = $('bothImages').disabled ? 'Registered images of the same size are required.' : '';
  $('bothImages').setAttribute('aria-pressed',String(manualMerge));
  $('redImage').setAttribute('aria-pressed',String(manualView === 'a'));
  $('greenImage').setAttribute('aria-pressed',String(manualView === 'b'));
  $('empty').hidden = true;
  ctx.putImageData(image,0,0);
  ctx.lineWidth = Math.max(1.25,w/700);
  const sizePanel = $('sizePanel');
  sizePanel.hidden = manual;
  if (!manual && sizePanel.open) {
    const groups = [
      {key:'a',plane:planeA,color:'#ff5757',label:channelLabel(field.config,'A'),visible:showA},
      {key:'b',plane:planeB,color:'#48e76d',label:channelLabel(field.config,'B'),visible:showB},
    ].filter(group => group.plane);
    for (const group of groups) {
      const points = result[group.key];
      const threshold = group.key === 'a' ? field.config.thresholdA : field.config.thresholdB;
      group.total = points.length;
      group.cells = [];
      ctx.strokeStyle = group.color;
      ctx.beginPath();
      for (const point of points) {
        if (!sizeCache.has(point)) {
          sizeCache.set(point,measureCell(group.plane,w,h,point,field.config.diameter,threshold));
        }
        const cell = sizeCache.get(point);
        if (!cell) continue;
        group.cells.push(cell);
        if (!$('sizeOverlay').checked || !(group.visible || view === 'original')) continue;
        for (let i=0;i<cell.outline.length;i+=4) {
          ctx.moveTo(cell.outline[i],cell.outline[i+1]);
          ctx.lineTo(cell.outline[i+2],cell.outline[i+3]);
        }
      }
      ctx.stroke();
    }
    showSizeStats(groups);
  }
  if (view !== 'original') {
    for (const [key,color,visible] of [['a','#ff5757',showA],['b','#48e76d',showB]]) {
      if (!visible) continue;
      ctx.strokeStyle = color;
      for (const point of result[key]) {
        if (!manual && sizePanel.open && $('sizeOverlay').checked && sizeCache.get(point)) continue;
        ctx.beginPath();
        ctx.arc(point.x,point.y,manual ? (manualMerge && key === 'a' ? 4 : 2.5) : point.radius*0.67,0,Math.PI*2);
        if (manual) {
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = '#fff';
        }
        ctx.stroke();
      }
    }

  }
  if (selected && (merged || (selected.keys[0] === 'a' ? showA : showB))) {
    const {x,y,radius} = selected.point;
    ctx.beginPath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2,w/400);
    ctx.arc(x,y,radius*0.67+4,0,Math.PI*2);
    ctx.stroke();
  }
  $('deletePoint').disabled = !selected;
  $('countA').textContent = result.enabledA ? result.a.length : '—';
  $('countB').textContent = result.enabledB ? result.b.length : '—';
  const labelA = channelLabel(field.config,'A');
  const labelB = channelLabel(field.config,'B');
  $('labelA').textContent = labelA;
  $('labelB').textContent = labelB;
  $('labelPercent').textContent = `${labelB} ÷ ${labelA}`;
  const percent = countRatioPercent(result);
  $('countPercent').textContent = percent === '' ? '—' : `${percent}%`;
  $('countPercent').title = percent === '' ? '' : `${labelB} ${result.b.length} ÷ ${labelA} ${result.a.length} × 100`;
  $('undo').disabled = !field.history.length;
  $('png').disabled = false;
  $('mergedPng').hidden = !manual || !preview.red || !preview.green;
  $('mergedPng').disabled = $('mergedPng').hidden ||
    preview.red?.w !== preview.green?.w || preview.red?.h !== preview.green?.h;
  $('mergedOptions').hidden = !manual || !preview.red;
  $('mergedPng').title = $('mergedPng').disabled ? 'Registered red and green images of the same size are required.' : 'Save the combined red and green image as PNG.';
  document.body.classList.toggle('manualLoaded',manual);
  applyZoom();
}

async function showField() {
  $('png').disabled = $('mergedPng').disabled = true;
  $('mergedOptions').hidden = true;
  canvas.hidden = true;
  $('zoomBar').hidden = true;
  $('toneControls').hidden = true;
  $('empty').hidden = false;
  $('empty').textContent = 'Loading images…';
  preview = await processImage(current(),false);
  sizeCache = new WeakMap();
  display();
}

$('form').onsubmit = async event => {
  event.preventDefault();
  if (requestPending) return;
  let files = Array.from($('files').files);
  let paired = $('paired').files[0];
  const config = Object.fromEntries(parameters.map(id => [id,$(id).type === 'number' ? $(id).valueAsNumber : $(id).value]));
  config.manual = $('method').value === 'manual';
  if (config.manual) {
    Object.assign(config,{modeA:'red',modeB:'green',greenOnly:!files.length && Boolean(paired)});
    if (config.greenOnly) {
      files = [paired];
      paired = undefined;
    }
  }
  if (!files.length || (paired && files.length !== 1) || (config.modeA === 'off' && config.modeB === 'off')) {
    $('status').textContent = !files.length ? 'Select an image.' : paired && files.length !== 1 ? 'Select one primary image when using a separate secondary image.' : 'Select at least one channel.';
    return;
  }
  setBusy(true);
  fields = [];
  selected = null;
  preview = null;
  const errors = [];
  $('review').hidden = $('reviewHelp').hidden = $('sizePanel').hidden = $('manualBar').hidden = true;
  $('csv').disabled = $('png').disabled = true;
  canvas.hidden = true;
  $('zoomBar').hidden = true;
  $('toneControls').hidden = true;
  $('countPercent').title = '';
  $('empty').hidden = false;
  $('empty').textContent = 'Detecting cell candidates…';
  for (const id of ['countA','countB','countPercent']) $(id).textContent = '—';
  try {
    for (const [i,file] of files.entries()) {
      $('status').textContent = `${i+1} / ${files.length}　${file.name}`;
      const field = {file,paired,config,history:[]};
      try {
        field.result = await processImage(field,true);
        fields.push(field);
      } catch (error) {
        errors.push(`${file.name}（${error.message}）`);
      }
    }
    $('field').replaceChildren(...fields.map(({file},i) => new Option(file.name,i)));
    manualView = config.greenOnly ? 'b' : 'a';
    $('view').value = 'merge';
    $('edit').value = '';
    if (fields.length) {
      $('review').hidden = $('reviewHelp').hidden = false;
      $('csv').disabled = false;
      await showField();
    } else {
      $('empty').textContent = 'No images could be opened.';
    }
    $('status').textContent = [`${fields.length} / ${files.length} ${config.manual ? 'image sets loaded' : 'images analyzed'}`,...errors].join('　');
  } catch (error) {
    $('status').textContent = error.message;
  } finally {
    setBusy(false);
  }
};

$('field').onchange = async () => {
  if (requestPending) return;
  setBusy(true);
  selected = null;
  preview = null;
  try {
    await showField();
  } catch (error) {
    $('empty').textContent = error.message;
  } finally {
    setBusy(false);
  }
};
$('view').onchange = $('edit').onchange = () => {
  selected = null;
  display();
};

$('sizePanel').ontoggle = display;
$('sizeOverlay').onchange = display;
$('smallLimit').oninput = $('largeLimit').oninput = display;

function refreshPairs(field) {
  if (!field.config.manual) field.result.pairs = pairPoints(field.result.a,field.result.b,field.config.match);
  display();
}

canvas.onclick = event => {
  if (requestPending || !preview) return;
  const field = current();
  const manual = field.config.manual;
  const key = manual ? manualView : $('edit').value;
  const view = manual ? manualView : $('view').value;
  if (!key || view === 'original' || (view !== 'merge' && view !== key)) return;
  if (key !== 'merge' && !field.result[key === 'a' ? 'enabledA' : 'enabledB']) return;
  const {red,green} = preview;
  const syncGreen = manual && key === 'b' && red && green &&
    red.w === green.w && red.h === green.h;
  const keys = key === 'merge' ? ['a','b'] : [key];
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) * canvas.width / rect.width);
  const y = Math.floor((event.clientY - rect.top) * canvas.height / rect.height);
  const points = keys.flatMap(channel => field.result[channel]);
  const hitRadius = manual ? Math.max(3,4*canvas.width/rect.width) : Math.max(5,7*canvas.width/rect.width);
  let nearest = null;
  let distance = Infinity;
  for (const point of points) {
    const d = Math.hypot(point.x-x,point.y-y);
    if (d <= Math.max(hitRadius,point.radius*0.67) && d < distance) {
      distance = d;
      nearest = point;
    }
  }
  canvas.focus({preventScroll:true});
  if (nearest) {
    const deleteChannels = manual && key === 'a' ? ['a','b'] : keys;
    selected = {keys:deleteChannels.filter(channel => field.result[channel].includes(nearest)),point:nearest};
    display();
    return;
  }
  if (syncGreen) {
    const {a,b} = field.result;
    let match = null;
    let closest = 4;
    for (const point of a) {
      const distance = Math.hypot(point.x-x,point.y-y);
      if (distance <= closest && !b.includes(point)) {
        match = point;
        closest = distance;
      }
    }
    rememberPoints(field,['a','b']);
    if (!match) {
      match = {x,y,radius:4};
      a.push(match);
    }
    b.push(match);
    selected = null;
    refreshPairs(field);
    return;
  }
  rememberPoints(field,keys);
  selected = null;
  const point = {x,y,radius:manual ? 4 : field.config.diameter/2};
  for (const channel of keys) field.result[channel].push(point);
  refreshPairs(field);
};
function rememberPoints(field,keys) {
  field.history.push(keys.map(key => [key,[...field.result[key]]]));
}

function deleteSelected() {
  if (!selected || requestPending || !preview) return;
  const field = current();
  const {keys,point} = selected;
  rememberPoints(field,keys);
  for (const key of keys) field.result[key] = field.result[key].filter(item => item !== point);
  selected = null;
  refreshPairs(field);
  canvas.focus({preventScroll:true});
}

$('deletePoint').onclick = deleteSelected;
canvas.onkeydown = event => {
  if (!selected || !['Delete','Backspace'].includes(event.key)) return;
  event.preventDefault();
  deleteSelected();
};

$('undo').onclick = () => {
  if (requestPending || !preview) return;
  const field = current();
  const previous = field.history.pop();
  if (!previous) return;
  selected = null;
  for (const [key,points] of previous) field.result[key] = points;
  refreshPairs(field);
};

function save(blob,name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href),1000);
}
$('png').onclick = () => {
  if (requestPending || $('png').disabled) return;
  const field = current();
  if (field.config.manual && manualView !== 'b') {
    saveRbpmsPng(manualView === 'merge');
    return;
  }
  const source = field.config.manual && manualView === 'b' && field.paired ? field.paired : field.file;
  const name = source.name.replace(/\.[^.]+$/,'');
  canvas.toBlob(blob => { if (blob) save(blob,`${name}-overlay.png`); },'image/png');
};
$('mergedPng').onclick = () => {
  if (requestPending || $('mergedPng').disabled) return;
  saveRbpmsPng(true);
};

function saveRbpmsPng(includeGreen) {
  const {red,green} = preview;
  const magenta = $('mergedColor').value === 'magenta';
  const field = current();
  const output = document.createElement('canvas');
  output.width = red.w;
  output.height = red.h;
  const context = output.getContext('2d');
  const pixels = context.createImageData(red.w,red.h);
  const adjustA = toneMapper('A');
  const adjustB = toneMapper('B');
  for (let i=0;i<red.w*red.h;i++) {
    pixels.data[i*4] = adjustA(red.rgb[0][i]);
    pixels.data[i*4+1] = includeGreen ? adjustB(green.rgb[1][i]) : 0;
    pixels.data[i*4+2] = magenta ? pixels.data[i*4] : 0;
    pixels.data[i*4+3] = 255;
  }
  context.putImageData(pixels,0,0);
  const markers = [['a',magenta ? '#ff57ff' : '#ff5757']];
  if (includeGreen) markers.push(['b','#48e76d']);
  for (const [key,color] of $('mergedMarkers').checked ? markers : []) {
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    for (const {x,y} of field.result[key]) {
      context.beginPath();
      context.arc(x,y,includeGreen && key === 'a' ? 4 : 2.5,0,Math.PI*2);
      context.stroke();
    }
  }
  const name = field.file.name.replace(/\.[^.]+$/,'');
  const color = magenta ? 'magenta' : 'red';
  const suffix = includeGreen ? color+'-green' : color;
  output.toBlob(blob => { if (blob) save(blob,`${name}-${suffix}.png`); },'image/png');
}
$('csv').onclick = () => {
  const quote = value => {
    const safe = typeof value === 'string' && /^[=+\-@\t\r\n]/.test(value) ? "'"+value : value;
    return '"'+String(safe).replaceAll('"','""')+'"';
  };
  const rows = [['Image','Secondary image','A color','B color','A count','B count','Candidate matches','B / A (%)','A contrast','B contrast','Diameter (px)','Matching distance (px)']];
  for (const {file,paired,config,result} of fields) {
    const {modeA,modeB,colorA,colorB,thresholdA,thresholdB,diameter,match} = config;
    const {a,b,pairs,enabledA,enabledB} = result;
    rows.push([file.name,paired?.name || '',modeA === 'custom' ? colorA : options[modeA],modeB === 'custom' ? colorB : options[modeB],
      enabledA ? a.length : '',enabledB ? b.length : '',!config.manual && enabledA && enabledB ? pairs.length : '',
      countRatioPercent(result),...(config.manual ? ['', '', '', ''] : [thresholdA,thresholdB,diameter,match])]);
  }
  save(new Blob(['\uFEFF',rows.map(row => row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'cell-counts.csv');
};
