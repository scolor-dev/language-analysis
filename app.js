const photoInput = document.querySelector('#photo-input');
const photoCanvas = document.querySelector('#photo-canvas');
const selectionCanvas = document.querySelector('#selection-canvas');
const stage = document.querySelector('#stage');
const placeholder = document.querySelector('#stage-placeholder');
const undoButton = document.querySelector('#undo-button');
const clearButton = document.querySelector('#clear-button');
const autoDetectButton = document.querySelector('#auto-detect-button');
const recognizeButton = document.querySelector('#recognize-button');
const readingOrder = document.querySelector('#reading-order');
const recognitionList = document.querySelector('#recognition-list');
const translation = document.querySelector('#translation');
const copyButton = document.querySelector('#copy-button');
const status = document.querySelector('#status');

const pctx = photoCanvas.getContext('2d', { willReadFrequently: true });
const sctx = selectionCanvas.getContext('2d');
const selections = [];
let dragStart = null;
let dragCurrent = null;
let templatesPromise;

const kanaRows = [
  ['ん', 'わ', 'ら', 'や', 'ま', 'は', 'な', 'た', 'さ', 'か', 'あ'],
  [null, null, 'り', null, 'み', 'ひ', 'に', 'ち', 'し', 'き', 'い'],
  [null, null, 'る', 'ゆ', 'む', 'ふ', 'ぬ', 'つ', 'す', 'く', 'う'],
  [null, null, 'れ', null, 'め', 'へ', 'ね', 'て', 'せ', 'け', 'え'],
  [null, 'を', 'ろ', 'よ', 'も', 'ほ', 'の', 'と', 'そ', 'こ', 'お']
];
const kanaOptions = kanaRows.flat().filter(Boolean);
const xEdges = [95, 187, 279, 370, 462, 554, 646, 738, 829, 921, 1012, 1104];
const yEdges = [103, 195, 286, 378, 470, 563];

photoInput.addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const image = new Image();
  image.onload = async () => {
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    photoCanvas.width = selectionCanvas.width = Math.round(image.naturalWidth * scale);
    photoCanvas.height = selectionCanvas.height = Math.round(image.naturalHeight * scale);
    pctx.drawImage(image, 0, 0, photoCanvas.width, photoCanvas.height);
    URL.revokeObjectURL(image.src);
    selections.length = 0;
    drawSelections();
    placeholder.hidden = true;
    stage.hidden = false;
    updateButtons();
    autoDetectButton.disabled = false;
    setStatus('写真を読み込みました。文字を自動検出しています…');
    await autoDetectAndRecognize();
  };
  image.src = URL.createObjectURL(file);
});

function canvasPoint(event) {
  const rect = selectionCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(selectionCanvas.width, (event.clientX - rect.left) * selectionCanvas.width / rect.width)),
    y: Math.max(0, Math.min(selectionCanvas.height, (event.clientY - rect.top) * selectionCanvas.height / rect.height))
  };
}

selectionCanvas.addEventListener('pointerdown', event => {
  selectionCanvas.setPointerCapture(event.pointerId);
  dragStart = canvasPoint(event);
  dragCurrent = dragStart;
  drawSelections();
});

selectionCanvas.addEventListener('pointermove', event => {
  if (!dragStart) return;
  dragCurrent = canvasPoint(event);
  drawSelections();
});

selectionCanvas.addEventListener('pointerup', event => {
  if (!dragStart) return;
  dragCurrent = canvasPoint(event);
  const box = rectFromPoints(dragStart, dragCurrent);
  if (box.w > 12 && box.h > 12) selections.push(box);
  dragStart = dragCurrent = null;
  drawSelections();
  updateButtons();
});

function rectFromPoints(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function drawSelections() {
  sctx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
  const boxes = dragStart ? [...selections, rectFromPoints(dragStart, dragCurrent)] : selections;
  boxes.forEach((box, index) => {
    sctx.fillStyle = 'rgba(239, 91, 62, .13)';
    sctx.strokeStyle = '#ef5b3e';
    sctx.lineWidth = Math.max(2, selectionCanvas.width / 700 * 2);
    sctx.fillRect(box.x, box.y, box.w, box.h);
    sctx.strokeRect(box.x, box.y, box.w, box.h);
    sctx.fillStyle = '#ef5b3e';
    sctx.beginPath();
    sctx.arc(box.x + 15, box.y + 15, 13, 0, Math.PI * 2);
    sctx.fill();
    sctx.fillStyle = '#fff';
    sctx.font = 'bold 15px sans-serif';
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillText(String(index + 1), box.x + 15, box.y + 15);
  });
}

undoButton.addEventListener('click', () => { selections.pop(); drawSelections(); updateButtons(); });
clearButton.addEventListener('click', () => { selections.length = 0; drawSelections(); updateButtons(); });
function updateButtons() {
  const empty = selections.length === 0;
  undoButton.disabled = clearButton.disabled = recognizeButton.disabled = empty;
  autoDetectButton.disabled = photoCanvas.width === 0;
}

recognizeButton.addEventListener('click', async () => {
  recognizeButton.disabled = true;
  setStatus('対応表と照合しています…');
  try {
    const templates = await (templatesPromise ||= loadTemplates());
    recognizeSelections(templates);
  } catch (error) {
    console.error(error);
    setStatus('対応表を読み込めませんでした。ページを再読み込みしてください。');
  } finally {
    recognizeButton.disabled = selections.length === 0;
  }
});

autoDetectButton.addEventListener('click', autoDetectAndRecognize);
readingOrder.addEventListener('change', async () => {
  if (!selections.length) return;
  const sorted = sortReadingOrder(selections, readingOrder.value);
  selections.splice(0, selections.length, ...sorted);
  drawSelections();
  try {
    const templates = await (templatesPromise ||= loadTemplates());
    recognizeSelections(templates, false);
  } catch (error) {
    console.error(error);
  }
});

async function autoDetectAndRecognize() {
  if (!photoCanvas.width) return;
  autoDetectButton.disabled = true;
  recognizeButton.disabled = true;
  setStatus('文字領域を探しています…');
  try {
    const templates = await (templatesPromise ||= loadTemplates());
    await new Promise(resolve => requestAnimationFrame(resolve));
    const detected = detectCharacterBoxes(templates);
    selections.splice(0, selections.length, ...sortReadingOrder(detected, readingOrder.value));
    drawSelections();
    updateButtons();
    if (!selections.length) {
      recognitionList.innerHTML = '<p class="empty-result">文字を自動検出できませんでした。手動で文字を囲んでください。</p>';
      setStatus('自動検出できませんでした。範囲を手動で囲むか、明るい写真で再試行してください。');
      return;
    }
    recognizeSelections(templates, true);
  } catch (error) {
    console.error(error);
    setStatus('自動検出中にエラーが発生しました。手動選択は引き続き使えます。');
  } finally {
    autoDetectButton.disabled = false;
    recognizeButton.disabled = selections.length === 0;
  }
}

function recognizeSelections(templates, automatic = false) {
  const results = selections.map(box => classify(cropPhoto(box), templates));
  renderResults(results);
  translation.value = results.map(result => result.kana).join('');
  setStatus(`${results.length}文字を${automatic ? '自動で' : ''}読み取りました。候補を確認してください。`);
}

function cropPhoto(box) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.w));
  canvas.height = Math.max(1, Math.round(box.h));
  canvas.getContext('2d').drawImage(photoCanvas, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function detectCharacterBoxes(templates) {
  const width = photoCanvas.width;
  const height = photoCanvas.height;
  const pixels = pctx.getImageData(0, 0, width, height).data;
  const grayscale = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel++) {
    const value = Math.round(.2126 * pixels[index] + .7152 * pixels[index + 1] + .0722 * pixels[index + 2]);
    grayscale[pixel] = value;
    histogram[value]++;
  }

  const low = histogramPercentile(histogram, width * height, .01);
  const paper = histogramPercentile(histogram, width * height, .9);
  const threshold = Math.min(otsuThreshold(histogram, width * height), low + (paper - low) * .48);
  const mask = Uint8Array.from(grayscale, value => value < threshold ? 1 : 0);
  const cleaned = closeBinaryMask(mask, width, height);
  const components = connectedComponentsRect(cleaned, width, height);
  const minDimension = Math.max(8, Math.min(width, height) * .009);
  const maxImageArea = width * height * .16;

  const foregroundTemplates = [];
  const seenGroups = new Set();
  for (const template of templates) {
    const group = template.kana === 'ん' ? 'n' : `row-${template.row}`;
    if (!seenGroups.has(group)) {
      seenGroups.add(group);
      foregroundTemplates.push(template.feature.dark);
    }
  }

  const proposals = components
    .filter(component => {
      const boxWidth = component.maxX - component.minX + 1;
      const boxHeight = component.maxY - component.minY + 1;
      const density = component.area / (boxWidth * boxHeight);
      return boxWidth >= minDimension && boxHeight >= minDimension
        && component.area < maxImageArea
        && density > .075
        && boxWidth < width * .38
        && boxHeight < height * .38;
    })
    .map(component => {
      const boxWidth = component.maxX - component.minX + 1;
      const boxHeight = component.maxY - component.minY + 1;
      const centreX = (component.minX + component.maxX) / 2;
      const centreY = (component.minY + component.maxY) / 2;
      const side = Math.max(boxWidth, boxHeight) * 1.78;
      const box = clampSquare(centreX, centreY, side, width, height);
      const feature = makeFeature(cropPhoto(box));
      const foregroundScore = foregroundTemplates.reduce((best, template) => {
        return Math.max(best, transformedSimilarity(feature.dark, template, 48, false));
      }, 0);
      return { ...box, foregroundScore, componentArea: component.area };
    })
    .filter(box => box.foregroundScore >= .47)
    .sort((a, b) => b.foregroundScore - a.foregroundScore);

  const accepted = [];
  for (const proposal of proposals) {
    const duplicate = accepted.some(box => boxIoU(box, proposal) > .55 || centreDistance(box, proposal) < Math.min(box.w, proposal.w) * .34);
    if (!duplicate) accepted.push(proposal);
  }

  // Components from a real line of text have a broadly consistent scale.
  // Remove tiny high-contrast noise that happened to resemble a silhouette.
  if (accepted.length >= 3) {
    const sides = accepted.map(box => box.w).sort((a, b) => a - b);
    const median = sides[Math.floor(sides.length / 2)];
    return accepted.filter(box => box.w >= median * .42 && box.w <= median * 2.4);
  }
  return accepted;
}

function histogramPercentile(histogram, total, percentile) {
  const target = total * percentile;
  let count = 0;
  for (let value = 0; value < histogram.length; value++) {
    count += histogram[value];
    if (count >= target) return value;
  }
  return 255;
}

function otsuThreshold(histogram, total) {
  let sum = 0;
  for (let value = 0; value < 256; value++) sum += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 128;
  for (let value = 0; value < 256; value++) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) { bestVariance = variance; threshold = value; }
  }
  return threshold;
}

function closeBinaryMask(mask, width, height) {
  const dilated = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    let on = 0;
    for (let oy = -1; oy <= 1 && !on; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (mask[(y + oy) * width + x + ox]) { on = 1; break; }
    }
    dilated[y * width + x] = on;
  }
  const closed = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    let on = 1;
    for (let oy = -1; oy <= 1 && on; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!dilated[(y + oy) * width + x + ox]) { on = 0; break; }
    }
    closed[y * width + x] = on;
  }
  return closed;
}

function connectedComponentsRect(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const components = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const stack = [start];
    visited[start] = 1;
    let area = 0, minX = width, minY = height, maxX = -1, maxY = -1;
    while (stack.length) {
      const index = stack.pop();
      const x = index % width;
      const y = Math.floor(index / width);
      area++;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (mask[next] && !visited[next]) { visited[next] = 1; stack.push(next); }
      }
    }
    components.push({ area, minX, minY, maxX, maxY });
  }
  return components;
}

function clampSquare(centreX, centreY, requestedSide, width, height) {
  const side = Math.min(requestedSide, width, height);
  const x = Math.max(0, Math.min(width - side, centreX - side / 2));
  const y = Math.max(0, Math.min(height - side, centreY - side / 2));
  return { x, y, w: side, h: side };
}

function boxIoU(a, b) {
  const left = Math.max(a.x, b.x), top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w), bottom = Math.min(a.y + a.h, b.y + b.h);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / (a.w * a.h + b.w * b.h - intersection || 1);
}

function centreDistance(a, b) {
  return Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2);
}

function sortReadingOrder(boxes, requestedOrder) {
  if (boxes.length < 2) return boxes;
  const centres = boxes.map(box => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 }));
  const spreadX = Math.max(...centres.map(point => point.x)) - Math.min(...centres.map(point => point.x));
  const spreadY = Math.max(...centres.map(point => point.y)) - Math.min(...centres.map(point => point.y));
  const order = requestedOrder === 'auto' ? (spreadY > spreadX * 1.18 ? 'vertical-rtl' : 'horizontal-ltr') : requestedOrder;
  const medianSide = [...boxes.map(box => box.w)].sort((a, b) => a - b)[Math.floor(boxes.length / 2)];

  if (order === 'vertical-rtl') {
    const columns = groupByAxis(boxes, 'x', medianSide * .62, true);
    return columns.flatMap(column => column.sort((a, b) => a.y - b.y));
  }
  const rows = groupByAxis(boxes, 'y', medianSide * .62, false);
  const rightToLeft = order === 'horizontal-rtl';
  return rows.flatMap(row => row.sort((a, b) => rightToLeft ? b.x - a.x : a.x - b.x));
}

function groupByAxis(boxes, axis, tolerance, descending) {
  const centre = box => box[axis] + box.w / 2;
  const sorted = [...boxes].sort((a, b) => descending ? centre(b) - centre(a) : centre(a) - centre(b));
  const groups = [];
  for (const box of sorted) {
    const match = groups.find(group => Math.abs(centre(box) - group.average) <= tolerance);
    if (match) {
      match.items.push(box);
      match.average = match.items.reduce((sum, item) => sum + centre(item), 0) / match.items.length;
    } else groups.push({ average: centre(box), items: [box] });
  }
  groups.sort((a, b) => descending ? b.average - a.average : a.average - b.average);
  return groups.map(group => group.items);
}

async function loadTemplates() {
  const chart = new Image();
  chart.src = 'assets/kana-chart.png';
  await chart.decode();
  const templates = [];
  kanaRows.forEach((row, rowIndex) => row.forEach((kana, colIndex) => {
    if (!kana) return;
    const padding = 5;
    const sx = xEdges[colIndex] + padding;
    const sy = yEdges[rowIndex] + padding;
    const sw = xEdges[colIndex + 1] - xEdges[colIndex] - padding * 2;
    const sh = yEdges[rowIndex + 1] - yEdges[rowIndex] - padding * 2;
    const crop = document.createElement('canvas');
    crop.width = sw;
    crop.height = sh;
    crop.getContext('2d').drawImage(chart, sx, sy, sw, sh, 0, 0, sw, sh);
    templates.push({ kana, row: rowIndex, col: colIndex, feature: makeFeature(crop) });
  }));
  return templates;
}

function makeFeature(source) {
  const sampleSize = 96;
  const sample = document.createElement('canvas');
  sample.width = sample.height = sampleSize;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sampleSize, sampleSize);
  const scale = Math.min(sampleSize / source.width, sampleSize / source.height);
  ctx.drawImage(source, (sampleSize - source.width * scale) / 2, (sampleSize - source.height * scale) / 2, source.width * scale, source.height * scale);
  const image = ctx.getImageData(0, 0, sampleSize, sampleSize);
  const luminance = [];
  for (let i = 0; i < image.data.length; i += 4) {
    luminance.push(.2126 * image.data[i] + .7152 * image.data[i + 1] + .0722 * image.data[i + 2]);
  }
  const sorted = [...luminance].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * .04)];
  const high = sorted[Math.floor(sorted.length * .92)];
  const range = Math.max(25, high - low);
  const ink = luminance.map(value => 1 - Math.max(0, Math.min(1, (value - low) / range)));
  return normalizeInk(ink, sampleSize);
}

function normalizeInk(ink, size) {
  const rawDark = Uint8Array.from(ink, value => value > .55 ? 1 : 0);
  const components = connectedComponents(rawDark, size);
  const main = components
    .filter(component => component.area >= 8)
    .sort((a, b) => componentScore(b, size) - componentScore(a, size))[0];

  if (!main) return emptyFeature();

  // All positioning is anchored to the central dark animal. Fragments of an
  // adjacent glyph normally touch an edge or sit away from the crop centre and
  // are therefore not allowed to change the scale or origin.
  const anchorWidth = main.maxX - main.minX + 1;
  const anchorHeight = main.maxY - main.minY + 1;
  const centerX = (main.minX + main.maxX) / 2;
  const centerY = (main.minY + main.maxY) / 2;
  const frameSide = Math.max(12, Math.max(anchorWidth, anchorHeight) * 1.72);
  const target = 48;
  const mainMask = new Uint8Array(size * size);
  main.pixels.forEach(index => { mainMask[index] = 1; });
  const protectedDark = dilateMask(mainMask, size, 2);
  const dark = new Float32Array(target * target);
  const back = new Float32Array(target * target);

  for (let ty = 0; ty < target; ty++) for (let tx = 0; tx < target; tx++) {
    const sx = Math.round(centerX + ((tx + .5) / target - .5) * frameSide);
    const sy = Math.round(centerY + ((ty + .5) / target - .5) * frameSide);
    if (sx < 0 || sx >= size || sy < 0 || sy >= size) continue;
    const sourceIndex = sy * size + sx;
    const targetIndex = ty * target + tx;
    if (mainMask[sourceIndex]) dark[targetIndex] = Math.min(1, Math.max(0, (ink[sourceIndex] - .5) / .28));
    if (!protectedDark[sourceIndex] && ink[sourceIndex] > .1 && ink[sourceIndex] < .78) {
      back[targetIndex] = Math.min(1, (ink[sourceIndex] - .1) / .5);
    }
  }

  return { dark, back, anchorArea: main.area };
}

function emptyFeature() {
  return { dark: new Float32Array(48 * 48), back: new Float32Array(48 * 48), anchorArea: 0 };
}

function connectedComponents(mask, size) {
  const visited = new Uint8Array(mask.length);
  const components = [];
  const neighbors = [-1, 0, 1];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const stack = [start];
    const pixels = [];
    visited[start] = 1;
    let minX = size, minY = size, maxX = -1, maxY = -1;
    let sumX = 0, sumY = 0;
    while (stack.length) {
      const index = stack.pop();
      const x = index % size;
      const y = Math.floor(index / size);
      pixels.push(index);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      sumX += x; sumY += y;
      for (const oy of neighbors) for (const ox of neighbors) {
        if (ox === 0 && oy === 0) continue;
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
        const next = ny * size + nx;
        if (mask[next] && !visited[next]) { visited[next] = 1; stack.push(next); }
      }
    }
    components.push({
      pixels,
      area: pixels.length,
      minX, minY, maxX, maxY,
      cx: sumX / pixels.length,
      cy: sumY / pixels.length,
      touchesEdge: minX <= 1 || minY <= 1 || maxX >= size - 2 || maxY >= size - 2
    });
  }
  return components;
}

function componentScore(component, size) {
  const distance = Math.hypot(component.cx - size / 2, component.cy - size / 2) / (size * .71);
  const centreWeight = Math.max(.18, 1 - distance * .82);
  const edgeWeight = component.touchesEdge ? .18 : 1;
  return component.area * centreWeight * edgeWeight;
}

function dilateMask(mask, size, radius) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!mask[y * size + x]) continue;
    for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
      const nx = x + ox, ny = y + oy;
      if (nx >= 0 && nx < size && ny >= 0 && ny < size) out[ny * size + nx] = 1;
    }
  }
  return out;
}

function classify(canvas, templates) {
  const feature = makeFeature(canvas);
  if (!feature.anchorArea) {
    return { kana: '？', confidence: 0, candidates: [], displayMode: 'low', canvas };
  }

  // Stage 1: identify the dark foreground. All kana in one row share it, while
  // ん has its own unique foreground. Taking the best score within each group
  // prevents the rear symbol from influencing the vowel decision.
  const groups = new Map();
  templates.forEach(template => {
    const key = template.kana === 'ん' ? 'n' : `row-${template.row}`;
    const score = transformedSimilarity(feature.dark, template.feature.dark, 48, false);
    groups.set(key, Math.max(groups.get(key) ?? 0, score));
  });
  const foregroundRank = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  const groupScores = new Map(foregroundRank);

  // Score all 46 characters so candidates from a close foreground row are not
  // hidden. The foreground selects the row and the rear layer selects the column.
  const ranked = templates
    .map(template => {
      const group = template.kana === 'ん' ? 'n' : `row-${template.row}`;
      const foreground = groupScores.get(group) ?? 0;
      const background = transformedSimilarity(feature.back, template.feature.back, 48, true);
      return { kana: template.kana, score: foreground * .57 + background * .43 };
    })
    .sort((a, b) => b.score - a.score);

  const topScore = ranked[0].score;
  let candidates;
  let displayMode;
  if (topScore >= .9) {
    candidates = ranked.slice(0, 1);
    displayMode = 'confirmed';
  } else if (topScore >= .8) {
    candidates = ranked.filter(candidate => candidate.score >= .8);
    displayMode = 'multiple';
  } else {
    candidates = ranked.slice(0, 3);
    displayMode = 'low';
  }

  return { kana: ranked[0].kana, confidence: topScore, candidates, displayMode, canvas };
}

function transformedSimilarity(a, b, size, tolerateExtra) {
  let best = 0;
  const angles = [-7, 0, 7].map(degrees => degrees * Math.PI / 180);
  for (const angle of angles) for (const dy of [-2, 0, 2]) for (const dx of [-2, 0, 2]) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    let overlap = 0, aa = 0, bb = 0;
    for (let y = 2; y < size - 2; y++) for (let x = 2; x < size - 2; x++) {
      const rx = x - size / 2, ry = y - size / 2;
      const ax = Math.round(cos * rx - sin * ry + size / 2 + dx);
      const ay = Math.round(sin * rx + cos * ry + size / 2 + dy);
      const av = ax >= 0 && ax < size && ay >= 0 && ay < size ? a[ay * size + ax] : 0;
      const bv = b[y * size + x];
      overlap += Math.min(av, bv);
      aa += av;
      bb += bv;
    }
    let similarity;
    if (aa < .001 && bb < .001) similarity = 1;
    else if (aa < .001 || bb < .001) similarity = 0;
    else {
      const precision = overlap / aa;
      const recall = overlap / bb;
      similarity = tolerateExtra ? recall * .76 + precision * .24 : recall * .52 + precision * .48;
    }
    best = Math.max(best, similarity);
  }
  return best;
}

function renderResults(results) {
  recognitionList.replaceChildren();
  results.forEach((result, index) => {
    const card = document.createElement('div');
    card.className = 'glyph-card';
    const preview = document.createElement('canvas');
    preview.width = preview.height = 120;
    const ctx = preview.getContext('2d');
    ctx.fillStyle = '#f4f4f0'; ctx.fillRect(0, 0, 120, 120);
    const scale = Math.min(112 / result.canvas.width, 112 / result.canvas.height);
    ctx.drawImage(result.canvas, (120 - result.canvas.width * scale) / 2, (120 - result.canvas.height * scale) / 2, result.canvas.width * scale, result.canvas.height * scale);
    const select = document.createElement('select');
    select.className = 'kana-select';
    kanaOptions.forEach(kana => select.add(new Option(kana, kana, false, kana === result.kana)));
    select.setAttribute('aria-label', `${index + 1}文字目`);
    select.addEventListener('change', syncTranslation);
    const candidateList = document.createElement('div');
    candidateList.className = `candidate-list ${result.displayMode}`;
    const state = document.createElement('span');
    state.className = 'candidate-state';
    state.textContent = result.displayMode === 'confirmed'
      ? '確定'
      : result.displayMode === 'multiple' ? '80%以上の候補' : '上位3候補';
    candidateList.append(state);
    result.candidates.forEach(candidate => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'candidate-button';
      button.innerHTML = `<strong>${candidate.kana}</strong><span>${formatPercent(candidate.score)}%</span>`;
      button.addEventListener('click', () => {
        select.value = candidate.kana;
        syncTranslation();
        [...candidateList.querySelectorAll('.candidate-button')].forEach(item => item.classList.toggle('selected', item === button));
      });
      if (candidate.kana === result.kana) button.classList.add('selected');
      candidateList.append(button);
    });
    const confidence = document.createElement('span');
    confidence.className = 'confidence';
    confidence.textContent = `最高一致率 ${formatPercent(result.confidence)}%`;
    card.append(preview, candidateList, select, confidence);
    recognitionList.append(card);
  });
}

function syncTranslation() {
  translation.value = [...recognitionList.querySelectorAll('.kana-select')].map(select => select.value).join('');
}

function formatPercent(score) {
  return (score * 100).toFixed(1).replace(/\.0$/, '');
}

document.querySelectorAll('[data-insert]').forEach(button => button.addEventListener('click', () => {
  const start = translation.selectionStart;
  translation.setRangeText(button.dataset.insert, start, translation.selectionEnd, 'end');
  translation.focus();
}));

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(translation.value);
    setStatus('結果をコピーしました。');
  } catch {
    translation.select();
    document.execCommand('copy');
    setStatus('結果をコピーしました。');
  }
});

function setStatus(message) { status.textContent = message; }
