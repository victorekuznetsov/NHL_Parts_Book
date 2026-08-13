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
    engineSite: "nte240/engine/index.html", engineLabel: "Двигатель Cummins QSK60 (EPC, с сайта Cummins)" },
  { id: "nte200", name: "NTE200", subtitle: "электромеханический самосвал NHL",
    currency: "CNY", hashPrefix: "#", hasEngine: false, hasService: false,
    engineSite: "", engineLabel: "Двигатель Cummins (EPC, с сайта Cummins)" },
  { id: "tr100", name: "TR100A", subtitle: "механический самосвал NHL (Cummins QST30)",
    currency: "CNY", hashPrefix: "#", hasEngine: true, hasService: true,
    engineSite: "tr100/qst30-cummins/index.html", engineLabel: "Двигатель Cummins QST30 (EPC, с сайта Cummins)" }
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

// Remove duplicate engine numbers: when a machine carries BOTH the EPC Cummins
// engine (QO*) and the superseded "из PDF" engine (Q\d), every part number that
// the EPC already lists is stripped from the PDF sections. Numbers unique to the
// PDF are kept (they are real parts EPC omits). PDF figures/sections that end up
// with no numbered parts are dropped, and now-empty PDF chapters are pruned.
// The EPC keeps every drawing (verified richer than the PDF), so no images are
// borrowed. Returns {removed, keptUnique} for reporting.
function dedupePdfEngine(cat, epcChapters, pdfChapters) {
  if (!epcChapters.length || !pdfChapters.length) return { removed: 0, keptUnique: 0 };
  var isPdf = {}; pdfChapters.forEach(function (c) { isPdf[c] = 1; });
  var isEpc = {}; epcChapters.forEach(function (c) { isEpc[c] = 1; });
  var epcPns = {};
  cat.sections.forEach(function (s) {
    if (!isEpc[s.chapter]) return;
    (s.figures || []).forEach(function (f) {
      (f.parts || []).forEach(function (p) { if (p.pn) epcPns[p.pn] = 1; });
    });
  });
  var removed = 0, keptUnique = 0;
  cat.sections.forEach(function (s) {
    if (!isPdf[s.chapter]) return;
    (s.figures || []).forEach(function (f) {
      f.parts = (f.parts || []).filter(function (p) {
        if (p.pn && epcPns[p.pn]) { removed++; return false; }
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

var priceFile = fs.readdirSync(ROOT).filter(function (n) { return /\.xlsx$/i.test(n); }).sort()[0];
if (!priceFile) throw new Error("не найден файл прайса (*.xlsx) в корне репозитория");
var PRICE_MAP = buildPriceMap(readXlsx(path.join(ROOT, priceFile)));
console.log("Прайс: " + priceFile + " — записей в карте цен: " + Object.keys(PRICE_MAP).length);

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
  var dd = dedupePdfEngine(cat, cls.engineEpc, cls.enginePdf);
  if (dd.removed) console.log("  " + m.id + ": удалено дублей двигателя (PDF↔EPC): " + dd.removed +
    ", сохранено уникальных PDF-номеров: " + dd.keptUnique);
  CATALOGS[m.id] = { chapters: cat.chapters || [], sections: cat.sections || [] };

  // catalog part numbers -> price from the central list (keep map small)
  var prices = {}, total = 0, priced = 0;
  var seen = {};
  (cat.sections || []).forEach(function (s) {
    (s.figures || []).forEach(function (f) {
      (f.parts || []).forEach(function (p) {
        if (!p.pn || seen[p.pn]) return;
        seen[p.pn] = 1; total++;
        var rec = PRICE_MAP[normArt(p.pn)];
        if (rec) { prices[p.pn] = rec; if (rec.p != null) priced++; }
      });
    });
  });
  PRICES_BY[m.id] = prices;
  // write the native subfolder prices.js too, so those catalogs match
  fs.writeFileSync(path.join(dir, "prices.js"),
    "window.PRICES = " + JSON.stringify(prices) + ";\n");

  stats.push(m.id + ": уник. номеров " + total + ", с ценой из прайса " + priced +
    " (" + Math.round(priced / total * 100) + "%), всего сматчено " + Object.keys(prices).length);
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
