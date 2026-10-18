/* Local ESM PDF.js bootstrap shared by the editor and its document tools. */
(function () {
  'use strict';
  window.pdfjsReady = import(new URL('./node_modules/pdfjs-dist/legacy/build/pdf.mjs', location.href).href)
    .then(library => {
      library.GlobalWorkerOptions.workerSrc = new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', location.href).href;
      window.pdfjsLib = library;
      return library;
    });
  window.pdfjsDocumentOptions = () => ({
    isEvalSupported: false,
    useSystemFonts: true,
    standardFontDataUrl: new URL('./node_modules/pdfjs-dist/standard_fonts/', location.href).href,
    cMapUrl: new URL('./node_modules/pdfjs-dist/cmaps/', location.href).href,
    cMapPacked: true,
    wasmUrl: new URL('./node_modules/pdfjs-dist/wasm/', location.href).href,
  });
})();
