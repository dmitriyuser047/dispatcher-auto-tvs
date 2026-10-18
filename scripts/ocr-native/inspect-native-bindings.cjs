'use strict';
// Static inspection only: parses files, never evaluates JavaScript or WASM.
const fs = require('node:fs');
function nativeDefinitions(cpp) {
  // Retain quoted literals while removing actual C++ line/block comments.
  const code = cpp.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, token => token.startsWith('//') || token.startsWith('/*') ? ' ' : token);
  return new Set([...code.matchAll(/\b(emscripten_bind_[A-Za-z0-9_]+)\s*\(/g)].map(m => m[1]));
}
function wasmExports(bytes) {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) throw new Error('Invalid WASM header');
  let offset = 8;
  function uleb() {
    let value = 0, shift = 0;
    for (let i = 0; i < 5; i++) {
      if (offset >= bytes.length) throw new Error('Truncated WASM integer');
      const b = bytes[offset++];
      if (i === 4 && (b & 240) !== 0) throw new Error('WASM integer exceeds u32');
      value += (b & 127) * 2 ** shift;
      if (!(b & 128)) return value;
      shift += 7;
    }
    throw new Error('Invalid WASM integer');
  }
  const result = new Map();
  while (offset < bytes.length) {
    const id = bytes[offset++], length = uleb(), end = offset + length;
    if (end > bytes.length) throw new Error('Truncated WASM section');
    if (id === 7) {
      const count = uleb();
      for (let i = 0; i < count; i++) {
        const size = uleb();
        if (offset + size >= end) throw new Error('Truncated WASM export name');
        const name = bytes.subarray(offset, offset + size).toString('utf8'); offset += size;
        const kind = bytes[offset++], index = uleb();
        if (result.has(name)) throw new Error('Duplicate WASM export');
        result.set(name, { kind, index });
      }
      if (offset !== end) throw new Error('Unexpected WASM export section data');
    }
    offset = end;
  }
  return result;
}
function inspectNativeBindings({ jsPath, wasmPath, cppPath }) {
  const js = fs.readFileSync(jsPath, 'utf8');
  const cpp = fs.readFileSync(cppPath, 'utf8');
  const definitions = nativeDefinitions(cpp);
  const references = new Set([...js.matchAll(/\b_(emscripten_bind_[A-Za-z0-9_]+)/g)].map(m => m[1]));
  const binaryExports = wasmExports(fs.readFileSync(wasmPath));
  const mappings = [];
  for (const name of [...definitions].sort()) {
    // Both unminified Emscripten and Closure's short local names are supported:
    // Module["_binding"]=_binding=wasmExports["short"];
    // e._binding=local=c.short;
    const property = `(?:[A-Za-z_$][\\w$]*\\[(["'])_${name}\\1\\]|[A-Za-z_$][\\w$]*\\._${name})`;
    const expression = new RegExp(`${property}\\s*=\\s*(?:[A-Za-z_$][\\w$]*\\s*=\\s*)?([A-Za-z_$][\\w$]*)(?:\\[(["'])([^"']+)\\3\\]|\\.([A-Za-z_$][\\w$]*))`);
    const match = expression.exec(js);
    if (!match) throw new Error(`Emitted JS has no native export mapping for ${name}`);
    const exportName = match[4] || match[5];
    const entry = binaryExports.get(exportName);
    if (!entry || entry.kind !== 0) throw new Error(`Native JS mapping ${name} -> ${exportName} is not an exported WASM function`);
    mappings.push({ binding: name, exportName, functionIndex: entry.index, wasmExportsObject: match[2] });
  }
  const missingDefinitions = [...references].filter(name => !definitions.has(name));
  if (missingDefinitions.length) throw new Error(`Emitted JS refers to missing native definitions: ${missingDefinitions.join(', ')}`);
  const missingReferences = [...definitions].filter(name => !references.has(name));
  if (missingReferences.length) throw new Error(`Native bindings missing from emitted JS: ${missingReferences.join(', ')}`);
  if (new Set(mappings.map(m => m.wasmExportsObject)).size !== 1) throw new Error('Native bindings map to inconsistent WASM export objects');
  return { inspection: 'static-js-mapping-and-wasm-export-section', javascriptEvaluated: false, wasmInstantiated: false, cppBindingDefinitions: definitions.size, emittedJsBindingReferences: references.size, emittedJsMappings: mappings.length, binaryFunctionExports: [...binaryExports.values()].filter(e => e.kind === 0).length, missingDefinitions, missingReferences, mappings };
}
module.exports = { inspectNativeBindings, wasmExports, nativeDefinitions };
