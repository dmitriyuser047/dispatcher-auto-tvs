#!/usr/bin/env node
'use strict';
// Restore the exact dependencies pinned by tesseract.js-core. No compiler/OCR/tests run here.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const root = path.resolve(__dirname, '../..');
const cache = path.join(root, '.native-ocr');
const source = path.join(cache, 'deps-source');
const archives = path.join(cache, 'downloads', 'dependencies');
const lock = JSON.parse(fs.readFileSync(path.join(__dirname, 'dependencies.lock.json'), 'utf8'));
const offline = process.argv.includes('--offline');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
const within = (base, target) => target === base || target.startsWith(base + path.sep);
function safeTarget(base, relative) {
  if (!relative || relative.includes('\0') || relative.includes('\\') || path.posix.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw Error('Unsafe archive entry: ' + relative);
  const target = path.resolve(base, ...relative.split('/'));
  if (!within(path.resolve(base), target)) throw Error('Archive entry leaves source directory: ' + relative);
  return target;
}
async function download(url, file, expectedSha, expectedLength, git = false) {
  let bytes;
  if (fs.existsSync(file)) {
    bytes = fs.readFileSync(file);
  } else {
    if (offline) throw Error('Offline archive/recipe missing: ' + file);
    console.log('Fetching ' + url);
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw Error('HTTP ' + response.status + ': ' + url);
    const declared = Number(response.headers.get('content-length'));
    if (declared && declared > 64 * 1024 * 1024) throw Error('Archive is unexpectedly large: ' + url);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 64 * 1024 * 1024) throw Error('Archive exceeds size limit: ' + url);
  }
  if (bytes.length !== expectedLength) throw Error('Pinned byte length mismatch: ' + file);
  const actual = git ? gitBlob(bytes) : sha256(bytes);
  if (actual !== expectedSha) throw Error('Pinned ' + (git ? 'Git blob' : 'SHA256') + ' mismatch: ' + file);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes, { flag: 'wx' });
  }
  return bytes;
}
function extract(bytes, directory) {
  // Extract only a fresh destination. Existing compiled sources may have intentional patches.
  if (fs.existsSync(directory)) throw Error('Source directory already exists without a matching marker; inspect it instead of overwriting: ' + directory);
  const zip = new AdmZip(bytes);
  const entries = zip.getEntries();
  if (!entries.length || entries.length > 100000) throw Error('Unexpected ZIP entry count');
  const top = entries[0].entryName.split('/')[0];
  let total = 0;
  const regular = new Map();
  const links = [];
  for (const entry of entries) {
    if (!entry.entryName.startsWith(top + '/')) throw Error('Archive has multiple source roots');
    const relative = entry.entryName.slice(top.length + 1);
    if (!relative) continue;
    const target = safeTarget(directory, relative);
    const mode = (entry.header.attr >>> 16) & 0xffff;
    if ((mode & 0xf000) === 0xa000) { links.push({ entry, relative, target }); continue; }
    if (entry.isDirectory) continue;
    total += entry.header.size;
    if (entry.header.size > 64 * 1024 * 1024 || total > 256 * 1024 * 1024) throw Error('Extracted sources exceed size limit');
    if (regular.has(target)) throw Error('Duplicate source entry: ' + relative);
    regular.set(target, entry);
  }
  fs.mkdirSync(directory, { recursive: true });
  for (const [target, entry] of regular) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData(), { flag: 'wx' });
  }
  // Upstream source symlinks become identical file copies on Windows; never create external links.
  for (const { entry, relative, target } of links) {
    const value = entry.getData().toString('utf8');
    if (value.includes('\\') || path.posix.isAbsolute(value) || /^[a-z]:/i.test(value)) throw Error('Unsafe source symlink: ' + relative);
    const linked = path.resolve(path.dirname(target), ...value.split('/'));
    if (!within(path.resolve(directory), linked) || !regular.has(linked)) throw Error('Unresolved source symlink: ' + relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(linked, target, fs.constants.COPYFILE_EXCL);
  }
}
async function main() {
  if (lock.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(lock.coreCommit)) throw Error('Unsupported dependency lock');
  fs.mkdirSync(source, { recursive: true });
  const manifest = { coreCommit: lock.coreCommit, retrievedAt: new Date().toISOString(), sources: [] };
  for (const item of lock.sources) {
    if (!/^[a-z0-9]+$/.test(item.name) || !/^[a-f0-9]{40}$/.test(item.commit)) throw Error('Invalid locked source');
    const directory = path.join(source, item.name);
    const marker = path.join(directory, '.tvs-pinned-source.json');
    if (fs.existsSync(marker)) {
      const current = JSON.parse(fs.readFileSync(marker, 'utf8'));
      if (current.commit !== item.commit || current.archiveSha256 !== item.archiveSha256) throw Error('Existing source pin mismatch: ' + directory);
      console.log('Pinned source present: ' + item.name);
    } else {
      const bytes = await download(item.archiveUrl, path.join(archives, item.name + '-' + item.commit + '.zip'), item.archiveSha256, item.archiveBytes);
      extract(bytes, directory);
      fs.writeFileSync(marker, JSON.stringify({ commit: item.commit, archiveSha256: item.archiveSha256, sourceArchiveVerified: true }, null, 2) + '\n');
    }
    manifest.sources.push({ ...item, sourceDirectory: path.relative(root, directory) });
  }
  const recipeDir = path.join(source, 'recipes');
  for (const recipe of lock.recipes) {
    const file = path.basename(recipe.path);
    await download('https://raw.githubusercontent.com/' + lock.coreRepository + '/' + lock.coreCommit + '/' + recipe.path,
      path.join(recipeDir, file), recipe.gitBlobSha1, recipe.bytes, true);
  }
  fs.writeFileSync(path.join(source, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(source, 'upstream-pins.json'), JSON.stringify({
    coreCommit: lock.coreCommit, source: lock.pinSource,
    dependencies: lock.sources.map(item => ({ path: 'third_party/' + item.name, mode: '160000', type: 'commit', sha: item.commit })),
    recipes: lock.recipes.map(item => ({ path: item.path, mode: '100755', type: 'blob', sha: item.gitBlobSha1, size: item.bytes }))
  }, null, 2) + '\n');
  console.log('Pinned dependencies and upstream recipes ready in ' + source);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
