const path = require('node:path');
const { fileURLToPath } = require('node:url');
const SHARED_PUBLIC = new Set(['bdds.js','registries.js','finance-registry.js','registry-counterparties.js','driver-invoices.js','vehicle-invoices.js','logistics.js','registries.css','finance-registry.css','vehicle-invoices.css'].map(name=>'web/public/'+name));

function trustedPage(url, rootDir, localPort) {
  try {
    const target = new URL(url);
    if (target.search || target.hash) return null;
    if (target.protocol === 'http:' && target.hostname === '127.0.0.1' && target.port === String(localPort) && target.pathname === '/index.html') return 'main';
    if (target.protocol !== 'file:') return null;
    const file = path.resolve(fileURLToPath(target));
    if (file === path.join(rootDir, 'reestr-window.html')) return 'reestr';
    if (file === path.join(rootDir, 'pdf-editor.html')) return 'pdf';
  } catch {}
  return null;
}

function canInvoke(page, channel) {
  if (['main', 'reestr', 'pdf'].includes(page) && ['get-theme', 'set-theme'].includes(channel)) return true;
  if (page === 'pdf') return channel.startsWith('pdf-editor-') || channel.startsWith('pdf-studio-');
  if (page === 'reestr') return ['reestr-window-data', 'reestr-save-rows', 'reestr-build-xlsx', 'reestr-save-xlsx', 'reestr-learn', 'reestr-analytics'].includes(channel);
  return page === 'main' && !channel.startsWith('pdf-editor-') && !channel.startsWith('pdf-studio-') && !['reestr-window-data', 'reestr-save-rows'].includes(channel);
}

function staticFile(rootDir, requestPath) {
  let name;
  try { name = decodeURIComponent(requestPath.split('?')[0]); } catch { return null; }
  if (name === '/') name = '/index.html';
  if (name !== '/index.html' && !/^\/(assets|vendor)\//.test(name) && name !== '/build/icon.ico' && !SHARED_PUBLIC.has(name.slice(1))) return null;
  const resolved = path.resolve(rootDir, '.' + name);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.includes('\0')) return null;
  if (relative !== 'index.html' && relative !== path.join('build', 'icon.ico') && !['assets', 'vendor'].some(dir => relative.startsWith(dir + path.sep)) && !SHARED_PUBLIC.has(relative.split(path.sep).join('/'))) return null;
  return resolved;
}

module.exports = { trustedPage, canInvoke, staticFile };
