import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import JSZip from 'jszip';
import { loadInput, buildExport, extOf, MODEL_EXTS } from './converter.js';

const $ = (id) => document.getElementById(id);
const els = {
  drop: $('drop'), file: $('file'), pick: $('pick'), work: $('work'), canvas: $('viewer'),
  status: $('status'), fname: $('fname'), stats: $('stats'), scale: $('scale'),
  zip: $('dl-zip'), fbx: $('dl-model'), tex: $('dl-tex'), another: $('another'),
  warnings: $('warnings'), textures: $('textures'), texCount: $('tex-count'),
};

let current = null;      // resultado de buildExport()
let loaded = null;       // resultado de loadInput()
let outFmt = 'fbx';      // 'fbx' | 'obj' | 'glb'
let thumbUrls = [];

// ---------- Herramientas de imagen (canvas) ----------
async function decode(bytes, mime) {
  return createImageBitmap(new Blob([bytes], { type: mime }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}
function canvasFor(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
async function canvasToPNG(c) {
  const blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/png' })
    : await new Promise((r) => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
const imageTools = {
  async toPNG(bytes, mime) {
    const bmp = await decode(bytes, mime);
    const c = canvasFor(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close?.();
    return canvasToPNG(c);
  },
  // Devuelve el canal alfa como PNG en grises (blanco = opaco), o null si la imagen no tiene transparencia
  async alphaToPNG(bytes, mime) {
    if (mime === 'image/jpeg') return null;
    const bmp = await decode(bytes, mime);
    const c = canvasFor(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    let hasAlpha = false;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { hasAlpha = true; break; }
    if (!hasAlpha) return null;
    for (let i = 0; i < px.length; i += 4) { const a = px[i + 3]; px[i] = px[i + 1] = px[i + 2] = a; px[i + 3] = 255; }
    ctx.putImageData(data, 0, 0);
    return canvasToPNG(c);
  },
  // Texturas sin archivo original (p. ej. incrustadas): se dibujan y se guardan como PNG
  async textureToPNG(tex) {
    const img = tex.image;
    if (!img?.width) return null;
    const c = canvasFor(img.width, img.height);
    const ctx = c.getContext('2d');
    if (img.data) {
      if (img.data.length !== img.width * img.height * 4) return null;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length), img.width, img.height), 0, 0);
    } else {
      if (img.decode) await img.decode().catch(() => {});
      ctx.drawImage(img, 0, 0);
    }
    return canvasToPNG(c);
  },
};

// ---------- Optimización de texturas (tamaño + peso) ----------
// quality: 'none' = sin recomprimir · 'balanced' = casi sin pérdida visible · 'max' = lo más ligero
const texOpts = { mode: 'original', max: 512, w: 512, h: 512, quality: 'balanced' };
let resizeCache = new Map();

const QUALITY = {
  balanced: { jpg: 0.86, jpgNormal: 0.93, pngColors: 0 },   // PNG sin pérdida, mejor comprimido
  max:      { jpg: 0.75, jpgNormal: 0.86, pngColors: 256 }, // PNG cuantizado a 256 colores
};
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg' };

function nearestPow2(n, max) {
  let lo = 1;
  while (lo * 2 <= n) lo *= 2;
  const hi = lo * 2;
  const p = n - lo <= hi - n ? lo : hi;
  return Math.max(1, Math.min(p, max));
}

function targetSize(img) {
  if (!img.width) return null;
  if (texOpts.mode === 'pow2') return [nearestPow2(img.width, texOpts.max), nearestPow2(img.height, texOpts.max)];
  if (texOpts.mode === 'exact') return [texOpts.w, texOpts.h];
  return [img.width, img.height];
}

async function renderAt(img, w, h) {
  let src = await decode(img.bytes, img.mime);
  let cw = src.width, ch = src.height;
  const draw = (from, tw, th) => {
    const c = canvasFor(tw, th);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(from, 0, 0, tw, th);
    return c;
  };
  // Reducción por mitades para que no quede pixelado
  while (cw / 2 >= w && ch / 2 >= h) {
    cw = Math.floor(cw / 2); ch = Math.floor(ch / 2);
    const next = draw(src, cw, ch);
    src.close?.();
    src = next;
  }
  const out = draw(src, w, h);
  src.close?.();
  return out;
}

async function encodeJPG(canvas, q) {
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/jpeg', quality: q })
    : await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
  return new Uint8Array(await blob.arrayBuffer());
}

function encodePNG(pixels, w, h, colors) {
  if (!window.UPNG) throw new Error('No se pudo cargar el compresor PNG.');
  return new Uint8Array(UPNG.encode([pixels.buffer], w, h, colors));
}

const optsKey = () => `${texOpts.mode}|${texOpts.max}|${texOpts.w}x${texOpts.h}|${texOpts.quality}`;

// Devuelve { bytes, mime, file } de la textura según las opciones de tamaño y peso
function processImage(img) {
  const key = `${img.file}|${optsKey()}`;
  if (!resizeCache.has(key)) resizeCache.set(key, doProcess(img));
  return resizeCache.get(key);
}

async function doProcess(img) {
  const original = { bytes: img.bytes, mime: img.mime, file: img.file };
  const size = targetSize(img);
  if (!size || !EXT[img.mime]) return original;
  const [w, h] = size;
  const resized = w !== img.width || h !== img.height;
  if (!resized && texOpts.quality === 'none') return original;

  const canvas = await renderAt(img, w, h);
  const pixels = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let hasAlpha = false;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) { hasAlpha = true; break; }

  const base = img.file.replace(/\.[^.]+$/, '');
  const candidates = [];
  if (texOpts.quality === 'none') {
    // Solo cambia el tamaño, mismo formato
    candidates.push(img.mime === 'image/jpeg'
      ? { bytes: await encodeJPG(canvas, 0.92), mime: 'image/jpeg' }
      : { bytes: encodePNG(pixels, w, h, 0), mime: 'image/png' });
  } else {
    const q = QUALITY[texOpts.quality];
    if (hasAlpha) {
      // Con transparencia: PNG (JPG no guarda alfa)
      candidates.push({ bytes: encodePNG(pixels, w, h, q.pngColors), mime: 'image/png' });
      if (q.pngColors) candidates.push({ bytes: encodePNG(pixels, w, h, 0), mime: 'image/png' });
    } else {
      // Opaca: JPG, mayor calidad para normal maps
      const isNormal = img.roles.includes('normal');
      candidates.push({ bytes: await encodeJPG(canvas, isNormal ? q.jpgNormal : q.jpg), mime: 'image/jpeg' });
    }
  }
  // Nunca entregar algo más pesado que el original del mismo tamaño
  if (!resized) candidates.push({ bytes: img.bytes, mime: img.mime });
  const best = candidates.reduce((a, b) => (b.bytes.length < a.bytes.length ? b : a));
  return { ...best, file: `${base}.${EXT[best.mime]}` };
}

// Ajusta las rutas si alguna textura cambió de extensión (png -> jpg)
function withFiles(text, results, quoted) {
  let out = text;
  for (const { from, to } of results) {
    if (from === to) continue;
    out = quoted
      ? out.split(`"textures/${from}"`).join(`"textures/${to}"`)
      : out.split(`textures/${from}\n`).join(`textures/${to}\n`);
  }
  return out;
}

async function readDims(img) {
  try {
    const bmp = await decode(img.bytes, img.mime);
    img.width = bmp.width; img.height = bmp.height;
    bmp.close?.();
  } catch { /* formato no decodificable (ktx2, etc.) */ }
}

function sizeSuffix() {
  if (texOpts.mode === 'pow2') return `_max${texOpts.max}`;
  if (texOpts.mode === 'exact') return `_${texOpts.w}x${texOpts.h}`;
  return '';
}

// ---------- Visor ----------
const renderer = new THREE.WebGLRenderer({ canvas: els.canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const view = new THREE.Scene();
view.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
const controls = new OrbitControls(camera, els.canvas);
controls.enableDamping = true;
let shown = null;

function resize() {
  const r = els.canvas.parentElement.getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(els.canvas.parentElement);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(view, camera); });

function showScene(scene) {
  if (shown) {
    view.remove(shown);
    shown.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) {
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
        m.dispose();
      }
    });
  }
  shown = scene;
  view.add(scene);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const center = box.getCenter(new THREE.Vector3());
  camera.near = size / 1000; camera.far = size * 100; camera.updateProjectionMatrix();
  camera.position.copy(center).add(new THREE.Vector3(0.6, 0.35, 1).normalize().multiplyScalar(size * 1.1));
  controls.target.copy(center);
  controls.update();
}

// ---------- UI ----------
function setStatus(text) {
  els.status.hidden = !text;
  els.status.textContent = text || '';
}
function setBusy(b) { for (const btn of [els.zip, els.fbx, els.tex]) btn.disabled = b; }

// ---------- Formato de salida ----------
const FMT = {
  fbx: { zip: 'Descargar ZIP (FBX + texturas)', model: 'Solo FBX', hint: 'Para 3ds Max, Maya, Blender, Unity… Los mapas ya van conectados al material.' },
  obj: { zip: 'Descargar ZIP (OBJ + MTL + texturas)', model: 'Solo OBJ + MTL', hint: 'Formato simple y universal. Úsalo si algún FBX te da problemas.' },
  glb: { zip: 'Descargar GLB', model: 'Solo GLB', hint: 'Un solo archivo con todo dentro (web, Unity, Sketchfab). Conserva huesos y animaciones.' },
};
function applyFormat() {
  els.zip.textContent = FMT[outFmt].zip;
  els.fbx.textContent = FMT[outFmt].model;
  els.fbx.hidden = outFmt === 'glb';
  $('fmt-hint').textContent = FMT[outFmt].hint;
}
for (const b of $('out-fmt').querySelectorAll('button')) {
  b.onclick = () => {
    outFmt = b.dataset.f;
    for (const x of $('out-fmt').querySelectorAll('button')) x.classList.toggle('on', x === b);
    applyFormat();
  };
}
applyFormat();

function download(data, name, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const ROLE_ES = {
  baseColor: 'Diffuse / Base color', normal: 'Normal', bump: 'Bump', emissive: 'Emisivo', occlusion: 'AO',
  metallicRoughness: 'Metal/Rough', specularGlossiness: 'Spec/Gloss', specular: 'Specular',
  roughness: 'Roughness', metalness: 'Metalness', opacity: 'Opacidad',
};

function fmtBytes(n) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function renderInfo(res) {
  els.stats.innerHTML = '';
  const items = [['Mallas', res.stats.meshes], ['Triángulos', res.stats.triangles.toLocaleString('es')],
    ['Materiales', res.stats.materials], ['Texturas', res.stats.textures]];
  for (const [k, v] of items) {
    const d = document.createElement('div');
    d.innerHTML = `<dt>${k}</dt><dd>${v}</dd>`;
    els.stats.append(d);
  }

  els.warnings.innerHTML = '';
  for (const w of res.warnings) {
    const li = document.createElement('li'); li.textContent = w; els.warnings.append(li);
  }

  thumbUrls.forEach(URL.revokeObjectURL); thumbUrls = [];
  els.textures.innerHTML = '';
  els.texCount.textContent = res.images.length ? `(${res.images.length})` : '';
  if (!res.images.length) {
    els.textures.innerHTML = '<p class="empty">Este modelo no tiene texturas. Si las tienes aparte, suéltalas junto al modelo o en un ZIP.</p>';
    return;
  }
  for (const img of res.images) {
    const url = URL.createObjectURL(new Blob([img.bytes], { type: img.mime }));
    thumbUrls.push(url);
    const card = document.createElement('div');
    card.className = 'tex';
    const tags = (img.roles.length ? img.roles : ['sin uso']).map((r) => `<span class="tag">${ROLE_ES[r] || r}</span>`).join('');
    card.innerHTML = `<div class="thumb"><img loading="lazy" alt=""></div>
      <div class="meta"><div class="name"></div><div class="dims"></div><div class="tags">${tags}</div>
      <button class="btn dl">Descargar</button></div>`;
    card.querySelector('img').src = url;
    card.querySelector('.name').textContent = img.file;
    img.dimsEl = card.querySelector('.dims');
    const btn = card.querySelector('.dl');
    btn.onclick = async () => {
      btn.disabled = true;
      try { const r = await processImage(img); download(r.bytes, r.file, r.mime); }
      catch (err) { console.error(err); alert(`Error: ${err.message || err}`); }
      finally { btn.disabled = false; }
    };
    els.textures.append(card);
  }
  updateDims();
}

// Muestra tamaño y peso (original → optimizado) en cada textura
let estimateToken = 0;
function updateDims() {
  if (!current) return;
  const token = ++estimateToken;
  for (const img of current.images) {
    if (!img.dimsEl) continue;
    const size = targetSize(img);
    if (!size) { img.dimsEl.textContent = fmtBytes(img.bytes.length); continue; }
    const same = size[0] === img.width && size[1] === img.height;
    const dims = same ? `${img.width}×${img.height}` : `${img.width}×${img.height} → <b>${size[0]}×${size[1]}</b>`;
    img.dimsEl.innerHTML = `${dims}<br>${fmtBytes(img.bytes.length)} → <span class="pending">calculando…</span>`;
    img.dimsHTML = dims;
  }
  clearTimeout(updateDims.t);
  updateDims.t = setTimeout(async () => {
    let before = 0, after = 0;
    for (const img of current.images) {
      if (token !== estimateToken) return;
      try {
        const r = await processImage(img);
        if (token !== estimateToken) return;
        before += img.bytes.length; after += r.bytes.length;
        if (img.dimsEl) {
          const pct = Math.round((1 - r.bytes.length / img.bytes.length) * 100);
          const fmt = r.mime !== img.mime ? ` · ${EXT[r.mime].toUpperCase()}` : '';
          img.dimsEl.innerHTML = r.bytes === img.bytes
            ? `${img.dimsHTML}<br>${fmtBytes(img.bytes.length)} · sin cambios`
            : `${img.dimsHTML}<br>${fmtBytes(img.bytes.length)} → <b>${fmtBytes(r.bytes.length)}</b>${pct > 0 ? ` (−${pct}%)` : ''}${fmt}`;
        }
      } catch (err) { console.error(err); }
    }
    if (token === estimateToken && before) {
      els.texCount.textContent = `(${current.images.length}) · ${fmtBytes(before)} → ${fmtBytes(after)}`;
    }
  }, 250);
}

// ---------- Opción "Optimizar texturas" ----------
function applyOptions() {
  const yes = $('optimize').querySelector('.on').dataset.v === 'yes';
  const size = $('size-sel').value;
  $('opt-yes').hidden = !yes;
  $('opt-no').hidden = yes;
  $('exact-opts').hidden = size !== 'exact';
  $('opt-hint').textContent = size === 'exact'
    ? 'Todas las texturas salen exactamente a este tamaño y se comprimen para que pesen menos sin perder calidad visible.'
    : 'Se reduce al tamaño más cercano (128, 256, 512…) sin pasar del máximo, y se comprime para que pese menos sin perder calidad visible.';
  if (!yes) { texOpts.mode = 'original'; texOpts.quality = 'none'; }
  else {
    texOpts.quality = 'balanced';
    if (size === 'exact') texOpts.mode = 'exact';
    else { texOpts.mode = 'pow2'; texOpts.max = +size; }
  }
  updateDims();
}
for (const b of $('optimize').querySelectorAll('button')) {
  b.onclick = () => {
    for (const x of $('optimize').querySelectorAll('button')) x.classList.toggle('on', x === b);
    applyOptions();
  };
}
$('size-sel').onchange = applyOptions;
const clampPx = (v) => Math.max(1, Math.min(8192, Math.round(+v) || 512));
$('exact-w').oninput = (e) => { texOpts.w = clampPx(e.target.value); updateDims(); };
$('exact-h').oninput = (e) => { texOpts.h = clampPx(e.target.value); updateDims(); };
applyOptions();

// Lee los archivos soltados; los ZIP se descomprimen
async function readFiles(list) {
  const out = [];
  for (const f of list) {
    if (extOf(f.name) === 'zip') {
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || /(^|\/)(__MACOSX|\.)/.test(entry.name)) continue;
        out.push({ name: entry.name, bytes: await entry.async('uint8array') });
      }
    } else {
      out.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    }
  }
  return out;
}

async function load(list) {
  els.drop.hidden = true;
  els.work.hidden = false;
  els.fname.textContent = '…';
  els.scale.value = 1;
  resize();
  setBusy(true);
  try {
    setStatus('Leyendo archivos…');
    const files = await readFiles(list);
    loaded?.dispose?.();
    loaded = await loadInput(files, { onStatus: setStatus });
    els.fname.textContent = loaded.mainName.split('/').pop();
    current = await buildExport(loaded, { scale: 1, imageTools, onStatus: setStatus });
    current.scaleUsed = 1;
    resizeCache = new Map();
    await Promise.all(current.images.map(readDims));
    showScene(loaded.scene);
    renderInfo(current);
    setBusy(false);
  } catch (err) {
    console.error(err);
    current = null;
    els.stats.innerHTML = ''; els.textures.innerHTML = ''; els.texCount.textContent = '';
    els.warnings.innerHTML = '';
    const li = document.createElement('li'); li.textContent = `Error: ${err.message || err}`; els.warnings.append(li);
  } finally {
    setStatus('');
  }
}

const currentScale = () => { const s = parseFloat(els.scale.value); return Number.isFinite(s) && s > 0 ? s : 1; };

// Si cambió la escala, se regeneran los archivos del modelo
async function ensureScale() {
  const scale = currentScale();
  if (scale === current.scaleUsed) return current;
  setStatus('Aplicando escala…');
  const res = await buildExport(loaded, { scale, imageTools });
  Object.assign(current, { fbx: res.fbx, obj: res.obj, mtl: res.mtl, scaleUsed: scale });
  return current;
}

async function run(fn) {
  if (!current) return;
  setBusy(true);
  try { await fn(await ensureScale()); }
  catch (err) { console.error(err); resizeCache = new Map(); alert(`Error: ${err.message || err}`); }
  finally { setStatus(''); setBusy(false); }
}

// GLB: se exporta la escena completa (con huesos y animaciones), en metros
async function exportGLB() {
  setStatus('Creando GLB…');
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const root = new THREE.Group();
  root.name = current.baseName;
  root.scale.setScalar((loaded.unitToCm / 100) * currentScale());
  const scene = loaded.scene;
  view.remove(scene);
  root.add(scene);
  try {
    const maxTextureSize = texOpts.mode === 'pow2' ? texOpts.max
      : texOpts.mode === 'exact' ? Math.max(texOpts.w, texOpts.h) : Infinity;
    return await new GLTFExporter().parseAsync(root, { binary: true, animations: loaded.animations, maxTextureSize });
  } finally {
    root.remove(scene);
    view.add(scene);
  }
}

async function processAll(res) {
  if (texOpts.mode !== 'original' || texOpts.quality !== 'none') setStatus('Optimizando texturas…');
  const out = [];
  for (const img of res.images) {
    const r = await processImage(img);
    out.push({ ...r, from: img.file, to: r.file });
  }
  return out;
}
const zipSuffix = () => (texOpts.quality === 'none' ? '' : '_optimizado') + sizeSuffix();

function modelFiles(res, tex) {
  if (outFmt === 'obj') {
    return [
      [`${res.baseName}.obj`, res.obj],
      [`${res.baseName}.mtl`, withFiles(res.mtl, tex, false)],
    ];
  }
  return [[`${res.baseName}.fbx`, withFiles(res.fbx, tex, true)]];
}

els.zip.onclick = () => run(async (res) => {
  if (outFmt === 'glb') {
    download(await exportGLB(), `${res.baseName}${zipSuffix()}.glb`, 'model/gltf-binary');
    return;
  }
  const tex = await processAll(res);
  setStatus('Creando ZIP…');
  const zip = new JSZip();
  const dir = zip.folder(res.baseName);
  for (const [name, data] of modelFiles(res, tex)) dir.file(name, data);
  for (const t of tex) dir.file(`textures/${t.file}`, t.bytes);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  download(blob, `${res.baseName}_${outFmt}${zipSuffix()}.zip`);
});
els.fbx.onclick = () => run(async (res) => {
  const tex = await processAll(res); // para que las rutas coincidan con las texturas optimizadas
  const files = modelFiles(res, tex);
  if (files.length === 1) { download(files[0][1], files[0][0], 'application/octet-stream'); return; }
  const zip = new JSZip();
  for (const [name, data] of files) zip.file(name, data);
  download(await zip.generateAsync({ type: 'blob' }), `${res.baseName}_obj.zip`);
});
els.tex.onclick = () => run(async (res) => {
  const tex = await processAll(res);
  setStatus('Creando ZIP…');
  const zip = new JSZip();
  for (const t of tex) zip.file(t.file, t.bytes);
  download(await zip.generateAsync({ type: 'blob' }), `${res.baseName}_texturas${zipSuffix()}.zip`);
});

// ---------- Entrada de archivos ----------
function accept(files) {
  const list = [...files];
  const ok = list.some((x) => MODEL_EXTS.includes(extOf(x.name)) || extOf(x.name) === 'zip');
  if (ok) load(list);
  else alert('Incluye un modelo: GLB, glTF, FBX, OBJ, DAE, STL o PLY (o un ZIP que lo contenga).');
}
els.pick.onclick = (e) => { e.stopPropagation(); els.file.click(); };
els.drop.onclick = () => els.file.click();
els.another.onclick = () => els.file.click();
els.file.onchange = () => { if (els.file.files.length) accept(els.file.files); els.file.value = ''; };

let depth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); depth++; els.drop.classList.add('over'); });
addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; els.drop.classList.remove('over'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault(); depth = 0; els.drop.classList.remove('over');
  if (e.dataTransfer.files.length) accept(e.dataTransfer.files);
});
