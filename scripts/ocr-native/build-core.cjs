'use strict';
// Native C++/WASM compilation only. Never executes OCR or tests.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { inspectNativeBindings, nativeDefinitions } = require('./inspect-native-bindings.cjs');
const root = path.basename(__dirname) === '.native-ocr' ? __dirname : path.resolve(__dirname, '../..', '.native-ocr');
const source = path.join(root, 'source/core');
const tesseract = path.join(source, 'third_party/tesseract');
const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const toolchainPath = path.resolve(option('--toolchain', path.join(root, 'toolchain.json')));
const toolchain = JSON.parse(fs.readFileSync(toolchainPath, 'utf8'));
const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, 'source-manifest.json'), 'utf8'));
const prefix = path.resolve(option('--prefix', toolchain.prefix));
const buildRoot = path.resolve(option('--build-dir', toolchain.coreBuild));
const output = path.resolve(option('--output', path.join(path.dirname(buildRoot), 'core-output')));
const jobs = Number(option('--jobs', Math.min(4, os.availableParallelism?.() || os.cpus().length)));
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 64) throw new Error('Invalid --jobs value');
if (process.platform === 'win32' && /[^\x20-\x7e]/.test(buildRoot)) throw new Error('The native build directory must use an ASCII Windows path because Emscripten file_packager emits .incbin paths in the host encoding.');
const variants = [
  { id: 'scalar-lstm', name: 'tesseract-core-lstm', sse: false, avx: false, legacy: false },
  { id: 'simd-lstm', name: 'tesseract-core-simd-lstm', sse: true, avx: false, legacy: false },
  { id: 'relaxedsimd-lstm', name: 'tesseract-core-relaxedsimd-lstm', sse: true, avx: true, legacy: false },
];
if (args.includes('--all')) variants.push(...variants.map(v => ({ ...v, id: v.id.replace('-lstm', '-legacy'), name: v.name.replace('-lstm', ''), legacy: true })));
const selected = option('--variants', '').split(',').filter(Boolean);
if (selected.some(id => !variants.some(v => v.id === id))) throw new Error('Unknown variant in --variants');
const selectedVariants = selected.length ? variants.filter(v => selected.includes(v.id)) : variants;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileRecord = (name, base = output) => { const b = fs.readFileSync(path.join(base, name)); return { path: name.split(path.sep).join('/'), bytes: b.length, sha256: sha256(b) }; };
const slash = p => p.split(path.sep).join('/');
const env = { ...process.env, ...toolchain.env };
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
env.PATH = [...toolchain.pathEntries, process.env.PATH || process.env.Path || ''].join(path.delimiter);
env.EMCC_CORES = String(jobs);
env.PYTHONUTF8 = '1';
if (process.platform === 'win32' && env.EM_CACHE && path.parse(path.resolve(env.EM_CACHE)).root.toLowerCase() !== path.parse(path.resolve(toolchain.emsdk)).root.toLowerCase()) {
  throw new Error('Emscripten 4.0.15 system-library builds require EM_CACHE and the SDK source on the same Windows drive. Keep cache in SDK; native object/output directories may stay on D.');
}
async function run(command, commandArgs, logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.createWriteStream(logPath, { flags: 'a' });
  log.write(`\n$ ${JSON.stringify([command, ...commandArgs])}\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { env, cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    function write(chunk) { log.write(chunk); tail = (tail + chunk.toString('utf8')).slice(-14000); }
    child.stdout.on('data', write); child.stderr.on('data', write);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Build command exited ${code}. Log: ${logPath}\n${tail}`)));
  }).finally(() => log.end());
}
function verifySources() {
  if (sourceManifest.nativeVersion !== '5.3.0-tvs1' || sourceManifest.upstreamPackageVersion !== '7.0.0') throw new Error('Unexpected source identity');
  if (!Array.isArray(sourceManifest.files) || sourceManifest.files.length < 8) throw new Error('Missing complete source hash inventory');
  for (const entry of sourceManifest.files) {
    if (fileRecord(entry.path, source).sha256 !== entry.sha256) throw new Error(`Source hash differs from manifest: ${entry.path}`);
  }
  for (const patch of sourceManifest.patches) {
    if (fileRecord(patch.name, path.join(root, 'patches')).sha256 !== patch.sha256) throw new Error(`Patch hash differs: ${patch.name}`);
  }
  // These must be actual Emscripten archives, supplied by the pinned deps build.
  const libraries = ['gif', 'jpeg', 'openlibm', 'png', 'tiff', 'tiffxx', 'webp', 'webpdecoder', 'webpdemux', 'z'];
  for (const name of libraries) {
    const lib = path.join(prefix, 'lib', `lib${name}.a`);
    if (!fs.existsSync(lib) || fs.statSync(lib).size < 8) throw new Error(`Missing native dependency: ${lib}`);
  }
  if (!fs.existsSync(path.join(prefix, 'lib/cmake/leptonica/LeptonicaConfig.cmake'))) throw new Error('Missing installed LeptonicaConfig.cmake');
  if (!fs.readFileSync(path.join(tesseract, 'src/lstm/lstmrecognizer.cpp'), 'utf8').includes('dict_->load_system_dawg.ResetFrom(params);')) throw new Error('Dictionary patch is not applied');
  if (!fs.readFileSync(path.join(tesseract, 'CMakeLists.txt'), 'utf8').includes('${CMAKE_CURRENT_SOURCE_DIR}/../../javascript/glue.js')) throw new Error('Portable CMake patch is not applied');
  if (!fs.readFileSync(path.join(tesseract, 'CMakeLists.txt'), 'utf8').includes('-s ERROR_ON_UNDEFINED_SYMBOLS=1')) throw new Error('Strict native linker checking is not enabled');
  const js = fs.readFileSync(path.join(source, 'javascript/glue.js'), 'utf8');
  const cpp = fs.readFileSync(path.join(source, 'javascript/src/glue.cpp'), 'utf8');
  const refs = new Set([...js.matchAll(/\b_(emscripten_bind_[A-Za-z0-9_]+)/g)].map(m => m[1]));
  const definitions = nativeDefinitions(cpp);
  const missing = [...refs].filter(name => !definitions.has(name));
  if (missing.length) throw new Error(`Missing native WebIDL bindings: ${missing.join(', ')}`);
}
function copyLicenses() {
  const dest = path.join(output, 'licenses'); fs.mkdirSync(dest, { recursive: true });
  for (const [sourceFile, targetName] of [['LICENSE', 'tesseract.js-core-LICENSE.txt'], ['third_party/tesseract/LICENSE', 'tesseract-LICENSE.txt']]) {
    fs.copyFileSync(path.join(source, sourceFile), path.join(dest, targetName));
  }
  const emscriptenLicense = path.join(toolchain.emsdk, 'upstream/emscripten/LICENSE');
  if (fs.existsSync(emscriptenLicense)) fs.copyFileSync(emscriptenLicense, path.join(dest, 'emscripten-LICENSE.txt'));
  for (const [file, name] of [['libc/musl/COPYRIGHT', 'musl-COPYRIGHT.txt'], ['libcxx/LICENSE.TXT', 'libcxx-LICENSE.txt'], ['libcxxabi/LICENSE.TXT', 'libcxxabi-LICENSE.txt'], ['compiler-rt/LICENSE.TXT', 'compiler-rt-LICENSE.txt'], ['libunwind/LICENSE.TXT', 'libunwind-LICENSE.txt']]) {
    const from = path.join(toolchain.emsdk, 'upstream/emscripten/system/lib', file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dest, name));
  }
  const thirdPartyRoot = path.join(root, 'deps-source');
  for (const name of ['giflib', 'leptonica', 'libjpeg', 'libpng', 'libtiff', 'libwebp', 'openlibm', 'zlib']) {
    const dir = path.join(thirdPartyRoot, name);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (/^(LICENSE|COPYING|COPYRIGHT)(\..*)?$/i.test(file) && fs.statSync(path.join(dir, file)).isFile()) fs.copyFileSync(path.join(dir, file), path.join(dest, `${name}-${file}`));
    }
  }
  // The pinned zlib snapshot carries its license in README and zlib.h.
  for (const file of ['README', 'zlib.h']) {
    const from = path.join(thirdPartyRoot, 'zlib', file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dest, `zlib-${file}.txt`));
  }
  for (const [name, file] of [['libjpeg', 'README'], ['leptonica', 'leptonica-license.txt']]) {
    const from = path.join(thirdPartyRoot, name, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dest, `${name}-${file}.txt`));
  }
}
async function main() {
  verifySources();
  fs.mkdirSync(output, { recursive: true });
  const artifacts = [];
  // Configure independent variants concurrently; final compilation and linking
  // remain sequential to fit the four-core host and its available memory.
  const configurations = await Promise.allSettled(selectedVariants.map(async variant => {
    const build = path.join(buildRoot, variant.id);
    const logPath = path.join(root, 'logs', `core-${variant.id}.log`);
    const bool = v => v ? 'ON' : 'OFF';
    const flags = [
      '-S', tesseract, '-B', build, '-G', 'Ninja',
      `-DCMAKE_TOOLCHAIN_FILE=${slash(toolchain.toolchainFile)}`, `-DCMAKE_MAKE_PROGRAM=${slash(toolchain.ninja)}`,
      '-DCMAKE_BUILD_TYPE=Release', `-DCMAKE_PREFIX_PATH=${slash(prefix)}`,
      '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
      `-DLeptonica_DIR=${slash(path.join(prefix, 'lib/cmake/leptonica'))}`,
      '-DWASM_BUILD=ON', '-DBUILD_SHARED_LIBS=OFF', '-DOPENMP_BUILD=OFF', '-DBUILD_TRAINING_TOOLS=OFF', '-DBUILD_TESTS=OFF',
      '-DGRAPHICS_DISABLED=ON', '-DSW_BUILD=OFF', '-DDISABLE_CURL=ON', '-DDISABLE_ARCHIVE=ON', '-DENABLE_NATIVE=OFF', '-DENABLE_LTO=OFF', '-DENABLE_OPENCL=OFF',
      `-DDISABLED_LEGACY_ENGINE=${bool(!variant.legacy)}`, `-DHAVE_SSE4_1=${bool(variant.sse)}`,
      `-DHAVE_AVX=${bool(variant.avx)}`, `-DHAVE_AVX2=${bool(variant.avx)}`, '-DHAVE_AVX512F=OFF',
      '-DCMAKE_C_FLAGS=-O3', '-DCMAKE_CXX_FLAGS=-O3',
    ];
    process.stdout.write(`Configuring ${variant.id} (${variant.name})\n`);
    await run(toolchain.cmake, flags, logPath);
    const versionHeader = fs.readFileSync(path.join(build, 'include/tesseract/version.h'), 'utf8');
    if (!versionHeader.includes('#define TESSERACT_VERSION_STR "5.3.0-tvs1"')) throw new Error('Generated native version differs from required TVS identity');
    const sourceFont = fs.readFileSync(path.join(tesseract, 'tessdata/pdf.ttf'));
    const stagedFont = fs.readFileSync(path.join(build, 'tvs-pdf.ttf'));
    if (!sourceFont.equals(stagedFont)) throw new Error('Staged PDF font differs from pinned source font');
    const fontSha256 = sha256(sourceFont);
    process.stdout.write(`Configured ${variant.id}\n`);
    return { variant, build, logPath, flags, versionHeader, fontSha256 };
  }));
  const configurationErrors = configurations.filter(r => r.status === 'rejected');
  if (configurationErrors.length) throw new AggregateError(configurationErrors.map(r => r.reason), configurationErrors.map(r => r.reason.message).join('\n'));
  for (const configuration of configurations) {
    const { variant, build, logPath, flags, versionHeader, fontSha256 } = configuration.value;
    process.stdout.write(`Compiling ${variant.id}; ${jobs} jobs. ${logPath}\n`);
    const targets = [variant.name];
    if (args.includes('--single-file')) targets.push(`${variant.name}.wasm`);
    await run(toolchain.cmake, ['--build', build, '--target', ...targets, '--parallel', String(jobs)], logPath);
    const names = [`${variant.name}.js`, `${variant.name}.wasm`];
    if (args.includes('--single-file')) names.push(`${variant.name}.wasm.js`);
    for (const name of names) {
      const from = path.join(build, 'bin', name);
      if (!fs.existsSync(from)) throw new Error(`Expected output is missing: ${from}`);
      if (name.endsWith('.wasm') && !fs.readFileSync(from).includes(Buffer.from(sourceManifest.nativeVersion))) throw new Error(`Native binary lacks TVS version identity: ${from}`);
      fs.copyFileSync(from, path.join(output, name));
    }
    const cache = fs.readFileSync(path.join(build, 'CMakeCache.txt'), 'utf8');
    const files = names.map(name => fileRecord(name));
    const bindings = inspectNativeBindings({ jsPath: path.join(output, `${variant.name}.js`), wasmPath: path.join(output, `${variant.name}.wasm`), cppPath: path.join(source, 'javascript/src/glue.cpp') });
    fs.mkdirSync(path.join(output, 'provenance'), { recursive: true });
    const bindingEvidencePath = `provenance/native-bindings-${variant.id}.json`;
    fs.writeFileSync(path.join(output, bindingEvidencePath), `${JSON.stringify(bindings, null, 2)}\n`);
    artifacts.push({ ...variant, flags: { HAVE_SSE4_1: variant.sse, HAVE_AVX: variant.avx, HAVE_AVX2: variant.avx, DISABLED_LEGACY_ENGINE: !variant.legacy, ERROR_ON_UNDEFINED_SYMBOLS: 1 }, files, configureArgs: flags, cacheSha256: sha256(cache), compileCommandsSha256: sha256(fs.readFileSync(path.join(build, 'compile_commands.json'))), versionHeaderSha256: sha256(versionHeader), sourceAndStagedPdfFontSha256: fontSha256, bindingEvidence: fileRecord(bindingEvidencePath), logPath });
    process.stdout.write(`Built ${variant.id}: ${files.map(f => `${f.path} (${f.bytes})`).join(', ')}\n`);
  }
  // Ensure that source/patch files did not change during the native build.
  verifySources();
  copyLicenses();
  const provenance = [];
  fs.mkdirSync(path.join(output, 'provenance'), { recursive: true });
  const dependencyEvidence = path.join(prefix, 'share/tvs-ocr-build');
  if (fs.existsSync(dependencyEvidence)) {
    fs.cpSync(dependencyEvidence, path.join(output, 'provenance/dependencies'), { recursive: true });
    function collect(relative) {
      for (const entry of fs.readdirSync(path.join(output, relative), { withFileTypes: true })) {
        const name = path.join(relative, entry.name);
        if (entry.isDirectory()) collect(name);
        else if (entry.isFile()) provenance.push(fileRecord(name));
      }
    }
    collect('provenance/dependencies');
  }
  for (const [from, name] of [[path.join(root, 'deps-source/source-manifest.json'), 'dependency-source-manifest.json'], [path.join(root, 'deps-source/upstream-pins.json'), 'dependency-upstream-pins.json'], [path.join(toolchain.depsBuild, 'build-result.json'), 'dependency-build-result.json']]) {
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(output, 'provenance', name));
    provenance.push(fileRecord(path.join('provenance', name)));
  }
  const dependencyArchives = fs.readdirSync(path.join(prefix, 'lib')).filter(name => name.endsWith('.a')).sort().map(name => fileRecord(path.join('lib', name), prefix));
  fs.copyFileSync(path.join(root, 'source-manifest.json'), path.join(output, 'source-manifest.json'));
  fs.mkdirSync(path.join(output, 'patches'), { recursive: true });
  for (const p of sourceManifest.patches) fs.copyFileSync(path.join(root, 'patches', p.name), path.join(output, 'patches', p.name));
  const manifest = { schemaVersion: 1, customBuild: sourceManifest.customBuild, packageVersion: '7.0.0', nativeVersion: sourceManifest.nativeVersion, builtAt: new Date().toISOString(), toolchain: { emsdkVersion: toolchain.emsdkVersion, emsdkCommit: toolchain.emsdkCommit, emscriptenRelease: toolchain.emscriptenRelease }, sourceManifestSha256: sha256(fs.readFileSync(path.join(root, 'source-manifest.json'))), buildSchedule: { configure: 'parallel-independent-directories', compileAndLink: 'sequential-variants', compileJobs: jobs, simultaneousFinalLinks: 1 }, provenance, dependencyArchives, variants: artifacts, testsOrOcrRun: false, notes: ['Native code compiled from pinned source with the listed TVS patches.', 'No OCR quality or runtime compatibility claim is inferred from compilation.', 'Models and trained neural weights are unchanged by this native build.'] };
  fs.writeFileSync(path.join(output, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const patches = sourceManifest.patches.map(p => ({ id: p.name.replace(/\.patch$/, ''), path: `patches/${p.name}`, bytes: p.bytes, sha256: p.sha256 })).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const runtimeManifest = {
    schemaVersion: 1, artifactKind: 'tvs-tesseract-wasm-core', buildId: sourceManifest.customBuild,
    expectedRuntimeVersion: sourceManifest.nativeVersion,
    compatibility: { tesseractJs: '7.0.0', upstreamCorePackage: '7.0.0', workerProtocol: 'tesseract-js-node-worker-7', oem: 1, wasmMemory64: false, pthreads: false, abi: 'tesseract-webidl7-tvs1' },
    unsupportedLegacyApis: ['TessBaseAPI.ClearAdaptiveClassifier', 'TessBaseAPI.GetOsdText', 'TessBaseAPI.DetectOS', 'TessBaseAPI.AdaptToWordStr', 'OSResults.print_scores'],
    patches, patchSetSha256: sha256(JSON.stringify(patches.map(({ id, sha256 }) => ({ id, sha256 })))),
    sources: sourceManifest.sources, sourceFiles: sourceManifest.files, toolchain: manifest.toolchain,
    variants: artifacts.map(a => ({
      id: a.id === 'scalar-lstm' ? 'lstm' : a.id, lstmOnly: !a.legacy, available: true,
      requiredFeatures: a.avx ? ['simd', 'relaxed-simd'] : a.sse ? ['simd'] : [],
      js: a.files.find(f => f.path === `${a.name}.js`), wasm: a.files.find(f => f.path === `${a.name}.wasm`),
    })),
    licenses: fs.readdirSync(path.join(output, 'licenses')).map(name => fileRecord(path.join('licenses', name))),
    buildManifest: fileRecord('build-manifest.json'), testsOrOcrRun: false,
  };
  fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`);
  const packageJson = { name: '@tvs/tesseract.js-core', version: '7.0.0-tvs.1', upstreamPackage: 'tesseract.js-core@7.0.0', tvsNativeVersion: sourceManifest.nativeVersion, license: 'Apache-2.0', main: './tesseract-core-lstm.js', files: artifacts.flatMap(a => a.files.map(f => f.path)), tvsManifest: './build-manifest.json' };
  fs.writeFileSync(path.join(output, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  process.stdout.write(`Native artifacts: ${output}\n`);
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
