const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const ExcelJS = require('exceljs');

const SCHEMA = 'tvs.pdf-project';
const SCHEMA_VERSION = 1;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_PROJECT_BYTES = 256 * 1024 * 1024;
const MAX_MODEL_BYTES = 32 * 1024 * 1024;
const MAX_PAGES = 1000;
const MAX_BLOCKS = 250000;
const MAX_RECOVERY_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_EXPORT_IMAGE_BYTES = 64 * 1024 * 1024;

const message = error => String(error && error.message || error || 'Неизвестная ошибка');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const cleanText = value => String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
const xml = value => cleanText(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const safeTitle = value => cleanText(value || 'Документ').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 100) || 'Документ';
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function decodeBase64(value, limit = MAX_SOURCE_BYTES) {
  if (typeof value !== 'string') throw new Error('Не получены данные файла');
  if (value.length > Math.ceil(limit * 4 / 3) + 2048) throw new Error('Файл превышает допустимый размер');
  const encoded = value.replace(/^data:[^;,]+;base64,/i, '').replace(/\s/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error('Повреждены данные файла');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > limit) throw new Error('Файл превышает допустимый размер');
  return bytes;
}

function assertPdf(bytes) {
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Источник не является PDF');
}

function cloneProject(project) {
  if (!plainObject(project)) throw new Error('Не получен проект документа');
  if (!Array.isArray(project.sources) || !project.sources.length || project.sources.length > MAX_ARCHIVE_ENTRIES - 1) throw new Error('Проект должен содержать исходный PDF');
  const sources = [];
  let sourceBytes = 0;
  const metadata = { ...project, sources: project.sources.map((source, index) => {
    if (!plainObject(source)) throw new Error('Повреждён источник проекта');
    const bytes = decodeBase64(source.bytesBase64);
    assertPdf(bytes);
    sourceBytes += bytes.length;
    if (sourceBytes > MAX_PROJECT_BYTES) throw new Error('Исходные PDF проекта превышают 256 МБ');
    const sourcePath = `sources/${String(index + 1).padStart(4, '0')}.pdf`;
    const copy = { ...source, name: cleanText(source.name || `Источник ${index + 1}.pdf`).slice(0, 255) };
    delete copy.bytesBase64;
    delete copy.path;
    copy.archivePath = sourcePath;
    copy.sha256 = hash(bytes);
    sources.push({ path: sourcePath, bytes });
    return copy;
  }) };
  // The renderer supplies a JSON document, never executable code or disk paths.
  const json = JSON.stringify(metadata);
  if (Buffer.byteLength(json) > MAX_MODEL_BYTES) throw new Error('Модель проекта превышает 32 МБ. Разделите документ на части');
  return { metadata: JSON.parse(json), sources, sourceBytes };
}

async function packProject(project) {
  const normalized = cloneProject(project);
  const manifest = {
    format: SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    title: cleanText(project.title || 'Документ').slice(0, 255),
    limits: { maxSourceBytes: MAX_SOURCE_BYTES, maxProjectBytes: MAX_PROJECT_BYTES, maxModelBytes: MAX_MODEL_BYTES },
    project: normalized.metadata,
  };
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf8'));
  normalized.sources.forEach(source => zip.addFile(source.path, source.bytes));
  const bytes = await zip.toBufferPromise();
  if (bytes.length > MAX_PROJECT_BYTES) throw new Error('Архив проекта превышает 256 МБ');
  return { bytes, manifest, identity: hash(Buffer.from(normalized.sources.map(source => hash(source.bytes)).join('|'))) };
}

function unpackProject(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_PROJECT_BYTES) throw new Error('Проект превышает допустимый размер 256 МБ');
  let zip;
  try { zip = new AdmZip(bytes); } catch (_) { throw new Error('Не удалось прочитать архив проекта'); }
  const entries = zip.getEntries();
  if (!entries.length || entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('Недопустимое количество файлов в проекте');
  const names = new Set();
  let uncompressed = 0;
  for (const entry of entries) {
    const name = entry.entryName;
    if (entry.isDirectory || names.has(name) || (name !== 'manifest.json' && !/^sources\/\d{4}\.pdf$/.test(name))) throw new Error('В проекте обнаружена недопустимая структура');
    names.add(name);
    const size = Number(entry.header.size);
    if (!Number.isFinite(size) || size < 0 || size > (name === 'manifest.json' ? MAX_MODEL_BYTES : MAX_SOURCE_BYTES)) throw new Error('Файл внутри проекта превышает допустимый размер');
    uncompressed += size;
    if (uncompressed > MAX_PROJECT_BYTES + MAX_MODEL_BYTES) throw new Error('Распакованный проект превышает допустимый размер');
  }
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new Error('В проекте нет manifest.json');
  let manifest;
  try { manifest = JSON.parse(manifestEntry.getData().toString('utf8')); } catch (_) { throw new Error('Повреждено описание проекта'); }
  if (manifest.format !== SCHEMA || manifest.schemaVersion !== SCHEMA_VERSION) throw new Error('Версия проекта не поддерживается этим редактором');
  if (!plainObject(manifest.project) || !Array.isArray(manifest.project.sources) || !manifest.project.sources.length) throw new Error('В проекте отсутствуют исходные PDF');
  const used = new Set(['manifest.json']);
  const project = { ...manifest.project, sources: manifest.project.sources.map(source => {
    if (!plainObject(source) || typeof source.archivePath !== 'string' || !/^sources\/\d{4}\.pdf$/.test(source.archivePath) || used.has(source.archivePath)) throw new Error('Повреждена ссылка на PDF проекта');
    const entry = zip.getEntry(source.archivePath);
    if (!entry) throw new Error('В проекте отсутствует исходный PDF');
    used.add(source.archivePath);
    const data = entry.getData();
    if (data.length !== Number(entry.header.size) || data.length > MAX_SOURCE_BYTES) throw new Error('Повреждён размер PDF проекта');
    assertPdf(data);
    if (!/^[a-f0-9]{64}$/.test(source.sha256 || '') || hash(data) !== source.sha256) throw new Error('Контрольная сумма исходного PDF не совпадает');
    const copy = { ...source, bytesBase64: data.toString('base64') };
    delete copy.archivePath;
    delete copy.sha256;
    return copy;
  }) };
  if (used.size !== entries.length) throw new Error('В проекте обнаружены лишние файлы');
  return { project, savedAt: manifest.savedAt, title: cleanText(manifest.title || project.title || 'Документ').slice(0, 255) };
}

function rowsOf(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 10000) throw new Error('В одной таблице более 10 000 строк. Разделите документ');
  let cells = 0;
  let characters = 0;
  return value.map(row => {
    if (!Array.isArray(row) || row.length > 200) throw new Error('Недопустимая структура таблицы');
    return row.map(cell => {
      if (++cells > 500000) throw new Error('В одной таблице более 500 000 ячеек. Разделите документ');
      const text = cleanText(cell);
      if (text.length > 32767) throw new Error('Содержимое ячейки превышает 32 767 символов');
      characters += text.length;
      if (characters > 16 * 1024 * 1024) throw new Error('Текст одной таблицы превышает 16 МБ');
      return text;
    });
  });
}

function decodeImage(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 128) throw new Error('Изображение для Word превышает 16 МБ');
  const found = value.match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!found) throw new Error('Для Word поддерживаются вставленные изображения PNG и JPEG');
  const bytes = decodeBase64(found[2], MAX_IMAGE_BYTES);
  let width = 0, height = 0, extension;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); extension = 'png';
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    extension = 'jpg';
    for (let offset = 2; offset < bytes.length - 1;) {
      if (bytes[offset++] !== 0xff) throw new Error('Повреждено изображение JPEG');
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error('Повреждено изображение JPEG');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) throw new Error('Повреждено изображение JPEG');
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  }
  if (!extension || !width || !height || width > 50000 || height > 50000 || width * height > 50000000) throw new Error('Не удалось прочитать размеры изображения или оно превышает 50 мегапикселей');
  if ((found[1].toLowerCase() === 'png') !== (extension === 'png')) throw new Error('Формат изображения не совпадает с его содержимым');
  return { bytes, width, height, extension };
}

function normalizeExport(payload) {
  if (!plainObject(payload) || !['docx', 'xlsx', 'txt', 'csv'].includes(payload.format)) throw new Error('Выберите формат DOCX, XLSX, TXT или CSV');
  if (!Array.isArray(payload.pages) || !payload.pages.length || payload.pages.length > MAX_PAGES) throw new Error('Для экспорта нужно от 1 до 1000 страниц');
  let count = 0;
  let characters = 0;
  let imageBytes = 0;
  const pages = payload.pages.map((page, index) => {
    if (!plainObject(page)) throw new Error('Повреждена модель страницы');
    const blocks = (Array.isArray(page.blocks) ? page.blocks : []).map(block => {
      if (!plainObject(block) || ++count > MAX_BLOCKS) throw new Error('В документе слишком много текстовых блоков');
      if (block.kind === 'image') {
        if (payload.format !== 'docx') return { kind: 'image', x: finite(block.x, 0), y: finite(block.y, 0) };
        const image = decodeImage(block.dataUrl);
        imageBytes += image.bytes.length;
        if (imageBytes > MAX_EXPORT_IMAGE_BYTES) throw new Error('Изображения для Word превышают суммарно 64 МБ');
        return { kind: 'image', image, x: finite(block.x, 0), y: finite(block.y, 0), w: Math.max(1, finite(block.w, image.width * .75)), h: Math.max(1, finite(block.h, image.height * .75)), alt: cleanText(block.alt || 'Вставленное изображение').slice(0, 255) };
      }
      const text = cleanText(block.text);
      characters += text.length;
      const rows = rowsOf(block.rows);
      rows.forEach(row => row.forEach(cell => { characters += cell.length; }));
      if (characters > 16 * 1024 * 1024) throw new Error('Экспортируемый текст превышает 16 МБ');
      return { text, x: finite(block.x, 0), y: finite(block.y, 0), w: finite(block.w, 0), h: finite(block.h, 0), fontSize: Math.max(6, Math.min(72, finite(block.fontSize, 11))), bold: !!block.bold, italic: !!block.italic, kind: block.kind === 'table' ? 'table' : 'text', rows };
    }).sort((left, right) => left.y - right.y || left.x - right.x);
    const tables = (Array.isArray(page.tables) ? page.tables : []).map(table => {
      if (!plainObject(table) || ++count > MAX_BLOCKS) throw new Error('Повреждена таблица');
      const rows = rowsOf(table.rows);
      rows.forEach(row => row.forEach(cell => { characters += cell.length; }));
      if (characters > 16 * 1024 * 1024) throw new Error('Экспортируемый текст превышает 16 МБ');
      return { rows, title: cleanText(table.title).slice(0, 255) };
    });
    return { number: Math.max(1, Math.floor(finite(page.number, index + 1))), width: Math.max(72, Math.min(14400, finite(page.width, 595.28))), height: Math.max(72, Math.min(14400, finite(page.height, 841.89))), blocks, tables };
  });
  return { format: payload.format, title: cleanText(payload.title || 'Документ').slice(0, 255), pages };
}

function paragraph(text, style = {}) {
  const size = Math.round((style.fontSize || 11) * 2);
  const runs = cleanText(text).split('\n').map((line, index) => `${index ? '<w:r><w:br/></w:r>' : ''}<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${style.bold ? '<w:b/>' : ''}${style.italic ? '<w:i/>' : ''}</w:rPr><w:t xml:space="preserve">${xml(line)}</w:t></w:r>`).join('');
  const indent = Math.max(0, Math.min(2880, Math.round((style.x || 0) * 20) - 720));
  return `<w:p><w:pPr><w:spacing w:after="100"/><w:ind w:left="${indent}"/></w:pPr>${runs || '<w:r><w:t></w:t></w:r>'}</w:p>`;
}

function wordTable(rows, width) {
  if (!rows.length) return '';
  const columns = Math.max(1, ...rows.map(row => row.length));
  const cellWidth = Math.max(1, Math.floor(width / columns));
  const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${cellWidth}"/>`).join('');
  const body = rows.map((row, index) => `<w:tr>${index === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${Array.from({ length: columns }, (_, col) => `<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/>${index === 0 ? '<w:shd w:fill="EDF1F7"/>' : ''}</w:tcPr>${paragraph(row[col] || '', { fontSize: 10 })}</w:tc>`).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(edge => `<w:${edge} w:val="single" w:sz="4" w:color="CBD5E1"/>`).join('')}</w:tblBorders><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>${paragraph('')}`;
}

function wordImage(block, page, drawingId) {
  const availableWidth = Math.max(1, page.width - 72), availableHeight = Math.max(1, page.height - 72);
  const scale = Math.min(1, availableWidth / block.w, availableHeight / block.h);
  const cx = Math.round(block.w * scale * 12700), cy = Math.round(block.h * scale * 12700);
  const indent = Math.max(0, Math.min(Math.round((availableWidth - block.w * scale) * 20), Math.round((block.x - 36) * 20)));
  return `<w:p><w:pPr><w:spacing w:after="100"/><w:ind w:left="${indent}"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${drawingId}" name="Изображение ${drawingId}" descr="${xml(block.alt)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image${drawingId}.${block.image.extension}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="img${drawingId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

async function createDocx(model) {
  const zip = new AdmZip();
  const parts = [];
  const images = [];
  model.pages.forEach((page, index) => {
    // Word limits a page edge to 22 inches. Large engineering PDFs still
    // export with their orientation, scaled into a valid Word page size.
    const scale = Math.min(1, 1584 / Math.max(page.width, page.height));
    const width = Math.max(2880, Math.round(page.width * scale * 20));
    const height = Math.max(2880, Math.round(page.height * scale * 20));
    const section = `<w:sectPr>${index < model.pages.length - 1 ? '<w:type w:val="nextPage"/>' : ''}<w:pgSz w:w="${width}" w:h="${height}"${width > height ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>`;
    page.blocks.forEach(block => {
      if (block.kind === 'image') {
        images.push(block.image);
        const drawingId = images.length;
        zip.addFile(`word/media/image${drawingId}.${block.image.extension}`, block.image.bytes);
        parts.push(wordImage(block, { width: width / 20, height: height / 20 }, drawingId));
      } else if (block.kind === 'table' && block.rows.length) parts.push(wordTable(block.rows, Math.max(240, width - 1440)));
      else if (block.text) parts.push(paragraph(block.text, block));
    });
    page.tables.forEach(table => {
      if (table.title) parts.push(paragraph(table.title, { bold: true }));
      parts.push(wordTable(table.rows, Math.max(240, width - 1440)));
    });
    if (!page.blocks.length && !page.tables.length) parts.push(paragraph(''));
    parts.push(index < model.pages.length - 1 ? `<w:p><w:pPr>${section}</w:pPr></w:p>` : section);
  });
  const add = (name, body) => zip.addFile(name, Buffer.from(body, 'utf8'));
  add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
  add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
  add('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${parts.join('')}</w:body></w:document>`);
  add('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${images.map((image, index) => `<Relationship Id="img${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${index + 1}.${image.extension}"/>`).join('')}</Relationships>`);
  add('word/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>');
  const now = new Date().toISOString();
  add('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(model.title)}</dc:title><dc:creator>Диспетчер ТВС</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  add('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Диспетчер ТВС — PDF</Application><Pages>${model.pages.length}</Pages></Properties>`);
  return zip.toBufferPromise();
}

function pageTables(page) {
  return [...page.blocks.filter(block => block.kind === 'table' && block.rows.length).map(block => ({ title: '', rows: block.rows })), ...page.tables];
}

async function createXlsx(model) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Диспетчер ТВС';
  workbook.title = model.title;
  workbook.created = new Date();
  const textSheet = workbook.addWorksheet('Текст', { views: [{ state: 'frozen', ySplit: 1 }] });
  textSheet.addRow(['Страница', 'Текст', 'X', 'Y', 'Ширина', 'Высота']);
  textSheet.columns = [{ width: 12 }, { width: 100 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }];
  for (let index = 0; index < model.pages.length; index++) {
    const page = model.pages[index];
    const sheet = workbook.addWorksheet(`Страница ${index + 1}`, { pageSetup: { orientation: page.width > page.height ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const tables = pageTables(page);
    tables.forEach((table, tableIndex) => {
      if (tableIndex) sheet.addRow([]);
      if (table.title) sheet.addRow([table.title]).font = { bold: true, size: 12 };
      table.rows.forEach((row, rowIndex) => {
        const added = sheet.addRow(row);
        added.eachCell({ includeEmpty: true }, cell => {
          cell.numFmt = '@';
          cell.alignment = { vertical: 'top', wrapText: true };
          cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
          if (!rowIndex) { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF1F7' } }; }
        });
      });
    });
    page.blocks.filter(block => block.kind !== 'table' || !block.rows.length).forEach(block => {
      if (!block.text) return;
      // Text remains text: invoice numbers, INN and leading zeroes are retained.
      for (let offset = 0; offset < block.text.length; offset += 32767) {
        const text = block.text.slice(offset, offset + 32767);
        textSheet.addRow([page.number, text, block.x, block.y, block.w, block.h]);
        if (!tables.length) sheet.addRow([text]);
      }
    });
    if (!sheet.rowCount) sheet.addRow(['']);
    sheet.columns.forEach(column => { column.width = tables.length ? 24 : 100; });
    sheet.eachRow(row => row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; }));
  }
  textSheet.getRow(1).font = { bold: true };
  textSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF1F7' } };
  textSheet.eachRow(row => row.getCell(2).alignment = { vertical: 'top', wrapText: true });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function createText(model) {
  return Buffer.from('\ufeff' + model.pages.map(page => {
    const blocks = page.blocks.map(block => block.kind === 'table' && block.rows.length ? block.rows.map(row => row.join('\t')).join('\n') : block.text).filter(Boolean);
    page.tables.forEach(table => blocks.push([table.title, table.rows.map(row => row.join('\t')).join('\n')].filter(Boolean).join('\n')));
    return blocks.join('\n');
  }).join('\n\f\n'), 'utf8');
}

function createCsv(model) {
  // Spreadsheet applications may execute leading =,+,-,@. Prefix only CSV
  // cells with an apostrophe; XLSX values above are explicit string cells.
  const cell = value => {
    let text = cleanText(value);
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const lines = [];
  model.pages.forEach((page, index) => {
    if (index) lines.push('');
    const tables = pageTables(page);
    tables.forEach((table, tableIndex) => {
      if (tableIndex) lines.push('');
      if (table.title) lines.push(cell(table.title));
      table.rows.forEach(row => lines.push(row.map(cell).join(';')));
    });
    const text = page.blocks.filter(block => block.kind !== 'table' || !block.rows.length).map(block => block.text).filter(Boolean);
    if (tables.length && text.length) lines.push('');
    text.forEach(value => lines.push(cell(value)));
  });
  return Buffer.from('\ufeff' + lines.join('\r\n'), 'utf8');
}

function registerPdfDocumentServices({ app, ipcMain, dialog, BrowserWindow, getSession, validateSender }) {
  const recoveryDir = path.join(app.getPath('userData'), 'pdf-recovery');
  const queues = new Map();
  const autosaveOwners = new Map();
  const parentOf = event => BrowserWindow.fromWebContents(event.sender) || undefined;
  const authorize = async event => {
    if (!event || !event.sender || event.sender.isDestroyed()) throw new Error('Окно редактора закрыто');
    if (typeof validateSender === 'function') {
      const valid = await validateSender(event);
      if (valid === false || valid == null) throw new Error('Эта операция доступна только в PDF-редакторе');
    } else if (typeof getSession === 'function') {
      if (!await getSession(event)) throw new Error('Документ редактора не найден');
    } else {
      // Do not expose filesystem operations to an unrelated renderer.
      throw new Error('Проверка окна PDF-редактора не настроена');
    }
  };
  const handle = (name, handler) => ipcMain.handle(name, async (event, payload) => {
    try { await authorize(event); return await handler(event, payload); }
    catch (error) { return { ok: false, error: message(error) }; }
  });
  const queued = (key, action) => {
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    queues.set(key, next);
    return next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
  };
  const atomicWrite = (filePath, bytes) => queued(path.resolve(filePath).toLowerCase(), async () => {
    const temp = path.join(path.dirname(filePath), '.' + path.basename(filePath) + '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
    try {
      const file = await fs.promises.open(temp, 'wx', 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      await fs.promises.rename(temp, filePath);
    } catch (error) { await fs.promises.unlink(temp).catch(() => {}); throw error; }
  });
  const pickSave = async (event, title, extension, name) => {
    const selected = await dialog.showSaveDialog(parentOf(event), { title, defaultPath: `${safeTitle(name)}.${extension}`, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (selected.canceled || !selected.filePath) return null;
    return path.extname(selected.filePath) ? selected.filePath : selected.filePath + '.' + extension;
  };
  const readBounded = async (filePath, limit = MAX_PROJECT_BYTES) => {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > limit) throw new Error('Файл пуст или превышает допустимый размер');
    const bytes = await fs.promises.readFile(filePath);
    if (bytes.length > limit) throw new Error('Файл превышает допустимый размер');
    return bytes;
  };
  const recoveryPath = id => {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Недопустимый идентификатор восстановления');
    return path.join(recoveryDir, id + '.tvspdf');
  };
  const recoveryFiles = async () => {
    let names;
    try { names = await fs.promises.readdir(recoveryDir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return (await Promise.all(names.filter(name => /^[a-f0-9]{64}\.tvspdf$/.test(name)).map(async name => {
      const filePath = path.join(recoveryDir, name);
      try {
        const stat = await fs.promises.lstat(filePath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROJECT_BYTES) return null;
        return { id: name.slice(0, 64), filePath, bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
      } catch (_) { return null; }
    }))).filter(Boolean);
  };

  handle('pdf-studio-export', async (event, payload) => {
    const model = normalizeExport(payload);
    const destination = await pickSave(event, 'Экспорт документа', model.format, model.title);
    if (!destination) return { ok: false, canceled: true };
    let bytes;
    if (model.format === 'docx') bytes = await createDocx(model);
    else if (model.format === 'xlsx') bytes = await createXlsx(model);
    else if (model.format === 'txt') bytes = createText(model);
    else bytes = createCsv(model);
    await atomicWrite(destination, bytes);
    return { ok: true, path: destination, format: model.format, pages: model.pages.length, bytes: bytes.length };
  });

  handle('pdf-studio-save-project', async (event, payload) => {
    const packed = await packProject(payload && payload.project);
    const destination = await pickSave(event, 'Сохранить проект PDF', 'tvspdf', packed.manifest.title);
    if (!destination) return { ok: false, canceled: true };
    await atomicWrite(destination, packed.bytes);
    return { ok: true, path: destination, bytes: packed.bytes.length, savedAt: packed.manifest.savedAt };
  });

  handle('pdf-studio-open-project', async event => {
    const selected = await dialog.showOpenDialog(parentOf(event), { title: 'Открыть проект PDF', filters: [{ name: 'Проект PDF ТВС', extensions: ['tvspdf'] }], properties: ['openFile'] });
    if (selected.canceled || !selected.filePaths || !selected.filePaths[0]) return { ok: false, canceled: true };
    const opened = unpackProject(await readBounded(selected.filePaths[0]));
    return { ok: true, path: selected.filePaths[0], ...opened };
  });

  handle('pdf-studio-autosave', (event, payload) => queued('autosave-window:' + event.sender.id, async () => {
    const packed = await packProject(payload && payload.project);
    const id = payload && payload.recoveryId ? payload.recoveryId : hash(Buffer.from(String(event.sender.id) + '|' + packed.identity));
    const destination = recoveryPath(id);
    const owner = autosaveOwners.get(id);
    if (owner && owner !== event.sender.id) throw new Error('Этот документ восстанавливается в другом окне');
    autosaveOwners.set(id, event.sender.id);
    return queued('recovery-quota', async () => {
      await fs.promises.mkdir(recoveryDir, { recursive: true });
      const existing = await recoveryFiles();
      const size = existing.filter(file => file.id !== id).reduce((sum, file) => sum + file.bytes, 0);
      if (size + packed.bytes.length > MAX_RECOVERY_BYTES) throw new Error('Хранилище восстановления PDF заняло 1 ГБ. Удалите ненужные копии в окне восстановления');
      await atomicWrite(destination, packed.bytes);
      return { ok: true, id, savedAt: packed.manifest.savedAt, bytes: packed.bytes.length };
    });
  }));

  handle('pdf-studio-recovery-list', async () => {
    const files = await recoveryFiles();
    const entries = [];
    for (const file of files) {
      try {
        // Read only the bounded manifest here; large PDF sources are restored
        // only when the user chooses this entry.
        const zip = new AdmZip(await readBounded(file.filePath));
        if (zip.getEntries().length > MAX_ARCHIVE_ENTRIES) throw new Error('Слишком много файлов');
        const manifestEntry = zip.getEntry('manifest.json');
        if (!manifestEntry || manifestEntry.header.size > MAX_MODEL_BYTES) throw new Error('Повреждено описание');
        const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
        if (manifest.format !== SCHEMA || manifest.schemaVersion !== SCHEMA_VERSION) throw new Error('Неизвестная версия');
        entries.push({ id: file.id, title: cleanText(manifest.title || 'Документ').slice(0, 255), savedAt: manifest.savedAt || file.modifiedAt, bytes: file.bytes });
      } catch (_) { entries.push({ id: file.id, title: 'Повреждённая копия восстановления', savedAt: file.modifiedAt, bytes: file.bytes, damaged: true }); }
    }
    entries.sort((left, right) => String(right.savedAt).localeCompare(String(left.savedAt)));
    return { ok: true, entries };
  });

  handle('pdf-studio-recovery-open', async (event, payload) => {
    const id = payload && payload.id;
    const filePath = recoveryPath(id);
    const stat = await fs.promises.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Недопустимая копия восстановления');
    const owner = autosaveOwners.get(id);
    if (owner && owner !== event.sender.id) throw new Error('Эта копия уже открыта в другом окне редактора');
    const opened = unpackProject(await readBounded(filePath));
    autosaveOwners.set(id, event.sender.id);
    return { ok: true, id, ...opened };
  });

  handle('pdf-studio-recovery-delete', async (event, payload) => {
    const id = payload && payload.id;
    const filePath = recoveryPath(id);
    const owner = autosaveOwners.get(id);
    if (owner && owner !== event.sender.id) throw new Error('Копия используется другим окном редактора');
    try { await fs.promises.unlink(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    autosaveOwners.delete(id);
    return { ok: true };
  });

  handle('pdf-studio-compare-file', async event => {
    const selected = await dialog.showOpenDialog(parentOf(event), { title: 'Выберите PDF для сравнения', filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile'] });
    if (selected.canceled || !selected.filePaths || !selected.filePaths[0]) return { ok: false, canceled: true };
    const bytes = await readBounded(selected.filePaths[0], MAX_SOURCE_BYTES);
    assertPdf(bytes);
    return { ok: true, name: path.basename(selected.filePaths[0]), bytesBase64: bytes.toString('base64') };
  });

  handle('pdf-studio-export-pages', async (event, payload) => {
    const bytes = decodeBase64(payload && payload.bytesBase64, MAX_PROJECT_BYTES);
    assertPdf(bytes);
    const destination = await pickSave(event, 'Сохранить выбранные страницы PDF', 'pdf', payload && payload.title || 'Страницы');
    if (!destination) return { ok: false, canceled: true };
    await atomicWrite(destination, bytes);
    return { ok: true, path: destination, bytes: bytes.length };
  });

  const releaseOwner = contents => {
    const contentsId = contents.id;
    contents.once('destroyed', () => { for (const [id, senderId] of autosaveOwners) if (senderId === contentsId) autosaveOwners.delete(id); });
  };
  app.on('web-contents-created', (_, contents) => releaseOwner(contents));
  return { recoveryDirectory: recoveryDir, schemaVersion: SCHEMA_VERSION };
}

module.exports = { registerPdfDocumentServices };
