export function weldMesh(m) {
  const n = m.positions.length / 3;
  const map = new Map();
  const remap = new Uint32Array(n);
  const keep = [];
  const q = (v, s) => Math.round(v * s);
  for (let i = 0; i < n; i++) {
    let key = `${q(m.positions[i * 3], 1e4)},${q(m.positions[i * 3 + 1], 1e4)},${q(m.positions[i * 3 + 2], 1e4)}`;
    if (m.normals) key += `|${q(m.normals[i * 3], 1e3)},${q(m.normals[i * 3 + 1], 1e3)},${q(m.normals[i * 3 + 2], 1e3)}`;
    if (m.uvs) key += `|${q(m.uvs[i * 2], 1e5)},${q(m.uvs[i * 2 + 1], 1e5)}`;
    let idx = map.get(key);
    if (idx === undefined) { idx = keep.length; map.set(key, idx); keep.push(i); }
    remap[i] = idx;
  }
  if (keep.length === n) return m;
  const indices = new Uint32Array(m.indices.length);
  for (let i = 0; i < indices.length; i++) indices[i] = remap[m.indices[i]];
  return dropDegenerate({ ...m, ...gather(m, keep), indices });
}

function gather(m, keep) {
  const k = keep.length;
  const positions = new Float32Array(k * 3);
  const normals = m.normals ? new Float32Array(k * 3) : null;
  const uvs = m.uvs ? new Float32Array(k * 2) : null;
  for (let j = 0; j < k; j++) {
    const i = keep[j];
    positions[j * 3] = m.positions[i * 3]; positions[j * 3 + 1] = m.positions[i * 3 + 1]; positions[j * 3 + 2] = m.positions[i * 3 + 2];
    if (normals) { normals[j * 3] = m.normals[i * 3]; normals[j * 3 + 1] = m.normals[i * 3 + 1]; normals[j * 3 + 2] = m.normals[i * 3 + 2]; }
    if (uvs) { uvs[j * 2] = m.uvs[i * 2]; uvs[j * 2 + 1] = m.uvs[i * 2 + 1]; }
  }
  return { positions, normals, uvs };
}

function dropDegenerate(m) {
  const idx = m.indices;
  const tri = idx.length / 3;
  let bad = 0;
  for (let t = 0; t < tri; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (a === b || b === c || a === c) bad++;
  }
  if (!bad) return m;
  const indices = new Uint32Array((tri - bad) * 3);
  const triMaterials = new Int32Array(tri - bad);
  let o = 0;
  for (let t = 0; t < tri; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    indices[o * 3] = a; indices[o * 3 + 1] = b; indices[o * 3 + 2] = c;
    triMaterials[o++] = m.triMaterials[t];
  }
  return { ...m, indices, triMaterials };
}

function compact(m) {
  const n = m.positions.length / 3;
  const remap = new Int32Array(n).fill(-1);
  const keep = [];
  const indices = new Uint32Array(m.indices.length);
  for (let i = 0; i < m.indices.length; i++) {
    const v = m.indices[i];
    if (remap[v] < 0) { remap[v] = keep.length; keep.push(v); }
    indices[i] = remap[v];
  }
  return { ...m, ...gather(m, keep), indices };
}

let simplifier = null;
async function getSimplifier() {
  if (!simplifier) {
    const { MeshoptSimplifier } = await import('meshoptimizer/meshopt_simplifier.module.js');
    await MeshoptSimplifier.ready;
    simplifier = MeshoptSimplifier;
  }
  return simplifier;
}

export async function simplifyMeshes(meshes, ratio) {
  if (ratio >= 1) return meshes;
  const S = await getSimplifier();
  const out = [];
  for (const m of meshes) {
    const groups = new Map();
    const tri = m.indices.length / 3;
    for (let t = 0; t < tri; t++) {
      const mat = m.triMaterials[t];
      if (!groups.has(mat)) groups.set(mat, []);
      groups.get(mat).push(m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2]);
    }
    const flags = groups.size > 1 ? ['LockBorder'] : [];
    const parts = [];
    let total = 0;
    for (const [mat, list] of groups) {
      const idx = Uint32Array.from(list);
      const target = Math.max(3, Math.floor((idx.length * ratio) / 3) * 3);
      const [res] = idx.length > 3 ? S.simplify(idx, m.positions, 3, target, 1, flags) : [idx];
      parts.push([mat, res]);
      total += res.length;
    }
    const indices = new Uint32Array(total);
    const triMaterials = new Int32Array(total / 3);
    let o = 0;
    for (const [mat, res] of parts) {
      indices.set(res, o);
      triMaterials.fill(mat, o / 3, (o + res.length) / 3);
      o += res.length;
    }
    out.push(compact({ ...m, indices, triMaterials }));
  }
  return out;
}

export const countTriangles = (meshes) => meshes.reduce((s, m) => s + m.indices.length / 3, 0);
export const countVertices = (meshes) => meshes.reduce((s, m) => s + m.positions.length / 3, 0);
