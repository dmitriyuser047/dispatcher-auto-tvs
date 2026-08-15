// Общая логика сборки реестра — используется и консольной версией (build-reestr.mjs),
// и веб-интерфейсом (server.mjs).

import fs from "fs";
import path from "path";
import os from "os";
import AdmZip from "adm-zip";
import { createExtractorFromData } from "node-unrar-js";
import ExcelJS from "exceljs";
import iconv from "iconv-lite";
import pkg from "pdfjs-dist/build/pdf.js";
const { getDocument } = pkg;
import Tesseract from "tesseract.js";

export const DEFAULT_CONFIG = {
  supplier: 'ООО "Башпромсбыт"',
  payerFullName: 'ООО "ИНВЕСТКАПИТАЛГРУПП"',
  initiator: "Ульянов А.С.",
  contractNumber: "07/03-01 от 07.03.2023",
  objectRules: [
    { keywords: ["карабаш"], object: "КП 3 Карабашское м/р", contract: "МрНГ-24-10000-00324-Р" },
    { keywords: ["тас юрях", "кп-5 тю", "кп 5 тю"], object: "КП 5 Тас Юрях", contract: "ГНЗ-24-10000-00170-Р" },
    { keywords: ["бованенков"], object: "Бованенковское НГКМ", contract: "" },
    { keywords: ["19g", "лабытнанги"], object: "БВНГКМ 19G МУПГ 1и2", contract: "ГНЗ-22/09000/00191/Р" },
    { keywords: ["ен-яхинское", "ен яхинское", "ен-яха"], object: "КП 123 Ен Яха", contract: "" },
    { keywords: ["г.казань", "г. казань", "казань"], object: "Офис Казань", contract: "" },
  ],
  categoryRules: [
    { keywords: ["доставка воды"], category: "ДОСТАВКА ВОДЫ", statья: "21.05.10, Доставка материалов и оборудования (Транспортно-экспедиторские услуги)" },
    { keywords: ["ингибитор", "перевозке груза", "перевозке грузов"], category: "ПЕРЕВОЗКА ГРУЗОВ", statья: "21.05.10, Доставка материалов и оборудования (Транспортно-экспедиторские услуги)" },
    { keywords: ["перевалка", "хранение груза"], category: "ПЕРЕВАЛКА, ХРАНЕНИЕ ГРУЗА", statья: "21.05.06, Материальные расходы.Прочие." },
    { keywords: ["автокран", "услуги крана", "манипулятор", "нива", "камаз"], category: "АРЕНДА АВТОТРАНСПОРТА СПЕЦ,ТЕХНИКИ", statья: "21.05.14, Аренда автотраспорта и спецтехники" },
    { keywords: ["вывоз жбо", "планировке грунта", "работе по кусту"], category: "ПРОЧИЕ РАСХОДЫ ПО ОПЕРАЦИОННОЙ ДЕЯТЕЛЬНОСТИ", statья: "21.05.27, Прочие расходы по операционной деятельности" },
  ],
  fallbackCategory: "ПРОЧИЕ РАСХОДЫ",
  fallbackStatья: "21.05.27, Прочие расходы по операционной деятельности",
};

export function loadConfig(configPath) {
  if (configPath && fs.existsSync(configPath)) {
    const user = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return { ...DEFAULT_CONFIG, ...user };
  }
  return DEFAULT_CONFIG;
}

function fixEntryName(entry) {
  const name = entry.entryName;
  const hasCyrillic = /[А-яёЁ]/.test(name);
  if (hasCyrillic) return name;
  if (/^[\x00-\x7F]*$/.test(name)) return name;
  if (!entry.rawEntryName || !Buffer.isBuffer(entry.rawEntryName)) return name;
  try {
    const decoded = iconv.decode(entry.rawEntryName, "cp866");
    if (/[А-яёЁ]/.test(decoded)) return decoded;
  } catch {}
  return name;
}

async function extractZip(buffer, destDir) {
  const zip = new AdmZip(buffer);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const fixedName = fixEntryName(entry);
    const outPath = path.join(destDir, fixedName.replace(/\\/g, "/"));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, entry.getData());
  }
}

async function extractRar(buffer, destDir) {
  const extractor = await createExtractorFromData({ data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) });
  const list = [...extractor.getFileList().fileHeaders].filter(h => !h.flags.directory).map(h => h.name);
  const extracted = extractor.extract({ files: list });
  for (const f of extracted.files) {
    if (!f.extraction) continue;
    const outPath = path.join(destDir, f.fileHeader.name);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(f.extraction));
  }
}

// ═══════════════════════════════════════════════════════════════════
//  ВИЗУАЛЬНЫЙ ДВИЖОК — читает PDF «глазами», работает с координатами
// ═══════════════════════════════════════════════════════════════════

function buildVisualLines(items) {
  const meaningful = items.filter(it => it.str && it.str.trim().length > 0);
  if (!meaningful.length) return [];

  const sorted = [...meaningful].sort((a, b) => {
    const dy = b.transform[5] - a.transform[5];
    if (Math.abs(dy) > 1.5) return dy;
    return a.transform[4] - b.transform[4];
  });

  const lines = [];
  let cur = null;
  for (const it of sorted) {
    const y = it.transform[5];
    const x = it.transform[4];
    const w = it.width || 0;
    const h = it.height || 9;
    if (!cur || Math.abs(cur.y - y) > h * 0.4) {
      cur = { y, yMin: y, yMax: y + h, xMin: x, xMax: x + w, parts: [it] };
      lines.push(cur);
    } else {
      cur.xMin = Math.min(cur.xMin, x);
      cur.xMax = Math.max(cur.xMax, x + w);
      cur.parts.push(it);
    }
  }

  for (const line of lines) {
    line.parts.sort((a, b) => a.transform[4] - b.transform[4]);

    const cells = [];
    let cellText = "";
    let cellX = line.parts[0].transform[4];

    for (let i = 0; i < line.parts.length; i++) {
      const p = line.parts[i];
      if (i > 0) {
        const prev = line.parts[i - 1];
        const gap = p.transform[4] - (prev.transform[4] + (prev.width || 0));
        const charW = (prev.height || 9) * 0.35;
        if (gap > charW * 4) {
          cells.push({ x: cellX, text: cellText.trim() });
          cellText = "";
          cellX = p.transform[4];
        } else if (gap > charW && !/\s$/.test(cellText) && !/^\s/.test(p.str)) {
          cellText += " ";
        }
      }
      cellText += p.str;
    }
    if (cellText.trim()) cells.push({ x: cellX, text: cellText.trim() });

    line.cells = cells;
    line.text = cells.map(c => c.text).join("  ");
  }

  return lines;
}

function linesToText(lines) {
  return lines.map(l => l.text).join(" ");
}

function findLinesWith(lines, pattern) {
  const re = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern;
  return lines.filter(l => re.test(l.text));
}

function findValueRightOf(line, labelPattern) {
  const re = typeof labelPattern === "string" ? new RegExp(labelPattern, "i") : labelPattern;
  for (let i = 0; i < line.cells.length; i++) {
    if (re.test(line.cells[i].text) && i + 1 < line.cells.length) {
      return line.cells[i + 1].text;
    }
  }
  const m = line.text.match(re);
  if (m) {
    const after = line.text.slice(m.index + m[0].length).trim();
    if (after) return after;
  }
  return null;
}

function findValueBelow(lines, lineIdx, xTarget, tolerance = 40) {
  for (let i = lineIdx + 1; i < Math.min(lineIdx + 4, lines.length); i++) {
    for (const cell of lines[i].cells) {
      if (Math.abs(cell.x - xTarget) < tolerance && cell.text.trim()) {
        return cell.text.trim();
      }
    }
  }
  return null;
}

function detectTableRegion(lines) {
  let headerIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text.toLowerCase();
    if (/наименован\S*\s+(?:товар|работ|услуг)/i.test(t) ||
        /№\s*п\/?п.*наименован/i.test(t) ||
        (/(?:кол|ед)/.test(t) && /цена|стоимость|сумма/.test(t))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].cells.length >= 4 && /сумма/i.test(lines[i].text)) {
        headerIdx = i;
        break;
      }
    }
  }

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const t = lines[i].text.toLowerCase();
    if (/^итого\b|^всего\b|всего к оплате/i.test(t.trim())) {
      endIdx = i;
      break;
    }
  }

  return { headerIdx, endIdx };
}

function extractTableItems(lines) {
  const { headerIdx, endIdx } = detectTableRegion(lines);
  if (headerIdx === -1) return null;

  const items = [];
  for (let i = headerIdx + 1; i < endIdx; i++) {
    const line = lines[i];
    const text = line.text.trim();
    if (!text || /^─|^═|^\s*$/.test(text)) continue;

    const descParts = [];
    for (const cell of line.cells) {
      const t = cell.text.trim();
      if (/^[\d\s.,]+$/.test(t)) continue;
      if (/^\d{1,3}$/.test(t)) continue;
      if (/^(шт|л|кг|м[²³]?|т|час|усл|компл)\.?$/i.test(t)) continue;
      if (/^\d[\d\s]*[.,]\d{2}$/.test(t)) continue;
      if (t.length > 3) descParts.push(t);
    }
    if (descParts.length) items.push(descParts.join(" "));
  }
  return items.length ? items.join("\n") : null;
}

function extractMoneyFromLine(line) {
  const nums = [];
  for (const cell of line.cells) {
    const m = cell.text.match(/(\d[\d\s]*[.,]\d{2})/);
    if (m) nums.push(m[1].replace(/\s/g, "").replace(".", ","));
  }
  if (nums.length) return nums[nums.length - 1];
  const m = line.text.match(/(\d[\d\s]*[.,]\d{2})/);
  return m ? m[1].replace(/\s/g, "").replace(".", ",") : null;
}

// ═══════════════════════════════════════════════════════════════════
//  OCR для сканированных PDF (изображения без текстового слоя)
// ═══════════════════════════════════════════════════════════════════

let ocrWorker = null;

async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker("rus");
  }
  return ocrWorker;
}

async function extractPageImage(page) {
  const ops = await page.getOperatorList();
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] === 85 || ops.fnArray[i] === 82) {
      const imgName = ops.argsArray[i][0];
      const imgData = await page.objs.get(imgName);
      if (imgData && imgData.data && imgData.width && imgData.height) return imgData;
    }
  }
  return null;
}

function rgbToBmpBuffer(imgData) {
  const { width, height, data } = imgData;
  const channels = data.length / (width * height);
  const rowBytes = width * 3;
  const rowPad = (4 - (rowBytes % 4)) % 4;
  const paddedRow = rowBytes + rowPad;
  const pixelDataSize = paddedRow * height;
  const fileSize = 54 + pixelDataSize;
  const buf = Buffer.alloc(fileSize);
  buf.write("BM", 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(-height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelDataSize, 34);
  let offset = 54;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * channels;
      buf[offset++] = data[srcIdx + 2];
      buf[offset++] = data[srcIdx + 1];
      buf[offset++] = data[srcIdx];
    }
    for (let p = 0; p < rowPad; p++) buf[offset++] = 0;
  }
  return buf;
}

function isPhotoPage(imgData) {
  if (!imgData || imgData.width < 400 || imgData.height < 400) return true;
  const { data, width, height } = imgData;
  const channels = data.length / (width * height);
  const step = Math.max(1, Math.floor(width * height / 5000));
  let darkCount = 0, totalSampled = 0;
  for (let i = 0; i < width * height; i += step) {
    const idx = i * channels;
    const gray = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
    if (gray < 80) darkCount++;
    totalSampled++;
  }
  const darkRatio = darkCount / totalSampled;
  return darkRatio > 0.35;
}

async function ocrPageImage(page, worker) {
  const imgData = await extractPageImage(page);
  if (!imgData) return "";
  if (isPhotoPage(imgData)) return "";
  const bmp = rgbToBmpBuffer(imgData);
  const tmpFile = path.join(os.tmpdir(), `ocr_${Date.now()}_${Math.random().toString(36).slice(2)}.bmp`);
  try {
    fs.writeFileSync(tmpFile, bmp);
    const result = await worker.recognize(tmpFile);
    return result.data.text || "";
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

function ocrTextToLines(text) {
  return buildVisualLines(
    text.split(/\n/).filter(s => s.trim()).map((s, i) => ({
      str: s,
      transform: [1, 0, 0, 1, 0, -i * 12],
      width: s.length * 6,
      height: 10,
    }))
  );
}

async function pdfToLayout(filePathOrBuffer) {
  const data = typeof filePathOrBuffer === "string"
    ? new Uint8Array(fs.readFileSync(filePathOrBuffer))
    : new Uint8Array(filePathOrBuffer);
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const allLines = [];
  let hasText = false;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageLines = buildVisualLines(content.items);
    if (pageLines.length > 0) hasText = true;
    allLines.push(...pageLines);
  }
  if (hasText || doc.numPages === 0) return allLines;

  const worker = await getOcrWorker();
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const text = await ocrPageImage(page, worker);
    if (text) allLines.push(...ocrTextToLines(text));
  }
  return allLines;
}

async function pdfToPageLayouts(filePathOrBuffer) {
  const data = typeof filePathOrBuffer === "string"
    ? new Uint8Array(fs.readFileSync(filePathOrBuffer))
    : new Uint8Array(filePathOrBuffer);
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];
  let hasText = false;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageLines = buildVisualLines(content.items);
    if (pageLines.length > 0) hasText = true;
    pages.push(pageLines);
  }
  if (hasText) return pages;

  const worker = await getOcrWorker();
  const ocrPages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const text = await ocrPageImage(page, worker);
    ocrPages.push(text ? ocrTextToLines(text) : []);
  }
  return ocrPages;
}

function isInvoiceStartPage(pageLines) {
  return pageLines.some(l => /сч[её]т\s*(на\s*оплату|[-–]\s*договор)/i.test(l.text));
}

function isUpdPage(pageLines) {
  const text = pageLines.map(l => l.text).join(" ");
  return /универсальн\S*\s+передаточн|счет-фактура\s*№|упд\s*№/i.test(text);
}

async function pdfToText(filePath) {
  const lines = await pdfToLayout(filePath);
  return linesToText(lines);
}

function findFilesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

const MONTHS = {
  "января": "01", "февраля": "02", "марта": "03", "апреля": "04", "мая": "05",
  "июня": "06", "июля": "07", "августа": "08", "сентября": "09",
  "октября": "10", "ноября": "11", "декабря": "12",
  "янв": "01", "фев": "02", "мар": "03", "апр": "04",
  "июн": "06", "июл": "07", "авг": "08", "сен": "09",
  "окт": "10", "ноя": "11", "дек": "12",
};

function monthWordToNum(word) {
  const w = word.toLowerCase().replace(/[.\s]/g, "");
  if (MONTHS[w]) return MONTHS[w];
  for (const [k, v] of Object.entries(MONTHS)) {
    if (w.startsWith(k) || k.startsWith(w)) return v;
  }
  return null;
}

function extractNumber(numStr) {
  if (!numStr) return null;
  return numStr.replace(/\s/g, "").replace(",", ".");
}

// ═══════════════════════════════════════════════════════════════════
//  ВИЗУАЛЬНЫЙ ПАРСЕР — «смотрит» на документ, ищет поля по расположению
// ═══════════════════════════════════════════════════════════════════

function visualExtractNumberDate(lines) {
  const result = {};
  const invoiceLines = findLinesWith(lines, /сч[её]т|invoice|инвойс|счет-фактура/i);

  for (const line of invoiceLines) {
    const t = line.text;
    let m = t.match(/№\s*(\S+)\s+от\s+(\d{1,2})\s+(\S+)\s+(\d{4})\s*г?\.?/i);
    if (m) {
      result.invoiceNumber = m[1].replace(/[.,;:]+$/, "");
      const mo = monthWordToNum(m[3]);
      if (mo) result.invoiceDate = `${m[2].padStart(2, "0")}.${mo}.${m[4]}`;
      if (result.invoiceNumber && result.invoiceDate) return result;
    }
    m = t.match(/№\s*(\S+)\s+от\s+(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/i);
    if (m) {
      result.invoiceNumber = m[1].replace(/[.,;:]+$/, "");
      const year = m[4].length === 2 ? "20" + m[4] : m[4];
      result.invoiceDate = `${m[2].padStart(2, "0")}.${m[3].padStart(2, "0")}.${year}`;
      if (result.invoiceNumber && result.invoiceDate) return result;
    }

    const numVal = findValueRightOf(line, /№/);
    if (numVal) {
      const clean = numVal.replace(/[.,;:]+$/, "").trim();
      if (clean && !/^от$/i.test(clean)) result.invoiceNumber = clean;
    }

    const dateVal = findValueRightOf(line, /от/i);
    if (dateVal) {
      const dm = dateVal.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
      if (dm) {
        const year = dm[3].length === 2 ? "20" + dm[3] : dm[3];
        result.invoiceDate = `${dm[1].padStart(2, "0")}.${dm[2].padStart(2, "0")}.${year}`;
      } else {
        const wm = dateVal.match(/(\d{1,2})\s+(\S+)\s+(\d{4})/);
        if (wm) {
          const mo = monthWordToNum(wm[2]);
          if (mo) result.invoiceDate = `${wm[1].padStart(2, "0")}.${mo}.${wm[3]}`;
        }
      }
    }
    if (result.invoiceNumber && result.invoiceDate) return result;
  }

  if (!result.invoiceNumber) {
    const flatText = linesToText(lines);
    const patterns = [
      /Сч[её]т(?:-фактура)?\s*(?:на оплату)?\s*№\s*(\S+)\s+от\s+(\d{1,2})\s+(\S+)\s+(\d{4})/i,
      /Сч[её]т(?:-фактура)?\s*(?:на оплату)?\s*№\s*(\S+)\s+от\s+(\d{2})[.\/-](\d{2})[.\/-](\d{4})/i,
      /(?:invoice|инвойс)\s*[№#.:]*\s*(\S+)\s+(?:от|from|dated?)\s+(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/i,
    ];
    for (const re of patterns) {
      const m = flatText.match(re);
      if (!m) continue;
      result.invoiceNumber = m[1].replace(/[.,;:]+$/, "");
      const mo = monthWordToNum(m[3]);
      if (mo) result.invoiceDate = `${m[2].padStart(2, "0")}.${mo}.${m[4]}`;
      else {
        const year = m[4].length === 2 ? "20" + m[4] : m[4];
        result.invoiceDate = `${m[2].padStart(2, "0")}.${m[3].padStart(2, "0")}.${year}`;
      }
      if (result.invoiceNumber && result.invoiceDate) return result;
    }
  }

  return result;
}

function visualExtractTotal(lines) {
  const totalLabels = [
    /всего к оплате/i,
    /итого\s*(с\s*ндс|включая|с учётом)?/i,
    /всего\s*:/i,
    /к оплате/i,
    /сумма к оплате/i,
  ];

  for (const re of totalLabels) {
    const found = findLinesWith(lines, re);
    for (const line of found) {
      const money = extractMoneyFromLine(line);
      if (money) return money;

      const idx = lines.indexOf(line);
      for (let j = idx + 1; j < Math.min(idx + 3, lines.length); j++) {
        const m2 = extractMoneyFromLine(lines[j]);
        if (m2) return m2;
      }
    }
  }

  const flatText = linesToText(lines);
  const m = flatText.match(/(?:всего к оплате|итого|всего)[^:]*:?\s*([\d\s]+[.,]\d{2})/i);
  if (m) return m[1].replace(/\s/g, "").replace(".", ",");

  return null;
}

function visualExtractDescription(lines) {
  const tableDesc = extractTableItems(lines);
  if (tableDesc) return tableDesc;

  const flatText = linesToText(lines);
  const textPatterns = [
    /(?:за |оплата за |оплата по |оказание услуг по |выполнение работ по )([\s\S]{10,400}?)(?:\.\s|\s+(?:Всего|Итого|Сумма|НДС|Без НДС))/i,
    /1\s+((?:[А-ЯЁа-яё][А-ЯЁа-яё\s,.\-()]{10,300}?))\s+\d[\d\s]*[.,]\d{2}/,
  ];
  for (const re of textPatterns) {
    const m = flatText.match(re);
    if (m && m[1].trim().length > 5) return m[1].replace(/\s{2,}/g, " ").trim();
  }
  return null;
}

function smartParseDocument(lines) {
  const result = visualExtractNumberDate(lines);
  const total = visualExtractTotal(lines);
  if (total) result.total = total;
  const desc = visualExtractDescription(lines);
  if (desc) result.description = desc;
  return result;
}

function parseInvoiceText(text) {
  if (Array.isArray(text)) return smartParseDocument(text);
  return smartParseDocument(buildVisualLines(
    text.split(/\n/).map((s, i) => ({ str: s, transform: [1,0,0,1, 0, -i * 12], width: s.length * 6, height: 10 }))
  ));
}

function parseUpdText(text) {
  const result = {};
  const src = typeof text === "string" ? text : linesToText(text);
  const patterns = [
    /Счет-фактура\s*№\s*(\S+)\s+от\s+(\d{2}\.\d{2}\.\d{4})/i,
    /Универсальный\s+передаточный\s+документ[\s\S]*?№\s*(\S+)\s+от\s+(\d{2}\.\d{2}\.\d{4})/i,
    /УПД\s*№\s*(\S+)\s+от\s+(\d{2}\.\d{2}\.\d{4})/i,
  ];
  for (const re of patterns) {
    const m = src.match(re);
    if (m) {
      result.updNumber = m[1].replace(/[.,;:]+$/, "");
      result.updDate = m[2];
      return result;
    }
  }
  return result;
}

function parseUpdAsInvoice(text) {
  return parseInvoiceText(text);
}

function matchRules(text, rules, fallback) {
  const lower = text.toLowerCase();
  for (const rule of rules) {
    if (rule.keywords.some(k => lower.includes(k))) return rule;
  }
  return fallback;
}

function ddmmyyyyToSortable(d) {
  const [dd, mm, yyyy] = d.split(".");
  return `${yyyy}${mm}${dd}`;
}

function classifyPdf(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (/упд|универсальн/i.test(name)) return "upd";
  if (/сч[её]т|invoice|счет/i.test(name)) return "invoice";
  return "unknown";
}

async function processArchiveFolder(folder, config, archiveLabel = "") {
  const files = findFilesRecursive(folder).filter(f => f.toLowerCase().endsWith(".pdf"));
  if (!files.length) return null;

  let invoiceFile = files.find(f => classifyPdf(f) === "invoice");
  let updFile = files.find(f => classifyPdf(f) === "upd");
  if (!invoiceFile && !updFile) invoiceFile = files[0];

  let inv = {};
  let isFromUpd = false;

  if (invoiceFile) {
    const layout = await pdfToLayout(invoiceFile);
    inv = smartParseDocument(layout);
    if (!inv.total || !inv.invoiceNumber) isFromUpd = true;
  }

  if ((!inv.total || !inv.invoiceNumber) && updFile) {
    const layout = await pdfToLayout(updFile);
    const updInv = smartParseDocument(layout);
    if (updInv.total) { inv = { ...inv, ...updInv }; isFromUpd = true; }
  }

  if ((!inv.total || !inv.invoiceNumber) && files.length > 0) {
    for (const f of files) {
      if (f === invoiceFile || f === updFile) continue;
      const layout = await pdfToLayout(f);
      const parsed = smartParseDocument(layout);
      if (parsed.total && parsed.invoiceNumber) { inv = parsed; break; }
      if (parsed.total) { inv = { ...inv, ...parsed }; break; }
    }
  }

  let upd = {};
  if (updFile) {
    const updLayout = await pdfToLayout(updFile);
    upd = parseUpdText(linesToText(updLayout));
  }
  if (!upd.updNumber && inv.invoiceNumber) {
    upd = { updNumber: inv.invoiceNumber, updDate: inv.invoiceDate };
  }

  if (!inv.total) return null;
  if (!inv.description) inv.description = archiveLabel || path.basename(folder);

  const combinedForObject = `${inv.description} ${archiveLabel}`;
  const objRule = matchRules(combinedForObject, config.objectRules, { object: "", contract: "" });
  const catRule = matchRules(inv.description, config.categoryRules, { category: config.fallbackCategory, statья: config.fallbackStatья });

  const basisLabel = isFromUpd
    ? `Счет-фактура №${inv.invoiceNumber || '?'} от ${inv.invoiceDate || '?'}`
    : `Счет №${inv.invoiceNumber || '?'} от ${inv.invoiceDate || '?'}`;

  const totalStr = inv.total || "0,00";
  const updLabel = upd.updNumber
    ? `УПД (${upd.updNumber} от ${upd.updDate}) на ${totalStr}`
    : `УПД на ${totalStr}`;

  return {
    sum: parseFloat(extractNumber(totalStr) || 0),
    date: inv.invoiceDate || new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }),
    category: catRule.category,
    description: inv.description,
    obj: objRule.object,
    dog: objRule.contract,
    osn: basisLabel,
    updLabel,
    statья: catRule.statья,
    sourceFolder: path.basename(folder),
  };
}

function buildRowFromParsed(inv, upd, config, label, baseName, isFromUpd) {
  const basisLabel = isFromUpd
    ? `Счет-фактура №${inv.invoiceNumber || '?'} от ${inv.invoiceDate || '?'}`
    : `Счет №${inv.invoiceNumber || '?'} от ${inv.invoiceDate || '?'}`;

  const totalStr = inv.total || "0,00";
  const updLabel = upd.updNumber
    ? `УПД (${upd.updNumber} от ${upd.updDate}) на ${totalStr}`
    : `УПД на ${totalStr}`;

  const combinedForObject = `${inv.description} ${label}`;
  const objRule = matchRules(combinedForObject, config.objectRules, { object: "", contract: "" });
  const catRule = matchRules(inv.description, config.categoryRules, { category: config.fallbackCategory, statья: config.fallbackStatья });

  return {
    sum: parseFloat(extractNumber(totalStr) || 0),
    date: inv.invoiceDate || new Date().toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }),
    category: catRule.category,
    description: inv.description,
    obj: objRule.object,
    dog: objRule.contract,
    osn: basisLabel,
    updLabel,
    statья: catRule.statья,
    sourceFolder: baseName,
  };
}

async function processSinglePdf(filePath, config, label = "") {
  const baseName = path.basename(filePath);
  const type = classifyPdf(filePath);

  const pageLayouts = await pdfToPageLayouts(filePath);

  const invoicePageIdxs = [];
  for (let i = 0; i < pageLayouts.length; i++) {
    if (isInvoiceStartPage(pageLayouts[i])) invoicePageIdxs.push(i);
  }

  if (invoicePageIdxs.length <= 1) {
    const layout = pageLayouts.flat();
    const flatText = linesToText(layout);
    let inv = smartParseDocument(layout);
    let upd = parseUpdText(flatText);
    if (!upd.updNumber && inv.invoiceNumber) {
      upd = { updNumber: inv.invoiceNumber, updDate: inv.invoiceDate };
    }
    if (!inv.total) return null;
    if (!inv.description) inv.description = label || baseName;
    const isFromUpd = type === "upd" || !inv.invoiceNumber;
    return buildRowFromParsed(inv, upd, config, label, baseName, isFromUpd);
  }

  const rows = [];
  for (let g = 0; g < invoicePageIdxs.length; g++) {
    const startPage = invoicePageIdxs[g];
    const endPage = g + 1 < invoicePageIdxs.length ? invoicePageIdxs[g + 1] : pageLayouts.length;

    const invoiceLines = pageLayouts[startPage];
    let inv = smartParseDocument(invoiceLines);

    let updLines = null;
    for (let p = startPage + 1; p < endPage; p++) {
      if (isUpdPage(pageLayouts[p])) { updLines = pageLayouts[p]; break; }
    }

    let upd = {};
    if (updLines) upd = parseUpdText(linesToText(updLines));
    if (!upd.updNumber && inv.invoiceNumber) {
      upd = { updNumber: inv.invoiceNumber, updDate: inv.invoiceDate };
    }

    if (!inv.total) continue;
    if (!inv.description) inv.description = label || baseName;
    rows.push(buildRowFromParsed(inv, upd, config, label, baseName, false));
  }

  return rows.length === 1 ? rows[0] : rows.length > 0 ? rows : null;
}

/**
 * Шаг 1: разбор архива — возвращает массив строк для редактирования.
 */
export async function parseInvoices(zipBuffer, config, onLog = () => {}) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "reestr-"));
  try {
    const outerZip = new AdmZip(zipBuffer);
    const subArchives = outerZip.getEntries().filter(e => !e.isDirectory && /\.(zip|rar)$/i.test(e.entryName));
    onLog({ type: "info", text: `Найдено под-архивов: ${subArchives.length}` });

    const rows = [];
    for (const entry of subArchives) {
      const name = fixEntryName(entry);
      const subDir = path.join(workDir, path.basename(name, path.extname(name)));
      fs.mkdirSync(subDir, { recursive: true });
      const data = entry.getData();
      try {
        if (/\.rar$/i.test(name)) await extractRar(data, subDir);
        else await extractZip(data, subDir);
      } catch (e) {
        onLog({ type: "warn", text: `Не удалось распаковать «${name}»: ${e.message}` });
        continue;
      }
      try {
        const row = await processArchiveFolder(subDir, config, name);
        if (row) {
          rows.push(row);
          onLog({ type: "ok", text: `${name} → ${row.sum.toLocaleString("ru-RU")} руб.` });
        } else {
          onLog({ type: "warn", text: `${name} — не удалось распознать счёт` });
        }
      } catch (e) {
        onLog({ type: "warn", text: `${name} — ошибка разбора: ${e.message}` });
      }
    }

    rows.sort((a, b) => ddmmyyyyToSortable(a.date).localeCompare(ddmmyyyyToSortable(b.date)));
    return rows;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Шаг 1 (альт.): разбор отдельных PDF-файлов.
 * @param {Array<{name: string, buffer: Buffer}>} pdfFiles
 */
export async function parsePdfFiles(pdfFiles, config, onLog = () => {}) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "reestr-pdf-"));
  try {
    onLog({ type: "info", text: `Загружено PDF-файлов: ${pdfFiles.length}` });

    // Сохраняем PDF на диск
    const savedPaths = [];
    for (const f of pdfFiles) {
      const filePath = path.join(workDir, f.name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, Buffer.from(f.buffer));
      savedPaths.push({ name: f.name, path: filePath });
    }

    // Разделяем на счета и УПД для попытки объединения в пары
    const invoices = savedPaths.filter(f => /счет/i.test(f.name) && !/упд/i.test(f.name));
    const upds = savedPaths.filter(f => /упд/i.test(f.name));
    const others = savedPaths.filter(f => !invoices.includes(f) && !upds.includes(f));

    const rows = [];
    const processedPaths = new Set();

    // Пробуем объединить счёт + УПД в пары (по похожим именам)
    for (const inv of invoices) {
      // Ищем УПД с похожим именем (убираем «счет» / «упд» и сравниваем остаток)
      const invBase = inv.name.toLowerCase().replace(/счет[^\s]*/gi, "").replace(/[_\-\s.pdf]+/g, "").trim();
      let matchedUpd = null;
      for (const u of upds) {
        if (processedPaths.has(u.path)) continue;
        const updBase = u.name.toLowerCase().replace(/упд[^\s]*/gi, "").replace(/[_\-\s.pdf]+/g, "").trim();
        if (invBase && updBase && (invBase.includes(updBase) || updBase.includes(invBase))) {
          matchedUpd = u;
          break;
        }
      }

      if (matchedUpd) {
        // Пара найдена — обрабатываем вместе через папку
        const pairDir = path.join(workDir, `pair_${rows.length}`);
        fs.mkdirSync(pairDir, { recursive: true });
        fs.copyFileSync(inv.path, path.join(pairDir, inv.name));
        fs.copyFileSync(matchedUpd.path, path.join(pairDir, matchedUpd.name));
        processedPaths.add(inv.path);
        processedPaths.add(matchedUpd.path);

        try {
          const row = await processArchiveFolder(pairDir, config, inv.name);
          if (row) {
            rows.push(row);
            onLog({ type: "ok", text: `${inv.name} + ${matchedUpd.name} → ${row.sum.toLocaleString("ru-RU")} руб.` });
          } else {
            onLog({ type: "warn", text: `${inv.name} — не удалось распознать` });
          }
        } catch (e) {
          onLog({ type: "warn", text: `${inv.name} — ошибка: ${e.message}` });
        }
      } else {
        // Счёт без пары — обрабатываем отдельно
        processedPaths.add(inv.path);
        try {
          const result = await processSinglePdf(inv.path, config, inv.name);
          if (Array.isArray(result)) {
            rows.push(...result);
            onLog({ type: "ok", text: `${inv.name} → ${result.length} счетов (${result.reduce((s, r) => s + r.sum, 0).toLocaleString("ru-RU")} руб.)` });
          } else if (result) {
            rows.push(result);
            onLog({ type: "ok", text: `${inv.name} → ${result.sum.toLocaleString("ru-RU")} руб.` });
          } else {
            onLog({ type: "warn", text: `${inv.name} — не удалось распознать` });
          }
        } catch (e) {
          onLog({ type: "warn", text: `${inv.name} — ошибка: ${e.message}` });
        }
      }
    }

    // Оставшиеся УПД (без пары) и прочие PDF
    for (const f of [...upds, ...others]) {
      if (processedPaths.has(f.path)) continue;
      processedPaths.add(f.path);
      try {
        const result = await processSinglePdf(f.path, config, f.name);
        if (Array.isArray(result)) {
          rows.push(...result);
          onLog({ type: "ok", text: `${f.name} → ${result.length} счетов (${result.reduce((s, r) => s + r.sum, 0).toLocaleString("ru-RU")} руб.)` });
        } else if (result) {
          rows.push(result);
          onLog({ type: "ok", text: `${f.name} → ${result.sum.toLocaleString("ru-RU")} руб.` });
        } else {
          onLog({ type: "warn", text: `${f.name} — не удалось распознать` });
        }
      } catch (e) {
        onLog({ type: "warn", text: `${f.name} — ошибка: ${e.message}` });
      }
    }

    rows.sort((a, b) => ddmmyyyyToSortable(a.date).localeCompare(ddmmyyyyToSortable(b.date)));
    return rows;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Шаг 2: генерация Excel из (отредактированных) строк.
 */
export async function buildXlsxFromRows(rows, config) {
  const ACCENT = "FF2563EB";
  const HEADER_TEXT = "FFFFFFFF";
  const TITLE_TEXT = "FF111827";
  const SUBTITLE_TEXT = "FF6B7280";
  const BAND_FILL = "FFF3F6FB";
  const BORDER_COLOR = "FFD9DEE8";
  const TOTAL_FILL = "FFDBEAFE";
  const FONT = "Calibri";

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("РЕЕСТР", { views: [{ showGridLines: false }] });

  ws.mergeCells("A1:J1");
  ws.getCell("A1").value = `Реестр б/н от ${new Date().toLocaleDateString("ru-RU")}`;
  ws.getCell("A1").font = { bold: true, size: 18, name: FONT, color: { argb: TITLE_TEXT } };
  ws.getCell("A1").alignment = { vertical: "middle" };
  ws.getRow(1).height = 30;

  ws.mergeCells("A2:J2");
  ws.getCell("A2").value = config.payerFullName;
  ws.getCell("A2").font = { bold: true, size: 11, name: FONT, color: { argb: SUBTITLE_TEXT } };
  ws.getCell("A2").alignment = { vertical: "middle" };
  ws.getRow(2).height = 20;

  const headers = ["№", "Сумма, руб.", "Контрагент", "Назначение платежа", "Объект", "Доходный договор", "Инициатор платежа", "Номер договора с контрагентом", "ОСНОВАНИЕ", "ФИНКОНТРОЛЬ"];
  ws.spliceRows(3, 1, headers);
  ws.getRow(3).eachCell(c => {
    c.font = { bold: true, name: FONT, size: 10.5, color: { argb: HEADER_TEXT } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  ws.getRow(3).height = 32;

  let r = 4;
  const total = rows.reduce((s, x) => s + x.sum, 0);

  rows.forEach((row, i) => {
    const naz = `${row.category || ''}\n${row.description || ''}\nОПЛАТА ПО ФАКТУ, выполнено ${row.date}`.trim();

    ws.getCell(r, 1).value = i + 1;
    ws.getCell(r, 2).value = row.sum;
    ws.getCell(r, 3).value = config.supplier;
    ws.getCell(r, 4).value = naz;
    ws.getCell(r, 5).value = row.obj;
    ws.getCell(r, 6).value = row.dog;
    ws.getCell(r, 7).value = config.initiator;
    ws.getCell(r, 8).value = config.contractNumber;
    ws.getCell(r, 9).value = row.osn;
    ws.getCell(r, 10).value = `ПО ДОГОВОРУ ${config.contractNumber}\nВ 1С ПРОВЕДЕНО\n${row.updLabel}\nСТАТЬЯ ${row.statья}\nОперационные расходы`;

    const isBand = i % 2 === 1;
    for (let c = 1; c <= 10; c++) {
      const cell = ws.getCell(r, c);
      cell.alignment = { wrapText: true, vertical: "top" };
      cell.font = { name: FONT, size: 10 };
      if (isBand) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILL } };
    }
    ws.getCell(r, 1).alignment = { horizontal: "center", vertical: "top" };
    ws.getCell(r, 2).alignment = { horizontal: "right", vertical: "top" };
    ws.getCell(r, 2).numFmt = "#,##0.00";
    ws.getCell(r, 2).font = { name: FONT, size: 10, bold: true };
    r++;
  });

  const lastDataRow = r - 1;
  ws.getCell(r, 2).value = { formula: `SUM(B4:B${lastDataRow})` };
  ws.getCell(r, 2).numFmt = "#,##0.00";
  ws.getCell(r, 3).value = "ВСЕГО";
  for (let c = 1; c <= 10; c++) {
    ws.getCell(r, c).font = { bold: true, name: FONT, size: 11 };
    ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    ws.getCell(r, c).border = { top: { style: "medium", color: { argb: ACCENT } } };
  }
  ws.getCell(r, 2).alignment = { horizontal: "right" };

  for (let rr = 3; rr <= r; rr++) {
    for (let c = 1; c <= 10; c++) {
      const existingBorder = ws.getCell(rr, c).border || {};
      ws.getCell(rr, c).border = {
        ...existingBorder,
        top: existingBorder.top || { style: "thin", color: { argb: BORDER_COLOR } },
        bottom: { style: "thin", color: { argb: BORDER_COLOR } },
        left: { style: "thin", color: { argb: BORDER_COLOR } },
        right: { style: "thin", color: { argb: BORDER_COLOR } },
      };
    }
  }

  ws.autoFilter = `A3:J3`;
  ws.views = [{ state: "frozen", ySplit: 3, showGridLines: false }];

  ws.columns = [
    { width: 5 }, { width: 14 }, { width: 18 }, { width: 45 }, { width: 20 },
    { width: 20 }, { width: 16 }, { width: 20 }, { width: 22 }, { width: 45 },
  ];

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, total };
}

/**
 * Обратная совместимость: старая функция «всё сразу» (только ZIP).
 */
export async function buildReestrBuffer(zipBuffer, config, onLog = () => {}) {
  const rows = await parseInvoices(zipBuffer, config, onLog);
  const { buffer, total } = await buildXlsxFromRows(rows, config);
  onLog({ type: "info", text: `Готово: ${rows.length} строк, сумма ${total.toLocaleString("ru-RU")} руб.` });
  return { buffer, rows, total };
}

/**
 * Обратная совместимость: старая функция «всё сразу» (только PDF).
 */
export async function buildReestrFromPdfs(pdfFiles, config, onLog = () => {}) {
  const rows = await parsePdfFiles(pdfFiles, config, onLog);
  const { buffer, total } = await buildXlsxFromRows(rows, config);
  onLog({ type: "info", text: `Готово: ${rows.length} строк, сумма ${total.toLocaleString("ru-RU")} руб.` });
  return { buffer, rows, total };
}
