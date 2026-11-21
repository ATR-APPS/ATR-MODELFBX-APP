import JSZip from 'jszip';
import { extOf, MODEL_EXTS } from './model/converter.js';

const IGNORED = /(^|\/)(__MACOSX|\.)/;

export function containsModel(files) {
  return [...files].some((file) => {
    const ext = extOf(file.name);
    return ext === 'zip' || MODEL_EXTS.includes(ext);
  });
}

export async function readFiles(list) {
  const files = [];
  for (const file of list) {
    if (extOf(file.name) !== 'zip') {
      files.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      continue;
    }
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || IGNORED.test(entry.name)) continue;
      files.push({ name: entry.name, bytes: await entry.async('uint8array') });
    }
  }
  return files;
}

export async function buildZip(entries, folder) {
  const zip = new JSZip();
  const root = folder ? zip.folder(folder) : zip;
  for (const [path, data] of entries) root.file(path, data);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
