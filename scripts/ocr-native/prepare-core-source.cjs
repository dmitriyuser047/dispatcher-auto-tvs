'use strict';
// Pinned upstream sources only. Does not install tools, dependencies, or app files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.basename(__dirname) === '.native-ocr' ? __dirname : path.resolve(__dirname, '../..', '.native-ocr');
const workspace = path.dirname(root);
const sources = [
  { name: 'core', repository: 'naptha/tesseract.js-core', commit: 'acffef2b66eb44a31df297e11d905f4b39001068', target: 'source/core' },
  { name: 'tesseract', repository: 'Balearica/tesseract', commit: '2a9c1c49c360462733c386d2a44fcd22c4e21411', target: 'source/core/third_party/tesseract' },
];
const patchNames = ['0001-lstm-dictionary-flags.patch', '0002-clear-image-on-decode-failure.patch', '0003-portable-wasm-build-paths.patch', '0005-glue-overload-dispatch.patch', '0006-lstm-unavailable-legacy-api.patch'];
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
function run(command, args, cwd = workspace) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`${command} exited ${r.status}: ${r.stderr || r.stdout || r.error}`);
  return r.stdout;
}
async function main() {
  const archiveRoot = path.join(root, 'downloads');
  const patchRoot = path.join(root, 'patches');
  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.mkdirSync(patchRoot, { recursive: true });
  const manifestPath = path.join(root, 'source-manifest.json');
  if (fs.existsSync(manifestPath)) throw new Error('Source manifest already exists; existing source is preserved. Reuse it or choose a new source directory.');
  const records = [];
  for (const source of sources) {
    const target = path.join(root, source.target);
    if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`Refusing to overwrite nonempty source: ${target}`);
    const url = `https://codeload.github.com/${source.repository}/tar.gz/${source.commit}`;
    const archive = path.join(archiveRoot, `${source.name}-${source.commit}.tar.gz`);
    if (!fs.existsSync(archive)) {
      process.stdout.write(`Downloading ${source.repository}@${source.commit}\n`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Download ${response.status}: ${url}`);
      fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    }
    const entries = run('tar', ['-tzf', archive]).trim().split(/\r?\n/);
    const archivePrefix = entries[0].split('/')[0];
    if (!archivePrefix || entries.some(e => !e.startsWith(`${archivePrefix}/`) || e.split('/').includes('..') || /^[\\/]|^[a-z]:/i.test(e))) throw new Error('Unsafe source archive path');
    fs.mkdirSync(target, { recursive: true });
    run('tar', ['-xzf', archive, '--strip-components=1', '-C', target]);
    records.push({ ...source, url, archiveSha256: sha256(fs.readFileSync(archive)), archiveBytes: fs.statSync(archive).size });
  }
  const tesseract = path.join(root, sources[1].target);
  const patches = [];
  for (const name of patchNames) {
    const target = path.join(patchRoot, name);
    const bundled = path.join(workspace, 'scripts/ocr-native/patches', name);
    const bytes = fs.readFileSync(fs.existsSync(bundled) ? bundled : target);
    fs.writeFileSync(target, bytes);
    // git apply inside an ignored subdirectory can silently skip paths outside
    // its repository prefix. Always supply the exact repository-relative target.
    const directory = path.relative(workspace, /^000[56]-/.test(name) ? path.join(root, 'source/core') : tesseract).split(path.sep).join('/');
    run('git', ['apply', '--check', `--directory=${directory}`, target]);
    run('git', ['apply', `--directory=${directory}`, target]);
    patches.push({ name, sha256: sha256(bytes), bytes: bytes.length });
  }
  // VERSION is used by Tesseract::Version(); no upstream release number is invented.
  const versionPath = path.join(tesseract, 'VERSION');
  const upstreamVersion = fs.readFileSync(versionPath, 'utf8').trim();
  if (upstreamVersion !== '5.3.0') throw new Error(`Unexpected native version: ${upstreamVersion}`);
  fs.writeFileSync(versionPath, '5.3.0-tvs1\n');
  const versionPatch = 'diff --git a/VERSION b/VERSION\n--- a/VERSION\n+++ b/VERSION\n@@ -1 +1 @@\n-5.3.0\n+5.3.0-tvs1\n';
  const versionPatchName = '0004-tvs-native-version.patch';
  fs.writeFileSync(path.join(patchRoot, versionPatchName), versionPatch);
  patches.push({ name: versionPatchName, sha256: sha256(versionPatch), bytes: Buffer.byteLength(versionPatch) });
  const record = {
    schemaVersion: 1, customBuild: 'tvs-ocr-core-7.0.0-tvs1', upstreamPackageVersion: '7.0.0',
    upstreamNativeVersion: upstreamVersion, nativeVersion: '5.3.0-tvs1', sources: records, patches,
    sourceOnly: true, testsOrOcrRun: false,
    files: ['javascript/glue.js', 'javascript/src/glue.cpp', 'javascript/src/wrapper.cpp', 'javascript/anterior.js', 'third_party/tesseract/src/lstm/lstmrecognizer.cpp', 'third_party/tesseract/src/api/baseapi.cpp', 'third_party/tesseract/CMakeLists.txt', 'third_party/tesseract/VERSION'].map(name => ({ path: name, sha256: sha256(fs.readFileSync(path.join(root, 'source/core', name))) })),
    notes: ['Pinned checked-in WebIDL glue retains custom APIs; patch 0005 fixes only stale overload dispatchers. It is not regenerated from the older IDL.', 'Third-party dependency sources and builds are managed separately.'],
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${manifestPath}\n`);
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
