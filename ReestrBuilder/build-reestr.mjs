#!/usr/bin/env node
// Консольная версия. Для удобного варианта с окном — запустите start.bat (server.mjs).
// Использование:
//   node build-reestr.mjs <путь_к_zip_с_архивами> <путь_к_итоговому.xlsx> [config.json]

import fs from "fs";
import { buildReestrBuffer, loadConfig } from "./lib.mjs";

async function main() {
  const [, , inputZip, outputXlsx, configPath] = process.argv;
  if (!inputZip || !outputXlsx) {
    console.error("Использование: node build-reestr.mjs <архив.zip> <реестр.xlsx> [config.json]");
    process.exit(1);
  }
  const config = loadConfig(configPath);
  const zipBuffer = fs.readFileSync(inputZip);
  const { buffer } = await buildReestrBuffer(zipBuffer, config, (msg) => {
    const prefix = { ok: "  OK ", warn: "  ?? ", info: "" }[msg.type] ?? "";
    console.log(prefix + msg.text);
  });
  fs.writeFileSync(outputXlsx, buffer);
  console.log(`\nФайл сохранён -> ${outputXlsx}`);
}

main().catch(e => { console.error(e); process.exit(1); });
