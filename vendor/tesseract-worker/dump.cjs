// Modified for TVS OCR binding; see PATCHES.md and UPSTREAM.json.
'use strict';

/**
 *
 * Dump data to a big JSON tree
 *
 * @fileoverview dump data to JSON tree
 * @author Kevin Kwok <antimatter15@gmail.com>
 * @author Guillermo Webster <gui@mit.edu>
 * @author Jerome Wu <jeromewus@gmail.com>
 */
const upstreamRequire = require('./upstream.cjs');
const arrayBufferToBase64 = upstreamRequire('./src/worker-script/utils/arrayBufferToBase64');
const imageType = upstreamRequire('./src/constants/imageType');

/**
 * deindent
 *
 * The generated HOCR is excessively indented, so
 * we get rid of that indentation
 *
 * @name deindent
 * @function deindent string
 * @access public
 */
const deindent = (html) => {
  const lines = html.split('\n');
  if (lines[0].substring(0, 2) === '  ') {
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].substring(0, 2) === '  ') {
        lines[i] = lines[i].slice(2);
      }
    }
  }
  return lines.join('\n');
};

/**
 * dump
 *
 * @name dump
 * @function dump recognition result to a JSON object
 * @access public
 */
module.exports = (TessModule, api, output, options) => {
  const enumToString = (value, prefix) => (
    Object.keys(TessModule)
      .filter((e) => (e.startsWith(`${prefix}_`) && TessModule[e] === value))
      .map((e) => e.slice(prefix.length + 1))[0]
  );

  const getImage = (type) => {
    try {
      api.WriteImage(type, '/image.png');
      const pngBuffer = TessModule.FS.readFile('/image.png');
      const exact = pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength);
      return `data:image/png;base64,${arrayBufferToBase64(exact)}`;
    } finally { try { TessModule.FS.unlink('/image.png'); } catch (_) {} }
  };

  const getPDFInternal = (title, textonly) => {
    const pdfRenderer = new TessModule.TessPDFRenderer('tesseract-ocr', '/', textonly);
    try {
      if (!pdfRenderer.BeginDocument(title) || !pdfRenderer.AddImage(api) || !pdfRenderer.EndDocument()) throw Error('Не удалось сформировать поисковый PDF');
      return TessModule.FS.readFile('/tesseract-ocr.pdf').slice();
    } finally {
      try { TessModule.destroy(pdfRenderer); }
      finally { try { TessModule.FS.unlink('/tesseract-ocr.pdf'); } catch (_) {} }
    }
  };

  return {
    text: output.text ? api.GetUTF8Text() : null,
    hocr: output.hocr ? deindent(api.GetHOCRText()) : null,
    tsv: output.tsv ? api.GetTSVText() : null,
    box: output.box ? api.GetBoxText() : null,
    unlv: output.unlv ? api.GetUNLVText() : null,
    osd: output.osd ? api.GetOsdText() : null,
    pdf: output.pdf ? getPDFInternal(options.pdfTitle ?? 'Tesseract OCR Result', options.pdfTextOnly ?? false) : null,
    imageColor: output.imageColor ? getImage(imageType.COLOR) : null,
    imageGrey: output.imageGrey ? getImage(imageType.GREY) : null,
    imageBinary: output.imageBinary ? getImage(imageType.BINARY) : null,
    confidence: !options.skipRecognition ? api.MeanTextConf() : null,
    blocks: output.blocks && !options.skipRecognition ? JSON.parse(api.GetJSONText()).blocks : null,
    layoutBlocks: output.layoutBlocks && options.skipRecognition
      ? JSON.parse(api.GetJSONText()).blocks : null,
    psm: enumToString(api.GetPageSegMode(), 'PSM'),
    oem: enumToString(api.oem(), 'OEM'),
    version: api.Version(),
    imageTransform: api.__tvsImageTransform || null,
    debug: output.debug ? TessModule.FS.readFile('/debugInternal.txt', { encoding: 'utf8', flags: 'a+' }) : null,
  };
};
