import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseInvoices, parsePdfFiles, buildXlsxFromRows, loadConfig } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5177;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".ico":  "image/x-icon",
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const ct = MIME[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": ct });
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req, limit = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { req.destroy(); reject(new Error("Файл слишком большой")); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function jsonResponse(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  if (req.method === "GET") {
    if (url === "/" || url === "/index.html") {
      sendFile(res, path.join(__dirname, "public", "index.html"));
      return;
    }
    if (url === "/statyi.json") {
      sendFile(res, path.join(__dirname, "statyi.json"));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Не найдено");
    return;
  }

  if (req.method === "POST") {
    const config = loadConfig(path.join(__dirname, "config.json"));

    if (url === "/parse") {
      try {
        const zipBuffer = await readBody(req);
        if (!zipBuffer.length) { jsonResponse(res, 400, { error: "Пустой файл" }); return; }
        const log = [];
        const rows = await parseInvoices(zipBuffer, config, (msg) => log.push(msg));
        jsonResponse(res, 200, { log, rows, config });
      } catch (e) {
        jsonResponse(res, 500, { error: e.message });
      }
      return;
    }

    if (url === "/parse-pdfs") {
      try {
        const body = JSON.parse((await readBody(req)).toString("utf-8"));
        const pdfFiles = body.files.map(f => ({
          name: f.name,
          buffer: Buffer.from(f.buffer),
        }));
        const log = [];
        const rows = await parsePdfFiles(pdfFiles, config, (msg) => log.push(msg));
        jsonResponse(res, 200, { log, rows, config });
      } catch (e) {
        jsonResponse(res, 500, { error: e.message });
      }
      return;
    }

    if (url === "/build-xlsx") {
      try {
        const body = JSON.parse((await readBody(req)).toString("utf-8"));
        const { buffer, total } = await buildXlsxFromRows(body.rows, config);
        jsonResponse(res, 200, {
          filename: `Реестр_${new Date().toISOString().slice(0, 10)}.xlsx`,
          xlsxBase64: buffer.toString("base64"),
          total,
        });
      } catch (e) {
        jsonResponse(res, 500, { error: e.message });
      }
      return;
    }

    if (url === "/build") {
      try {
        const { buildReestrBuffer } = await import("./lib.mjs");
        const zipBuffer = await readBody(req);
        if (!zipBuffer.length) { jsonResponse(res, 400, { error: "Пустой файл" }); return; }
        const log = [];
        const { buffer, rows, total } = await buildReestrBuffer(zipBuffer, config, (msg) => log.push(msg));
        jsonResponse(res, 200, {
          log, rowsCount: rows.length, total,
          filename: `Реестр_${new Date().toISOString().slice(0, 10)}.xlsx`,
          xlsxBase64: buffer.toString("base64"),
        });
      } catch (e) {
        jsonResponse(res, 500, { error: e.message });
      }
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Не найдено");
});

server.listen(PORT, () => {
  console.log(`Реестр-Билдер запущен: http://localhost:${PORT}`);
});
