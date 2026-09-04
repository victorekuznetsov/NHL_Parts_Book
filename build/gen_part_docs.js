/* Строит индекс «что ещё известно про номер» для единого приложения:

     window.PART_DOCS     — номер -> документы базы знаний (QuickServe), где он
                            упоминается, и русское наименование из базы;
     window.SERVICE_PAGES — машина -> раздел каталога -> инструкция по ремонту
                            этого раздела (адрес страницы и её название).

   Нужен, чтобы «Проверить список» и поиск в едином приложении показывали по
   найденному номеру не только каталог и цену, но и всю сопутствующую
   информацию: сервисные бюллетени и TSB, процедуры ремонта двигателя и
   инструкцию по ремонту того узла машины, где деталь стоит.

   Источники (всё уже лежит в репозитории):
     cummins/data/kb_parts.js  — номер -> "<категория>|<номер документа>";
     cummins/data/kb_docs.js   — названия и категории документов;
     nte240/data/service.js    — инструкции по ремонту NTE240 (свои страницы);
     cummins/data/kb/machine_*.js — инструкции по ремонту машин в базе знаний.

   Запуск из корня репозитория:  node build/gen_part_docs.js */
"use strict";
var fs = require("fs");
var vm = require("vm");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var MACHINES = { nte240: "NTE240", nte200: "NTE200", tr100: "TR100A" };

function load(rel, name) {
  var file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null;
  var ctx = { window: { KB_MACHINE: {} } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  return ctx.window[name];
}
function normNo(s) { return String(s || "").toUpperCase().replace(/[\s-]/g, ""); }

/* ------------------------------------------- номер -> документы базы знаний */
var PARTS = load("cummins/data/kb_parts.js", "KB_PARTS") || {};
var DOCS = load("cummins/data/kb_docs.js", "KB_DOCS") || {};
var partDocs = {}, withDocs = 0, links = 0;

Object.keys(PARTS).forEach(function (no) {
  var p = PARTS[no];
  var list = [];
  (p.d || []).forEach(function (ref) {
    var id = String(ref).split("|").pop();
    var d = DOCS[id];
    if (!d) return;
    if (list.some(function (x) { return x[0] === id; })) return;
    list.push([id, d.ru || d.t || id, d.c]);
  });
  if (!list.length && !p.ru) return;
  var rec = {};
  if (p.ru) rec.ru = p.ru;
  if (list.length) {
    /* сначала бюллетени и TSB — они про саму деталь, потом процедуры */
    var order = { bulletin: 0, tsb: 1, install_inst: 2, sti: 3, outlines: 4, manual: 5, procedures: 6 };
    list.sort(function (a, b) {
      return (order[a[2]] == null ? 9 : order[a[2]]) - (order[b[2]] == null ? 9 : order[b[2]]) ||
             a[0].localeCompare(b[0]);
    });
    rec.d = list;
    withDocs++;
    links += list.length;
  }
  partDocs[normNo(no)] = rec;
});

/* ------------------------- машина -> раздел -> инструкция по ремонту раздела */
var servicePages = {};
Object.keys(MACHINES).forEach(function (id) {
  var out = {};
  /* у машины могут быть свои страницы инструкций (nte240/service/<код>.html) */
  var own = load(id + "/data/service.js", "SERVICE") || {};
  Object.keys(own).forEach(function (code) {
    if (!fs.existsSync(path.join(ROOT, id, "service", code + ".html"))) return;
    out[code] = { t: own[code], u: id + "/service/" + code + ".html" };
  });
  /* остальные — только в базе знаний (страница #/msvc/<машина>/<код>) */
  var kb = load("cummins/data/kb/machine_" + MACHINES[id] + ".js", "KB_MACHINE");
  var data = kb && kb[MACHINES[id]];
  (data && data.svc || []).forEach(function (s) {
    if (out[s.c]) return;
    out[s.c] = { t: s.t, u: "cummins/index.html#/msvc/" + MACHINES[id] + "/" + s.c };
  });
  if (Object.keys(out).length) servicePages[id] = out;
});

var file = path.join(ROOT, "data", "part_docs.js");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file,
  "window.PART_DOCS = " + JSON.stringify(partDocs) + ";\n" +
  "window.SERVICE_PAGES = " + JSON.stringify(servicePages) + ";\n");

console.log("data/part_docs.js — номеров: " + Object.keys(partDocs).length +
  ", из них с документами: " + withDocs + " (ссылок " + links + ")");
Object.keys(servicePages).forEach(function (id) {
  console.log("  инструкции по ремонту " + MACHINES[id] + ": " +
    Object.keys(servicePages[id]).length);
});
console.log("  размер: " + (fs.statSync(file).size / 1024).toFixed(0) + " КБ");
