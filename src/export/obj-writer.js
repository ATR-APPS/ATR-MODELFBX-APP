const MTL_KEYS = {
  diffuse: 'map_Kd',
  specular: 'map_Ks',
  emissive: 'map_Ke',
  opacity: 'map_d',
};

function num(v) {
  if (!Number.isFinite(v)) return '0';
  const r = +v.toFixed(6);
  return r === 0 ? '0' : String(r);
}
const clean = (s) => String(s).replace(/\s+/g, '_');

export function writeOBJ({ meshes, materials, textures }, mtlFileName) {
  const out = [`# Generado por ATR MODELFBX`, `mtllib ${mtlFileName}`, ''];
  let vBase = 1;
  for (const m of meshes) {
    const n = m.positions.length / 3;
    const lines = [`o ${clean(m.name)}`];
    for (let i = 0; i < n; i++) {
      lines.push(`v ${num(m.positions[i * 3])} ${num(m.positions[i * 3 + 1])} ${num(m.positions[i * 3 + 2])}`);
    }
    if (m.uvs) {
      for (let i = 0; i < n; i++) {
        const v = m.uvs[i * 2 + 1];
        lines.push(`vt ${num(m.uvs[i * 2])} ${num(m.flipV ? 1 - v : v)}`);
      }
    }
    if (m.normals) {
      for (let i = 0; i < n; i++) {
        lines.push(`vn ${num(m.normals[i * 3])} ${num(m.normals[i * 3 + 1])} ${num(m.normals[i * 3 + 2])}`);
      }
    }
    const idx = m.indices;
    let lastMat = -1;
    for (let t = 0; t < idx.length / 3; t++) {
      const mat = m.triMaterials ? m.triMaterials[t] : 0;
      if (mat !== lastMat) { lines.push(`usemtl ${clean(materials[mat].name)}`); lastMat = mat; }
      const f = [];
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k] + vBase;
        f.push(m.uvs && m.normals ? `${v}/${v}/${v}` : m.uvs ? `${v}/${v}` : m.normals ? `${v}//${v}` : `${v}`);
      }
      lines.push(`f ${f.join(' ')}`);
    }
    vBase += n;
    out.push(lines.join('\n'), '');
  }

  const mtl = ['# Generado por ATR MODELFBX', ''];
  for (const mat of materials) {
    const c = mat.color || [1, 1, 1];
    const e = mat.emissive || [0, 0, 0];
    mtl.push(`newmtl ${clean(mat.name)}`);
    mtl.push(`Ka 0 0 0`, `Kd ${num(c[0])} ${num(c[1])} ${num(c[2])}`, `Ks 0.2 0.2 0.2`, `Ns 20`);
    mtl.push(`Ke ${num(e[0])} ${num(e[1])} ${num(e[2])}`, `d ${num(mat.opacity ?? 1)}`, `illum 2`);
    for (const [slot, t] of Object.entries(mat.maps || {})) {
      if (t == null) continue;
      const file = textures[t].file;
      if (MTL_KEYS[slot]) mtl.push(`${MTL_KEYS[slot]} ${file}`);
      if (slot === 'normal') mtl.push(`norm ${file}`, `map_Bump ${file}`);
      if (slot === 'bump') mtl.push(`map_Bump ${file}`);
    }
    mtl.push('');
  }
  return { obj: out.join('\n'), mtl: mtl.join('\n') };
}
