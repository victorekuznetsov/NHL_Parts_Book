/* Собирает "слепок" папок для технических бюллетеней Cummins, упоминаемых в
   карточках деталей трёх двигателей NHL (поле "Service Part Topic"). Сами PDF
   Cummins не публикует в открытом доступе (кроме общего бюллетеня 3666132) —
   их нужно скачать вручную с quickserve.cummins.com под своим логином и
   положить в указанное манифестом место. Запуск из корня репозитория:
     node build/gen_bulletin_manifest.js
   Перезаписывает cummins/bulletins/manifest.csv и truncated.csv. */
"use strict";
var fs = require("fs");
var vm = require("vm");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var ENGINES = { "33239746": "NTE240", "33239899": "NTE200", "37295879": "TR100A" };

function loadCatalog(esn) {
  var file = path.join(ROOT, "cummins", "data", esn + ".js");
  var ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  return ctx.window.CATALOGS[esn];
}

function csvCell(v) {
  v = String(v == null ? "" : v);
  return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function csvRow(cells) { return cells.map(csvCell).join(";"); }

var master = {};       // code -> { engines:{}, parts:[] }
var truncated = [];     // { esn, pn, raw }

Object.keys(ENGINES).forEach(function (esn) {
  var cat = loadCatalog(esn);
  var cards = cat.cards || {};
  Object.keys(cards).forEach(function (pn) {
    var attrs = (cards[pn] || {}).attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (!/topic/i.test(k)) return;
      var raw = String(attrs[k]);
      var vals = raw.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      if (vals.length > 1) {
        // источник обрезает поле при нескольких темах — сохранён только
        // первый код целиком, остальное недостоверно
        truncated.push({ esn: esn, pn: pn, raw: raw });
        vals = [vals[0]];
      }
      vals.forEach(function (code) {
        var rec = master[code] || (master[code] = { engines: {}, parts: [] });
        rec.engines[esn] = 1;
        if (rec.parts.indexOf(pn) < 0) rec.parts.push(pn);
      });
    });
  });
});

// Прямых (deep-link) адресов на конкретный документ у QuickServe нет: сайт
// отвечает редиректом на SAML-логин на ЛЮБОЙ путь/параметры, даже правдоподобно
// выглядящие (проверено) — значит угадать рабочую ссылку на поиск внутри
// QuickServe нельзя, только вести на голову сайта и просить искать вручную.
// Единственная по-настоящему рабочая ссылка на позицию — поиск в Google.
function googleSearchUrl(code) {
  return "https://www.google.com/search?q=" + encodeURIComponent("Cummins " + code + " bulletin filetype:pdf");
}
var QUICKSERVE_HOME = "https://quickserve.cummins.com/";

var codes = Object.keys(master).sort();
var manifestRows = [csvRow(["Код", "Тип", "Двигатели", "Деталей", "Примеры деталей", "Куда положить файл",
                             "Поиск в Google", "QuickServe (войти и искать код вручную)"])];
codes.forEach(function (code) {
  var rec = master[code];
  var engs = Object.keys(rec.engines).map(function (e) { return ENGINES[e]; }).join(", ");
  var type = /^TSB\d+/.test(code) ? "TSB (сервисный бюллетень)" : "Service Topic (внутренний код Cummins)";
  var dest = "cummins/bulletins/topics/" + code.replace(/[^\w-]/g, "_") + ".pdf";
  manifestRows.push(csvRow([code, type, engs, rec.parts.length, rec.parts.slice(0, 5).join(", "), dest,
                             googleSearchUrl(code), QUICKSERVE_HOME]));
});
fs.writeFileSync(path.join(ROOT, "cummins", "bulletins", "manifest.csv"), manifestRows.join("\n") + "\n", "utf8");

var truncRows = [csvRow(["Двигатель", "Номер детали", "Исходное (обрезанное) значение", "Поиск в Google", "Что делать"])];
truncated.forEach(function (t) {
  truncRows.push(csvRow([ENGINES[t.esn], t.pn, t.raw, googleSearchUrl(t.pn),
    "Открыть деталь " + t.pn + " на quickserve.cummins.com — там указан полный список тем/бюллетеней"]));
});
fs.writeFileSync(path.join(ROOT, "cummins", "bulletins", "truncated.csv"), truncRows.join("\n") + "\n", "utf8");

console.log("Уникальных кодов (manifest.csv): " + codes.length);
console.log("Деталей с обрезанным списком тем (truncated.csv): " + truncated.length);
