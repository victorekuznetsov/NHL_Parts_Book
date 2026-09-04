/* Строит по каталогам двигателей Cummins (cummins/data/<ESN>.js) три индекса
   для единого приложения — всё, что нужно «Проверке списка», чтобы про любой
   номер было однозначно видно: есть ли он в каталоге, поставляется ли отдельно
   и чем его заказать, если отдельно не поставляется.

   Источник данных:
     cards[<номер>].attrs.Sellable  — "Y" поставляется отдельно, "N" нет;
     options[].parts[]              — состав узлов двигателя;
     kits[]                         — ремкомплекты: свой номер и содержимое.

   Пишет data/engine_parts.js:

     window.ENGINE_PART_INFO = { "<номер>": {
       s: 0 | 1,                   // 0 — отдельно не поставляется, 1 — поставляется
       k: [{ no, name }, ... ],    // ремкомплекты, в которые деталь входит
       e: ["33239746", ... ]       // двигатели, где деталь так помечена
     } }
     Раньше сюда попадали только номера, про которые «есть что сказать»
     (не поставляется отдельно и/или входит в комплект) — из-за этого у ~1800
     номеров в таблице проверки стоял прочерк, хотя из EPC точно известно, что
     они поставляются отдельно. Теперь индекс покрывает ВСЕ номера каталога
     двигателя, а прочерк означает ровно одно: номера в каталоге ДВС нет.

     window.ENGINE_PARTS = { "<номер>": {
       n: "наименование",
       m: [{ e: "<ESN>", m: "<машина>", o: ["<узел>", ...] }, ... ]
     } }
     Весь состав трёх двигателей: по нему «Проверить список» находит номера,
     которых нет в каталоге машины, но которые есть в каталоге двигателя.

     window.ENGINE_KITS = { "<номер комплекта>": {
       n: "наименование", t: "тип", e: ["<ESN>", ...],
       p: [{ no, name }, ... ]     // что входит в комплект
     } }
     Номера самих ремкомплектов. Их нет ни в составе узлов, ни в каталогах
     машин — то есть до сих пор «Проверить список» отвечала по ним «не найдено»,
     хотя заказывают именно их, когда деталь отдельно не поставляется.

     window.ENGINE_OPTS = { "<код узла>": "наименование" }
     Названия узлов двигателя — чтобы в выгрузках рядом с кодом узла стояло
     человеческое имя.

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
var parts = {};
var kitsOut = {};
var optNames = {};
var notSold = 0, inKits = 0, sold = 0;

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

  /* номера самих ремкомплектов — их нет ни в узлах, ни в каталогах машин */
  (cat.kits || []).forEach(function (kit) {
    if (!kit.no) return;
    var kk = normNo(kit.no);
    var kr = kitsOut[kk] || (kitsOut[kk] = { n: kit.name || "", t: kit.type || kit.notes || "", e: [], p: [] });
    if (!kr.n && kit.name) kr.n = kit.name;
    if (kr.e.indexOf(esn) < 0) kr.e.push(esn);
    (kit.parts || []).forEach(function (p) {
      if (!p.no || p.no === kit.no) return;
      if (!kr.p.some(function (x) { return x.no === p.no; })) kr.p.push({ no: p.no, name: p.name || "" });
    });
  });

  /* весь состав двигателя: номер -> узлы, в которых он стоит */
  (cat.options || []).forEach(function (o) {
    if (o.no && !optNames[o.no]) optNames[o.no] = o.name || "";
    (o.parts || []).forEach(function (p) {
      if (!p.no) return;
      var key = normNo(p.no);
      var rec = parts[key] || (parts[key] = { n: "", m: [] });
      if (!rec.n && p.name) rec.n = p.name;
      var slot = null;
      rec.m.forEach(function (x) { if (x.e === esn) slot = x; });
      if (!slot) { slot = { e: esn, m: NHL[esn], o: [] }; rec.m.push(slot); }
      if (slot.o.indexOf(o.no) < 0) slot.o.push(o.no);
    });
  });

  /* комплектность — по КАЖДОМУ номеру каталога двигателя, а не только по
     «интересным»: иначе в таблице проверки не отличить «поставляется
     отдельно» от «нет данных» */
  Object.keys(cards).forEach(function (pn) {
    var attrs = cards[pn].attrs || {};
    var sellable = attrs.Sellable !== "N";
    var kits = kitsByPart[pn] || [];
    var key = normNo(pn);
    var rec = out[key] || (out[key] = { s: 1, k: [], e: [] });
    /* если хоть на одном двигателе деталь отдельно не поставляется — так и пишем */
    if (!sellable) rec.s = 0;
    kits.forEach(function (k) {
      if (!rec.k.some(function (x) { return x.no === k.no; })) rec.k.push(k);
    });
    if (rec.e.indexOf(esn) < 0) rec.e.push(esn);
  });
});

Object.keys(out).forEach(function (k) {
  if (out[k].s === 0) notSold++; else sold++;
  if (out[k].k.length) inKits++;
  if (!out[k].k.length) delete out[k].k;
});

fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "engine_parts.js"),
  "window.ENGINE_PART_INFO = " + JSON.stringify(out) + ";\n" +
  "window.ENGINE_PARTS = " + JSON.stringify(parts) + ";\n" +
  "window.ENGINE_KITS = " + JSON.stringify(kitsOut) + ";\n" +
  "window.ENGINE_OPTS = " + JSON.stringify(optNames) + ";\n");
console.log("data/engine_parts.js — комплектность: " + Object.keys(out).length +
  " номеров (поставляются отдельно: " + sold + ", не поставляются: " + notSold +
  ", входят в комплекты: " + inKits + ")");
console.log("  состав двигателей: " + Object.keys(parts).length + " номеров");
console.log("  ремкомплекты: " + Object.keys(kitsOut).length +
  " номеров, узлы: " + Object.keys(optNames).length);
console.log("  размер: " +
  (fs.statSync(path.join(ROOT, "data", "engine_parts.js")).size / 1024).toFixed(0) + " КБ");
