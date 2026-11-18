'use strict';

function drawDistribution(canvas, groups, key, unit) {
  const context = canvas.getContext('2d');
  const {width,height} = canvas;
  const left = 50, right = width-18, top = 16, bottom = height-48;
  const bins = 20;
  let maximum = 0;
  for (const {cells} of groups) {
    for (const cell of cells) maximum = Math.max(maximum,cell[key]);
  }
  context.clearRect(0,0,width,height);
  context.font = '14px system-ui';
  context.fillStyle = '#acb9cd';
  if (!maximum) {
    context.fillText('No measurable candidates',left,top+20);
    return;
  }
  const step = Math.ceil(maximum/bins);
  const series = groups.map(({cells}) => {
    const counts = Array(bins).fill(0);
    for (const cell of cells) counts[Math.min(bins-1,Math.floor(cell[key]/step))]++;
    return counts;
  });
  const yStep = Math.max(1,Math.ceil(Math.max(...series.flat())/4));
  context.textAlign = 'right';
  for (let i=0;i<=4;i++) {
    const y = bottom-i*(bottom-top)/4;
    context.strokeStyle = '#354157';
    context.beginPath();
    context.moveTo(left,y);
    context.lineTo(right,y);
    context.stroke();
    context.fillText(String(i*yStep),left-8,y+5);
  }
  const binWidth = (right-left)/bins;
  const barWidth = (binWidth-2)/groups.length;
  for (const [g,counts] of series.entries()) {
    context.fillStyle = groups[g].color;
    for (const [i,count] of counts.entries()) {
      const barHeight = count*(bottom-top)/(4*yStep);
      context.fillRect(left+i*binWidth+g*barWidth+1,bottom-barHeight,barWidth,barHeight);
    }
  }
  context.fillStyle = '#acb9cd';
  context.textAlign = 'center';
  for (let i=0;i<=bins;i+=5) context.fillText(String(i*step),left+i*binWidth,bottom+20);
  context.fillText(unit,(left+right)/2,height-5);
}

function showSizeStats(groups) {
  const low = $('smallLimit').valueAsNumber;
  const high = $('largeLimit').valueAsNumber;
  const valid = $('smallLimit').validity.valid && $('largeLimit').validity.valid && low < high;
  $('sizeError').hidden = valid;
  const body = $('sizeRows');
  body.replaceChildren();
  const mean = (cells,key) => cells.length ? (cells.reduce((total,c) => total+c[key],0)/cells.length).toFixed(2) : '—';
  for (const {cells,total,label,color} of groups) {
    const row = body.insertRow();
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = label;
    name.style.color = color;
    row.append(name);
    const small = cells.filter(c => c.diameter < low).length;
    const large = cells.filter(c => c.diameter >= high).length;
    const format = n => valid && cells.length ? `${n}（${(100*n/cells.length).toFixed(1)}%）` : '—';
    for (const value of [cells.length,total-cells.length,mean(cells,'area'),mean(cells,'diameter'),
      format(small),format(cells.length-small-large),format(large)]) row.insertCell().textContent = value;
  }
  drawDistribution($('areaHistogram'),groups,'area','Area (px²)');
  drawDistribution($('diameterHistogram'),groups,'diameter','Equivalent diameter (px)');
}
