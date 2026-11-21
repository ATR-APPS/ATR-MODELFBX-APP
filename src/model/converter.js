import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { writeFBX } from '../export/fbx-writer.js';
import { writeOBJ } from '../export/obj-writer.js';
import { weldMesh } from './mesh-tools.js';
import { LocalizedError } from '../i18n.js';

export const MODEL_EXTS = ['glb', 'gltf', 'fbx', 'obj', 'dae', 'stl', 'ply'];

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  ktx2: 'image/ktx2', tga: 'image/x-tga', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  dds: 'image/vnd-ms.dds', avif: 'image/avif',
};
const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/ktx2': 'ktx2',
  'image/x-tga': 'tga', 'image/bmp': 'bmp', 'image/tiff': 'tif', 'image/vnd-ms.dds': 'dds', 'image/avif': 'avif',
};
const MAX_FRIENDLY = new Set(['png', 'jpg', 'tga', 'bmp', 'tif', 'dds']);
const TO_PNG = new Set(['webp', 'gif', 'avif']);

export const extOf = (name) => (/\.([^./\\]+)$/.exec(name)?.[1] || '').toLowerCase();
const stripExt = (name) => name.replace(/\.[^./\\]+$/, '');
export function baseOf(path) {
  let p = String(path);
  try { p = decodeURIComponent(p); } catch {}
  return p.replace(/[?#].*$/, '').replace(/\\/g, '/').split('/').pop();
}
export const keyOf = (path) => baseOf(path).toLowerCase();

function sniffMime(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  if (b[0] === 0xab && b[1] === 0x4b && b[2] === 0x54 && b[3] === 0x58) return 'image/ktx2';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b[0] === 0x44 && b[1] === 0x44 && b[2] === 0x53) return 'image/vnd-ms.dds';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a)) return 'image/tiff';
  return null;
}
const mimeFor = (bytes, name) => sniffMime(bytes) || MIME_BY_EXT[extOf(name || '')] || 'application/octet-stream';

function decodeDataUri(uri) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri);
  if (!m) return null;
  if (!m[2]) return { mime: m[1], bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
  const bin = atob(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}

export function sanitizeName(s, fallback = 'item') {
  const clean = String(s || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_\-.]+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 80);
  return clean || fallback;
}

function uniqueNamer() {
  const used = new Set();
  return (base) => {
    let name = base, i = 2;
    while (used.has(name.toLowerCase())) name = `${base}_${i++}`;
    used.add(name.toLowerCase());
    return name;
  };
}

function warn(warnings, key, params = {}) {
  warnings.set(`${key}|${JSON.stringify(params)}`, { key, params });
}

const toArrayBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

function readContainer(buffer) {
  const dv = new DataView(buffer);
  if (buffer.byteLength >= 12 && dv.getUint32(0, true) === 0x46546c67) {
    const total = dv.getUint32(8, true);
    let offset = 12, json = null, bin = null;
    while (offset + 8 <= total) {
      const len = dv.getUint32(offset, true);
      const type = dv.getUint32(offset + 4, true);
      const start = offset + 8;
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, len)));
      else if (type === 0x004e4942) bin = new Uint8Array(buffer, start, len);
      offset = start + len;
    }
    if (!json) throw new LocalizedError('error.glbNoJson');
    return { json, bin };
  }
  try {
    return { json: JSON.parse(new TextDecoder().decode(new Uint8Array(buffer))), bin: null };
  } catch {
    throw new LocalizedError('error.invalidGltf');
  }
}

function gltfBuffer(json, bin, index, fileMap) {
  const def = json.buffers?.[index];
  if (!def) return null;
  if (!def.uri) return bin;
  if (def.uri.startsWith('data:')) return decodeDataUri(def.uri)?.bytes ?? null;
  return fileMap.get(keyOf(def.uri))?.bytes ?? null;
}

function gltfImages(json, bin, fileMap, warnings) {
  return (json.images || []).map((img, i) => {
    let bytes = null, mime = img.mimeType, hint = img.name;
    if (img.bufferView != null) {
      const bv = json.bufferViews[img.bufferView];
      const buf = gltfBuffer(json, bin, bv.buffer, fileMap);
      if (buf) bytes = buf.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    } else if (img.uri?.startsWith('data:')) {
      const d = decodeDataUri(img.uri);
      if (d) { bytes = d.bytes; mime = mime || d.mime; }
    } else if (img.uri) {
      const f = fileMap.get(keyOf(img.uri));
      if (f) { bytes = f.bytes; hint = hint || stripExt(baseOf(f.name)); }
      else warn(warnings, 'warn.missingTexture', { name: keyOf(img.uri) });
    }
    if (bytes) mime = sniffMime(bytes) || mime || MIME_BY_EXT[extOf(img.uri || '')];
    return { index: i, hint, bytes, mime };
  });
}

function textureSource(json, texInfo) {
  if (!texInfo) return null;
  const t = json.textures?.[texInfo.index];
  if (!t) return null;
  const ext = t.extensions || {};
  return t.source ?? ext.EXT_texture_webp?.source ?? ext.EXT_texture_avif?.source ??
    ext.KHR_texture_basisu?.source ?? ext.MSFT_texture_dds?.source ?? null;
}

function gltfMaterial(json, def, gi) {
  const pbr = def.pbrMetallicRoughness || {};
  const sg = def.extensions?.KHR_materials_pbrSpecularGlossiness;
  const roles = {};
  const set = (role, info) => { const s = textureSource(json, info); if (s != null) roles[role] = `g${s}`; };
  set('baseColor', sg ? sg.diffuseTexture : pbr.baseColorTexture);
  set('normal', def.normalTexture);
  set('emissive', def.emissiveTexture);
  set('occlusion', def.occlusionTexture);
  set('metallicRoughness', pbr.metallicRoughnessTexture);
  if (sg) set('specularGlossiness', sg.specularGlossinessTexture);
  const factor = (sg ? sg.diffuseFactor : pbr.baseColorFactor) || [1, 1, 1, 1];
  const alphaMode = def.alphaMode || 'OPAQUE';
  return {
    name: sanitizeName(def.name, `Material_${gi}`),
    roles,
    color: factor.slice(0, 3),
    opacity: alphaMode === 'BLEND' ? factor[3] ?? 1 : 1,
    emissive: def.emissiveFactor || [0, 0, 0],
    alphaMode,
  };
}

export async function loadInput(files, { dracoPath, onStatus = () => {} } = {}) {
  const fileMap = new Map();
  for (const f of files) if (!fileMap.has(keyOf(f.name))) fileMap.set(keyOf(f.name), f);

  const main = [...files]
    .filter((f) => MODEL_EXTS.includes(extOf(f.name)))
    .sort((a, b) => MODEL_EXTS.indexOf(extOf(a.name)) - MODEL_EXTS.indexOf(extOf(b.name)))[0];
  if (!main) throw new LocalizedError('error.noModel');
  const ext = extOf(main.name);
  const warnings = new Map();

  const blobUrls = new Map();
  const blobToFile = new Map();
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(data|blob|https?):/.test(url)) return url;
    const f = fileMap.get(keyOf(url));
    if (!f) {
      warn(warnings, 'warn.missingFile', { name: keyOf(url) });
      return url;
    }
    let u = blobUrls.get(f.name);
    if (!u) {
      u = `${URL.createObjectURL(new Blob([f.bytes]))}#${encodeURIComponent(keyOf(f.name))}`;
      blobUrls.set(f.name, u);
      blobToFile.set(u, f);
    }
    return u;
  });
  const track = (Base) => class extends Base {
    load(url, ...rest) {
      const tex = super.load(url, ...rest);
      const f = fileMap.get(keyOf(url));
      if (f) tex.userData.sourceFile = f;
      return tex;
    }
  };
  manager.addHandler(/\.tga(#.*)?$/i, new (track(TGALoader))(manager));
  manager.addHandler(/\.dds(#.*)?$/i, new (track(DDSLoader))(manager));

  let busy = false;
  const waiters = [];
  manager.onStart = () => { busy = true; };
  manager.onLoad = () => { busy = false; waiters.splice(0).forEach((r) => r()); };
  const idle = () => (busy
    ? Promise.race([new Promise((r) => waiters.push(r)), new Promise((r) => setTimeout(r, 30000))])
    : Promise.resolve());

  onStatus('status.loadingModel');
  const buffer = toArrayBuffer(main.bytes);
  const text = () => new TextDecoder().decode(main.bytes);
  const result = { kind: ext, mainName: main.name, files: fileMap, blobToFile, warnings, animations: [], flipV: false, unitToCm: 1 };

  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader(manager);
    const draco = new DRACOLoader(manager);
    if (dracoPath) draco.setDecoderPath(dracoPath);
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);
    try {
      const gltf = await loader.parseAsync(buffer, '');
      Object.assign(result, { scene: gltf.scene, gltf, container: readContainer(buffer), animations: gltf.animations, flipV: true, unitToCm: 100 });
    } finally { draco.dispose(); }
  } else if (ext === 'fbx') {
    const group = new FBXLoader(manager).parse(buffer, '');
    Object.assign(result, { scene: group, animations: group.animations || [] });
  } else if (ext === 'obj') {
    const src = text();
    const objLoader = new OBJLoader(manager);
    const ref = /^\s*mtllib\s+(.+?)\s*$/m.exec(src)?.[1];
    const mtl = (ref && fileMap.get(keyOf(ref))) || files.find((f) => extOf(f.name) === 'mtl');
    if (mtl) {
      const materials = new MTLLoader(manager).parse(new TextDecoder().decode(mtl.bytes), '');
      materials.preload();
      objLoader.setMaterials(materials);
    } else if (ref) warn(warnings, 'warn.missingMtl', { name: ref });
    result.scene = objLoader.parse(src);
  } else if (ext === 'dae') {
    const collada = new ColladaLoader(manager).parse(text(), '');
    Object.assign(result, { scene: collada.scene, animations: collada.scene.animations || [], unitToCm: 100 });
  } else if (ext === 'stl' || ext === 'ply') {
    const geo = ext === 'stl' ? new STLLoader().parse(buffer) : new PLYLoader().parse(buffer);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.6, vertexColors: !!geo.attributes.color, name: 'Material' });
    const group = new THREE.Group();
    group.add(Object.assign(new THREE.Mesh(geo, mat), { name: sanitizeName(stripExt(baseOf(main.name)), 'Mesh') }));
    result.scene = group;
    if (ext === 'stl') result.unitToCm = 0.1;
  }

  onStatus('status.loadingTextures');
  await idle();
  result.scene.updateMatrixWorld(true);
  result.dispose = () => { for (const u of blobUrls.values()) URL.revokeObjectURL(u.split('#')[0]); };
  return result;
}

function bakeMesh(mesh, factor) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const n = pos.count;
  const world = mesh.matrixWorld;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
  const hasMorph = mesh.morphTargetInfluences?.some((x) => x !== 0);
  const skinned = mesh.isSkinnedMesh;

  const positions = new Float32Array(n * 3);
  const normals = nrm ? new Float32Array(n * 3) : null;
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    if (skinned || hasMorph) mesh.getVertexPosition(i, v);
    else v.fromBufferAttribute(pos, i);
    v.applyMatrix4(world).multiplyScalar(factor);
    positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;

    if (normals) {
      if (skinned) {
        a.fromBufferAttribute(pos, i);
        b.fromBufferAttribute(nrm, i).add(a);
        mesh.applyBoneTransform(i, a);
        mesh.applyBoneTransform(i, b);
        v.subVectors(b, a);
      } else {
        v.fromBufferAttribute(nrm, i);
      }
      v.applyMatrix3(normalMatrix).normalize();
      normals[i * 3] = v.x; normals[i * 3 + 1] = v.y; normals[i * 3 + 2] = v.z;
    }
  }

  let indices;
  if (geo.index) indices = Uint32Array.from(geo.index.array);
  else { indices = new Uint32Array(n); for (let i = 0; i < n; i++) indices[i] = i; }
  indices = indices.subarray(0, indices.length - (indices.length % 3));

  if (world.determinant() < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = t;
    }
  }

  let uvs = null;
  if (uv) {
    uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { uvs[i * 2] = uv.getX(i); uvs[i * 2 + 1] = uv.getY(i); }
  }
  return { positions, normals, uvs, indices };
}

function partMaterials(o, baked, materialIndexFor) {
  const triCount = baked.indices.length / 3;
  const triMaterials = new Int32Array(triCount);
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const groups = o.geometry.groups;
  if (Array.isArray(o.material) && groups.length) {
    const gIdx = mats.map((m) => materialIndexFor(m));
    triMaterials.fill(gIdx[0]);
    for (const g of groups) {
      const from = Math.floor(g.start / 3);
      const to = Math.min(triCount, Math.floor((g.start + g.count) / 3));
      triMaterials.fill(gIdx[g.materialIndex ?? 0] ?? gIdx[0], from, to);
    }
  } else {
    triMaterials.fill(materialIndexFor(mats[0]));
  }
  return triMaterials;
}

function mergeParts(parts) {
  if (parts.length === 1) return parts[0];
  const vCount = parts.reduce((s, p) => s + p.positions.length / 3, 0);
  const iCount = parts.reduce((s, p) => s + p.indices.length, 0);
  const anyN = parts.some((p) => p.normals), anyUV = parts.some((p) => p.uvs);
  const positions = new Float32Array(vCount * 3);
  const normals = anyN ? new Float32Array(vCount * 3) : null;
  const uvs = anyUV ? new Float32Array(vCount * 2) : null;
  const indices = new Uint32Array(iCount);
  const triMaterials = new Int32Array(iCount / 3);
  let vo = 0, io = 0;
  for (const p of parts) {
    positions.set(p.positions, vo * 3);
    if (normals && p.normals) normals.set(p.normals, vo * 3);
    if (uvs && p.uvs) uvs.set(p.uvs, vo * 2);
    for (let i = 0; i < p.indices.length; i++) indices[io + i] = p.indices[i] + vo;
    triMaterials.set(p.triMaterials, io / 3);
    vo += p.positions.length / 3;
    io += p.indices.length;
  }
  return { positions, normals, uvs, indices, triMaterials };
}

const THREE_ROLES = {
  map: 'baseColor', normalMap: 'normal', bumpMap: 'bump', emissiveMap: 'emissive', specularMap: 'specular',
  alphaMap: 'opacity', aoMap: 'occlusion', roughnessMap: 'roughness', metalnessMap: 'metalness',
};

export async function buildExport(loaded, { imageTools, onStatus = () => {} } = {}) {
  const warnings = new Map(loaded.warnings);
  const scene = loaded.scene;
  scene.updateMatrixWorld(true);
  const factor = loaded.unitToCm;
  const isGltf = !!loaded.gltf;

  const imageMap = new Map();
  if (isGltf) {
    const { json, bin } = loaded.container;
    for (const img of gltfImages(json, bin, loaded.files, warnings)) {
      imageMap.set(`g${img.index}`, { key: `g${img.index}`, hint: img.hint, uses: [], load: async () => (img.bytes ? { bytes: img.bytes, mime: img.mime } : null) });
    }
  }
  const texKey = (tex) => {
    const key = `t${tex.source?.uuid ?? tex.uuid}`;
    if (!imageMap.has(key)) {
      imageMap.set(key, {
        key, uses: [],
        hint: tex.userData.sourceFile ? stripExt(baseOf(tex.userData.sourceFile.name)) : tex.name ? stripExt(baseOf(tex.name)) : '',
        load: async () => {
          const f = tex.userData.sourceFile || loaded.blobToFile.get(tex.image?.src);
          if (f) return { bytes: f.bytes, mime: mimeFor(f.bytes, f.name), hint: stripExt(baseOf(f.name)) };
          const src = tex.image?.src;
          if (src?.startsWith('data:')) { const d = decodeDataUri(src); if (d) return { bytes: d.bytes, mime: mimeFor(d.bytes) }; }
          if (src?.startsWith('blob:')) {
            try { const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer()); return { bytes, mime: mimeFor(bytes) }; } catch {}
          }
          if (imageTools?.textureToPNG) {
            const bytes = await imageTools.textureToPNG(tex).catch(() => null);
            if (bytes) return { bytes, mime: 'image/png' };
          }
          return null;
        },
      });
    }
    return key;
  };

  const matNamer = uniqueNamer();
  const materials = [];
  const matIndexByKey = new Map();
  const threeMaterials = [];
  const gltfMats = isGltf ? (loaded.container.json.materials || []).map((d, i) => gltfMaterial(loaded.container.json, d, i)) : [];

  function materialIndexFor(threeMat) {
    const gi = isGltf ? loaded.gltf.parser.associations.get(threeMat)?.materials : undefined;
    const key = gi != null ? `g${gi}` : threeMat?.uuid ?? 'default';
    if (matIndexByKey.has(key)) return matIndexByKey.get(key);
    let rec;
    if (gi != null) {
      rec = { ...gltfMats[gi], roles: { ...gltfMats[gi].roles } };
    } else {
      const m = threeMat || {};
      const roles = {};
      for (const [prop, role] of Object.entries(THREE_ROLES)) if (m[prop]?.isTexture) roles[role] = texKey(m[prop]);
      const c = m.color || new THREE.Color(0.8, 0.8, 0.8);
      const e = m.emissive || new THREE.Color(0, 0, 0);
      rec = {
        name: sanitizeName(m.name, 'Material'),
        roles,
        color: [c.r, c.g, c.b],
        opacity: m.opacity ?? 1,
        emissive: [e.r, e.g, e.b],
        alphaMode: m.transparent || m.alphaTest > 0 ? 'BLEND' : 'OPAQUE',
      };
    }
    rec.name = matNamer(rec.name);
    const idx = materials.length;
    materials.push(rec);
    matIndexByKey.set(key, idx);
    threeMaterials[idx] = threeMat;
    return idx;
  }

  onStatus('status.processingGeometry');
  const objs = [];
  scene.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) objs.push(o); });
  if (!objs.length) throw new LocalizedError('error.noMesh');
  if (objs.some((o) => o.isSkinnedMesh)) warn(warnings, 'warn.skinned');
  if (loaded.animations?.length) warn(warnings, 'warn.animations', { count: loaded.animations.length });

  const buckets = new Map();
  for (const o of objs) {
    const assoc = isGltf ? loaded.gltf.parser.associations.get(o) : null;
    const merge = assoc?.primitives != null && o.parent && o.parent !== scene;
    const key = merge ? `${o.parent.uuid}|${assoc.meshes}` : o.uuid;
    if (!buckets.has(key)) buckets.set(key, { name: merge ? (o.parent.name || o.name) : o.name || o.parent?.name, parts: [] });
    buckets.get(key).parts.push(o);
  }
  const meshNamer = uniqueNamer();
  const meshes = [];
  let triangles = 0;
  for (const { name, parts } of buckets.values()) {
    const baked = parts.map((o) => {
      const b = bakeMesh(o, factor);
      return { ...b, triMaterials: partMaterials(o, b, materialIndexFor) };
    });
    const merged = mergeParts(baked);
    const mesh = weldMesh({ name: meshNamer(sanitizeName(name, 'Mesh')), flipV: loaded.flipV, ...merged });
    meshes.push(mesh);
    triangles += mesh.indices.length / 3;
  }

  for (const m of materials) for (const [role, key] of Object.entries(m.roles)) imageMap.get(key)?.uses.push({ mat: m.name, role });
  for (const g of gltfMats) for (const [role, key] of Object.entries(g.roles)) {
    const im = imageMap.get(key);
    if (im && !im.uses.length) im.uses.push({ mat: g.name, role });
  }

  onStatus('status.extractingTextures');
  const fileNamer = uniqueNamer();
  const outImages = [];
  const entryByKey = new Map();
  for (const im of imageMap.values()) {
    const got = await im.load();
    if (!got?.bytes) continue;
    let { bytes, mime } = got;
    let ext = EXT_BY_MIME[mime] || extOf(im.hint || '') || 'bin';
    if (TO_PNG.has(ext) && imageTools) {
      try { bytes = await imageTools.toPNG(bytes, mime); mime = 'image/png'; ext = 'png'; }
      catch { warn(warnings, 'warn.pngFailed', { ext }); }
    }
    if (!MAX_FRIENDLY.has(ext)) warn(warnings, 'warn.unsupportedFormat', { ext });
    let base = got.hint || im.hint;
    if (!base && im.uses.length) base = `${im.uses[0].mat}_${im.uses[0].role}`;
    const name = fileNamer(sanitizeName(base, `texture_${outImages.length}`));
    const entry = { name, file: `${name}.${ext}`, bytes, mime, roles: [...new Set(im.uses.map((u) => u.role))] };
    outImages.push(entry);
    entryByKey.set(im.key, entry);
  }

  const opacityByKey = new Map();
  if (imageTools) {
    for (const m of materials) {
      const key = m.roles.baseColor;
      if (m.alphaMode === 'OPAQUE' || key == null || m.roles.opacity || opacityByKey.has(key)) continue;
      const entry = entryByKey.get(key);
      opacityByKey.set(key, null);
      if (!entry) continue;
      try {
        const alpha = await imageTools.alphaToPNG(entry.bytes, entry.mime);
        if (alpha) {
          const name = fileNamer(`${entry.name}_opacity`);
          const op = { name, file: `${name}.png`, bytes: alpha, mime: 'image/png', roles: ['opacity'] };
          outImages.push(op);
          opacityByKey.set(key, op);
        }
      } catch {}
    }
  }

  const fileTextures = [];
  const texIndex = new Map();
  const tIdx = (entry) => {
    if (!entry) return undefined;
    if (!texIndex.has(entry)) { texIndex.set(entry, fileTextures.length); fileTextures.push({ name: entry.name, file: `textures/${entry.file}` }); }
    return texIndex.get(entry);
  };
  const outMaterials = materials.map((m) => {
    const r = m.roles;
    const get = (role) => entryByKey.get(r[role]);
    const maps = {
      diffuse: tIdx(get('baseColor')),
      normal: tIdx(get('normal')),
      bump: tIdx(get('bump')),
      emissive: tIdx(get('emissive')),
      specular: tIdx(get('specular') || get('specularGlossiness')),
      opacity: tIdx(get('opacity') || (m.alphaMode !== 'OPAQUE' ? opacityByKey.get(r.baseColor) : null)),
    };
    for (const k of Object.keys(maps)) if (maps[k] == null) delete maps[k];
    return {
      name: m.name,
      color: maps.diffuse != null ? [1, 1, 1] : m.color,
      emissive: maps.emissive != null ? [1, 1, 1] : m.emissive,
      opacity: m.opacity,
      maps,
    };
  });

  onStatus('status.writingFiles');
  const baseName = sanitizeName(stripExt(baseOf(loaded.mainName)), 'modelo');
  const data = { meshes, materials: outMaterials, textures: fileTextures };

  return {
    baseName,
    data,
    factor,
    threeMaterials,
    ...writeModel(data, meshes, baseName),
    images: outImages,
    stats: { meshes: meshes.length, triangles, materials: materials.length, textures: outImages.length },
    warnings: [...warnings.values()],
  };
}

export function writeModel(data, meshes, baseName) {
  const d = { ...data, meshes };
  return { fbx: writeFBX(d), ...writeOBJ(d, `${baseName}.mtl`) };
}
