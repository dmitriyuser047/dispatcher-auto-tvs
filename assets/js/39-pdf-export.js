(function (scope) {
  'use strict';

  const FONT_STYLES = ['regular', 'bold', 'italic', 'boldItalic'];

  function fail(message) { throw new Error(message); }
  function finite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) fail('Некорректное значение: ' + label + '.');
    return number;
  }
  function positive(value, label) {
    const number = finite(value, label);
    if (number <= 0) fail('Значение «' + label + '» должно быть больше нуля.');
    return number;
  }
  function bytesOf(value, label) {
    if (value instanceof Uint8Array) return value.slice();
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    fail('Не удалось прочитать ' + label + '.');
  }
  function decodeBase64(value, label) {
    if (typeof value !== 'string' || !value) fail('Не получены данные: ' + label + '.');
    try {
      const binary = scope.atob(value);
      return Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
    } catch (_) { fail('Повреждены данные: ' + label + '.'); }
  }
  function encodeBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return scope.btoa(binary);
  }
  function overlaps(left, right) {
    const bounds = item => {
      const box = boxOf(item), r = rotation(item.angle);
      const corners = [[0,0],[box.w,0],[0,box.h],[box.w,box.h]].map(([x,y]) => [box.x+r.cos*x-r.sin*y,box.y+r.sin*x+r.cos*y]);
      return [Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))];
    };
    const a=bounds(left), b=bounds(right);
    return a[0]<b[2] && a[2]>b[0] && a[1]<b[3] && a[3]>b[1];
  }
  function inverse(matrix) {
    if (!Array.isArray(matrix) || matrix.length !== 6) fail('Не получены координаты исходной страницы.');
    const values = matrix.map(function (value) { return finite(value, 'преобразование страницы'); });
    const [a, b, c, d, e, f] = values;
    const determinant = a * d - b * c;
    if (Math.abs(determinant) < 1e-10) fail('Невозможно преобразовать координаты страницы.');
    return [d / determinant, -b / determinant, -c / determinant, a / determinant,
      (c * f - d * e) / determinant, (b * e - a * f) / determinant];
  }
  function multiply(left, right) {
    const [a, b, c, d, e, f] = left;
    const [g, h, i, j, k, l] = right;
    return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j,
      a * k + c * l + e, b * k + d * l + f];
  }
  function rotation(angle) {
    const radians = finite(angle == null ? 0 : angle, 'угол') * Math.PI / 180;
    return { cos: Math.cos(radians), sin: Math.sin(radians) };
  }
  function colorOf(value, PDFLib, fallback) {
    const raw = value == null ? fallback : value;
    if (typeof raw !== 'string') fail('Некорректный цвет элемента.');
    let hex = raw.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map(function (part) { return part + part; }).join('');
    if (!/^[0-9a-f]{6}$/i.test(hex)) fail('Некорректный цвет элемента: ' + raw + '.');
    return PDFLib.rgb(parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255);
  }
  function opacityOf(value, fallback) {
    const number = value == null ? fallback : finite(value, 'прозрачность');
    return Math.max(0, Math.min(1, number));
  }
  function boxOf(element) {
    return {
      x: finite(element.x, 'X элемента'), y: finite(element.y, 'Y элемента'),
      w: positive(element.w, 'ширина элемента'), h: positive(element.h, 'высота элемента'),
    };
  }
  function withMatrix(page, matrix, PDFLib, draw) {
    page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix.apply(null, matrix));
    try { draw(); } finally { page.pushOperators(PDFLib.popGraphicsState()); }
  }
  function rectangle(page, element, transform, PDFLib, fallbackColor, fallbackOpacity) {
    const box = boxOf(element);
    const turn = rotation(element.angle);
    const matrix = multiply(transform, [turn.cos, turn.sin, -turn.sin, turn.cos, box.x, box.y]);
    withMatrix(page, matrix, PDFLib, function () {
      const color = colorOf(element.color, PDFLib, fallbackColor);
      const outlined = element.fill === false;
      page.drawRectangle({ x: 0, y: 0, width: box.w, height: box.h,
        color: outlined ? undefined : color,
        borderColor: outlined ? color : undefined,
        borderWidth: outlined ? positive(element.width || 1.5, 'толщина рамки') : 0,
        opacity: opacityOf(element.opacity, fallbackOpacity),
        borderOpacity: opacityOf(element.opacity, fallbackOpacity) });
    });
  }
  function fontStyle(element) {
    if (element.bold && element.italic) return 'boldItalic';
    if (element.bold) return 'bold';
    if (element.italic) return 'italic';
    return 'regular';
  }
  function normalText(value) {
    return String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  }
  function missingGlyph(text, supported) {
    for (const character of text) {
      if (character === '\n') continue;
      const point = character.codePointAt(0);
      if (point < 32 || !supported.has(point)) return character;
    }
    return null;
  }
  function softWrap(text, font, size, maxWidth) {
    const output = [];
    const measured = new Map();
    function width(value) {
      if (!measured.has(value)) measured.set(value, font.widthOfTextAtSize(value, size));
      return measured.get(value);
    }
    for (const paragraph of text.split('\n')) {
      if (!(maxWidth > 0) || !paragraph || width(paragraph) <= maxWidth) {
        output.push(paragraph);
        continue;
      }
      let line = '';
      for (const token of paragraph.match(/\s+|\S+/gu) || []) {
        if (line && width(line + token) > maxWidth) {
          output.push(line.replace(/\s+$/u, ''));
          line = '';
          if (/^\s+$/u.test(token)) continue;
        }
        if (width(token) <= maxWidth) {
          line += token;
          continue;
        }
        for (const character of token) {
          if (line && width(line + character) > maxWidth) {
            output.push(line);
            line = '';
          }
          line += character;
        }
      }
      output.push(line);
    }
    return output.join('\n');
  }

  async function build(options) {
    options = options || {};
    const PDFLib = options.PDFLib || scope.PDFLib;
    if (!PDFLib || !PDFLib.PDFDocument) fail('Модуль сохранения PDF не загружен. Откройте редактор повторно.');
    const sources = options.sources;
    const models = options.pages;
    if (!Array.isArray(sources) || !sources.length) fail('Не загружен исходный PDF.');
    if (!Array.isArray(models) || !models.length) fail('В документе должна оставаться хотя бы одна страница.');

    const sourceDocs = new Map();
    const preparationWarnings=[];
    const usedSources = new Set(models.map(model => model && model.sourceId));
    for (const source of sources) {
      if (!source || source.id == null || sourceDocs.has(source.id)) fail('Неверный список исходных PDF.');
      if (!usedSources.has(source.id)) continue;
      let document;
      try {
        document = await PDFLib.PDFDocument.load(bytesOf(source.bytes, 'исходный PDF'), { updateMetadata: false });
      } catch (error) {
        fail('Не удалось открыть исходный PDF для сохранения: ' + (error && error.message || String(error)));
      }
      const form=document.getForm();
      if(form.getFields().length){
        try{form.flatten({updateFieldAppearances:false});}
        catch(error){fail('Не удалось сохранить вид полей PDF-формы. Сначала сохраните плоскую PDF-копию: '+error.message);}
        preparationWarnings.push('Интерактивные поля документа «'+String(source.name||'PDF')+'» превращены в обычное содержимое страниц для сохранения их внешнего вида.');
      }
      // An annotation's /Dest, file attachment or action can reference an
      // excluded page. Remove these references before copying any page graph.
      // Visible form appearances were flattened above.
      let omittedAnnotations=false;
      for(const page of document.getPages()){
        const annotations=page.node.Annots();
        if(annotations?.size())omittedAnnotations=true;
        page.node.delete(PDFLib.PDFName.of('Annots'));
        page.node.delete(PDFLib.PDFName.of('AA'));
      }
      if(omittedAnnotations)preparationWarnings.push('Ссылки, вложения и комментарии PDF не перенесены в сохранённую копию.');
      sourceDocs.set(source.id, { document: document, pages: document.getPages() });
    }
    // Start with a fresh context. Removing pages from the original page tree
    // leaves their content streams, attachments and metadata in its context,
    // and pdf-lib serializes those objects even when they are no longer shown.
    let document = await PDFLib.PDFDocument.create();
    const ordered = [];

    // Copy only retained pages, before drawing overlays, so duplicates remain
    // independent and no discarded page object enters the output context.
    for (const model of models) {
      const source = model && sourceDocs.get(model.sourceId);
      const index = model && model.sourcePage;
      if (!source || !Number.isInteger(index) || index < 0 || index >= source.pages.length) {
        fail('Не найдена исходная страница документа.');
      }
      const turn = finite(model.rotation == null ? 0 : model.rotation, 'поворот страницы');
      if (Math.abs(turn / 90 - Math.round(turn / 90)) > 1e-8) fail('Страницу можно поворачивать с шагом 90°.');
      const transform = inverse(model.baseTransform);
      positive(model.width, 'ширина страницы');
      positive(model.height, 'высота страницы');
      const [page] = await document.copyPages(source.document, [index]);
      const rawUnit=source.pages[index].node.lookup(PDFLib.PDFName.of('UserUnit'));
      const userUnit=rawUnit instanceof PDFLib.PDFNumber?rawUnit.asNumber():1;
      ordered.push({ model: model, page: page, transform: transform, userUnit,
        nativeRotation: source.pages[index].getRotation().angle });
    }
    for (const entry of ordered) document.addPage(entry.page);
    const omittedSourcePages=[...sourceDocs.entries()].some(([sourceId,source])=>new Set(models.filter(model=>model.sourceId===sourceId).map(model=>model.sourcePage)).size<source.pages.length);
    // A shared /Resources dictionary can include an image from a discarded
    // page. For subsets, rebuild visible retained pages as fresh bitmaps, so
    // neither discarded objects nor unused shared resources can be recovered.
    const rasterizePages=omittedSourcePages?ordered.map((entry,pageIndex)=>({pageIndex,userUnit:entry.userUnit})):[];

    // Rewrite source content before adding replacement text and annotations.
    // An engine failure aborts saving; a visual rectangle is never a fallback.
    const contentChanges = [];
    ordered.forEach((entry, pageIndex) => {
      const redactions = (entry.model.elements || []).filter(e => e?.type === 'redaction');
      for (const element of entry.model.elements || []) {
        if (!element) continue;
        const original = element.original || (element.type === 'mask' ? element : null);
        const area = element.type === 'redaction' ? element : original;
        if (!area) continue;
        // A cleaned scan region is also replaced physically. Native text uses
        // selective glyph removal, OCR/images use a flattened affected page.
        const kind = element.type === 'redaction' || !element.origKey || String(element.origKey).startsWith('ocr:') ? 'redact' : 'text';
        const box=boxOf(area), r=rotation(area.angle), t=entry.transform;
        const quad = [[0,0],[box.w,0],[0,box.h],[box.w,box.h]].flatMap(([x,y]) => {
          const px=box.x+r.cos*x-r.sin*y, py=box.y+r.sin*x+r.cos*y;
          return [t[0]*px+t[2]*py+t[4],t[1]*px+t[3]*py+t[5]];
        });
        contentChanges.push({pageIndex,kind,quadPDF:quad,userUnit:entry.userUnit,fillColor:element.type==='redaction'?(element.color||'#000000'):'#ffffff'});
      }
      entry.redactions = redactions;
    });
    if (contentChanges.length || rasterizePages.length) {
      if (typeof options.api?.processContent !== 'function') fail('Не загружен движок изменения содержимого PDF. Переустановите программу.');
      const base = new Uint8Array(await document.save({updateFieldAppearances:false}));
      const result = await options.api.processContent({bytesBase64:encodeBase64(base),changes:contentChanges,rasterizePages});
      if (!result?.ok || !result.bytesBase64) fail('Содержимое PDF не изменено: '+(result?.error||'движок не вернул документ'));
      if (typeof options.onWarnings === 'function') await options.onWarnings(preparationWarnings.concat(result.warnings||[]), result.pages || []);
      document = await PDFLib.PDFDocument.load(decodeBase64(result.bytesBase64,'обработанный PDF'),{updateMetadata:false});
      if (document.getPageCount() !== ordered.length) fail('Движок изменил число страниц. Сохранение остановлено.');
      ordered.forEach((entry,index) => { entry.page=document.getPage(index);if(entry.userUnit!==1)entry.page.node.set(PDFLib.PDFName.of('UserUnit'),PDFLib.PDFNumber.of(entry.userUnit)); });
    }else if(preparationWarnings.length&&typeof options.onWarnings==='function'){
      await options.onWarnings(preparationWarnings,[]);
    }

    const fontCache = new Map();
    const imageCache = new Map();
    async function getFont(style) {
      if (!FONT_STYLES.includes(style)) fail('Неизвестное начертание шрифта.');
      if (fontCache.has(style)) return fontCache.get(style);
      if (!scope.fontkit || !options.api || typeof options.api.getFont !== 'function') {
        fail('Не загружен шрифт для сохранения русского текста. Откройте редактор повторно.');
      }
      document.registerFontkit(scope.fontkit);
      const result = await options.api.getFont(style);
      if (!result || !result.ok || !result.base64) {
        fail('Не удалось загрузить шрифт для текста: ' + (result && result.error || style) + '.');
      }
      let font;
      try { font = await document.embedFont(decodeBase64(result.base64, 'шрифт'), { subset: true }); }
      catch (error) { fail('Не удалось встроить шрифт: ' + (error && error.message || String(error))); }
      const item = { font: font, supported: new Set(font.getCharacterSet()), name: result.name || style };
      fontCache.set(style, item);
      return item;
    }
    async function getImage(dataUrl) {
      if (typeof dataUrl !== 'string') fail('Не получено изображение для вставки.');
      if (imageCache.has(dataUrl)) return imageCache.get(dataUrl);
      const match = /^data:image\/(png|jpe?g);base64,([\s\S]+)$/i.exec(dataUrl);
      if (!match) fail('Для вставки поддерживаются изображения PNG и JPEG.');
      const bytes = decodeBase64(match[2], 'изображение');
      let image;
      try { image = match[1].toLowerCase() === 'png' ? await document.embedPng(bytes) : await document.embedJpg(bytes); }
      catch (error) { fail('Не удалось сохранить изображение: ' + (error && error.message || String(error))); }
      imageCache.set(dataUrl, image);
      return image;
    }

    for (const entry of ordered) {
      const page = entry.page;
      const transform = entry.transform;
      const rawAnnotations = Array.isArray(entry.model.elements) ? entry.model.elements : [];
      const redactions = entry.redactions || [];
      // True redaction also excludes added text/images and hidden OCR rows.
      // Covers/markers keep their existing visual-only semantics.
      const annotations = rawAnnotations.filter(element => element && (element.type === 'redaction' || !redactions.some(area => overlaps(area,element))));
      const replaced = new Set(annotations.filter(Boolean).map(function (element) { return element.origKey; })
        .filter(function (key) { return key != null; }));
      const hiddenOcr = (Array.isArray(entry.model.ocrLines) ? entry.model.ocrLines : [])
        .filter(function (line) { return line && normalText(line.text).trim() && !replaced.has(line.origKey) && !redactions.some(area => overlaps(area,line)); })
        .map(function (line) {
          const element = Object.assign({}, line, { type: 'text', opacity: 0, bg: null,
            wrap: false, bold: false, italic: false });
          delete element.original;
          return element;
        });
      // Keep untouched OCR searchable without painting a duplicate over the
      // scanned page. Edited or covered OCR rows already have an annotation.
      const elements = annotations.concat(hiddenOcr);

      // Source regions have already been rewritten by PDFium. Do not paint a
      // white patch over native text edits: their original backdrop is intact.
      for (const element of elements) {
        if (!element || element.type === 'mask') continue;
        if (element.type === 'rectangle' || element.type === 'highlight' || element.type === 'redaction') {
          rectangle(page, element, transform, PDFLib,
            element.type === 'highlight' ? '#ffeb3b' : '#ffffff', element.type === 'highlight' ? 0.35 : 1);
        } else if (element.type === 'text') {
          const box = boxOf(element);
          const text = normalText(element.text);
          if (element.bg) rectangle(page, Object.assign({}, element, { color: element.bg }), transform, PDFLib, '#ffffff', 1);
          if (!text) continue;
          const size = positive(element.fontSize, 'размер шрифта');
          const loaded = await getFont(fontStyle(element));
          const absent = missingGlyph(text, loaded.supported);
          if (absent) {
            const point = absent.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
            fail('Шрифт «' + loaded.name + '» не содержит символ «' + absent + '» (U+' + point + '). Замените этот символ в тексте.');
          }
          const wrapped = softWrap(text, loaded.font, size, element.wrap === false ? 0 : box.w);
          const turn = rotation(element.angle);
          const ascent = size * 0.82;
          const baselineX = box.x - turn.sin * ascent;
          const baselineY = box.y + turn.cos * ascent;
          const matrix = multiply(transform, [turn.cos, turn.sin, turn.sin, -turn.cos, baselineX, baselineY]);
          withMatrix(page, matrix, PDFLib, function () {
            page.drawText(wrapped, { x: 0, y: 0, font: loaded.font, size: size,
              lineHeight: size * 1.2, color: colorOf(element.color, PDFLib, '#000000'),
              opacity: opacityOf(element.opacity, 1) });
          });
        } else if (element.type === 'image') {
          const box = boxOf(element);
          const image = await getImage(element.dataUrl);
          const turn = rotation(element.angle);
          // PDF images use a bottom-left origin. Translate to the rotated
          // lower-left corner before drawing so the image stays upright.
          const matrix = multiply(transform, [turn.cos, turn.sin, turn.sin, -turn.cos,
            box.x - turn.sin * box.h, box.y + turn.cos * box.h]);
          withMatrix(page, matrix, PDFLib, function () {
            page.drawImage(image, { x: 0, y: 0, width: box.w, height: box.h,
              opacity: opacityOf(element.opacity, 1) });
          });
        } else if (element.type === 'draw') {
          const points = (Array.isArray(element.points) ? element.points : []).map(function (point) {
            return { x: finite(point.x, 'X линии'), y: finite(point.y, 'Y линии') };
          });
          if (!points.length) continue;
          const thickness = positive(element.width == null ? 2 : element.width, 'толщина линии');
          const color = colorOf(element.color, PDFLib, '#000000');
          withMatrix(page, transform, PDFLib, function () {
            if (points.length === 1) {
              page.drawCircle({ x: points[0].x, y: points[0].y, size: thickness / 2, color: color,
                opacity: opacityOf(element.opacity, 1) });
            } else {
              for (let index = 1; index < points.length; index++) {
                page.drawLine({ start: points[index - 1], end: points[index], thickness: thickness,
                  color: color, opacity: opacityOf(element.opacity, 1), lineCap: PDFLib.LineCapStyle.Round });
              }
            }
          });
        } else {
          fail('Неизвестный элемент PDF: ' + String(element.type || 'без типа') + '.');
        }
      }
      const rotationAngle = ((entry.nativeRotation + Number(entry.model.rotation || 0)) % 360 + 360) % 360;
      page.setRotation(PDFLib.degrees(rotationAngle));
    }
    try { return new Uint8Array(await document.save({ updateFieldAppearances: false })); }
    catch (error) { fail('Не удалось сформировать PDF: ' + (error && error.message || String(error))); }
  }

  scope.PdfEditorExport = Object.freeze({ build: build });
  if(typeof module==='object'&&module.exports)module.exports=scope.PdfEditorExport;
})(typeof window !== 'undefined' ? window : globalThis);
