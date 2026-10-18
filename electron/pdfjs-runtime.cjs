'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

let loaded;
function loadPdfJs() {
  // Resolve the installed ESM entry instead of relying on a CJS facade that
  // disappeared in PDF.js 4. The same path works inside Electron's ASAR.
  if (!loaded) loaded = import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  return loaded;
}

function pdfDocumentOptions() {
  const base = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const directory = name => path.join(base, name).split(path.sep).join('/') + '/';
  return {
    isEvalSupported: false,
    useSystemFonts: true,
    standardFontDataUrl: directory('standard_fonts'),
    cMapUrl: directory('cmaps'),
    cMapPacked: true,
    wasmUrl: directory('wasm'),
  };
}

module.exports = { loadPdfJs, pdfDocumentOptions };
