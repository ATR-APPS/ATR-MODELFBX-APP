import './styles/main.css';
import { loadInput, buildExport, writeModel } from './model/converter.js';
import { simplifyMeshes, countTriangles } from './model/mesh-tools.js';
import { imageTools, readImageSize } from './textures/image-tools.js';
import {
  textureOptions, targetSize, sizeSuffix, maxTextureSize,
  processTexture, resetTextureCache, relinkTextures,
} from './textures/optimizer.js';
import { Viewer, meshesToGroup } from './viewer/viewer.js';
import { buildVoxelModel, writeBBModel, voxelPreview, maxDetail } from './export/voxel.js';
import { createDropdown } from './ui/dropdown.js';
import { showGithubStars } from './ui/github-stars.js';
import { containsModel, readFiles, buildZip } from './files.js';
import { t, getLanguage, setLanguage, onLanguageChange, applyTranslations, describeError } from './i18n.js';
import { $, formatInt, formatBytes, download } from './utils.js';

const DRACO_PATH = `${import.meta.env.BASE_URL}draco/`;

const FORMATS = {
  fbx: { main: 'download.fbx', model: 'download.fbxOnly' },
  obj: { main: 'download.obj', model: 'download.objOnly' },
  glb: { main: 'download.glb', model: null },
  bbmodel: { main: 'download.bbmodel', model: null },
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
  modelResult: $('model-result'),
  downloadMain: $('dl-zip'),
  downloadModel: $('dl-model'),
  downloadTextures: $('dl-tex'),
};

const viewer = new Viewer($('viewer'));
const sizeDropdown = createDropdown($('size-sel'));

const state = {
  input: null,
  result: null,
  format: 'fbx',
  reduce: false,
  ratio: 0.5,
  reduced: null,
  reduction: null,
  thumbnails: [],
  voxelRes: 16,
  voxelDetail: 4,
  voxelPalette: 16,
  voxelCleanup: true,
  voxelModel: null,
  voxelGroup: null,
};

let modelJob = 0;
let estimateJob = 0;
let estimateTimer = 0;
let ratioTimer = 0;
let voxelJob = 0;
let voxelTimer = 0;

function setStatus(key) {
  ui.status.hidden = !key;
  ui.status.textContent = key ? t(key) : '';
}

function setBusy(busy) {
  for (const button of [ui.downloadMain, ui.downloadModel, ui.downloadTextures]) button.disabled = busy;
}

function showError(error) {
  console.error(error);
  alert(t('error.prefix', { message: describeError(error) }));
}

function renderViewerInfo() {
  const { result, reduction } = state;
  ui.viewerInfo.hidden = !result;
  if (!result) return;
  if (state.format === 'bbmodel') {
    ui.viewerInfo.textContent = state.voxelModel ? t('viewer.cubes', { count: formatInt(state.voxelModel.boxes.length) }) : '';
    ui.viewerInfo.hidden = !state.voxelModel;
    return;
  }
  ui.viewerInfo.textContent = reduction
    ? t('viewer.optimized', { after: formatInt(reduction.after), before: formatInt(reduction.before) })
    : t('viewer.triangles', { count: formatInt(result.stats.triangles) });
}

function renderReduction() {
  const { reduction } = state;
  if (!reduction) return;
  const percent = Math.round((1 - reduction.after / reduction.before) * 100);
  ui.modelResult.innerHTML = t('model.result', {
    before: formatInt(reduction.before),
    after: formatInt(reduction.after),
    percent,
  });
}

function renderStats({ stats }) {
  const items = [
    ['stats.meshes', stats.meshes],
    ['stats.triangles', formatInt(stats.triangles)],
    ['stats.materials', stats.materials],
    ['stats.textures', stats.textures],
  ];
  ui.stats.replaceChildren(...items.map(([label, value]) => {
    const item = document.createElement('div');
    item.innerHTML = `<dd>${value}</dd><dt>${t(label)}</dt>`;
    return item;
  }));
}

function renderWarnings(warnings) {
  ui.warnings.replaceChildren(...warnings.map((warning) => {
    const item = document.createElement('li');
    item.textContent = t(warning.key, warning.params);
    return item;
  }));
}

function roleLabel(roles) {
  if (!roles.length) return t('role.unused');
  return roles.map((role) => t(`role.${role}`)).join(', ');
}

function renderTextures({ images }) {
  state.thumbnails.forEach(URL.revokeObjectURL);
  state.thumbnails = [];
  ui.textureCount.textContent = images.length || '';
  ui.textureTotal.textContent = '';

  if (!images.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t('textures.empty');
    ui.textures.replaceChildren(empty);
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
      <button class="dl">${downloadIcon}</button>`;
    row.querySelector('img').src = url;
    row.querySelector('.role').textContent = roleLabel(image.roles);

    image.nameEl = row.querySelector('.name');
    image.dimsEl = row.querySelector('.dims');
    image.nameEl.textContent = image.nameEl.title = image.file;

    const button = row.querySelector('.dl');
    button.title = t('textures.download');
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
    state.reduction = null;
    refreshPreview();
    renderViewerInfo();
    updateVoxels();
    return;
  }

  ui.modelResult.textContent = t('model.calculating');
  try {
    const meshes = await simplifyMeshes(result.data.meshes, state.ratio);
    if (job !== modelJob) return;
    state.reduced = meshes;
    state.reduction = { before: result.stats.triangles, after: countTriangles(meshes) };
    refreshPreview();
    renderReduction();
    renderViewerInfo();
    updateVoxels();
  } catch (error) {
    console.error(error);
    ui.modelResult.textContent = t('model.failed', { message: describeError(error) });
  }
}

function refreshPreview() {
  const { result } = state;
  if (!result) return;
  if (state.format === 'bbmodel') viewer.setPreview(state.voxelGroup);
  else viewer.setPreview(state.reduced ? meshesToGroup(state.reduced, result.threeMaterials, result.factor) : null);
}

function clearVoxels() {
  voxelJob++;
  state.voxelModel = null;
  state.voxelGroup = null;
}

async function updateVoxels() {
  const { result } = state;
  if (!result || state.format !== 'bbmodel') return;
  const job = ++voxelJob;
  $('voxel-result').textContent = t('model.calculating');
  await new Promise((resolve) => setTimeout(resolve, 20));
  if (job !== voxelJob) return;
  try {
    const model = await buildVoxelModel(result, state.reduced || result.data.meshes, {
      resolution: state.voxelRes,
      detail: state.voxelDetail,
      palette: state.voxelPalette,
      cleanup: state.voxelCleanup,
    });
    if (job !== voxelJob || !model) return;
    state.voxelModel = model;
    state.voxelGroup = voxelPreview(model, result.factor);
    $('voxel-result').innerHTML = t('voxel.result', {
      count: formatInt(model.boxes.length),
      width: model.width,
      height: model.height,
    });
    refreshPreview();
    renderViewerInfo();
  } catch (error) {
    console.error(error);
    $('voxel-result').textContent = t('model.failed', { message: describeError(error) });
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
  ui.pick.dataset.i18n = 'drop.change';
  ui.pick.textContent = t('drop.change');
}

async function load(list) {
  showLoadedLayout();
  ui.fileName.textContent = '…';
  viewer.resize();
  setBusy(true);

  try {
    setStatus('status.reading');
    const files = await readFiles(list);
    state.input?.dispose?.();
    state.input = await loadInput(files, { dracoPath: DRACO_PATH, onStatus: setStatus });
    ui.fileName.textContent = state.input.mainName.split('/').pop();

    state.result = await buildExport(state.input, { imageTools, onStatus: setStatus });
    state.reduction = null;
    state.reduced = null;
    clearVoxels();
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
    state.reduction = null;
    renderViewerInfo();
    ui.stats.replaceChildren();
    ui.textures.replaceChildren();
    ui.textureCount.textContent = '';
    renderWarnings([{ key: 'error.prefix', params: { message: describeError(error) } }]);
  } finally {
    setStatus('');
  }
}

async function processTextures(result) {
  if (textureOptions.optimize) setStatus('status.optimizingTextures');
  const textures = [];
  for (const image of result.images) {
    const texture = await processTexture(image);
    textures.push({ ...texture, from: image.file, to: texture.file });
  }
  return textures;
}

function modelFiles(result, textures) {
  if (state.reduced) setStatus('status.writingOptimized');
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
  const textures = textureOptions.optimize ? `_optimized${sizeSuffix()}` : '';
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
  if (state.format === 'bbmodel') {
    if (!state.voxelModel) await updateVoxels();
    if (!state.voxelModel) return;
    setStatus('status.creatingBBModel');
    const json = await writeBBModel(state.voxelModel, result.baseName);
    download(json, `${result.baseName}_voxel${state.voxelRes}.bbmodel`, 'application/json');
    return;
  }
  if (state.format === 'glb') {
    setStatus('status.creatingGlb');
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
  setStatus('status.creatingZip');
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
  setStatus('status.creatingZip');
  const entries = textures.map((texture) => [texture.file, texture.bytes]);
  download(await buildZip(entries), `${result.baseName}_textures${fileSuffix()}.zip`);
}

function renderFormat() {
  const { main, model } = FORMATS[state.format];
  for (const button of $('out-fmt').querySelectorAll('button')) {
    button.classList.toggle('on', button.dataset.f === state.format);
  }
  ui.downloadMain.textContent = t(main);
  ui.downloadModel.textContent = model ? t(model) : '';
  ui.downloadModel.hidden = !model;
  $('voxel-opts').hidden = state.format !== 'bbmodel';
}

function renderLanguage() {
  for (const button of $('lang').querySelectorAll('button')) {
    button.classList.toggle('on', button.dataset.lang === getLanguage());
  }
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
  else alert(t('error.noModelSelected'));
}

async function loadFromUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const name = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop()) || 'model.glb';
    load([new File([await response.blob()], name)]);
  } catch (error) {
    alert(t('error.loadUrl', { url, message: describeError(error) }));
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

$('voxel-res').oninput = (event) => {
  state.voxelRes = Number(event.target.value);
  $('voxel-res-val').textContent = event.target.value;
  renderVoxelDetail();
  clearTimeout(voxelTimer);
  voxelTimer = setTimeout(updateVoxels, 250);
};

function renderVoxelDetail() {
  const limit = maxDetail(state.voxelRes);
  for (const button of $('voxel-detail').querySelectorAll('button')) {
    const value = Number(button.dataset.px);
    button.disabled = value > limit;
    button.classList.toggle('on', value === Math.min(state.voxelDetail, limit));
  }
}

for (const button of $('voxel-detail').querySelectorAll('button')) {
  button.onclick = () => {
    state.voxelDetail = Number(button.dataset.px);
    renderVoxelDetail();
    updateVoxels();
  };
}
renderVoxelDetail();

for (const button of $('voxel-palette').querySelectorAll('button')) {
  button.onclick = () => {
    state.voxelPalette = Number(button.dataset.colors);
    for (const other of $('voxel-palette').querySelectorAll('button')) other.classList.toggle('on', other === button);
    updateVoxels();
  };
}
$('voxel-cleanup').onchange = (event) => {
  state.voxelCleanup = event.target.checked;
  updateVoxels();
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
  button.onclick = () => {
    state.format = button.dataset.f;
    renderFormat();
    if (state.format === 'bbmodel' && !state.voxelModel) updateVoxels();
    else refreshPreview();
    renderViewerInfo();
  };
}

for (const button of $('lang').querySelectorAll('button')) {
  button.onclick = () => setLanguage(button.dataset.lang);
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

onLanguageChange(() => {
  renderLanguage();
  renderFormat();
  sizeDropdown.render();
  renderViewerInfo();
  renderReduction();
  if (state.result) {
    renderStats(state.result);
    renderWarnings(state.result.warnings);
    renderTextures(state.result);
  }
});

ui.pick.dataset.i18n = 'drop.pick';
applyTranslations();
sizeDropdown.render();
renderLanguage();
renderFormat();
applyTextureOptions();
showGithubStars('ATR-APPS/ATR-MODELFBX-APP', { badge: $('gh-stars'), counter: $('gh-count') });

const source = new URLSearchParams(location.search).get('src');
if (source) loadFromUrl(source);
