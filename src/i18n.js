const messages = {
  en: {
    'github.view': 'View on GitHub',
    'language.label': 'Language',
    'drop.title': 'Drop your model here',
    'drop.pick': 'Choose files',
    'drop.change': 'Change',
    'viewer.empty': 'Your model will appear here',
    'viewer.wire': 'Wireframe',
    'viewer.fit': 'Center',
    'viewer.fitTitle': 'Center view',
    'viewer.triangles': '{count} triangles',
    'viewer.optimized': 'Optimized: {after} of {before} triangles',
    'panel.empty': 'Load a model to see its data, textures and export options',
    'stats.meshes': 'Meshes',
    'stats.triangles': 'Triangles',
    'stats.materials': 'Materials',
    'stats.textures': 'Textures',
    'group.model': 'Model',
    'group.textures': 'Textures',
    'group.export': 'Export',
    'group.files': 'Texture files',
    'model.reduce': 'Reduce polygons',
    'model.ratio': 'Percentage of triangles',
    'model.calculating': 'Calculating…',
    'model.result': 'Triangles: {before} → <b>{after}</b> (−{percent}%)',
    'model.failed': 'Could not optimize: {message}',
    'textures.optimize': 'Optimize',
    'textures.maxSize': 'Max size',
    'textures.exact': 'Exact',
    'textures.exactSize': 'Width × height',
    'textures.width': 'Width',
    'textures.height': 'Height',
    'textures.empty': 'This model has no textures. If you have them separately, drop them with the model or in a ZIP.',
    'textures.download': 'Download',
    'download.fbx': 'Download FBX + textures',
    'download.obj': 'Download OBJ + textures',
    'download.glb': 'Download GLB',
    'download.bbmodel': 'Download Blockbench (.bbmodel)',
    'voxel.title': 'Voxelize the model into cubes for Blockbench / Minecraft style',
    'voxel.resolution': 'Resolution (cubes on the longest side)',
    'voxel.result': 'Cubes: <b>{count}</b> · texture {width}×{height}',
    'voxel.detail': 'Texture pixels per cube',
    'viewer.cubes': '{count} cubes',
    'status.creatingBBModel': 'Creating Blockbench model…',
    'download.fbxOnly': 'FBX only',
    'download.objOnly': 'OBJ + MTL only',
    'download.textures': 'Textures only',
    'role.baseColor': 'Diffuse',
    'role.normal': 'Normal',
    'role.bump': 'Bump',
    'role.emissive': 'Emissive',
    'role.occlusion': 'AO',
    'role.metallicRoughness': 'Metal/Rough',
    'role.specularGlossiness': 'Spec/Gloss',
    'role.specular': 'Specular',
    'role.roughness': 'Roughness',
    'role.metalness': 'Metalness',
    'role.opacity': 'Opacity',
    'role.unused': 'Unused',
    'status.reading': 'Reading files…',
    'status.loadingModel': 'Loading model…',
    'status.loadingTextures': 'Loading textures…',
    'status.processingGeometry': 'Processing geometry…',
    'status.extractingTextures': 'Extracting textures…',
    'status.writingFiles': 'Writing files…',
    'status.optimizingTextures': 'Optimizing textures…',
    'status.writingOptimized': 'Writing optimized model…',
    'status.creatingZip': 'Creating ZIP…',
    'status.creatingGlb': 'Creating GLB…',
    'error.prefix': 'Error: {message}',
    'error.noModelSelected': 'Include a model: GLB, glTF, FBX, OBJ, DAE, STL or PLY (or a ZIP that contains one).',
    'error.loadUrl': 'Could not load {url}: {message}',
    'error.glbNoJson': 'The GLB file has no JSON chunk.',
    'error.invalidGltf': 'The file is not a valid GLB or glTF.',
    'error.noModel': 'No model found. Supported formats: GLB, glTF, FBX, OBJ, DAE, STL, PLY.',
    'error.noMesh': 'No mesh was found in the file.',
    'warn.missingTexture': 'Missing texture "{name}": add it next to the model or in a ZIP.',
    'warn.missingFile': 'Missing file "{name}": add it next to the model or in a ZIP.',
    'warn.missingMtl': 'Missing material file "{name}": add it next to the OBJ.',
    'warn.skinned': 'The model has a skeleton: it is exported in its current pose, without bones or skinning.',
    'warn.animations': '{count} animation(s) ignored (they are only kept when exporting to GLB).',
    'warn.pngFailed': 'Could not convert a .{ext} image to PNG.',
    'warn.unsupportedFormat': 'A texture uses the .{ext} format, which 3ds Max may not open.',
  },
  es: {
    'github.view': 'Ver en GitHub',
    'language.label': 'Idioma',
    'drop.title': 'Arrastra tu modelo aquí',
    'drop.pick': 'Elegir archivos',
    'drop.change': 'Cambiar',
    'viewer.empty': 'Tu modelo aparecerá aquí',
    'viewer.wire': 'Ver malla',
    'viewer.fit': 'Centrar',
    'viewer.fitTitle': 'Centrar vista',
    'viewer.triangles': '{count} triángulos',
    'viewer.optimized': 'Optimizado: {after} de {before} triángulos',
    'panel.empty': 'Carga un modelo para ver sus datos, texturas y opciones de exportación',
    'stats.meshes': 'Mallas',
    'stats.triangles': 'Triángulos',
    'stats.materials': 'Materiales',
    'stats.textures': 'Texturas',
    'group.model': 'Modelo',
    'group.textures': 'Texturas',
    'group.export': 'Exportar',
    'group.files': 'Archivos de textura',
    'model.reduce': 'Reducir polígonos',
    'model.ratio': 'Porcentaje de triángulos',
    'model.calculating': 'Calculando…',
    'model.result': 'Triángulos: {before} → <b>{after}</b> (−{percent}%)',
    'model.failed': 'No se pudo optimizar: {message}',
    'textures.optimize': 'Optimizar',
    'textures.maxSize': 'Tamaño máximo',
    'textures.exact': 'Exacto',
    'textures.exactSize': 'Ancho × alto',
    'textures.width': 'Ancho',
    'textures.height': 'Alto',
    'textures.empty': 'Este modelo no tiene texturas. Si las tienes aparte, suéltalas junto al modelo o en un ZIP.',
    'textures.download': 'Descargar',
    'download.fbx': 'Descargar FBX + texturas',
    'download.obj': 'Descargar OBJ + texturas',
    'download.glb': 'Descargar GLB',
    'download.bbmodel': 'Descargar Blockbench (.bbmodel)',
    'voxel.title': 'Convierte el modelo en cubos para Blockbench / estilo Minecraft',
    'voxel.resolution': 'Resolución (cubos en el lado más largo)',
    'voxel.result': 'Cubos: <b>{count}</b> · textura {width}×{height}',
    'voxel.detail': 'Píxeles de textura por cubo',
    'viewer.cubes': '{count} cubos',
    'status.creatingBBModel': 'Creando modelo de Blockbench…',
    'download.fbxOnly': 'Solo FBX',
    'download.objOnly': 'Solo OBJ + MTL',
    'download.textures': 'Solo texturas',
    'role.baseColor': 'Diffuse',
    'role.normal': 'Normal',
    'role.bump': 'Bump',
    'role.emissive': 'Emisivo',
    'role.occlusion': 'AO',
    'role.metallicRoughness': 'Metal/Rough',
    'role.specularGlossiness': 'Spec/Gloss',
    'role.specular': 'Specular',
    'role.roughness': 'Roughness',
    'role.metalness': 'Metalness',
    'role.opacity': 'Opacidad',
    'role.unused': 'Sin uso',
    'status.reading': 'Leyendo archivos…',
    'status.loadingModel': 'Cargando modelo…',
    'status.loadingTextures': 'Cargando texturas…',
    'status.processingGeometry': 'Procesando geometría…',
    'status.extractingTextures': 'Extrayendo texturas…',
    'status.writingFiles': 'Escribiendo archivos…',
    'status.optimizingTextures': 'Optimizando texturas…',
    'status.writingOptimized': 'Escribiendo modelo optimizado…',
    'status.creatingZip': 'Creando ZIP…',
    'status.creatingGlb': 'Creando GLB…',
    'error.prefix': 'Error: {message}',
    'error.noModelSelected': 'Incluye un modelo: GLB, glTF, FBX, OBJ, DAE, STL o PLY (o un ZIP que lo contenga).',
    'error.loadUrl': 'No se pudo cargar {url}: {message}',
    'error.glbNoJson': 'El GLB no contiene JSON.',
    'error.invalidGltf': 'El archivo no es un GLB ni un glTF válido.',
    'error.noModel': 'No se encontró ningún modelo. Formatos: GLB, glTF, FBX, OBJ, DAE, STL, PLY.',
    'error.noMesh': 'No se encontró ninguna malla en el archivo.',
    'warn.missingTexture': 'Falta la textura "{name}": súbela junto al modelo o en un ZIP.',
    'warn.missingFile': 'Falta el archivo "{name}": súbelo junto al modelo o en un ZIP.',
    'warn.missingMtl': 'Falta el archivo de materiales "{name}": súbelo junto al OBJ.',
    'warn.skinned': 'El modelo tiene esqueleto: se exporta en su pose actual, sin huesos ni skinning.',
    'warn.animations': 'Se ignoraron {count} animación(es) (solo se conservan al exportar a GLB).',
    'warn.pngFailed': 'No se pudo convertir una imagen .{ext} a PNG.',
    'warn.unsupportedFormat': 'Una textura viene en formato .{ext}, que 3ds Max quizá no pueda abrir.',
  },
};

const STORAGE_KEY = 'language';
const listeners = new Set();

function detectLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (messages[saved]) return saved;
  } catch {}
  const preferred = typeof navigator === 'undefined'
    ? 'en'
    : navigator.languages?.[0] || navigator.language || 'en';
  return preferred.toLowerCase().startsWith('es') ? 'es' : 'en';
}

let current = detectLanguage();

export const getLanguage = () => current;

export function t(key, params = {}) {
  const text = messages[current][key] ?? messages.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '');
}

export function applyTranslations(root = document) {
  document.documentElement.lang = current;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
}

export function setLanguage(language) {
  if (!messages[language] || language === current) return;
  current = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {}
  applyTranslations();
  for (const listener of listeners) listener(language);
}

export function onLanguageChange(listener) {
  listeners.add(listener);
}

export class LocalizedError extends Error {
  constructor(key, params = {}) {
    super(key);
    this.key = key;
    this.params = params;
  }
}

export const describeError = (error) => (error?.key ? t(error.key, error.params) : error?.message || String(error));
