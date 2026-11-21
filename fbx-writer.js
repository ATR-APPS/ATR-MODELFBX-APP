// Escritor FBX ASCII 7.4 (compatible con 3ds Max / FBX SDK).
// Recibe datos "planos" para que sea independiente de three.js:
//
// meshes:    [{ name, positions: Float32Array (xyz), normals: Float32Array|null,
//               uvs: Float32Array|null, flipV: bool (true si las UV vienen con origen arriba-izq, como glTF),
//               indices: Uint32Array (triángulos), triMaterials: Int32Array (índice global de material por triángulo) }]
// materials: [{ name, color:[r,g,b], opacity, emissive:[r,g,b],
//               maps: { diffuse?, normal?, emissive?, opacity?, specular? } (índices a textures) }]
// textures:  [{ name, file }]   file = ruta relativa al FBX, p.ej. "textures/Body_baseColor.png"

const MAP_PROPERTY = {
  diffuse: 'DiffuseColor',
  normal: 'NormalMap',
  bump: 'Bump',
  emissive: 'EmissiveColor',
  opacity: 'TransparentColor',
  specular: 'SpecularColor',
};

function num(v) {
  if (!Number.isFinite(v)) return '0';
  const r = +v.toFixed(6);
  return r === 0 ? '0' : String(r);
}

function str(s) {
  return String(s).replace(/["\r\n\t\\]/g, '_').replace(/::/g, '_');
}

function arrayBlock(name, values, isInt, ind) {
  const n = values.length;
  const per = 48;
  const lines = [];
  for (let i = 0; i < n; i += per) {
    const end = Math.min(i + per, n);
    const parts = new Array(end - i);
    for (let j = i; j < end; j++) parts[j - i] = isInt ? String(values[j]) : num(values[j]);
    lines.push(parts.join(','));
  }
  // Como el FBX SDK de Autodesk: las líneas de continuación van sin sangría
  return `${ind}${name}: *${n} {\n${ind}\ta: ${lines.join(',\n')}\n${ind}} \n`;
}

// Las posiciones se escriben en centímetros (unidad nativa de FBX).
export function writeFBX({ meshes, materials, textures }, { creator = 'GLB2FBX' } = {}) {
  let nextId = 1000000;
  const id = () => nextId++;
  const out = [];
  const conns = [];

  const matIds = materials.map(() => id());
  const texIds = textures.map(() => id());
  const vidIds = textures.map(() => id());

  // ---------- Header ----------
  const now = new Date();
  out.push(`; FBX 7.4.0 project file
; ----------------------------------------------------

FBXHeaderExtension:  {
	FBXHeaderVersion: 1003
	FBXVersion: 7400
	CreationTimeStamp:  {
		Version: 1000
		Year: ${now.getFullYear()}
		Month: ${now.getMonth() + 1}
		Day: ${now.getDate()}
		Hour: ${now.getHours()}
		Minute: ${now.getMinutes()}
		Second: ${now.getSeconds()}
		Millisecond: 0
	}
	Creator: "${creator}"
}
GlobalSettings:  {
	Version: 1000
	Properties70:  {
		P: "UpAxis", "int", "Integer", "",1
		P: "UpAxisSign", "int", "Integer", "",1
		P: "FrontAxis", "int", "Integer", "",2
		P: "FrontAxisSign", "int", "Integer", "",1
		P: "CoordAxis", "int", "Integer", "",0
		P: "CoordAxisSign", "int", "Integer", "",1
		P: "OriginalUpAxis", "int", "Integer", "",1
		P: "OriginalUpAxisSign", "int", "Integer", "",1
		P: "UnitScaleFactor", "double", "Number", "",1
		P: "OriginalUnitScaleFactor", "double", "Number", "",1
	}
}

Definitions:  {
	Version: 100
	Count: ${1 + meshes.length * 2 + materials.length + textures.length * 2}
	ObjectType: "GlobalSettings" {
		Count: 1
	}
	ObjectType: "Model" {
		Count: ${meshes.length}
	}
	ObjectType: "Geometry" {
		Count: ${meshes.length}
	}
	ObjectType: "Material" {
		Count: ${materials.length}
	}
	ObjectType: "Texture" {
		Count: ${textures.length}
	}
	ObjectType: "Video" {
		Count: ${textures.length}
	}
}

Objects:  {
`);

  // ---------- Meshes ----------
  for (const m of meshes) {
    const geoId = id();
    const modelId = id();
    const name = str(m.name || 'Mesh');
    const idx = m.indices;
    const triCount = idx.length / 3;

    // Materiales locales de este mesh (orden = orden de conexión)
    const localOf = new Map();
    const localMats = [];
    const triMatLocal = new Int32Array(triCount);
    for (let t = 0; t < triCount; t++) {
      const g = m.triMaterials ? m.triMaterials[t] : 0;
      let l = localOf.get(g);
      if (l === undefined) { l = localMats.length; localOf.set(g, l); localMats.push(g); }
      triMatLocal[t] = l;
    }

    const pvi = new Int32Array(idx.length);
    for (let i = 0; i < idx.length; i += 3) {
      pvi[i] = idx[i];
      pvi[i + 1] = idx[i + 1];
      pvi[i + 2] = -idx[i + 2] - 1;
    }

    let s = `	Geometry: ${geoId}, "Geometry::${name}", "Mesh" {\n`;
    s += arrayBlock('Vertices', m.positions, false, '\t\t');
    s += arrayBlock('PolygonVertexIndex', pvi, true, '\t\t');
    s += `\t\tGeometryVersion: 124\n`;

    if (m.normals) {
      const nrm = new Float32Array(idx.length * 3);
      for (let i = 0; i < idx.length; i++) {
        const v = idx[i] * 3;
        nrm[i * 3] = m.normals[v];
        nrm[i * 3 + 1] = m.normals[v + 1];
        nrm[i * 3 + 2] = m.normals[v + 2];
      }
      s += `\t\tLayerElementNormal: 0 {\n\t\t\tVersion: 101\n\t\t\tName: ""\n\t\t\tMappingInformationType: "ByPolygonVertex"\n\t\t\tReferenceInformationType: "Direct"\n`;
      s += arrayBlock('Normals', nrm, false, '\t\t\t');
      s += `\t\t}\n`;
    }

    if (m.uvs) {
      const uv = new Float32Array(m.uvs.length);
      for (let i = 0; i < uv.length; i += 2) {
        uv[i] = m.uvs[i];
        uv[i + 1] = m.flipV ? 1 - m.uvs[i + 1] : m.uvs[i + 1]; // FBX usa V hacia arriba
      }
      s += `\t\tLayerElementUV: 0 {\n\t\t\tVersion: 101\n\t\t\tName: "UVChannel_1"\n\t\t\tMappingInformationType: "ByPolygonVertex"\n\t\t\tReferenceInformationType: "IndexToDirect"\n`;
      s += arrayBlock('UV', uv, false, '\t\t\t');
      s += arrayBlock('UVIndex', idx, true, '\t\t\t');
      s += `\t\t}\n`;
    }

    s += `\t\tLayerElementMaterial: 0 {\n\t\t\tVersion: 101\n\t\t\tName: ""\n\t\t\tMappingInformationType: "ByPolygon"\n\t\t\tReferenceInformationType: "IndexToDirect"\n`;
    s += arrayBlock('Materials', triMatLocal, true, '\t\t\t');
    s += `\t\t}\n`;

    s += `\t\tLayer: 0 {\n\t\t\tVersion: 100\n`;
    if (m.normals) s += `\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementNormal"\n\t\t\t\tTypedIndex: 0\n\t\t\t}\n`;
    s += `\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementMaterial"\n\t\t\t\tTypedIndex: 0\n\t\t\t}\n`;
    if (m.uvs) s += `\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementUV"\n\t\t\t\tTypedIndex: 0\n\t\t\t}\n`;
    s += `\t\t}\n\t}\n`;

    s += `	Model: ${modelId}, "Model::${name}", "Mesh" {
		Version: 232
		Properties70:  {
			P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
			P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
			P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
			P: "DefaultAttributeIndex", "int", "Integer", "",0
		}
		Shading: T
		Culling: "CullingOff"
	}
`;
    out.push(s);

    conns.push(`\tC: "OO",${modelId},0`);
    conns.push(`\tC: "OO",${geoId},${modelId}`);
    for (const g of localMats) conns.push(`\tC: "OO",${matIds[g]},${modelId}`);
  }

  // ---------- Materials ----------
  materials.forEach((mat, i) => {
    const c = mat.color || [1, 1, 1];
    const e = mat.emissive || [0, 0, 0];
    const op = mat.opacity ?? 1;
    out.push(`	Material: ${matIds[i]}, "Material::${str(mat.name)}", "" {
		Version: 102
		ShadingModel: "phong"
		MultiLayer: 0
		Properties70:  {
			P: "ShadingModel", "KString", "", "", "phong"
			P: "DiffuseColor", "Color", "", "A",${num(c[0])},${num(c[1])},${num(c[2])}
			P: "DiffuseFactor", "Number", "", "A",1
			P: "EmissiveColor", "Color", "", "A",${num(e[0])},${num(e[1])},${num(e[2])}
			P: "EmissiveFactor", "Number", "", "A",1
			P: "AmbientColor", "Color", "", "A",0,0,0
			P: "SpecularColor", "Color", "", "A",0.2,0.2,0.2
			P: "SpecularFactor", "Number", "", "A",1
			P: "Shininess", "double", "Number", "",20
			P: "ShininessExponent", "Number", "", "A",20
			P: "TransparencyFactor", "Number", "", "A",${num(1 - op)}
			P: "Opacity", "double", "Number", "",${num(op)}
		}
	}
`);
    for (const [slot, t] of Object.entries(mat.maps || {})) {
      if (t == null || !MAP_PROPERTY[slot]) continue;
      conns.push(`\tC: "OP",${texIds[t]},${matIds[i]}, "${MAP_PROPERTY[slot]}"`);
    }
  });

  // ---------- Textures / Videos ----------
  textures.forEach((tex, i) => {
    const name = str(tex.name);
    const file = str(tex.file);
    out.push(`	Video: ${vidIds[i]}, "Video::${name}", "Clip" {
		Type: "Clip"
		Properties70:  {
			P: "Path", "KString", "XRefUrl", "", "${file}"
		}
		UseMipMap: 0
		Filename: "${file}"
		RelativeFilename: "${file}"
	}
	Texture: ${texIds[i]}, "Texture::${name}", "" {
		Type: "TextureVideoClip"
		Version: 202
		TextureName: "Texture::${name}"
		Properties70:  {
			P: "UVSet", "KString", "", "", "UVChannel_1"
			P: "UseMaterial", "bool", "", "",1
		}
		Media: "Video::${name}"
		FileName: "${file}"
		RelativeFilename: "${file}"
		ModelUVTranslation: 0,0
		ModelUVScaling: 1,1
		Texture_Alpha_Source: "None"
		Cropping: 0,0,0,0
	}
`);
    conns.push(`\tC: "OO",${vidIds[i]},${texIds[i]}`);
  });

  out.push(`}

Connections:  {
${conns.join('\n')}
}
`);
  return out.join('');
}
