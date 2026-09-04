/* Build the unified catalog data files from the three per-machine sandboxes,
   pricing ALL machines from the single central price list in the repo root
   ("*.xlsx"). Emits:
     data/catalogs.js       -> window.MACHINES, window.CATALOGS
     data/prices.js         -> window.PRICES_BY   (unified app)
     <machine>/data/prices.js -> window.PRICES    (native subfolder apps)
   Run from the repo root:  node build/gen_data.js
*/
"use strict";
var fs = require("fs");
var vm = require("vm");
var path = require("path");
var readXlsx = require("./read_xlsx.js").readXlsx;

var ROOT = path.resolve(__dirname, "..");

var MACHINES = [
  { id: "nte240", name: "NTE240", subtitle: "электромеханический самосвал NHL (Cummins QSK60)",
    currency: "CNY", hashPrefix: "#/s/", hasEngine: true, hasService: true,
    engineSite: "cummins/index.html?esn=33239746", engineLabel: "Двигатель Cummins QSK60 CM2150 (EPC, parts.cummins.com · ESN 33239746)" },
  { id: "nte200", name: "NTE200", subtitle: "электромеханический самосвал NHL",
    currency: "CNY", hashPrefix: "#", hasEngine: false, hasService: false,
    engineSite: "cummins/index.html?esn=33239899", engineLabel: "Двигатель Cummins QSK50 CM2150 (EPC, parts.cummins.com · ESN 33239899)" },
  { id: "tr100", name: "TR100A", subtitle: "механический самосвал NHL (Cummins QST30)",
    currency: "CNY", hashPrefix: "#", hasEngine: true, hasService: true,
    engineSite: "cummins/index.html?esn=37295879", engineLabel: "Двигатель Cummins QST30 CM552 (EPC, parts.cummins.com · ESN 37295879)" }
];

// Split a machine's chapters into categories: electric drive (600), the EPC
// Cummins engine (QO*), and the superseded "из PDF" engine (Q\d / 700) which is
// hidden from the Машина/Двигатель navigation.
function classifyChapters(chapters) {
  var drive = [], enginePdf = [], engineEpc = [];
  chapters.forEach(function (c) {
    var code = c.code;
    if (code === "600") drive.push(code);
    else if (/^QO/.test(code)) engineEpc.push(code);
    else if (/^Q\d/.test(code)) enginePdf.push(code);
    else if (code === "700") enginePdf.push(code);
  });
  return { drive: drive, enginePdf: enginePdf, engineEpc: engineEpc };
}

function loadGlobal(file, name) {
  var ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  return ctx.window[name];
}

// Remove duplicate engine numbers: when a machine carries BOTH the Cummins EPC
// engine and the superseded "из PDF" engine (Q\d / 700), every part number that
// the EPC already lists is stripped from the PDF sections. The EPC side comes
// either from the machine's own QO* chapters (NTE200) or from the standalone
// EPC catalog cummins/data/<ESN>.js (NTE240, TR100A — their engine lives in the
// separate site, so the machine book has no QO* chapters at all).
// Numbers unique to the PDF are kept (they are real parts EPC omits). PDF
// figures/sections that end up with no numbered parts are dropped, and
// now-empty PDF chapters are pruned. The EPC keeps every drawing (verified
// richer than the PDF), so no images are borrowed.
// Returns {removed, keptUnique} for reporting.
function dedupePdfEngine(cat, epcChapters, pdfChapters, sitePns) {
  if (!pdfChapters.length) return { removed: 0, keptUnique: 0 };
  if (!epcChapters.length && !sitePns) return { removed: 0, keptUnique: 0 };
  var isPdf = {}; pdfChapters.forEach(function (c) { isPdf[c] = 1; });
  var isEpc = {}; epcChapters.forEach(function (c) { isEpc[c] = 1; });
  var epcPns = {};
  cat.sections.forEach(function (s) {
    if (!isEpc[s.chapter]) return;
    (s.figures || []).forEach(function (f) {
      (f.parts || []).forEach(function (p) { if (p.pn) epcPns[normPn(p.pn)] = 1; });
    });
  });
  if (sitePns) Object.keys(sitePns).forEach(function (k) { epcPns[k] = 1; });
  var removed = 0, keptUnique = 0;
  cat.sections.forEach(function (s) {
    if (!isPdf[s.chapter]) return;
    (s.figures || []).forEach(function (f) {
      f.parts = (f.parts || []).filter(function (p) {
        if (p.pn && epcPns[normPn(p.pn)]) { removed++; return false; }
        if (p.pn) keptUnique++;
        return true;
      });
    });
    // keep only figures that still hold a numbered part
    s.figures = (s.figures || []).filter(function (f) {
      return (f.parts || []).some(function (p) { return p.pn; });
    });
  });
  cat.sections = cat.sections.filter(function (s) {
    return !isPdf[s.chapter] || (s.figures || []).length > 0;
  });
  var used = {}; cat.sections.forEach(function (s) { used[s.chapter] = 1; });
  cat.chapters = cat.chapters.filter(function (c) { return !isPdf[c.code] || used[c.code]; });
  return { removed: removed, keptUnique: keptUnique };
}

// Part numbers of the standalone EPC engine catalog (cummins/data/<ESN>.js).
// Read from options[].parts[] and cards{} — together they cover everything the
// EPC site can show for that ESN. Null when the machine has no engine site.
function normPn(s) { return String(s || "").toUpperCase().replace(/[\s-]/g, ""); }
function epcSitePns(engineSite) {
  var m = /[?&]esn=(\d+)/.exec(engineSite || "");
  if (!m) return null;
  var file = path.join(ROOT, "cummins", "data", m[1] + ".js");
  if (!fs.existsSync(file)) return null;
  var cat = (loadGlobal(file, "CATALOGS") || {})[m[1]];
  if (!cat) return null;
  var out = {};
  (cat.options || []).forEach(function (o) {
    (o.parts || []).forEach(function (p) { if (p.no) out[normPn(p.no)] = 1; });
  });
  Object.keys(cat.cards || {}).forEach(function (no) { out[normPn(no)] = 1; });
  return out;
}

// ---- central price list -------------------------------------------------
function normArt(x) {
  if (x == null) return "";
  var s = String(x).replace(/ /g, " ").trim();
  if (/\.0$/.test(s)) s = s.slice(0, -2);
  return s;
}
function toPrice(x) {
  if (x == null || x === "") return null;
  var s = String(x).replace(/ /g, "").replace(/\s/g, "").replace(",", ".");
  var v = parseFloat(s);
  return isNaN(v) ? null : Math.round(v * 100) / 100;
}
// Mirrors app.js rowsToPrices: keyed by Артикул and by Взаимозаменяемый артикул.
function buildPriceMap(rows) {
  var hr = -1, col = { art: 0, xref: 1, name: 2, price: 3, group: 4 };
  for (var i = 0; i < rows.length && hr < 0; i++) {
    var row = rows[i] || [];
    for (var c = 0; c < row.length; c++) {
      if (typeof row[c] === "string" && row[c].trim() === "Артикул") { hr = i; break; }
    }
    if (hr === i) {
      row.forEach(function (cell, c) {
        var v = (typeof cell === "string" ? cell : "").trim().toLowerCase();
        if (v === "артикул") col.art = c;
        else if (v.indexOf("заменя") >= 0) col.xref = c;
        else if (v.indexOf("наимен") >= 0) col.name = c;
        else if (v.indexOf("цена") >= 0) col.price = c;
        else if (v.indexOf("группа") >= 0) col.group = c;
      });
    }
  }
  if (hr < 0) throw new Error("не найден столбец «Артикул» в прайсе");
  var out = {};
  for (var r = hr + 1; r < rows.length; r++) {
    var rw = rows[r] || [], art = normArt(rw[col.art]);
    if (!art) continue;
    var rec = {
      p: toPrice(rw[col.price]),
      g: rw[col.group] != null ? String(rw[col.group]).replace(/ /g, " ").trim() : "",
      x: normArt(rw[col.xref]),
      n: rw[col.name] != null ? String(rw[col.name]).replace(/ /g, " ").trim() : ""
    };
    if (!(art in out)) out[art] = rec;
    if (rec.x && !(rec.x in out)) out[rec.x] = { p: rec.p, g: rec.g, x: rec.x, n: rec.n };
  }
  return out;
}

// Два прайс-листа лежат в корне репозитория одновременно: "...на согласование..."
// — согласованный прайс (основной, по нему считаются заказы и остальная логика
// сайта не меняется), и второй файл (без "на согласование" в имени) — текущий
// прайс, который показывается рядом только для сравнения.
var xlsxFiles = fs.readdirSync(ROOT).filter(function (n) { return /\.xlsx$/i.test(n); });
var agreedFile = xlsxFiles.filter(function (n) { return /на\s*согласовани/i.test(n); })[0];
var curFile = xlsxFiles.filter(function (n) { return n !== agreedFile; })[0];
if (!agreedFile) throw new Error("не найден файл согласованного прайса («...на согласование...») в корне репозитория");
if (!curFile) throw new Error("не найден файл текущего прайса (без «на согласование» в названии) в корне репозитория");
var PRICE_MAP = buildPriceMap(readXlsx(path.join(ROOT, agreedFile)));
var CUR_MAP = buildPriceMap(readXlsx(path.join(ROOT, curFile)));
console.log("Согласованный прайс: " + agreedFile + " — записей: " + Object.keys(PRICE_MAP).length);
console.log("Текущий прайс: " + curFile + " — записей: " + Object.keys(CUR_MAP).length);

// Prices for the standalone Cummins engine catalog (cummins/), keyed by a
// normalised part number (uppercase, no spaces/dashes) to match its normNo().
// Loaded as the default price base there, so engine prices show without a manual
// upload; a user-loaded price file still overlays on top.
(function () {
  var cum = {}, cumCur = {};
  Object.keys(PRICE_MAP).forEach(function (art) {
    var rec = PRICE_MAP[art];
    if (!rec || rec.p == null) return;
    var k = String(art).toUpperCase().replace(/[\s-]/g, "");
    if (k) cum[k] = rec.p;
  });
  Object.keys(CUR_MAP).forEach(function (art) {
    var rec = CUR_MAP[art];
    if (!rec || rec.p == null) return;
    var k = String(art).toUpperCase().replace(/[\s-]/g, "");
    if (k) cumCur[k] = rec.p;
  });
  fs.writeFileSync(path.join(ROOT, "cummins", "data", "prices.js"),
    "window.CUMMINS_PRICES = " + JSON.stringify(cum) + ";\n" +
    "window.CUMMINS_PRICES_CUR = " + JSON.stringify(cumCur) + ";\n");
  console.log("cummins/data/prices.js — согласованных цен: " + Object.keys(cum).length +
    ", текущих: " + Object.keys(cumCur).length);
})();

// ---- catalogs + per-machine prices -------------------------------------
function rewriteImages(catalog, base) {
  (catalog.sections || []).forEach(function (s) {
    (s.figures || []).forEach(function (f) {
      f.images = (f.images || []).map(function (img) {
        if (!img) return img;
        if (/^(https?:)?\/\//.test(img) || img.indexOf(base + "/") === 0) return img;
        return base + "/" + img;
      });
    });
  });
  return catalog;
}

var CATALOGS = {};
var PRICES_BY = {};
var stats = [];

MACHINES.forEach(function (m) {
  var dir = path.join(ROOT, m.id, "data");
  var cat = loadGlobal(path.join(dir, "parts.js"), "CATALOG");
  rewriteImages(cat, m.id);
  m.title_en = cat.title_en || m.name;
  m.title_zh = cat.title_zh || "";
  var cls = classifyChapters(cat.chapters || []);
  m.driveChapters = cls.drive;
  m.enginePdfChapters = cls.enginePdf;
  m.engineEpcChapters = cls.engineEpc;
  var dd = dedupePdfEngine(cat, cls.engineEpc, cls.enginePdf, epcSitePns(m.engineSite));
  if (dd.removed) console.log("  " + m.id + ": удалено дублей двигателя (PDF\u2194EPC): " + dd.removed +
    ", сохранено уникальных PDF-номеров: " + dd.keptUnique);
  // главы «из PDF» могли опустеть — оставляем в списке только выжившие
  var alive = {}; (cat.chapters || []).forEach(function (c) { alive[c.code] = 1; });
  m.enginePdfChapters = cls.enginePdf.filter(function (c) { return alive[c]; });
  CATALOGS[m.id] = { chapters: cat.chapters || [], sections: cat.sections || [] };

  // catalog part numbers -> price from the central list (keep map small).
  // Каждая запись несёт согласованную цену (p, как раньше) и рядом — текущую
  // (cp) из отдельного прайса, по тому же артикулу/взаимозамене.
  var prices = {}, total = 0, priced = 0, pricedCur = 0;
  var seen = {};
  (cat.sections || []).forEach(function (s) {
    (s.figures || []).forEach(function (f) {
      (f.parts || []).forEach(function (p) {
        if (!p.pn || seen[p.pn]) return;
        seen[p.pn] = 1; total++;
        var rec = PRICE_MAP[normArt(p.pn)];
        if (!rec) return;
        var curRec = CUR_MAP[normArt(p.pn)] || (rec.x && CUR_MAP[rec.x]);
        var cp = curRec ? curRec.p : null;
        prices[p.pn] = { p: rec.p, g: rec.g, x: rec.x, n: rec.n, cp: cp };
        if (rec.p != null) priced++;
        if (cp != null) pricedCur++;
      });
    });
  });
  PRICES_BY[m.id] = prices;
  // write the native subfolder prices.js too, so those catalogs match
  fs.writeFileSync(path.join(dir, "prices.js"),
    "window.PRICES = " + JSON.stringify(prices) + ";\n");

  stats.push(m.id + ": уник. номеров " + total + ", с согласованной ценой " + priced +
    " (" + Math.round(priced / total * 100) + "%), с текущей " + pricedCur +
    ", всего сматчено " + Object.keys(prices).length);
});

var machinesOut = MACHINES.map(function (m) {
  return {
    id: m.id, name: m.name, subtitle: m.subtitle, currency: m.currency,
    hashPrefix: m.hashPrefix, hasEngine: m.hasEngine, hasService: m.hasService,
    title_en: m.title_en, title_zh: m.title_zh,
    driveChapters: m.driveChapters, enginePdfChapters: m.enginePdfChapters,
    engineEpcChapters: m.engineEpcChapters, engineSite: m.engineSite, engineLabel: m.engineLabel
  };
});

fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "catalogs.js"),
  "window.MACHINES = " + JSON.stringify(machinesOut) + ";\n" +
  "window.CATALOGS = " + JSON.stringify(CATALOGS) + ";\n");
fs.writeFileSync(path.join(ROOT, "data", "prices.js"),
  "window.PRICES_BY = " + JSON.stringify(PRICES_BY) + ";\n");

console.log("Записано: data/catalogs.js, data/prices.js и <машина>/data/prices.js");
stats.forEach(function (s) { console.log("  " + s); });
