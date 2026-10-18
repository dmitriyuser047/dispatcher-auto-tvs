'use strict';
// Windows portable tools only; no registry, system PATH, services or package manager.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const workspace = path.resolve(__dirname, '../..');
const work = path.join(workspace, '.native-ocr');
const tools = path.join(work, 'tools');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function run(command, commandArgs, capture = false) {
  const result = spawnSync(command, commandArgs, { cwd: workspace, windowsHide: true, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(command + ' failed (' + result.status + '): ' + (result.stderr || ''));
  return result.stdout || '';
}
async function archive(name, url, sha256, target) {
  const downloads = path.join(tools, 'downloads'); fs.mkdirSync(downloads, { recursive: true });
  const file = path.join(downloads, name);
  if (!fs.existsSync(file)) {
    const response = await fetch(url); if (!response.ok) throw Error('Download failed: ' + response.status + ' ' + url);
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  if (digest(fs.readFileSync(file)) !== sha256) throw Error('Tool archive SHA256 mismatch: ' + name);
  fs.mkdirSync(target, { recursive: true }); run('tar.exe', ['-xf', file, '-C', target]);
  return { name, url, sha256, bytes: fs.statSync(file).size };
}
async function main() {
  if (process.platform !== 'win32') throw Error('This portable tool setup targets Windows x64');
  const emsdk = path.join(tools, 'emsdk');
  const existing = path.join(work, 'toolchain.json');
  const prior = fs.existsSync(existing) ? JSON.parse(fs.readFileSync(existing, 'utf8')) : {};
  const bootstrapPython = option('--python', prior.python);
  if (!bootstrapPython) throw Error('Provide --python <Python 3.8+ executable> for the emsdk installer');
  const buildRoot = path.resolve(option('--build-root', prior.prefix ? path.dirname(prior.prefix) : path.join(work, 'build')));
  if (/[^\x20-\x7e]/.test(buildRoot)) throw Error('Use an ASCII --build-root path, for example D:/tvs-ocr-native-build. Emscripten 4.0.15 cannot embed the PDF font from a Unicode build path on Windows.');
  fs.mkdirSync(tools, { recursive: true }); fs.mkdirSync(buildRoot, { recursive: true });
  const sdkCommit = '389a68bc35dcff7ebae4614e1615099dafda00d1';
  if (!fs.existsSync(emsdk)) run('git', ['-c', 'core.longpaths=true', 'clone', '--branch', '4.0.15', '--depth', '1', 'https://github.com/emscripten-core/emsdk.git', emsdk]);
  if (run('git', ['-C', emsdk, 'rev-parse', 'HEAD'], true).trim() !== sdkCommit) throw Error('Existing emsdk checkout differs from pinned 4.0.15 commit');
  const downloads = [];
  downloads.push(await archive('cmake-3.30.5-windows-x86_64.zip', 'https://github.com/Kitware/CMake/releases/download/v3.30.5/cmake-3.30.5-windows-x86_64.zip', '5ab6e1faf20256ee4f04886597e8b6c3b1bd1297b58a68a58511af013710004b', path.join(tools, 'cmake')));
  downloads.push(await archive('ninja-win-1.12.1.zip', 'https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-win.zip', 'f550fec705b6d6ff58f2db3c374c2277a37691678d6aba463adcbb129108467a', path.join(tools, 'ninja')));
  run(bootstrapPython, [path.join(emsdk, 'emsdk.py'), 'install', '4.0.15']);
  fs.writeFileSync(path.join(tools, 'activation.log'), run(bootstrapPython, [path.join(emsdk, 'emsdk.py'), 'activate', '4.0.15'], true));
  const cmake = path.join(tools, 'cmake/cmake-3.30.5-windows-x86_64/bin/cmake.exe');
  const ninja = path.join(tools, 'ninja/ninja.exe');
  const emroot = path.join(emsdk, 'upstream/emscripten');
  const python = path.join(emsdk, 'python/3.13.3_64bit/python.exe');
  const node = path.join(emsdk, 'node/22.16.0_64bit/bin/node.exe');
  // Emscripten 4.0.15 uses relpath(SDK source, cache build directory). On
  // Windows those directories must be on the same drive. Objects and the
  // dependency prefix can still use the separate buildRoot drive.
  const cache = path.join(emroot, 'cache');
  const result = {
    emsdkVersion: '4.0.15', emsdkCommit: sdkCommit, emscriptenRelease: 'b412b6307e541b93dd93f01b61181e15c17302ec',
    root: workspace, emsdk, cmake, ninja, python, node,
    emcc: path.join(emroot, 'emcc.bat'), emxx: path.join(emroot, 'em++.bat'), emcmake: path.join(emroot, 'emcmake.bat'),
    toolchainFile: path.join(emroot, 'cmake/Modules/Platform/Emscripten.cmake'),
    prefix: path.join(buildRoot, 'prefix'), coreBuild: path.join(buildRoot, 'core-build'), depsBuild: path.join(buildRoot, 'deps-build'),
    pathEntries: [path.dirname(cmake), path.dirname(ninja), emsdk, emroot, path.dirname(python), path.dirname(node)],
    env: { EMSDK: emsdk, EM_CONFIG: path.join(emsdk, '.emscripten'), EMSDK_NODE: node, EMSDK_PYTHON: python, EM_CACHE: cache, EMCC_CORES: '4', PYTHONUTF8: '1' },
  };
  for (const file of [cmake, ninja, python, node, result.emcc, result.toolchainFile]) if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw Error('Missing installed tool: ' + file);
  fs.writeFileSync(existing, JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(tools, 'portable-setup-manifest.json'), JSON.stringify({ at: new Date().toISOString(), downloads, emsdkCommit: sdkCommit }, null, 2) + '\n');
  process.stdout.write('Portable toolchain: ' + existing + '\n');
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
