/* Copy page-owned objects together with their references. Source PDF text keys
   remain stable; OCR rows, regions and tables belong to exactly one page. */
(function (scope) {
  'use strict';
  function copyPage(model, options = {}) {
    const nextId = options.nextId || (() => crypto.randomUUID());
    const copy = JSON.parse(JSON.stringify(model));
    const oldPageId = model.id;
    copy.id = options.pageId || nextId();
    const areaIds = new Map([['full:' + oldPageId, 'full:' + copy.id]]);
    const ocrKeys = new Map();
    for (const area of copy.ocrAreas || []) {
      const before = area.id;
      area.id = nextId();
      areaIds.set(before, area.id);
    }
    for (const line of copy.ocrLines || []) {
      const before = line.id, key = line.origKey;
      line.id = 'ocr:' + nextId();
      ocrKeys.set(before, line.id);
      if (key) ocrKeys.set(key, line.id);
      line.origKey = line.id;
      if (areaIds.has(line.areaId)) line.areaId = areaIds.get(line.areaId);
    }
    for (const element of copy.elements || []) {
      element.id = nextId();
      if (ocrKeys.has(element.origKey)) element.origKey = ocrKeys.get(element.origKey);
      if (areaIds.has(element.areaId)) element.areaId = areaIds.get(element.areaId);
    }
    for (const table of copy.ocrTables || []) {
      table.id = nextId();
      if (areaIds.has(table.areaId)) table.areaId = areaIds.get(table.areaId);
    }
    for (const engine of copy.ocrEngines || []) if (areaIds.has(engine.areaId)) engine.areaId = areaIds.get(engine.areaId);
    return copy;
  }
  const api = Object.freeze({ copyPage });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else scope.PdfPageModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
