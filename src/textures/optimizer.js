import UPNG from 'upng-js';
import { createCanvas, decodeImage, encodeCanvas, hasTransparency } from './image-tools.js';

const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg' };
const JPG_QUALITY = 0.86;
const JPG_QUALITY_NORMAL = 0.93;

export const textureOptions = {
  optimize: true,
  mode: 'pow2',
  max: 512,
  width: 512,
  height: 512,
};

let cache = new Map();

export function resetTextureCache() {
  cache = new Map();
}

function nearestPowerOfTwo(n, max) {
  let low = 1;
  while (low * 2 <= n) low *= 2;
  const high = low * 2;
  const value = n - low <= high - n ? low : high;
  return Math.max(1, Math.min(value, max));
}

export function targetSize(image) {
  if (!image.width) return null;
  if (!textureOptions.optimize) return [image.width, image.height];
  if (textureOptions.mode === 'exact') return [textureOptions.width, textureOptions.height];
  return [
    nearestPowerOfTwo(image.width, textureOptions.max),
    nearestPowerOfTwo(image.height, textureOptions.max),
  ];
}

export function sizeSuffix() {
  if (!textureOptions.optimize) return '';
  if (textureOptions.mode === 'exact') return `_${textureOptions.width}x${textureOptions.height}`;
  return `_max${textureOptions.max}`;
}

export function maxTextureSize() {
  if (!textureOptions.optimize) return Infinity;
  if (textureOptions.mode === 'exact') return Math.max(textureOptions.width, textureOptions.height);
  return textureOptions.max;
}

async function resample(image, width, height) {
  let source = await decodeImage(image.bytes, image.mime);
  let w = source.width;
  let h = source.height;

  const draw = (from, tw, th) => {
    const canvas = createCanvas(tw, th);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(from, 0, 0, tw, th);
    return canvas;
  };

  while (w / 2 >= width && h / 2 >= height) {
    w = Math.floor(w / 2);
    h = Math.floor(h / 2);
    const next = draw(source, w, h);
    source.close?.();
    source = next;
  }

  const result = draw(source, width, height);
  source.close?.();
  return result;
}

async function optimize(image) {
  const original = { bytes: image.bytes, mime: image.mime, file: image.file };
  const size = targetSize(image);
  if (!textureOptions.optimize || !size || !EXTENSIONS[image.mime]) return original;

  const [width, height] = size;
  const resized = width !== image.width || height !== image.height;
  const canvas = await resample(image, width, height);
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;

  const candidates = [];
  if (hasTransparency(pixels)) {
    const png = UPNG.encode([pixels.buffer], width, height, 0);
    candidates.push({ bytes: new Uint8Array(png), mime: 'image/png' });
  } else {
    const quality = image.roles.includes('normal') ? JPG_QUALITY_NORMAL : JPG_QUALITY;
    candidates.push({ bytes: await encodeCanvas(canvas, 'image/jpeg', quality), mime: 'image/jpeg' });
  }
  if (!resized) candidates.push({ bytes: image.bytes, mime: image.mime });

  const best = candidates.reduce((a, b) => (b.bytes.length < a.bytes.length ? b : a));
  const base = image.file.replace(/\.[^.]+$/, '');
  return { ...best, file: `${base}.${EXTENSIONS[best.mime]}` };
}

export function processTexture(image) {
  const { optimize: enabled, mode, max, width, height } = textureOptions;
  const key = `${image.file}|${enabled}|${mode}|${max}|${width}x${height}`;
  if (!cache.has(key)) cache.set(key, optimize(image));
  return cache.get(key);
}

export function relinkTextures(text, results, quoted) {
  let out = text;
  for (const { from, to } of results) {
    if (from === to) continue;
    out = quoted
      ? out.split(`"textures/${from}"`).join(`"textures/${to}"`)
      : out.split(`textures/${from}\n`).join(`textures/${to}\n`);
  }
  return out;
}
