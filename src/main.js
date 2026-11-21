import './styles/main.css';
import { loadInput, buildExport, writeModel } from './model/converter.js';
import { simplifyMeshes, countTriangles } from './model/mesh-tools.js';
import { imageTools, readImageSize } from './textures/image-tools.js';
import {
  textureOptions, targetSize, sizeSuffix, maxTextureSize,
  processTexture, resetTextureCache, relinkTextures,
} from './textures/optimizer.js';
import { Viewer, meshesToGroup } from './viewer/viewer.js';
import { createDropdown } from './ui/dropdown.js';
import { showGithubStars } from './ui/github-stars.js';
import { containsModel, readFiles, buildZip } from './files.js';
import { $, formatInt, formatBytes, download } from './utils.js';

const DRACO_PATH = `${import.meta.env.BASE_URL}draco/`;

const ROLE_LABELS = {
  baseColor: 'Diffuse',
  normal: 'Normal',
  bump: 'Bump',
  emissive: 'Emisivo',
  occlusion: 'AO',
  metallicRoughness: 'Metal/Rough',
  specularGlossiness: 'Spec/Gloss',
  specular: 'Specular',
  roughness: 'Roughness',
  metalness: 'Metalness',
  opacity: 'Opacidad',
};

const FORMATS = {
  fbx: { main: 'Descargar FBX + texturas', model: 'Solo FBX' },
  obj: { main: 'Descargar OBJ + texturas', model: 'Solo OBJ + MTL' },
  glb: { main: 'Descargar GLB', model: '' },
};

const downloadIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ui = {
  drop: $('drop'),
  fileInput: $('file'),
  pick: $('pick'),
  fileName: $('fname'),
  status: $('status'),
  viewerInfo: $('viewer-info'),
  stats: $('stats'),
  warnings: $('warnings'),
  textures: $('textures'),
  textureCount: $('tex-count'),
  textureTotal: $('tex-total'),
  downloadMain: $('dl-zip'),
  downloadModel: $('dl-model'),
  downloadTextures: $('dl-tex'),
};

const viewer = new Viewer($('viewer'));

const state = {
  input: null,
  result: null,
  format: 'fbx',
  reduce: false,
  ratio: 0.5,
  reduced: null,
  thumbnails: [],
};

let modelJob = 0;
let estimateJob = 0;
let estimateTimer = 0;
let ratioTimer = 0;

function setStatus(text) {
  ui.status.hidden = !text;
  ui.status.textContent = text || '';
}

function setViewerInfo(text) {
  ui.viewerInfo.hidden = !text;
  ui.viewerInfo.textContent = text || '';
}

function setBusy(busy) {
  for (const button of [ui.downloadMain, ui.downloadModel, ui.downloadTextures]) button.disabled = busy;
}

function showError(error) {
  console.error(error);
  alert(`Error: ${error.message || error}`);
}

function renderStats({ stats }) {
  const items = [
    ['Mallas', stats.meshes],
    ['Triángulos', formatInt(stats.triangles)],
    ['Materiales', stats.materials],
    ['Texturas', stats.textures],
  ];
  ui.stats.replaceChildren(...items.map(([label, value]) => {
    const item = document.createElement('div');
    item.innerHTML = `<dd>${value}</dd><dt>${label}</dt>`;
    return item;
  }));
}

function renderWarnings(messages) {
  ui.warnings.replaceChildren(...messages.map((message) => {
    const item = document.createElement('li');
    item.textContent = message;
    return item;
  }));
}

function renderTextures({ images }) {
  state.thumbnails.forEach(URL.revokeObjectURL);
  state.thumbnails = [];
  ui.textureCount.textContent = images.length || '';
  ui.textureTotal.textContent = '';

  if (!images.length) {
    ui.textures.innerHTML = '<p class="empty">Este modelo no tiene texturas. Si las tienes aparte, suéltalas junto al modelo o en un ZIP.</p>';
    return;
  }

  ui.textures.replaceChildren(...images.map((image) => {
    const url = URL.createObjectURL(new Blob([image.bytes], { type: image.mime }));
    state.thumbnails.push(url);

    const row = document.createElement('div');
    row.className = 'tex';
    row.innerHTML = `
      <div class="thumb"><img loading="lazy" alt=""></div>
      <div class="meta"><div class="name"></div><div class="role"></div><div class="dims"></div></div>
      <button class="dl" title="Descargar">${downloadIcon}</button>`;
    row.querySelector('img').src = url;
    row.querySelector('.role').textContent = image.roles.length
      ? image.roles.map((role) => ROLE_LABELS[role] || role).join(', ')
      : 'Sin uso';

    image.nameEl = row.querySelector('.name');
    image.dimsEl = row.querySelector('.dims');
    image.nameEl.textContent = image.nameEl.title = image.file;

    const button = row.querySelector('.dl');
    button.onclick = async () => {
      button.disabled = true;
      try {
        const texture = await processTexture(image);
        download(texture.bytes, texture.file, texture.mime);
      } catch (error) {
        showError(error);
      } finally {
        button.disabled = false;
      }
    };
    return row;
  }));
  updateTextureEstimates();
}

function updateTextureEstimates() {
  if (!state.result) return;
  const job = ++estimateJob;
  const px = (w, h) => (w === h ? `${w} px` : `${w}×${h}`);

  for (const image of state.result.images) {
    const size = targetSize(image);
    if (!size) {
      image.dimsLabel = '';
      image.dimsEl.textContent = formatBytes(image.bytes.length);
      continue;
    }
    const same = size[0] === image.width && size[1] === image.height;
    image.dimsLabel = same
      ? px(image.width, image.height)
      : `${px(image.width, image.height)} → <b>${px(...size)}</b>`;
    image.dimsEl.innerHTML = `${image.dimsLabel} · ${formatBytes(image.bytes.length)}`;
  }

  clearTimeout(estimateTimer);
  estimateTimer = setTimeout(async () => {
    let before = 0;
    let after = 0;
    for (const image of state.result.images) {
      if (job !== estimateJob) return;
      try {
        const texture = await processTexture(image);
        if (job !== estimateJob) return;
        before += image.bytes.length;
        after += texture.bytes.length;
        image.nameEl.textContent = image.nameEl.title = texture.file;
        const prefix = image.dimsLabel ? `${image.dimsLabel} · ` : '';
        image.dimsEl.innerHTML = texture.bytes.length === image.bytes.length
          ? `${prefix}${formatBytes(image.bytes.length)}`
          : `${prefix}${formatBytes(image.bytes.length)} → <b>${formatBytes(texture.bytes.length)}</b>`;
      } catch (error) {
        console.error(error);
      }
    }
    if (before) {
      ui.textureTotal.innerHTML = before === after
        ? formatBytes(before)
        : `${formatBytes(before)} → <b>${formatBytes(after)}</b>`;
    }
  }, 250);
}

async function updateReduction() {
  const { result } = state;
  if (!result) return;
  const job = ++modelJob;
  $('model-yes').hidden = !state.reduce;

  if (!state.reduce) {
    state.reduced = null;
    viewer.setPreview(null);
    setViewerInfo(`${formatInt(result.stats.triangles)} triángulos`);
    return;
  }

  $('model-result').textContent = 'Calculando…';
  try {
    const meshes = await simplifyMeshes(result.data.meshes, state.ratio);
    if (job !== modelJob) return;
    state.reduced = meshes;
    viewer.setPreview(meshesToGroup(meshes, result.threeMaterials, result.factor));

    const before = result.stats.triangles;
    const after = countTriangles(meshes);
    const percent = Math.round((1 - after / before) * 100);
    $('model-result').innerHTML = `Triángulos: ${formatInt(before)} → <b>${formatInt(after)}</b> (−${percent}%)`;
    setViewerInfo(`Optimizado: ${formatInt(after)} de ${formatInt(before)} triángulos`);
  } catch (error) {
    console.error(error);
    $('model-result').textContent = `No se pudo optimizar: ${error.message || error}`;
  }
}

function showLoadedLayout() {
  $('panel-empty').hidden = true;
  $('panel-body').hidden = false;
  $('empty').hidden = true;
  $('viewer-tools').hidden = false;
  $('file-chip').hidden = false;
  $('drop-title').hidden = true;
  $('formats').hidden = true;
  document.querySelector('.drop-icon').classList.add('gone');
  ui.pick.textContent = 'Cambiar';
}

async function load(list) {
  showLoadedLayout();
  ui.fileName.textContent = '…';
  viewer.resize();
  setBusy(true);

  try {
    setStatus('Leyendo archivos…');
    const files = await readFiles(list);
    state.input?.dispose?.();
    state.input = await loadInput(files, { dracoPath: DRACO_PATH, onStatus: setStatus });
    ui.fileName.textContent = state.input.mainName.split('/').pop();

    state.result = await buildExport(state.input, { imageTools, onStatus: setStatus });
    resetTextureCache();
    await Promise.all(state.result.images.map(readImageSize));

    viewer.show(state.input.scene);
    renderStats(state.result);
    renderWarnings(state.result.warnings);
    renderTextures(state.result);
    await updateReduction();
    setBusy(false);
  } catch (error) {
    console.error(error);
    state.result = null;
    ui.stats.replaceChildren();
    ui.textures.replaceChildren();
    ui.textureCount.textContent = '';
    renderWarnings([`Error: ${error.message || error}`]);
  } finally {
    setStatus('');
  }
}

async function processTextures(result) {
  if (textureOptions.optimize) setStatus('Optimizando texturas…');
  const textures = [];
  for (const image of result.images) {
    const texture = await processTexture(image);
    textures.push({ ...texture, from: image.file, to: texture.file });
  }
  return textures;
}

function modelFiles(result, textures) {
  if (state.reduced) setStatus('Escribiendo modelo optimizado…');
  const output = state.reduced ? writeModel(result.data, state.reduced, result.baseName) : result;
  if (state.format === 'obj') {
    return [
      [`${result.baseName}.obj`, output.obj],
      [`${result.baseName}.mtl`, relinkTextures(output.mtl, textures, false)],
    ];
  }
  return [[`${result.baseName}.fbx`, relinkTextures(output.fbx, textures, true)]];
}

function fileSuffix() {
  const reduction = state.reduced ? `_${Math.round(state.ratio * 100)}pct` : '';
  const textures = textureOptions.optimize ? `_optimizado${sizeSuffix()}` : '';
  return reduction + textures;
}

async function run(task) {
  if (!state.result) return;
  setBusy(true);
  try {
    await task(state.result);
  } catch (error) {
    resetTextureCache();
    showError(error);
  } finally {
    setStatus('');
    setBusy(false);
  }
}

async function downloadAll(result) {
  if (state.format === 'glb') {
    setStatus('Creando GLB…');
    const glb = await viewer.exportGLB({
      name: result.baseName,
      scale: state.input.unitToCm / 100,
      animations: state.input.animations,
      maxTextureSize: maxTextureSize(),
    });
    download(glb, `${result.baseName}${fileSuffix()}.glb`, 'model/gltf-binary');
    return;
  }

  const textures = await processTextures(result);
  setStatus('Creando ZIP…');
  const entries = [
    ...modelFiles(result, textures),
    ...textures.map((texture) => [`textures/${texture.file}`, texture.bytes]),
  ];
  download(await buildZip(entries, result.baseName), `${result.baseName}_${state.format}${fileSuffix()}.zip`);
}

async function downloadModel(result) {
  const textures = await processTextures(result);
  const files = modelFiles(result, textures);
  if (files.length === 1) {
    download(files[0][1], files[0][0], 'application/octet-stream');
    return;
  }
  download(await buildZip(files), `${result.baseName}_obj.zip`);
}

async function downloadTextures(result) {
  const textures = await processTextures(result);
  setStatus('Creando ZIP…');
  const entries = textures.map((texture) => [texture.file, texture.bytes]);
  download(await buildZip(entries), `${result.baseName}_texturas${fileSuffix()}.zip`);
}

function setFormat(format) {
  state.format = format;
  for (const button of $('out-fmt').querySelectorAll('button')) {
    button.classList.toggle('on', button.dataset.f === format);
  }
  ui.downloadMain.textContent = FORMATS[format].main;
  ui.downloadModel.textContent = FORMATS[format].model;
  ui.downloadModel.hidden = format === 'glb';
}

function applyTextureOptions() {
  const size = $('size-sel').value;
  textureOptions.optimize = $('tex-toggle').checked;
  textureOptions.mode = size === 'exact' ? 'exact' : 'pow2';
  if (size !== 'exact') textureOptions.max = Number(size);
  $('opt-yes').hidden = !textureOptions.optimize;
  $('exact-opts').hidden = size !== 'exact';
  updateTextureEstimates();
}

function acceptFiles(files) {
  if (containsModel(files)) load([...files]);
  else alert('Incluye un modelo: GLB, glTF, FBX, OBJ, DAE, STL o PLY (o un ZIP que lo contenga).');
}

async function loadFromUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const name = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop()) || 'modelo.glb';
    load([new File([await response.blob()], name)]);
  } catch (error) {
    alert(`No se pudo cargar ${url}: ${error.message || error}`);
  }
}

const clampPixels = (value) => Math.max(1, Math.min(8192, Math.round(Number(value)) || 512));

$('fit').onclick = () => viewer.fit();
$('wire').onchange = (event) => viewer.setWireframe(event.target.checked);

$('model-toggle').onchange = (event) => {
  state.reduce = event.target.checked;
  updateReduction();
};
$('ratio').oninput = (event) => {
  state.ratio = Number(event.target.value) / 100;
  $('ratio-val').textContent = `${event.target.value}%`;
  clearTimeout(ratioTimer);
  ratioTimer = setTimeout(updateReduction, 200);
};

$('tex-toggle').onchange = applyTextureOptions;
$('size-sel').onchange = applyTextureOptions;
$('exact-w').oninput = (event) => {
  textureOptions.width = clampPixels(event.target.value);
  updateTextureEstimates();
};
$('exact-h').oninput = (event) => {
  textureOptions.height = clampPixels(event.target.value);
  updateTextureEstimates();
};

for (const button of $('out-fmt').querySelectorAll('button')) {
  button.onclick = () => setFormat(button.dataset.f);
}

ui.downloadMain.onclick = () => run(downloadAll);
ui.downloadModel.onclick = () => run(downloadModel);
ui.downloadTextures.onclick = () => run(downloadTextures);

ui.pick.onclick = (event) => {
  event.stopPropagation();
  ui.fileInput.click();
};
ui.drop.onclick = (event) => {
  if (!event.target.closest('button')) ui.fileInput.click();
};
ui.fileInput.onchange = () => {
  if (ui.fileInput.files.length) acceptFiles(ui.fileInput.files);
  ui.fileInput.value = '';
};

let dragDepth = 0;
addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth++;
  ui.drop.classList.add('over');
});
addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) ui.drop.classList.remove('over');
});
addEventListener('dragover', (event) => event.preventDefault());
addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  ui.drop.classList.remove('over');
  if (event.dataTransfer.files.length) acceptFiles(event.dataTransfer.files);
});

createDropdown($('size-sel'));
setFormat('fbx');
applyTextureOptions();
showGithubStars('ATR-APPS/ATR-MODELFBX-APP', { badge: $('gh-stars'), counter: $('gh-count') });

const source = new URLSearchParams(location.search).get('src');
if (source) loadFromUrl(source);
