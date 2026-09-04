/* Строит компактный индекс «поставляется ли деталь отдельно и в какие
   комплекты она входит» по каталогу двигателя Cummins (cummins/data/<ESN>.js)
   для трёх двигателей NHL. Нужен единому приложению: в «Проверить список»
   рядом с найденным номером видно, что отдельно он не поставляется и каким
   комплектом его можно заказать.

   Источник данных:
     cards[<номер>].attrs.Sellable === "N"  — отдельно не поставляется;
     kits[].parts[]                          — состав ремкомплектов.

   Пишет data/engine_parts.js:
     window.ENGINE_PART_INFO = { "<нормализованный номер>": {
       s: 0,                       // 0 — отдельно не поставляется (иначе поля нет)
       k: [{ no, name }, ... ],    // комплекты, в которые деталь входит
       e: ["33239746", ... ]       // двигатели, где деталь так помечена
     } }

   В индекс попадают только номера, про которые есть что сказать (не
   поставляется отдельно и/или входит в комплект), поэтому файл небольшой.

   Запуск из корня репозитория:  node build/gen_engine_parts.js */
"use strict";
var fs = require("fs");
var vm = require("vm");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var NHL = { "33239746": "nte240", "33239899": "nte200", "37295879": "tr100" };

function normNo(s) { return String(s || "").toUpperCase().replace(/[\s-]/g, ""); }

function loadCatalog(esn) {
  var file = path.join(ROOT, "cummins", "data", esn + ".js");
  var ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  return ctx.window.CATALOGS[esn];
}

var out = {};
var notSold = 0, inKits = 0;

Object.keys(NHL).forEach(function (esn) {
  var cat = loadCatalog(esn);
  var cards = cat.cards || {};

  /* номер детали -> комплекты, в состав которых она входит */
  var kitsByPart = {};
  (cat.kits || []).forEach(function (kit) {
    (kit.parts || []).forEach(function (p) {
      if (!p.no || p.no === kit.no) return;
      (kitsByPart[p.no] = kitsByPart[p.no] || []).push({ no: kit.no, name: kit.name || "" });
    });
  });

  Object.keys(cards).forEach(function (pn) {
    var attrs = cards[pn].attrs || {};
    var sold = attrs.Sellable !== "N";
    var kits = kitsByPart[pn] || [];
    if (sold && !kits.length) return;

    var key = normNo(pn);
    var rec = out[key] || (out[key] = { k: [], e: [] });
    if (!sold) rec.s = 0;
    kits.forEach(function (k) {
      if (!rec.k.some(function (x) { return x.no === k.no; })) rec.k.push(k);
    });
    if (rec.e.indexOf(esn) < 0) rec.e.push(esn);
  });
});

Object.keys(out).forEach(function (k) {
  if (out[k].s === 0) notSold++;
  if (out[k].k.length) inKits++;
  if (!out[k].k.length) delete out[k].k;
});

fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "engine_parts.js"),
  "window.ENGINE_PART_INFO = " + JSON.stringify(out) + ";\n");
console.log("data/engine_parts.js — номеров: " + Object.keys(out).length +
  " (не поставляются отдельно: " + notSold + ", входят в комплекты: " + inKits + ")");
