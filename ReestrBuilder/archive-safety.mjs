import path from 'node:path';
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_ARCHIVE_FILES = 2000;
export function safeArchivePath(root, name) {
  const portable = String(name).replace(/\\/g, '/');
  const parts = portable.split('/');
  if (!portable || portable.startsWith('/') || portable.includes('\0') ||
      parts.some(p => p === '..' || p.includes(':') || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Недопустимый путь в архиве: ' + name);
  const result = path.resolve(root, portable);
  const relative = path.relative(path.resolve(root), result);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Файл выходит за пределы папки импорта');
  return result;
}
export function checkArchiveSize(sizes) {
  if (sizes.length > MAX_ARCHIVE_FILES || sizes.some(n => !Number.isSafeInteger(n) || n < 0 || n > MAX_FILE_BYTES) ||
      sizes.reduce((sum, n) => sum + n, 0) > MAX_ARCHIVE_BYTES) throw new Error('Архив слишком большой для импорта (до 2000 файлов, 64 МБ на файл, 512 МБ суммарно)');
}
