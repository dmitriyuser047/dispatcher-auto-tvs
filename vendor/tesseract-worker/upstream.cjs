'use strict';
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const logicalFile = __filename.replace(/([\\/])app\.asar\.unpacked(?=[\\/]|$)/i, '$1app.asar');
const appRequire = createRequire(logicalFile);
const entry = appRequire.resolve('tesseract.js/package.json');
if (JSON.parse(fs.readFileSync(entry, 'utf8')).version !== '7.0.0') throw Error('Нужна комплектная версия Tesseract.js 7.0.0');
module.exports = createRequire(entry);
