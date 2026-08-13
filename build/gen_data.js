/* Build the unified catalog data files from the three per-machine sandboxes.
   Reads each machine's data/parts.js (window.CATALOG) and data/prices.js
   (window.PRICES), rewrites drawing paths to point into the machine subfolder,
   and emits:
     data/catalogs.js  -> window.MACHINES, window.CATALOGS
     data/prices.js    -> window.PRICES_BY
   Run from the repo root:  node build/gen_data.js
*/
"use strict";
var fs = require("fs");
var vm = require("vm");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");

// Machine registry — order defines the switcher order. `hashPrefix` matches the
// native subfolder app's routing so a section can deep-link into its own book.
var MACHINES = [
  { id: "nte240", name: "NTE240", subtitle: "электромеханический самосвал NHL (Cummins QSK60)",
    currency: "CNY", hashPrefix: "#/s/", hasEngine: true, hasService: true },
  { id: "nte200", name: "NTE200", subtitle: "электромеханический самосвал NHL",
    currency: "CNY", hashPrefix: "#", hasEngine: false, hasService: false },
  { id: "tr100", name: "TR100A", subtitle: "механический самосвал NHL (Cummins QST30)",
    currency: "CNY", hashPrefix: "#", hasEngine: true, hasService: true }
];

function loadGlobal(file, name) {
  var ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  return ctx.window[name];
}

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
  var prices = loadGlobal(path.join(dir, "prices.js"), "PRICES");
  rewriteImages(cat, m.id);
  // carry the machine's own book titles through for reference
  m.title_en = cat.title_en || m.name;
  m.title_zh = cat.title_zh || "";
  CATALOGS[m.id] = { chapters: cat.chapters || [], sections: cat.sections || [] };
  PRICES_BY[m.id] = prices || {};

  var pns = 0;
  (cat.sections || []).forEach(function (s) {
    (s.figures || []).forEach(function (f) {
      (f.parts || []).forEach(function (p) { if (p.pn) pns++; });
    });
  });
  stats.push(m.id + ": chapters " + (cat.chapters || []).length +
    ", sections " + (cat.sections || []).length + ", parts " + pns +
    ", prices " + Object.keys(prices || {}).length);
});

// MACHINES for the app: keep only the fields the runtime needs.
var machinesOut = MACHINES.map(function (m) {
  return {
    id: m.id, name: m.name, subtitle: m.subtitle, currency: m.currency,
    hashPrefix: m.hashPrefix, hasEngine: m.hasEngine, hasService: m.hasService,
    title_en: m.title_en, title_zh: m.title_zh
  };
});

fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "catalogs.js"),
  "window.MACHINES = " + JSON.stringify(machinesOut) + ";\n" +
  "window.CATALOGS = " + JSON.stringify(CATALOGS) + ";\n");
fs.writeFileSync(path.join(ROOT, "data", "prices.js"),
  "window.PRICES_BY = " + JSON.stringify(PRICES_BY) + ";\n");

console.log("Wrote data/catalogs.js and data/prices.js");
stats.forEach(function (s) { console.log("  " + s); });
