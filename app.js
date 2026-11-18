'use strict';
const $ = id => document.getElementById(id);
const palette = {
  original: {rgb:[1,1,1], ink:'#c7d4e5', marker:'#ffffff'},
  red: {rgb:[1,0,0], ink:'#ff5757', marker:'#6cf5ff'},
  green: {rgb:[0,1,0], ink:'#48e76d', marker:'#ff4040'},
  blue: {rgb:[0,0,1], ink:'#80aaff', marker:'#ffd34f'},
  magenta: {rgb:[1,0,1], ink:'#f17df2', marker:'#baff64'},
};
const colorChoice = channel => $('color'+channel).value;
const colorFor = channel => palette[colorChoice(channel)];

const worker = new Worker('worker.js');
let field = null;
let preview = null;
let selected = null;
let manualView = 'a';
let requestPending = false;
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
  pendingWorker?.reject(new Error(event.message || 'Could not open the images.'));
  pendingWorker = null;
};

function loadImages(redFile, greenFile) {
  return new Promise((resolve,reject) => {
    pendingWorker = {resolve,reject};
    worker.postMessage({redFile,greenFile});
  });
}

function setBusy(value) {
  requestPending = value;
  for (const id of ['run','files','paired']) $(id).disabled = value;
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

function paintImage(context, view) {
  const showA = view !== 'b';
  const showB = view !== 'a';
  const source = showA ? preview.red : preview.green;
  const {w,h} = source;
  const image = context.createImageData(w,h);
  const layers = [];
  if (showA) layers.push(['A',preview.red]);
  if (showB) layers.push(['B',preview.green]);
  for (const [channel,source] of layers) {
    const adjust = toneMapper(channel);
    const {rgb} = colorFor(channel);
    const original = colorChoice(channel) === 'original' ? source.rgb : null;
    for (let i=0;i<w*h;i++) {
      const intensity = original ? 0 : adjust(source.intensity[i]);
      for (let c=0;c<3;c++) {
        image.data[i*4+c] += original ? adjust(original[c][i]) : intensity*rgb[c];
      }
    }
  }
  for (let i=0;i<w*h;i++) {
    image.data[i*4+3] = 255;
  }
  context.putImageData(image,0,0);
}

function paintMarkers(context, view, width) {
  context.lineWidth = Math.max(1.25,width/700);
  for (const key of view === 'merge' ? ['a','b'] : [view]) {
    context.fillStyle = colorFor(key.toUpperCase()).marker;
    context.strokeStyle = '#11141a';
    for (const {x,y} of field.result[key]) {
      context.beginPath();
      context.arc(x,y,view === 'merge' && key === 'a' ? 4 : 2.5,0,Math.PI*2);
      context.fill();
      context.stroke();
    }
  }
}

for (const channel of ['A','B']) {
  const select = $('color'+channel);
  select.onchange = () => {
    document.documentElement.style.setProperty('--channel-'+channel.toLowerCase(),colorFor(channel).ink);
    display();
  };
}

function display() {
  if (!field || !preview) return;
  const view = manualView;
  const merged = view === 'merge';
  const {w,h} = view === 'b' ? preview.green : preview.red;
  const {result} = field;
  $('toneControls').hidden = false;
  $('toneA').hidden = !result.enabledA;
  $('toneB').hidden = !result.enabledB;
  canvas.width = w;
  canvas.height = h;
  $('zoomBar').hidden = false;
  $('imagePixels').textContent = `${w} × ${h} px`;
  canvas.hidden = false;
  $('manualBar').hidden = false;
  $('review').hidden = false;
  $('redImage').disabled = !result.enabledA;
  $('greenImage').disabled = !result.enabledB;
  $('bothImages').disabled = !preview.red || !preview.green ||
    preview.red.w !== preview.green.w || preview.red.h !== preview.green.h;
  $('bothImages').title = $('bothImages').disabled ? 'Registered images of the same size are required.' : '';
  $('bothImages').setAttribute('aria-pressed',String(merged));
  $('redImage').setAttribute('aria-pressed',String(manualView === 'a'));
  $('greenImage').setAttribute('aria-pressed',String(manualView === 'b'));
  $('empty').hidden = true;
  paintImage(ctx,view);
  paintMarkers(ctx,view,w);
  if (selected && (merged || selected.keys.includes(view))) {
    const {x,y,radius} = selected.point;
    ctx.beginPath();
    ctx.arc(x,y,radius*0.67+4,0,Math.PI*2);
    ctx.lineWidth = Math.max(2,w/400);
    ctx.strokeStyle = '#11141a';
    ctx.stroke();
    ctx.lineWidth /= 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  $('deletePoint').disabled = !selected;
  $('countA').textContent = result.enabledA ? result.a.length : '—';
  $('countB').textContent = result.enabledB ? result.b.length : '—';
  const percent = countRatioPercent(result);
  $('countPercent').textContent = percent === '' ? '—' : `${percent}%`;
  $('countPercent').title = percent === '' ? '' : `B ${result.b.length} ÷ A ${result.a.length} × 100`;
  $('undo').disabled = !field.history.length;
  $('png').disabled = false;
  $('mergedPng').hidden = !preview.red || !preview.green;
  $('mergedPng').disabled = $('mergedPng').hidden ||
    preview.red?.w !== preview.green?.w || preview.red?.h !== preview.green?.h;
  $('mergedOptions').hidden = false;
  $('mergedPng').title = $('mergedPng').disabled ? 'Registered channel images of the same size are required.' : 'Save the channel overlay as PNG.';
  document.body.classList.add('manualLoaded');
  applyZoom();
}

$('form').onsubmit = async event => {
  event.preventDefault();
  if (requestPending) return;
  const redFile = $('files').files[0];
  const greenFile = $('paired').files[0];
  if (!redFile && !greenFile) {
    $('status').textContent = 'Select an image.';
    return;
  }
  setBusy(true);
  $('status').textContent = 'Loading images…';
  try {
    const images = await loadImages(redFile,greenFile);
    preview = images;
    field = {
      redFile,
      greenFile,
      history: [],
      result: {a:[],b:[],enabledA:!!images.red,enabledB:!!images.green},
    };
    manualView = images.red ? 'a' : 'b';
    selected = null;
    display();
    $('csv').disabled = false;
    $('status').textContent = 'Images loaded.';
  } catch (error) {
    $('status').textContent = error.message;
  } finally {
    setBusy(false);
  }
};

canvas.onclick = event => {
  if (requestPending || !preview) return;
  const key = manualView;
  const {red,green} = preview;
  const syncGreen = key === 'b' && red && green &&
    red.w === green.w && red.h === green.h;
  const keys = key === 'merge' ? ['a','b'] : [key];
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) * canvas.width / rect.width);
  const y = Math.floor((event.clientY - rect.top) * canvas.height / rect.height);
  const points = keys.flatMap(channel => field.result[channel]);
  const hitRadius = Math.max(3,4*canvas.width/rect.width);
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
    const deleteChannels = key === 'a' ? ['a','b'] : keys;
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
    display();
    return;
  }
  rememberPoints(field,keys);
  selected = null;
  const point = {x,y,radius:4};
  for (const channel of keys) field.result[channel].push(point);
  display();
};
function rememberPoints(field,keys) {
  field.history.push(keys.map(key => [key,[...field.result[key]]]));
}

function deleteSelected() {
  if (!selected || requestPending || !preview) return;
  const {keys,point} = selected;
  rememberPoints(field,keys);
  for (const key of keys) field.result[key] = field.result[key].filter(item => item !== point);
  selected = null;
  display();
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
  const previous = field.history.pop();
  if (!previous) return;
  selected = null;
  for (const [key,points] of previous) field.result[key] = points;
  display();
};

function save(blob,name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href),1000);
}
$('png').onclick = () => {
  if (!requestPending && !$('png').disabled) saveImagePng(manualView);
};
$('mergedPng').onclick = () => {
  if (!requestPending && !$('mergedPng').disabled) saveImagePng('merge');
};

function saveImagePng(view) {
  const source = view === 'b' ? preview.green : preview.red;
  const output = document.createElement('canvas');
  output.width = source.w;
  output.height = source.h;
  const context = output.getContext('2d');
  paintImage(context,view);
  if ($('mergedMarkers').checked) paintMarkers(context,view,source.w);
  const file = view === 'b' ? field.greenFile : field.redFile;
  const name = file.name.replace(/\.[^.]+$/,'');
  const suffix = view === 'merge' ? colorChoice('A')+'-'+colorChoice('B')+'-overlay' : colorChoice(view.toUpperCase());
  output.toBlob(blob => { if (blob) save(blob,`${name}-${suffix}.png`); },'image/png');
}
$('csv').onclick = () => {
  const quote = value => {
    const safe = typeof value === 'string' && /^[=+\-@\t\r\n]/.test(value) ? "'"+value : value;
    return '"'+String(safe).replaceAll('"','""')+'"';
  };
  const {redFile,greenFile,result} = field;
  const rows = [
    ['Channel A image','Channel B image','Channel A count','Channel B count','B / A (%)'],
    [redFile?.name || '',greenFile?.name || '',result.enabledA ? result.a.length : '',
      result.enabledB ? result.b.length : '',countRatioPercent(result)],
  ];
  save(new Blob(['\uFEFF',rows.map(row => row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'cell-counts.csv');
};

for (const id of ['files', 'paired']) {
  const input = document.getElementById(id);
  const picker = input.closest('.file-picker');
  const selection = picker.querySelector('.file-selection');
  input.addEventListener('change', () => {
    const names = Array.from(input.files, file => file.name).join(', ');
    selection.textContent = names || 'No files selected';
    selection.title = names;
  });
}
