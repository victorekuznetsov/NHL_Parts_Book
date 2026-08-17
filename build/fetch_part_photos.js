/* Скачивает все фото деталей (оригиналы, без сжатия), на которые ссылаются
   карточки трёх наших двигателей Cummins, с CDN parts.cummins.com — и
   сохраняет локально в cummins/photos/<esn>/<файл>, зеркаля структуру CDN
   (.../graphics/parts/<num[0:3]>/<num>/<file>). После этого каталог не
   зависит ни от серверного прокси /api/photo, ни от прямого доступа клиента
   к parts.cummins.com — фото открываются офлайн так же, как чертежи.
   Запуск из корня репозитория:  node build/fetch_part_photos.js
   Докачивает только отсутствующие файлы — безопасно перезапускать. */
"use strict";
var fs = require("fs");
var vm = require("vm");
var path = require("path");
var https = require("https");

var ROOT = path.resolve(__dirname, "..");
var ESNS = ["33239746", "33239899", "37295879"];
var OUT_DIR = path.join(ROOT, "cummins", "photos");
var CONCURRENCY = 16;

function loadCatalog(esn) {
  var file = path.join(ROOT, "cummins", "data", esn + ".js");
  var ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  return ctx.window.CATALOGS[esn];
}

// собрать все уникальные имена файлов фото (p.img в позициях + CARDS[pn].views)
var files = {};
ESNS.forEach(function (esn) {
  var cat = loadCatalog(esn);
  (cat.options || []).forEach(function (o) {
    (o.parts || []).forEach(function (p) { if (p.img) files[p.img] = 1; });
  });
  var cards = cat.cards || {};
  Object.keys(cards).forEach(function (pn) {
    (cards[pn].views || []).forEach(function (v) { if (v) files[v] = 1; });
  });
});
var list = Object.keys(files).sort();
console.log("Всего файлов к скачиванию: " + list.length);

function localPath(file) {
  var num = file.split("_")[0];
  return path.join(OUT_DIR, num.slice(0, 3), num, file);
}
function cdnUrl(file) {
  var num = file.split("_")[0];
  return "https://parts.cummins.com/graphics/parts/" + num.slice(0, 3) + "/" + num + "/" + file;
}

function download(file, cb) {
  var dest = localPath(file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return cb(null, "skip");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  var tmp = dest + ".part";
  var req = https.get(cdnUrl(file), { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 20000 }, function (res) {
    if (res.statusCode !== 200) { res.resume(); return cb(null, "http" + res.statusCode); }
    var out = fs.createWriteStream(tmp);
    res.pipe(out);
    out.on("finish", function () {
      out.close(function () {
        fs.renameSync(tmp, dest);
        cb(null, "ok");
      });
    });
    out.on("error", function (e) { cb(e); });
  });
  req.on("error", function (e) { cb(e); });
  req.on("timeout", function () { req.destroy(new Error("timeout")); });
}

var i = 0, ok = 0, skip = 0, fail = 0, failed = [];
function next() {
  if (i >= list.length) return;
  var file = list[i++];
  download(file, function (err, status) {
    if (err || (status && status.indexOf("http") === 0)) {
      fail++; failed.push(file + " -> " + (err ? err.message : status));
    } else if (status === "skip") skip++;
    else ok++;
    var done = ok + skip + fail;
    if (done % 200 === 0 || done === list.length) {
      console.log("progress " + done + "/" + list.length + " (ok=" + ok + " skip=" + skip + " fail=" + fail + ")");
    }
    if (done === list.length) {
      if (failed.length) {
        fs.writeFileSync(path.join(ROOT, "build", "photo_fetch_failures.txt"), failed.join("\n") + "\n");
        console.log("Не скачано: " + failed.length + " — список в build/photo_fetch_failures.txt");
      } else if (fs.existsSync(path.join(ROOT, "build", "photo_fetch_failures.txt"))) {
        fs.unlinkSync(path.join(ROOT, "build", "photo_fetch_failures.txt"));
      }
      console.log("Готово: ok=" + ok + " skip=" + skip + " fail=" + fail);
      return;
    }
    next();
  });
}
for (var c = 0; c < CONCURRENCY; c++) next();
