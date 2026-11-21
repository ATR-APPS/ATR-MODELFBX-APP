import { getLanguage } from './i18n.js';

export const $ = (id) => document.getElementById(id);

export const formatInt = (n) => Math.round(n).toLocaleString(getLanguage());

export function formatBytes(n) {
  if (n > 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function download(data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
