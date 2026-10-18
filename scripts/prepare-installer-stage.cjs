// Materialize only the application's local production dependency graph. No install,
// network, symlinks, or changes to the development node_modules tree are needed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const workspace = path.resolve(__dirname, '..');
const metadata = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
const originalConfig = JSON.parse(JSON.stringify(metadata.build));
// Reuse the local metadata editor when winCodeSign extraction needs symlink rights.
if (fs.existsSync(path.join(workspace, '.builder-cache', 'winCodeSign', 'rcedit-x64.exe'))) {
  originalConfig.win.signAndEditExecutable = false;
  originalConfig.afterPack = path.join(workspace, 'scripts', 'windows-executable.cjs');
}
const stage = fs.mkdtempSync(path.join(workspace, '.builder-stage-' + metadata.version + '-'));
const configPath = path.join(workspace, '.builder-stage-config.json');
const reportPath = path.join(workspace, 'audit', 'installer-stage-' + metadata.version + '.json');
const modules = [], sourceFiles = [], skippedOptional = [];
const top = { source: workspace, target: stage, children: new Map(), parent: null };
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

function inside(base, file) {
  const relative = path.relative(base, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function copyFile(source, destination, ledger) {
  if (!inside(stage, destination)) throw new Error('Stage destination escapes workspace: ' + destination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  const content = fs.readFileSync(source);
  ledger.push({ path: path.relative(workspace, source).replace(/\\/g, '/'), bytes: content.length, sha256: sha256(content) });
}

function copyApplicationTree(source, destination) {
  if (fs.statSync(source).isDirectory()) {
    for (const name of fs.readdirSync(source).sort()) {
      if (name === 'node_modules') continue;
      copyApplicationTree(path.join(source, name), path.join(destination, name));
    }
  } else copyFile(source, destination, sourceFiles);
}

for (const pattern of metadata.build.files) {
  if (typeof pattern !== 'string' || pattern.startsWith('!')) throw new Error('Unsupported application packaging pattern: ' + JSON.stringify(pattern));
  const relative = pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern;
  if (/[*?{}]/.test(relative) || !inside(workspace, path.resolve(workspace, relative))) throw new Error('Unsupported or unsafe packaging path: ' + pattern);
  if (relative.split(/[\\/]/).includes('node_modules')) continue;
  const source = path.join(workspace, relative);
  if (!fs.existsSync(source)) throw new Error('Missing application packaging source: ' + source);
  copyApplicationTree(source, path.join(stage, relative));
}

function resolvePackage(name, parentSource) {
  const requireFromParent = createRequire(path.join(parentSource, 'package.json'));
  try {
    return fs.realpathSync(path.dirname(requireFromParent.resolve(name + '/package.json')));
  } catch (originalError) {
    // The exports map may deliberately hide package.json. Lookup directories still
    // follow Node's dependency resolution, including pnpm's package-local links.
    for (const directory of requireFromParent.resolve.paths(name) || []) {
      const candidate = path.join(directory, name, 'package.json');
      if (fs.existsSync(candidate)) return fs.realpathSync(path.dirname(candidate));
    }
    throw new Error('Installed production dependency missing: ' + name + ' required by ' + parentSource + ' (' + originalError.code + ')');
  }
}

function readPackage(source) { return JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')); }
function dependencyNames(pkg) { return [...new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.optionalDependencies || {})])].sort(); }

function reserve(name, source, owner, optional) {
  const placement = { name, source, target: path.join(owner.target, 'node_modules', name), parent: owner, children: new Map(), package: readPackage(source), optional };
  owner.children.set(name, placement);
  return placement;
}

// Reserve every top-level package first, so their dependencies can reuse them
// independently of traversal order. Never merge two different physical versions.
for (const name of dependencyNames(metadata)) {
  const optional = Object.hasOwn(metadata.optionalDependencies || {}, name);
  try { reserve(name, resolvePackage(name, workspace), top, optional); }
  catch (error) { if (optional) skippedOptional.push({ name, parent: metadata.name, reason: error.message }); else throw error; }
}

function nearestExisting(name, owner) {
  for (let scope = owner; scope; scope = scope.parent) {
    if (scope.children.has(name)) return scope.children.get(name);
  }
  return null;
}

function materialize(placement) {
  if (placement.copied) return;
  placement.copied = true;
  const hash = crypto.createHash('sha256');
  let fileCount = 0, bytes = 0;
  function copyModuleTree(source, destination, relative = '') {
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(source).sort()) {
        if (name !== 'node_modules') copyModuleTree(path.join(source, name), path.join(destination, name), relative ? relative + '/' + name : name);
      }
    } else {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      const content = fs.readFileSync(source);
      hash.update(relative + '\0').update(content).update('\0');
      fileCount++; bytes += content.length;
    }
  }
  copyModuleTree(placement.source, placement.target);
  modules.push({ name: placement.package.name, version: placement.package.version, source: placement.source, destination: path.relative(stage, placement.target).replace(/\\/g, '/'), sourceTreeSha256: hash.digest('hex'), packageJsonSha256: sha256(fs.readFileSync(path.join(placement.source, 'package.json'))), files: fileCount, bytes });
  for (const name of dependencyNames(placement.package)) {
    const optional = Object.hasOwn(placement.package.optionalDependencies || {}, name);
    let source;
    try { source = resolvePackage(name, placement.source); }
    catch (error) { if (optional) { skippedOptional.push({ name, parent: placement.package.name, reason: error.message }); continue; } throw error; }
    const existing = nearestExisting(name, placement);
    if (existing?.source === source) {
      // This also terminates dependency cycles through the exact ancestor package.
      materialize(existing);
      continue;
    }
    materialize(reserve(name, source, placement, optional));
  }
}

for (const placement of top.children.values()) materialize(placement);

const stageMetadata = { ...metadata };
delete stageMetadata.devDependencies;
delete stageMetadata.build;
delete stageMetadata.scripts;
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(stageMetadata, null, 2));
const config = {
  ...originalConfig,
  directories: { ...originalConfig.directories, app: stage, output: path.join(workspace, 'dist'), buildResources: path.join(workspace, 'build') },
  win: { ...originalConfig.win, icon: path.join(workspace, metadata.build.win.icon) },
  electronVersion: metadata.devDependencies.electron,
  npmRebuild: false,
  nodeGypRebuild: false,
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
const report = { createdAt: new Date().toISOString(), version: metadata.version, stagePath: stage, configPath, projectDir: stage, networkUsed: false, devTreeModified: false, modules: modules.sort((a, b) => a.destination.localeCompare(b.destination)), skippedOptional, sourceFiles, stagePackageSha256: sha256(fs.readFileSync(path.join(stage, 'package.json'))), totalModuleFiles: modules.reduce((sum, item) => sum + item.files, 0), totalModuleBytes: modules.reduce((sum, item) => sum + item.bytes, 0) };
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
// Load the actual staged module tree once before the builder sees it.
const requireStage = createRequire(path.join(stage, 'package.json'));
for (const name of ['exceljs', 'tesseract.js', 'adm-zip', 'node-unrar-js', 'iconv-lite', '@napi-rs/canvas']) requireStage(name);
requireStage.resolve('pdfjs-dist/legacy/build/pdf.mjs');
console.log(JSON.stringify({ stagePath: stage, configPath, reportPath, modules: modules.length, totalModuleFiles: report.totalModuleFiles, totalModuleBytes: report.totalModuleBytes, skippedOptional: skippedOptional.length }, null, 2));
