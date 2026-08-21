/* Строит компактный индекс замен номеров из каталога двигателя Cummins
   (cummins/data/<ESN>.js — CARDS[pn].sup) для трёх наших двигателей NHL,
   чтобы «Проверить список» в едином приложении находил старые/заменённые
   номера двигателя, даже если их нет в собственном прайсе машины.
   Пишет data/engine_sup.js:
     window.ENGINE_SUP = { "<нормализованный старый номер>": [
       { esn, machine, cur, name }, ... ] }
   Запуск из корня репозитория:  node build/gen_engine_sup.js */
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
var totalChains = 0;

Object.keys(NHL).forEach(function (esn) {
  var machineId = NHL[esn];
  var cat = loadCatalog(esn);
  var cards = cat.cards || {};

  // название по номеру — в cards его нет, берём из первого совпадения в options.parts
  var nameByNo = {};
  (cat.options || []).forEach(function (o) {
    (o.parts || []).forEach(function (p) {
      if (p.no && p.name && !nameByNo[p.no]) nameByNo[p.no] = p.name;
    });
  });

  var seenChains = {};
  Object.keys(cards).forEach(function (pn) {
    var chain = cards[pn].sup || [];
    if (chain.length < 2) return;
    var last = chain[chain.length - 1];
    var cur = last && last.no !== pn ? last.no : null;
    if (!cur) return;
    var chainKey = chain.map(function (s) { return s.no; }).sort().join(",");
    if (seenChains[chainKey]) return;   // цепочка уже обработана через другой номер
    seenChains[chainKey] = 1;
    totalChains++;
    chain.forEach(function (s) {
      if (!s.no || s.no === cur) return;   // сам действующий номер индексировать не нужно
      var key = normNo(s.no);
      var arr = out[key] = out[key] || [];
      if (arr.some(function (r) { return r.esn === esn && r.cur === cur; })) return;
      arr.push({ esn: esn, machine: machineId, cur: cur, name: nameByNo[cur] || "" });
    });
  });
});

fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "engine_sup.js"),
  "window.ENGINE_SUP = " + JSON.stringify(out) + ";\n");
console.log("data/engine_sup.js — цепочек замен: " + totalChains +
  ", записей (старый номер -> действующий): " + Object.keys(out).length);
