import * as THREE from 'three';
import { decodeImage, createCanvas, encodeCanvas } from '../textures/image-tools.js';

const MAX_SAMPLE_SIZE = 1024;
const MAX_FINE_RESOLUTION = 384;
const pixelCache = new WeakMap();

const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export const maxDetail = (resolution) => Math.max(1, 2 ** Math.floor(Math.log2(MAX_FINE_RESOLUTION / resolution)));

async function readPixels(image) {
  if (pixelCache.has(image)) return pixelCache.get(image);
  let pixels = null;
  try {
    const bitmap = await decodeImage(image.bytes, image.mime);
    const scale = Math.min(1, MAX_SAMPLE_SIZE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    pixels = { width, height, data: ctx.getImageData(0, 0, width, height).data };
  } catch (error) {
    console.warn(error);
  }
  pixelCache.set(image, pixels);
  return pixels;
}

// Fallback: read the texture three.js already loaded for the viewer.
function readTexturePixels(texture) {
  if (pixelCache.has(texture)) return pixelCache.get(texture);
  let pixels = null;
  try {
    const image = texture.image;
    if (image?.width && image?.height) {
      if (image.data && image.data.length === image.width * image.height * 4) {
        pixels = { width: image.width, height: image.height, data: image.data };
      } else if (!image.data) {
        const scale = Math.min(1, MAX_SAMPLE_SIZE / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, width, height);
        pixels = { width, height, data: ctx.getImageData(0, 0, width, height).data };
      }
    }
  } catch (error) {
    console.warn(error);
  }
  pixelCache.set(texture, pixels);
  return pixels;
}

async function materialSamplers({ data, images, threeMaterials = [] }) {
  return Promise.all(data.materials.map(async (material, index) => {
    const threeMaterial = threeMaterials[index];
    // Specular/glossiness materials often keep the real colours in the specular texture and a black diffuse.
    const dark = Math.max(...material.color) < 0.05;
    const slot = material.maps.diffuse ?? (dark ? material.maps.specular : undefined);
    const texture = data.textures[slot];
    const image = texture && images.find((im) => im.name === texture.name);
    let pixels = image ? await readPixels(image) : null;
    if (!pixels && threeMaterial?.map?.isTexture) pixels = readTexturePixels(threeMaterial.map);

    let color = material.color;
    if (pixels) color = [1, 1, 1];
    else if (!image && threeMaterial?.map?.isTexture) color = [0.8, 0.8, 0.8];
    const tint = color.map((c) => srgb(Math.min(1, Math.max(0, c))) * 255);
    const cutout = !!(threeMaterial?.transparent || threeMaterial?.alphaTest > 0 || material.opacity < 1);
    return { tint, pixels, cutout };
  }));
}

// Surface voxelization. Every triangle is sampled densely; each sample marks its coarse voxel (a cube)
// and paints a fine voxel (one texture pixel of that cube's faces).
function rasterize(meshes, samplers, grid) {
  const { size, detail, origin, nx, ny, nz } = grid;
  const fine = size / detail;
  const fnx = nx * detail, fny = ny * detail, fnz = nz * detail;
  const coarse = new Float32Array(nx * ny * nz * 4);
  const fineSlots = new Map();
  let fineSums = new Float32Array(4 * 65536);
  const out = [0, 0, 0, 0];

  for (const mesh of meshes) {
    const { positions: p, uvs, indices, triMaterials, flipV } = mesh;
    for (let t = 0; t < indices.length / 3; t++) {
      const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
      const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
      const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
      const cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
      const longest = Math.sqrt(Math.max(
        (bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2,
        (cx - bx) ** 2 + (cy - by) ** 2 + (cz - bz) ** 2,
        (ax - cx) ** 2 + (ay - cy) ** 2 + (az - cz) ** 2,
      ));
      const n = Math.min(1024, Math.max(1, Math.ceil(longest / (fine * 0.5))));
      const sampler = samplers[triMaterials[t]] || { tint: [200, 200, 200], pixels: null, cutout: false };

      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n - i; j++) {
          const u = i / n, v = j / n, w = 1 - u - v;
          const fx = Math.min(fnx - 1, Math.floor((ax * w + bx * u + cx * v - origin.x) / fine));
          const fy = Math.min(fny - 1, Math.floor((ay * w + by * u + cy * v - origin.y) / fine));
          const fz = Math.min(fnz - 1, Math.floor((az * w + bz * u + cz * v - origin.z) / fine));
          if (fx < 0 || fy < 0 || fz < 0) continue;

          sample(sampler, uvs, flipV, a, b, c, w, u, v, out);
          if (out[3] < 0.3) continue;

          const ck = ((Math.floor(fy / detail) * nz + Math.floor(fz / detail)) * nx + Math.floor(fx / detail)) * 4;
          coarse[ck] += out[0]; coarse[ck + 1] += out[1]; coarse[ck + 2] += out[2]; coarse[ck + 3] += 1;

          const key = (fy * fnz + fz) * fnx + fx;
          let slot = fineSlots.get(key);
          if (slot === undefined) {
            slot = fineSlots.size;
            fineSlots.set(key, slot);
            if (slot * 4 >= fineSums.length) {
              const grown = new Float32Array(fineSums.length * 2);
              grown.set(fineSums);
              fineSums = grown;
            }
          }
          const fk = slot * 4;
          fineSums[fk] += out[0]; fineSums[fk + 1] += out[1]; fineSums[fk + 2] += out[2]; fineSums[fk + 3] += 1;
        }
      }
    }
  }
  return { coarse, fineSlots, fineSums, fnx, fny, fnz };
}

function sample({ tint, pixels, cutout }, uvs, flipV, a, b, c, w, u, v, out) {
  if (!pixels || !uvs) {
    out[0] = tint[0]; out[1] = tint[1]; out[2] = tint[2]; out[3] = 1;
    return;
  }
  let tu = uvs[a * 2] * w + uvs[b * 2] * u + uvs[c * 2] * v;
  let tv = uvs[a * 2 + 1] * w + uvs[b * 2 + 1] * u + uvs[c * 2 + 1] * v;
  tu -= Math.floor(tu);
  tv -= Math.floor(tv);
  if (!flipV) tv = 1 - tv;
  const px = Math.min(pixels.width - 1, Math.floor(tu * pixels.width));
  const py = Math.min(pixels.height - 1, Math.floor(tv * pixels.height));
  const k = (py * pixels.width + px) * 4;
  const d = pixels.data;
  out[0] = (d[k] * tint[0]) / 255;
  out[1] = (d[k + 1] * tint[1]) / 255;
  out[2] = (d[k + 2] * tint[2]) / 255;
  out[3] = cutout ? d[k + 3] / 255 : 1;
}

const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Empty cells connected to the border. Faces looking at any other empty cell face the hollow inside.
function findOutside(solid, { nx, ny, nz }) {
  const outside = new Uint8Array(solid.length);
  const queue = new Int32Array(solid.length);
  let head = 0, tail = 0;
  const push = (x, y, z) => {
    const i = (y * nz + z) * nx + x;
    if (solid[i] || outside[i]) return;
    outside[i] = 1;
    queue[tail++] = i;
  };
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) { push(0, y, z); push(nx - 1, y, z); }
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { push(x, y, 0); push(x, y, nz - 1); }
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) { push(x, 0, z); push(x, ny - 1, z); }
  while (head < tail) {
    const i = queue[head++];
    const x = i % nx, z = Math.floor(i / nx) % nz, y = Math.floor(i / (nx * nz));
    for (const [dx, dy, dz] of NEIGHBORS) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X >= 0 && Y >= 0 && Z >= 0 && X < nx && Y < ny && Z < nz) push(X, Y, Z);
    }
  }
  return outside;
}

// Greedy merge of solid voxels into boxes: grow along X, then Z, then Y.
function mergeBoxes(solid, { nx, ny, nz }) {
  const at = (x, y, z) => (y * nz + z) * nx + x;
  const used = new Uint8Array(solid.length);
  const free = (x, y, z) => solid[at(x, y, z)] && !used[at(x, y, z)];
  const rowFree = (x1, x2, y, z) => {
    for (let x = x1; x < x2; x++) if (!free(x, y, z)) return false;
    return true;
  };
  const layerFree = (x1, x2, y, z1, z2) => {
    for (let z = z1; z < z2; z++) if (!rowFree(x1, x2, y, z)) return false;
    return true;
  };
  const boxes = [];
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        if (!free(x, y, z)) continue;
        let x2 = x + 1;
        while (x2 < nx && free(x2, y, z)) x2++;
        let z2 = z + 1;
        while (z2 < nz && rowFree(x, x2, y, z2)) z2++;
        let y2 = y + 1;
        while (y2 < ny && layerFree(x, x2, y2, z, z2)) y2++;
        for (let yy = y; yy < y2; yy++) for (let zz = z; zz < z2; zz++) for (let xx = x; xx < x2; xx++) used[at(xx, yy, zz)] = 1;
        boxes.push({ from: [x, y, z], to: [x2, y2, z2] });
      }
    }
  }
  return boxes;
}

// Each face maps texture coordinates (u right, v down, in cube units) to a point on the box surface.
// Orientation follows Minecraft/Blockbench conventions (north = -Z).
const FACES = {
  north: { axis: 2, sign: -1, dims: (w, h, d) => [w, h], point: (b, u, v) => [b.to[0] - u, b.to[1] - v, b.from[2]] },
  south: { axis: 2, sign: 1, dims: (w, h, d) => [w, h], point: (b, u, v) => [b.from[0] + u, b.to[1] - v, b.to[2]] },
  east: { axis: 0, sign: 1, dims: (w, h, d) => [d, h], point: (b, u, v) => [b.to[0], b.to[1] - v, b.to[2] - u] },
  west: { axis: 0, sign: -1, dims: (w, h, d) => [d, h], point: (b, u, v) => [b.from[0], b.to[1] - v, b.from[2] + u] },
  up: { axis: 1, sign: 1, dims: (w, h, d) => [w, d], point: (b, u, v) => [b.from[0] + u, b.to[1], b.from[2] + v] },
  down: { axis: 1, sign: -1, dims: (w, h, d) => [w, d], point: (b, u, v) => [b.from[0] + u, b.from[1], b.to[2] - v] },
};

function planFaces(boxes, outside, { nx, ny, nz }) {
  const rects = [];
  for (const box of boxes) {
    const w = box.to[0] - box.from[0], h = box.to[1] - box.from[1], d = box.to[2] - box.from[2];
    box.faces = {};
    for (const [name, face] of Object.entries(FACES)) {
      const [fw, fh] = face.dims(w, h, d);
      let visible = false;
      for (let v = 0; v < fh && !visible; v++) {
        for (let u = 0; u < fw && !visible; u++) {
          const p = face.point(box, u + 0.5, v + 0.5);
          const c = p.map(Math.floor);
          c[face.axis] = face.sign > 0 ? p[face.axis] : p[face.axis] - 1;
          const [x, y, z] = c;
          visible = x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz || outside[(y * nz + z) * nx + x] === 1;
        }
      }
      if (!visible) continue;
      const rect = { box, name, w: fw, h: fh };
      box.faces[name] = rect;
      rects.push(rect);
    }
  }
  return rects;
}

function packRects(rects, detail) {
  const area = rects.reduce((s, r) => s + r.w * r.h * detail * detail, 0);
  const widest = rects.reduce((m, r) => Math.max(m, r.w * detail), 1);
  let width = 16;
  while (width < Math.max(widest, Math.ceil(Math.sqrt(area * 1.15)))) width *= 2;

  const sorted = [...rects].sort((a, b) => b.h - a.h || b.w - a.w);
  let x = 0, y = 0, shelf = 0;
  for (const rect of sorted) {
    const rw = rect.w * detail, rh = rect.h * detail;
    if (x + rw > width) { x = 0; y += shelf; shelf = 0; }
    rect.x = x; rect.y = y;
    x += rw;
    shelf = Math.max(shelf, rh);
  }
  let height = 16;
  while (height < y + shelf) height *= 2;
  return { width, height };
}

// Each texture pixel shows the outermost painted fine voxel behind it; if none, the cube's average colour.
function paintAtlas(rects, grid, raster, colors, width, height) {
  const { nx, nz, detail } = grid;
  const { fineSlots, fineSums, fnx, fnz } = raster;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const px = image.data;

  for (const rect of rects) {
    const face = FACES[rect.name];
    const { axis, sign } = face;
    for (let pv = 0; pv < rect.h * detail; pv++) {
      for (let pu = 0; pu < rect.w * detail; pu++) {
        const p = face.point(rect.box, (pu + 0.5) / detail, (pv + 0.5) / detail);
        const f = p.map((c) => Math.floor(c * detail));
        const plane = p[axis] * detail;
        let slot;
        for (let layer = 0; layer < detail && slot === undefined; layer++) {
          f[axis] = sign > 0 ? plane - 1 - layer : plane + layer;
          slot = fineSlots.get((f[1] * fnz + f[2]) * fnx + f[0]);
        }
        const k = ((rect.y + pv) * width + rect.x + pu) * 4;
        if (slot !== undefined) {
          const s = slot * 4, n = fineSums[s + 3];
          px[k] = fineSums[s] / n; px[k + 1] = fineSums[s + 1] / n; px[k + 2] = fineSums[s + 2] / n;
        } else {
          const c = p.map(Math.floor);
          c[axis] = sign > 0 ? p[axis] - 1 : p[axis];
          const ci = ((c[1] * nz + c[2]) * nx + c[0]) * 3;
          px[k] = colors[ci]; px[k + 1] = colors[ci + 1]; px[k + 2] = colors[ci + 2];
        }
        px[k + 3] = 255;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export async function buildVoxelModel(result, meshes, { resolution, detail }) {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) box.expandByPoint(point.fromArray(mesh.positions, i));
  }
  if (box.isEmpty()) return null;

  detail = Math.min(detail, maxDetail(resolution));
  const dims = box.getSize(new THREE.Vector3());
  const size = Math.max(dims.x, dims.y, dims.z) / resolution || 1;
  const nx = Math.max(1, Math.ceil(dims.x / size));
  const ny = Math.max(1, Math.ceil(dims.y / size));
  const nz = Math.max(1, Math.ceil(dims.z / size));
  const grid = { size, detail, origin: box.min.clone(), nx, ny, nz };

  const raster = rasterize(meshes, await materialSamplers(result), grid);
  const total = nx * ny * nz;
  const solid = new Uint8Array(total);
  const colors = new Uint8Array(total * 3);
  for (let i = 0; i < total; i++) {
    const n = raster.coarse[i * 4 + 3];
    if (!n) continue;
    solid[i] = 1;
    colors[i * 3] = raster.coarse[i * 4] / n;
    colors[i * 3 + 1] = raster.coarse[i * 4 + 1] / n;
    colors[i * 3 + 2] = raster.coarse[i * 4 + 2] / n;
  }

  const outside = findOutside(solid, grid);
  const boxes = mergeBoxes(solid, grid);
  const rects = planFaces(boxes, outside, grid);
  const { width, height } = packRects(rects, detail);
  const atlas = paintAtlas(rects, grid, raster, colors, width, height);
  return { grid, boxes, rects, atlas, width, height };
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// 1 texture pixel = 1 Blockbench unit, like Minecraft (16 units = 1 block).
export async function writeBBModel(model, name) {
  const { grid, boxes, atlas, width, height } = model;
  const { detail: s, nx, nz } = grid;
  const png = await encodeCanvas(atlas);
  const offsetX = Math.floor(nx / 2), offsetZ = Math.floor(nz / 2);

  const elements = boxes.map((box, i) => {
    const faces = {};
    for (const face of Object.keys(FACES)) {
      const r = box.faces[face];
      faces[face] = r
        ? { uv: [r.x, r.y, r.x + r.w * s, r.y + r.h * s], texture: 0 }
        : { uv: [0, 0, 0, 0], texture: null };
    }
    return {
      name: `cube_${i + 1}`,
      box_uv: false,
      rescale: false,
      locked: false,
      render_order: 'default',
      allow_mirror_modeling: true,
      from: [(box.from[0] - offsetX) * s, box.from[1] * s, (box.from[2] - offsetZ) * s],
      to: [(box.to[0] - offsetX) * s, box.to[1] * s, (box.to[2] - offsetZ) * s],
      autouv: 0,
      color: i % 8,
      origin: [0, 0, 0],
      faces,
      type: 'cube',
      uuid: crypto.randomUUID(),
    };
  });

  return JSON.stringify({
    meta: { format_version: '4.5', model_format: 'free', box_uv: false },
    name,
    model_identifier: '',
    visible_box: [1, 1, 0],
    variable_placeholders: '',
    variable_placeholder_buttons: [],
    timeline_setups: [],
    unhandled_root_fields: {},
    resolution: { width, height },
    elements,
    outliner: [{
      name,
      origin: [0, 0, 0],
      color: 0,
      uuid: crypto.randomUUID(),
      export: true,
      mirror_uv: false,
      isOpen: true,
      locked: false,
      visibility: true,
      autouv: 0,
      children: elements.map((e) => e.uuid),
    }],
    textures: [{
      path: '',
      name: `${name}.png`,
      folder: '',
      namespace: '',
      id: '0',
      width,
      height,
      uv_width: width,
      uv_height: height,
      particle: false,
      layers_enabled: false,
      render_mode: 'default',
      render_sides: 'auto',
      frame_time: 1,
      frame_order_type: 'loop',
      frame_order: '',
      frame_interpolate: false,
      visible: true,
      internal: true,
      saved: false,
      uuid: crypto.randomUUID(),
      source: `data:image/png;base64,${toBase64(png)}`,
    }],
  });
}

// Preview built from the same boxes, faces and texture that go into the .bbmodel.
export function voxelPreview(model, scale) {
  const { grid, rects, atlas, width, height } = model;
  const { size, detail, origin } = grid;
  const inverse = 1 / scale;
  const positions = [], normals = [], uvs = [], indices = [];
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];

  for (const rect of rects) {
    const face = FACES[rect.name];
    const normal = [0, 0, 0];
    normal[face.axis] = face.sign;
    const base = positions.length / 3;
    for (const [cu, cv] of corners) {
      const p = face.point(rect.box, cu * rect.w, cv * rect.h);
      positions.push(
        (origin.x + p[0] * size) * inverse,
        (origin.y + p[1] * size) * inverse,
        (origin.z + p[2] * size) * inverse,
      );
      normals.push(...normal);
      uvs.push((rect.x + cu * rect.w * detail) / width, 1 - (rect.y + cv * rect.h * detail) / height);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const texture = new THREE.CanvasTexture(atlas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, side: THREE.DoubleSide });

  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material));
  return group;
}
