'use strict';
// Static release-input verification. Does not load a WASM factory or run OCR.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const coreDirectory = path.join(root, 'vendor', 'tesseract-core');
const bindingDirectory = path.join(root, 'vendor', 'tesseract-worker');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const binding = JSON.parse(fs.readFileSync(path.join(bindingDirectory, 'UPSTREAM.json'), 'utf8'));
if (binding.bindingPatchSetVersion !== 2 || binding.nativeCorePolicy !== 'custom-manifest-required; separate native patch ledger') throw Error('Native core requires binding patch set 2');
for (const entry of binding.files) {
  if (entry.file !== path.basename(entry.file) || sha256(fs.readFileSync(path.join(bindingDirectory, entry.file))) !== entry.sha256) throw Error('Binding integrity mismatch: ' + entry.file);
}
const { readManifest, verifyManifestAssets } = require('../vendor/tesseract-worker/get-core.cjs');
const manifestBytes = fs.readFileSync(path.join(coreDirectory, 'manifest.json'));
const manifestSha256 = sha256(manifestBytes);
const manifest = readManifest(coreDirectory, { manifestSha256 });
const files = verifyManifestAssets(coreDirectory, manifest);
// Version() returns a compiled string; its data must also be present in each
// emitted binary. This check reads bytes only and does not instantiate WASM.
for (const variant of files.variants) {
  if (!fs.readFileSync(variant.wasm.path).includes(Buffer.from(manifest.expectedRuntimeVersion, 'utf8'))) throw Error('Native version string missing from binary: ' + variant.id);
}
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const result = {
  version, at: new Date().toISOString(), scope: 'static-native-core-release-inputs', status: 'PASS',
  buildId: manifest.buildId, nativeVersion: manifest.expectedRuntimeVersion,
  manifestSha256, patchSetSha256: manifest.patchSetSha256,
  bindingFilesVerified: binding.files.length, variants: files.variants, patches: files.patches,
  wasmInstantiated: false, ocrRun: false, functionalTestsRun: false,
};
fs.mkdirSync(path.join(root, 'audit'), { recursive: true });
fs.writeFileSync(path.join(root, 'audit', 'native-core-static-' + version + '.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify({ version, status: result.status, buildId: result.buildId, variants: files.variants.map(file => file.id), patches: files.patches.length, manifestSha256 }) + '\n');
