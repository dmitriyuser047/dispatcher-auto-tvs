'use strict';

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// PDFium owns parsing and content rewriting. No PDF stream is modified by a
// regular expression. Keep this exact runtime version in package.json: the
// experimental redaction API and its behaviour are version specific.
// https://github.com/embedpdf/embed-pdf-viewer/tree/v2/packages/pdfium
// https://github.com/embedpdf/runtime/blob/73a041a5c1aaffa09ebb64f1981ff501cb91a41c/public/fpdf_edit.h
const ENGINE = 'PDFium 2.15.1';
const LIMITS = Object.freeze({ inputBytes: 128 * 1024 * 1024, changes: 5000, pagePixels: 25 * 1000 * 1000 });
const FPDF_PAGEOBJ_TEXT = 1;
const FPDF_PAGEOBJ_FORM = 5;
const FPDF_NO_INCREMENTAL = 2;
const FPDF_ANNOT = 1;

let modulePromise;
let operationQueue = Promise.resolve();

function serial(operation) {
  const result = operationQueue.catch(() => {}).then(operation);
  operationQueue = result.catch(() => {});
  return result;
}

async function getModule() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const packageEntry = require.resolve('@embedpdf/pdfium');
      const packageInfo = JSON.parse(await fs.promises.readFile(path.join(path.dirname(packageEntry), '..', 'package.json'), 'utf8'));
      if (packageInfo.version !== '2.15.1') throw new Error('Редактору нужен PDFium 2.15.1. Переустановите программу с комплектным движком');
      const { init } = require('@embedpdf/pdfium');
      // A local byte buffer works in app.asar and never downloads a CDN asset.
      const wasmBinary = await fs.promises.readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
      const module = await init({ wasmBinary, print: () => {}, printErr: () => {} });
      module.PDFiumExt_Init();
      return module;
    })().catch(error => { modulePromise = null; throw error; });
  }
  return modulePromise;
}

function inputBuffer(value) {
  let bytes;
  if (Buffer.isBuffer(value)) bytes = value;
  else if (value instanceof Uint8Array) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  else if (value instanceof ArrayBuffer) bytes = Buffer.from(new Uint8Array(value));
  else throw new Error('Движку редактирования не переданы байты PDF');
  if (!bytes.length || bytes.length > LIMITS.inputBytes) throw new Error('PDF пуст или превышает ограничение редактора 128 МБ');
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Переданные данные не являются PDF');
  return bytes;
}

function memory(module, size) {
  const ptr = module.pdfium.wasmExports.malloc(size);
  if (!ptr) throw new Error('Недостаточно памяти для обработки PDF');
  return ptr >>> 0;
}

function free(module, ptr) { if (ptr) module.pdfium.wasmExports.free(ptr); }

function putBytes(module, ptr, bytes) {
  // HEAPU8 is refreshed by Emscripten after a memory growth.
  module.pdfium.HEAPU8.set(bytes, ptr);
}

function copyBytes(module, ptr, size) {
  return Buffer.from(module.pdfium.HEAPU8.subarray(ptr, ptr + size));
}

function withDocument(module, bytes, password, operation) {
  const ptr = memory(module, bytes.length);
  let document = 0;
  try {
    putBytes(module, ptr, bytes);
    document = module.FPDF_LoadMemDocument64(ptr, bytes.length, password || '');
    if (!document) {
      const code = module.FPDF_GetLastError();
      throw new Error(code === 4 ? 'Неверный пароль или PDF защищён паролем' : 'PDFium не смог открыть PDF (код ' + code + ')');
    }
    return operation(document);
  } finally {
    if (document) module.FPDF_CloseDocument(document);
    free(module, ptr);
  }
}

function saveFull(module, document) {
  const writer = module.PDFiumExt_OpenFileWriter();
  let ptr = 0;
  if (!writer) throw new Error('Не удалось создать PDF для сохранения');
  try {
    // Explicit full rewrite: the input file and earlier revisions are never
    // appended to the output. The file writer is PDFium's FPDF_FILEWRITE.
    if (!module.FPDF_SaveAsCopy(document, writer, FPDF_NO_INCREMENTAL)) throw new Error('PDFium не смог сохранить изменения');
    const size = module.PDFiumExt_GetFileWriterSize(writer);
    if (!Number.isSafeInteger(size) || size < 8 || size > 512 * 1024 * 1024) throw new Error('Недопустимый размер PDF после обработки');
    ptr = memory(module, size);
    if (module.PDFiumExt_GetFileWriterData(writer, ptr, size) !== size) throw new Error('Не удалось прочитать сохранённый PDF');
    return copyBytes(module, ptr, size);
  } finally {
    free(module, ptr);
    module.PDFiumExt_CloseFileWriter(writer);
  }
}

function rectOf(points) {
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function normaliseChange(change, index) {
  if (!change || !Number.isInteger(change.pageIndex) || change.pageIndex < 0) throw new Error('Не указана страница изменения № ' + (index + 1));
  if (change.kind !== 'text' && change.kind !== 'redact') throw new Error('Неизвестный тип изменения № ' + (index + 1));
  const quad = change.quadPDF == null ? null : change.quadPDF;
  const raw = quad || change.rectPDF;
  if (!Array.isArray(raw) || raw.length !== (quad ? 8 : 4) || raw.some(n => !Number.isFinite(n) || Math.abs(n) > 10000000)) throw new Error('Некорректные координаты изменения № ' + (index + 1));
  const rect = quad ? rectOf(quad) : [Math.min(raw[0], raw[2]), Math.min(raw[1], raw[3]), Math.max(raw[0], raw[2]), Math.max(raw[1], raw[3])];
  if (rect[2] - rect[0] < 0.01 || rect[3] - rect[1] < 0.01) throw new Error('Область изменения № ' + (index + 1) + ' слишком мала');
  if (quad) {
    const polygon = [0, 2, 6, 4].map(i => [quad[i], quad[i + 1]]);
    const turns = polygon.map((a, i) => {
      const b = polygon[(i + 1) % 4], c = polygon[(i + 2) % 4];
      return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    });
    if (!turns.every(turn => turn > 0.0001) && !turns.every(turn => turn < -0.0001)) throw new Error('Четырёхугольник изменения № ' + (index + 1) + ' имеет неверный порядок точек');
  }
  let fillColor = change.fillColor || '#ffffff';
  if (!/^#[0-9a-f]{6}$/i.test(fillColor)) throw new Error('Некорректный цвет очистки области');
  const userUnit = change.userUnit == null ? 1 : Number(change.userUnit);
  if (!Number.isFinite(userUnit) || userUnit <= 0 || userUnit > 75000) throw new Error('Некорректный масштаб единицы страницы PDF');
  return { pageIndex: change.pageIndex, kind: change.kind, rect, quad: quad ? [...quad] : null, fillColor, userUnit };
}

function normaliseRasterPages(value) {
  if(value == null)return [];
  if(!Array.isArray(value)||value.length>LIMITS.changes)throw new Error('Недопустимый список страниц защищённой копии');
  const seen=new Set();
  return value.map(page=>{
    if(!page||!Number.isInteger(page.pageIndex)||page.pageIndex<0||seen.has(page.pageIndex))throw new Error('Некорректная страница защищённой копии');
    const userUnit=page.userUnit==null?1:Number(page.userUnit);
    if(!Number.isFinite(userUnit)||userUnit<=0||userUnit>75000)throw new Error('Некорректный масштаб страницы защищённой копии');
    seen.add(page.pageIndex);return {pageIndex:page.pageIndex,userUnit};
  });
}

function intersects(a, b) { return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]; }

function isAxisAligned(quad) {
  if (!quad) return true;
  const near = (a, b) => Math.abs(a - b) < 0.01;
  // PDF.js order: upper-start, upper-end, lower-start, lower-end.
  return near(quad[1], quad[3]) && near(quad[5], quad[7]) && near(quad[0], quad[4]) && near(quad[2], quad[6]);
}

function objectBounds(module, object, scratch) {
  if (!module.FPDFPageObj_GetBounds(object, scratch, scratch + 4, scratch + 8, scratch + 12)) return null;
  const rect = [0, 4, 8, 12].map(offset => module.pdfium.getValue(scratch + offset, 'float'));
  return rect.every(Number.isFinite) ? rect : null;
}

function nativeTextPossible(module, page, changes) {
  if (changes.some(change => change.kind !== 'text' || !isAxisAligned(change.quad))) return false;
  const scratch = memory(module, 16);
  try {
    for (let i = 0, count = module.FPDFPage_CountObjects(page); i < count; i++) {
      const object = module.FPDFPage_GetObject(page, i);
      if (!object) throw new Error('Не удалось прочитать объект страницы');
      const type = module.FPDFPageObj_GetType(object);
      if (type !== FPDF_PAGEOBJ_FORM && type !== FPDF_PAGEOBJ_TEXT) continue;
      const bounds = objectBounds(module, object, scratch);
      if (!bounds || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) return false;
      if (!changes.some(change => intersects(bounds, change.rect))) continue;
      // v2 cannot regenerate nested forms while selectively protecting their
      // image/path children. Rasterise that page, rather than lose its backdrop.
      if (type === FPDF_PAGEOBJ_FORM) return false;
      const mode = module.FPDFTextObj_GetTextRenderMode(object);
      // Searchable scans commonly contain invisible OCR glyphs over an image.
      // Removing those glyphs alone would leave the old scanned word visible.
      // Clipping text modes also need rebuilding because their graphics-state
      // effect cannot be preserved by selectively protecting background objects.
      if (mode < 0 || mode >= 3) return false;
      const alpha = getter => getter(object, scratch, scratch + 4, scratch + 8, scratch + 12)
        ? module.pdfium.getValue(scratch + 12, 'i32') : null;
      const fillAlpha = alpha(module.FPDFPageObj_GetFillColor);
      const strokeAlpha = alpha(module.FPDFPageObj_GetStrokeColor);
      if ((mode === 0 && fillAlpha === 0) || (mode === 1 && strokeAlpha === 0) ||
          (mode === 2 && fillAlpha === 0 && strokeAlpha === 0)) return false;
    }
    return true;
  } finally { free(module, scratch); }
}

function removeNativeText(module, page, changes) {
  const protectedObjects = [];
  let scratch = 0;
  let quads = 0;
  try {
    scratch = memory(module, 4);
    for (let i = 0, count = module.FPDFPage_CountObjects(page); i < count; i++) {
      const object = module.FPDFPage_GetObject(page, i);
      if (!object || module.FPDFPageObj_GetType(object) === FPDF_PAGEOBJ_TEXT) continue;
      if (!module.FPDFPageObj_GetIsActive(object, scratch)) throw new Error('Не удалось прочитать состояние объекта PDF');
      if (!module.pdfium.getValue(scratch, 'i32')) continue;
      if (!module.FPDFPageObj_SetIsActive(object, false)) throw new Error('Не удалось защитить фон страницы');
      protectedObjects.push(object);
    }
    quads = memory(module, changes.length * 8 * 4);
    changes.forEach((change, index) => {
      const [left, bottom, right, top] = change.rect;
      [left, top, right, top, left, bottom, right, bottom].forEach((value, component) => {
        module.pdfium.setValue(quads + (index * 8 + component) * 4, value, 'float');
      });
    });
    // One pass for all regions prevents later edits from shifting glyph tests.
    const removed = module.EPDFText_RedactInQuads(page, quads, changes.length, false, false);
    if (!removed) throw new Error('В выбранной области исходный текст не найден. Обновите страницу и выделите текст заново');
  } finally {
    // The native redactor skips inactive objects. Reactivate before generating
    // page content, so original images and vector paths stay in the PDF.
    for (const object of protectedObjects) module.FPDFPageObj_SetIsActive(object, true);
    free(module, quads);
    free(module, scratch);
  }
  if (!module.FPDFPage_GenerateContent(page)) throw new Error('Не удалось записать исправленный текст страницы');
}

function devicePoint(module, page, width, height, x, y, scratch) {
  if (!module.FPDF_PageToDevice(page, 0, 0, width, height, 0, x, y, scratch, scratch + 4)) throw new Error('Не удалось преобразовать координаты области PDF');
  return [module.pdfium.getValue(scratch, 'i32'), module.pdfium.getValue(scratch + 4, 'i32')];
}

function signedArea(polygon) {
  return polygon.reduce((sum, point, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function clearPolygon(module, bitmap, polygon, fillColor, width, height) {
  const area = signedArea(polygon);
  if (!Number.isFinite(area) || Math.abs(area) < 0.5) throw new Error('Область очистки не попала на страницу');
  const left = Math.max(0, Math.floor(Math.min(...polygon.map(p => p[0]))) - 1);
  const right = Math.min(width - 1, Math.ceil(Math.max(...polygon.map(p => p[0]))) + 1);
  const top = Math.max(0, Math.floor(Math.min(...polygon.map(p => p[1]))) - 1);
  const bottom = Math.min(height - 1, Math.ceil(Math.max(...polygon.map(p => p[1]))) + 1);
  if (left > right || top > bottom) throw new Error('Область очистки находится за пределами страницы');
  const stride = module.FPDFBitmap_GetStride(bitmap);
  const base = module.FPDFBitmap_GetBuffer(bitmap) >>> 0;
  const red = parseInt(fillColor.slice(1, 3), 16), green = parseInt(fillColor.slice(3, 5), 16), blue = parseInt(fillColor.slice(5, 7), 16);
  const rectangular = polygon.every((a, i) => {
    const b = polygon[(i + 1) % 4];
    return a[0] === b[0] || a[1] === b[1];
  });
  if (rectangular) {
    const argb = (0xff000000 | red << 16 | green << 8 | blue) >>> 0;
    if (!module.FPDFBitmap_FillRect(bitmap, left, top, right - left + 1, bottom - top + 1, argb)) throw new Error('Не удалось очистить область страницы');
    return;
  }
  const direction = Math.sign(area);
  // A one-pixel guard also clears antialiasing at the marked boundary.
  const edges = polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return { x: a[0], y: a[1], dx: b[0] - a[0], dy: b[1] - a[1], tolerance: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
  const heap = module.pdfium.HEAPU8;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      let inside = true;
      for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
        const edge = edges[edgeIndex];
        if (direction * (edge.dx * (y + 0.5 - edge.y) - edge.dy * (x + 0.5 - edge.x)) < -edge.tolerance) { inside = false; break; }
      }
      if (!inside) continue;
      const offset = base + y * stride + x * 4;
      heap[offset] = blue; heap[offset + 1] = green; heap[offset + 2] = red; heap[offset + 3] = 255;
    }
  }
}

function appendRasterPage(module, sourceDocument, sourcePage, destination, pageIndex, changes, requestedUserUnit) {
  let bitmap = 0, page = 0, image = 0, scratch = 0, formInfo = 0, formHandle = 0;
  const originalRotation = module.FPDFPage_GetRotation(sourcePage);
  if (originalRotation < 0 || originalRotation > 3) throw new Error('Не удалось прочитать поворот исходной страницы');
  const userUnit = requestedUserUnit ?? changes[0]?.userUnit ?? 1;
  if (changes.some(change => change.userUnit !== userUnit)) throw new Error('Исправления страницы имеют разный масштаб единиц');
  // Work in the same unrotated PDF user space as PDF.js's baseTransform.
  // Baked-in /Rotate would otherwise be applied a second time by the renderer.
  module.FPDFPage_SetRotation(sourcePage, 0);
  try {
    const pageWidth = module.FPDF_GetPageWidth(sourcePage);
    const pageHeight = module.FPDF_GetPageHeight(sourcePage);
    if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) throw new Error('Некорректный размер страницы PDF');
    const scale = Math.min(300 * userUnit / 72, Math.sqrt(LIMITS.pagePixels / (pageWidth * pageHeight)));
    if (scale / userUnit < 120 / 72) throw new Error('Страница слишком большая для безопасной очистки с сохранением читаемости');
    const width = Math.max(1, Math.ceil(pageWidth * scale));
    const height = Math.max(1, Math.ceil(pageHeight * scale));
    scratch = memory(module, 16);
    if (!module.FPDF_GetPageBoundingBox(sourcePage, scratch)) throw new Error('Не удалось прочитать границы страницы');
    // FS_RECTF stores left, top, right, bottom, unlike our rectPDF arrays.
    const visibleBox = [0, 12, 8, 4].map(offset => module.pdfium.getValue(scratch + offset, 'float'));
    const readBox = getter => {
      if (!getter(sourcePage, scratch, scratch + 4, scratch + 8, scratch + 12)) return null;
      const box = [0, 4, 8, 12].map(offset => module.pdfium.getValue(scratch + offset, 'float'));
      return box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1] ? box : null;
    };
    const mediaBox = readBox(module.FPDFPage_GetMediaBox) || visibleBox;
    const cropBox = readBox(module.FPDFPage_GetCropBox) || visibleBox;
    bitmap = module.FPDFBitmap_Create(width, height, true);
    if (!bitmap) throw new Error('Недостаточно памяти для очистки страницы');
    if (!module.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff)) throw new Error('Не удалось подготовить изображение страницы');
    const formType = module.FPDF_GetFormType(sourceDocument);
    if (formType === 2 || formType === 3) throw new Error('Очистка страниц с XFA-формами не поддерживается. Сначала сохраните обычную PDF-копию формы');
    if (formType === 1) {
      formInfo = module.PDFiumExt_OpenFormFillInfo();
      if (!formInfo) throw new Error('Не удалось прочитать поля PDF-формы');
      formHandle = module.PDFiumExt_InitFormFillEnvironment(sourceDocument, formInfo);
      if (!formHandle) throw new Error('Не удалось подготовить отображение PDF-формы');
      module.FORM_OnAfterLoadPage(sourcePage, formHandle);
    }
    module.FPDF_RenderPageBitmap(bitmap, sourcePage, 0, 0, width, height, 0, FPDF_ANNOT);
    if (formHandle) module.FPDF_FFLDraw(formHandle, bitmap, sourcePage, 0, 0, width, height, 0, FPDF_ANNOT);
    for (const change of changes) {
      const [left, bottom, right, top] = change.rect;
      const quad = change.quad || [left, top, right, top, left, bottom, right, bottom];
      // Polygon perimeter differs from PDF.js's text quad order.
      const polygon = [0, 2, 6, 4].map(i => devicePoint(module, sourcePage, width, height, quad[i], quad[i + 1], scratch));
      clearPolygon(module, bitmap, polygon, change.fillColor, width, height);
    }
    // This page has a newly encoded bitmap only. No original content stream,
    // hidden text, annotations or source image resources are imported for it.
    page = module.FPDFPage_New(destination, pageIndex, mediaBox[2] - mediaBox[0], mediaBox[3] - mediaBox[1]);
    if (!page) throw new Error('Не удалось создать очищенную страницу');
    module.FPDFPage_SetMediaBox(page, ...mediaBox);
    module.FPDFPage_SetCropBox(page, ...cropBox);
    module.FPDFPage_SetRotation(page, originalRotation);
    image = module.FPDFPageObj_NewImageObj(destination);
    if (!image || !module.FPDFImageObj_SetBitmap(0, 0, image, bitmap)) throw new Error('Не удалось записать очищенное изображение страницы');
    module.FPDFPageObj_Transform(image, pageWidth, 0, 0, pageHeight, visibleBox[0], visibleBox[1]);
    module.FPDFPage_InsertObject(page, image);
    image = 0; // ownership transferred to the page
    if (!module.FPDFPage_GenerateContent(page)) throw new Error('Не удалось сохранить очищенную страницу');
    return Math.round(scale * 72 / userUnit);
  } finally {
    if (formHandle) {
      module.FORM_OnBeforeClosePage(sourcePage, formHandle);
      module.PDFiumExt_ExitFormFillEnvironment(formHandle);
    }
    if (formInfo) module.PDFiumExt_CloseFormFillInfo(formInfo);
    if (image) module.FPDFPageObj_Destroy(image);
    if (page) module.FPDF_ClosePage(page);
    free(module, scratch);
    if (bitmap) module.FPDFBitmap_Destroy(bitmap);
    module.FPDFPage_SetRotation(sourcePage, originalRotation);
  }
}

/**
 * Remove source content before pdf-lib adds replacement text/annotations.
 * rectPDF is [left,bottom,right,top] in original PDF user space (not viewport).
 * quadPDF, when given, is [upper-start,upper-end,lower-start,lower-end], x/y.
 * pageIndex addresses the already assembled output document, starting at 0.
 *
 * A text edit keeps top-level text and graphics as vectors. Nested/rotated text
 * and all image/area edits rebuild ONLY the affected page as a bitmap, because
 * the pinned native redactor cannot guarantee selective background protection.
 * Raster pages lose their original text/search layer and live form controls;
 * callers may add a corrected OCR layer after this operation.
 *
 * New document construction discards prior revisions and document attachments,
 * outlines and document metadata. This is not a promise of document-wide
 * sanitisation: copies visible elsewhere still require marking there too.
 */
async function applyContentChangesCore(value, inputChanges, options = {}) {
  const bytes = inputBuffer(value);
  if (!Array.isArray(inputChanges) || inputChanges.length > LIMITS.changes) throw new Error('Недопустимое число исправлений PDF');
  const changes = inputChanges.map(normaliseChange);
  const rasterizePages = normaliseRasterPages(options.rasterizePages);
  if (!changes.length && !rasterizePages.length) return { bytes, warnings: [], pages: [], engine: ENGINE, rewritten: false };
  return serial(async () => {
    const module = await getModule();
    return withDocument(module, bytes, options.password, source => {
      const count = module.FPDF_GetPageCount(source);
      if (!count) throw new Error('В PDF нет страниц');
      if (changes.some(change => change.pageIndex >= count)) throw new Error('Страница исправления отсутствует в PDF');
      if (rasterizePages.some(page => page.pageIndex >= count)) throw new Error('Страница защищённой копии отсутствует в PDF');
      if (module.EPDF_IsEncrypted(source) && !module.EPDF_IsOwnerUnlocked(source) && !(module.FPDF_GetDocPermissions(source) & 8)) throw new Error('Владелец PDF запретил изменение содержимого');
      const destination = module.FPDF_CreateNewDocument();
      if (!destination) throw new Error('Не удалось создать исправленный PDF');
      const pages = [], warnings = [];
      try {
        if (module.FPDF_GetSignatureCount(source) > 0) warnings.push('После изменения документа исходные электронные подписи не сохраняют действительность.');
        for (let index = 0; index < count; index++) {
          const pageChanges = changes.filter(change => change.pageIndex === index);
          const raster = rasterizePages.find(page => page.pageIndex === index);
          if (!pageChanges.length && !raster) {
            if (!module.FPDF_ImportPages(destination, source, String(index + 1), index)) throw new Error('Не удалось сохранить страницу ' + (index + 1));
            continue;
          }
          const page = module.FPDF_LoadPage(source, index);
          if (!page) throw new Error('Не удалось открыть страницу ' + (index + 1));
          let method, dpi;
          try {
            if (!raster && nativeTextPossible(module, page, pageChanges)) {
              removeNativeText(module, page, pageChanges);
              method = 'native-text';
            } else {
              dpi = appendRasterPage(module, source, page, destination, index, pageChanges, raster?.userUnit);
              method = 'raster-content';
            }
          } finally { module.FPDF_ClosePage(page); }
          if (method === 'native-text' && !module.FPDF_ImportPages(destination, source, String(index + 1), index)) throw new Error('Не удалось перенести исправленную страницу ' + (index + 1));
          pages.push({ pageIndex: index, method, ...(dpi ? { dpi, userUnit: raster?.userUnit ?? pageChanges[0].userUnit } : {}) });
        }
        const rasterPages = pages.filter(page => page.method === 'raster-content');
        if (rasterPages.length) warnings.push('Страницы ' + rasterPages.map(page => page.pageIndex + 1).join(', ') + ' сохранены изображением после очистки содержимого; исходный поиск и интерактивные поля этих страниц удалены.');
        if(rasterizePages.length)warnings.push('После удаления или выбора части страниц сохранены только видимые изображения оставшихся страниц до 300 dpi. Общие ресурсы исходного PDF могут содержать данные исключённых страниц, поэтому они не переносятся. Исходный текст перестанет быть редактируемым; для поиска можно выполнить OCR.');
        warnings.push('Исправленный PDF пересобран целиком; закладки, вложения и свойства исходного документа не переносятся.');
        return { bytes: saveFull(module, destination), warnings, pages, engine: ENGINE, rewritten: true };
      } finally { module.FPDF_CloseDocument(destination); }
    });
  });
}

/** Run each job in an isolated worker so PDFium cannot block Electron's UI. */
async function applyContentChanges(value, inputChanges, options = {}) {
  const bytes = inputBuffer(value);
  if (!Array.isArray(inputChanges) || inputChanges.length > LIMITS.changes) throw new Error('Недопустимое число исправлений PDF');
  const changes = inputChanges.map(normaliseChange).map(change => ({
    pageIndex: change.pageIndex,
    kind: change.kind,
    rectPDF: change.rect,
    ...(change.quad ? { quadPDF: change.quad } : {}),
    fillColor: change.fillColor,
    userUnit: change.userUnit,
  }));
  const rasterizePages = normaliseRasterPages(options.rasterizePages);
  if (!changes.length && !rasterizePages.length) return { bytes: Buffer.from(bytes), warnings: [], pages: [], engine: ENGINE, rewritten: false };
  const password = options?.password == null ? '' : String(options.password);
  if (password.length > 1024) throw new Error('Пароль PDF слишком длинный');
  const timeout = Number(options && options.timeoutMs);
  const timeoutMs = Number.isFinite(timeout) ? Math.min(300000, Math.max(1000, timeout)) : 120000;
  // Exact-sized transferable buffers never expose unrelated Buffer-pool data.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { tvsPdfContentWorker: 1, bytes: copy, changes, password, rasterizePages },
      transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let settled = false;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      worker.on('error', () => {});
      worker.terminate().catch(() => {}).finally(() => error ? reject(error) : resolve(result));
    };
    worker.on('message', message => {
      if (!message || message.ok !== true) return finish(new Error(message && message.error || 'Движок PDF завершился с ошибкой'));
      if (!(message.result && message.result.bytes instanceof Uint8Array)) return finish(new Error('Движок PDF вернул повреждённые данные'));
      finish(null, { ...message.result, bytes: Buffer.from(message.result.bytes.buffer, message.result.bytes.byteOffset, message.result.bytes.byteLength) });
    });
    worker.on('error', error => finish(new Error('Ошибка движка PDF: ' + error.message)));
    worker.on('exit', code => finish(new Error('Движок PDF остановился до завершения операции (код ' + code + ')')));
    timer = setTimeout(() => finish(new Error('Обработка PDF превысила допустимое время. Уменьшите число исправляемых страниц')), timeoutMs);
    timer.unref();
  });
}

module.exports = { applyContentChanges, ENGINE, LIMITS };

if (!isMainThread && workerData && workerData.tvsPdfContentWorker === 1) {
  applyContentChangesCore(workerData.bytes, workerData.changes, { password: workerData.password, rasterizePages: workerData.rasterizePages }).then(result => {
    const copy = new Uint8Array(result.bytes.length);
    copy.set(result.bytes);
    parentPort.postMessage({ ok: true, result: { ...result, bytes: copy } }, [copy.buffer]);
    parentPort.close();
  }).catch(error => {
    parentPort.postMessage({ ok: false, error: String(error && error.message || error || 'Ошибка обработки PDF') });
    parentPort.close();
  });
}
