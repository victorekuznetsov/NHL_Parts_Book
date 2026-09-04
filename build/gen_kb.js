/* Переносит базу знаний Cummins (репозиторий Cummins_Parts_Book) в каталог
   двигателя `cummins/` этого репозитория, оставляя только то, что относится к
   трём двигателям парка NHL:

     NTE240 — QSK60 CM2150 MCRS, ESN 33239746
     NTE200 — QSK50 CM2150 MCRS, ESN 33239899
     TR100A — QST30 CM552,       ESN 37295879

   Что делает:
   1. Фильтрует данные базы знаний (документы QuickServe, руководства, детали,
      темы, поиск, машины) по этим ESN и по трём машинам NHL.
   2. Складывает тексты документов кусками (data/kb/body_*.js) — только по
      отобранным документам, нумерация кусков сохраняется.
   3. Копирует рисунки процедур (assets/figures), на которые ссылаются
      отобранные тексты.
   4. Копирует PDF документов, кроме процедур: их полный текст с рисунками уже
      лежит в базе, а PDF процедур — это ~650 МБ, которые каталогу не нужны.
   5. Ничего не дублирует: фотографии деталей берутся из cummins/photos,
      чертежи и руководства машин — из nte240/, nte200/, tr100/. Пути к ним
      переписываются прямо в данных.

   Запуск из корня репозитория:

     node build/gen_kb.js [путь-к-Cummins_Parts_Book]

   По умолчанию исходник ищется в ../Cummins_Parts_Book (или в переменной
   окружения CUMMINS_KB_SRC). */
"use strict";

var fs = require("fs");
var vm = require("vm");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var DST = path.join(ROOT, "cummins");
var SRC = path.resolve(process.argv[2] || process.env.CUMMINS_KB_SRC ||
                       path.join(ROOT, "..", "Cummins_Parts_Book"));

/* двигатели и машины NHL */
var ESN = ["33239746", "33239899", "37295879"];
var ESN_SET = {};
ESN.forEach(function (e) { ESN_SET[e] = 1; });
var MACHINES = { NTE240: "nte240", NTE200: "nte200", TR100A: "tr100" };

/* PDF каких категорий переносим целиком. Процедуры не берём — их полный текст
   с рисунками лежит в базе, а PDF всех процедур это ~650 МБ. Исключение:
   процедуры без выгруженного текста — для них PDF единственный источник, они
   переносятся всегда (см. ниже, после сборки текстов). */
var PDF_CATS = { manual: 1, tsb: 1, bulletin: 1, sti: 1, install_inst: 1, outlines: 1 };

if (!fs.existsSync(path.join(SRC, "kb.js"))) {
  console.error("Не найден исходный каталог Cummins с базой знаний: " + SRC);
  console.error("Укажите путь: node build/gen_kb.js /путь/к/Cummins_Parts_Book");
  process.exit(1);
}

/* ------------------------------------------------------------- утилиты */
function loadFrom(base, rel, name) {
  var file = path.join(base, rel);
  /* куски текстов и машин дописываются в уже существующие объекты */
  var ctx = { window: { KB_BODY: {}, KB_BODY_RU: {}, KB_MACHINE: {} } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  return ctx.window[name];
}
function loadVar(rel, name) { return loadFrom(SRC, rel, name); }
function writeVar(rel, name, value) {
  var file = path.join(DST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "window." + name + "=" + JSON.stringify(value) + ";\n");
  return fs.statSync(file).size;
}
function mb(n) { return (n / 1048576).toFixed(1) + " МБ"; }
function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return fs.statSync(to).size;
}

/* ------------------------------------- где в NHL уже лежит файл машины */
/* Все чертежи и страницы руководств машин NHL уже есть в подпапках
   nte240/, nte200/, tr100/ — второй копии в базе знаний не нужно.
   Строим соответствие «имя файла из базы знаний → путь относительно cummins/». */
var mediaIndex = {};   // machine -> { "<stem>": [ {rel, size}, ... ] }
Object.keys(MACHINES).forEach(function (m) {
  var dir = path.join(ROOT, MACHINES[m]);
  var idx = (mediaIndex[m] = {});
  (function walk(d) {
    var names;
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    names.forEach(function (ent) {
      var p = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(p); return; }
      var stem = ent.name.replace(/\.[^.]+$/, "");
      (idx[stem] = idx[stem] || []).push({
        rel: "../" + path.relative(ROOT, p).split(path.sep).join("/"),
        size: fs.statSync(p).size
      });
    });
  })(dir);
});
/* приоритет каталогов при неоднозначности */
var DIR_RANK = ["/drawings/", "/service_media/", "/manual_media/", "/manuals/", "/service/"];
function rank(rel) {
  for (var i = 0; i < DIR_RANK.length; i++) if (rel.indexOf(DIR_RANK[i]) >= 0) return i;
  return DIR_RANK.length;
}
var mediaMissing = [];
function localMedia(machine, file) {
  var base = String(file).split("/").pop();
  var stem = base.replace(/\.[^.]+$/, "");
  if (stem.indexOf(machine + "_") === 0) stem = stem.slice(machine.length + 1);
  var cand = (mediaIndex[machine] || {})[stem];
  if (!cand || !cand.length) { mediaMissing.push(machine + "/" + base); return ""; }
  var src = path.join(SRC, "assets", "machines", machine, base);
  var size = fs.existsSync(src) ? fs.statSync(src).size : -1;
  var same = cand.filter(function (c) { return c.size === size; });
  var list = same.length ? same : cand;
  list = list.slice().sort(function (a, b) { return rank(a.rel) - rank(b.rel); });
  return list[0].rel;
}

/* ============================================================ документы */
var DOCS = loadVar("data/kb_docs.js", "KB_DOCS");
var docs = {};
Object.keys(DOCS).forEach(function (id) {
  var d = DOCS[id];
  if (!(d.e || []).some(function (e) { return ESN_SET[e]; })) return;
  docs[id] = d;
});
var docIds = Object.keys(docs);
var docSet = {};
docIds.forEach(function (id) { docSet[id] = 1; });

/* внутренние ссылки — только на оставшиеся документы; PDF процедур не берём */
docIds.forEach(function (id) {
  var d = docs[id];
  d.e = (d.e || []).filter(function (e) { return ESN_SET[e]; });
  if (d.bl) d.bl = d.bl.filter(function (x) { return docSet[x] || docSet[x + "-history"]; });
});

/* ========================================================= руководства */
var MAN = loadVar("data/kb_manuals.js", "KB_MANUALS");
var man = {};
Object.keys(MAN).forEach(function (id) {
  var m = MAN[id];
  if (!(m.e || []).some(function (e) { return ESN_SET[e]; })) return;
  m.e = m.e.filter(function (e) { return ESN_SET[e]; });
  man[id] = m;
});

/* ============================================================== детали */
var PARTS = loadVar("data/kb_parts.js", "KB_PARTS");
var parts = {};
Object.keys(PARTS).forEach(function (no) {
  var p = PARTS[no];
  if (!(p.e || []).some(function (e) { return ESN_SET[e]; })) return;
  p.e = p.e.filter(function (e) { return ESN_SET[e]; });
  if (p.d) p.d = p.d.filter(function (x) { return docSet[x]; });
  delete p.ph_local;
  parts[no] = p;
});

/* детали машин: в базе знаний это ровно три машины NHL */
var MPARTS = loadVar("data/kb_mparts.js", "KB_MPARTS");
var mparts = {};
Object.keys(MPARTS).forEach(function (no) {
  var p = MPARTS[no], keep = {};
  Object.keys(p.m || {}).forEach(function (m) { if (MACHINES[m]) keep[m] = p.m[m]; });
  if (!Object.keys(keep).length) return;
  p.m = keep;
  mparts[no] = p;
});

/* =============================================== наименования по-русски */
var NAMES = loadVar("data/kb_names.js", "KB_NAMES");
var optSet = {}, kitSet = {}, partSet = {};
ESN.forEach(function (esn) {
  /* каталог двигателя берём из этого репозитория, а не из исходника */
  var cat = loadFrom(ROOT, "cummins/data/" + esn + ".js", "CATALOGS")[esn];
  (cat.options || []).forEach(function (o) {
    optSet[o.no] = 1;
    (o.parts || []).forEach(function (p) { if (p.no) partSet[p.no] = 1; });
  });
  (cat.kits || []).forEach(function (k) {
    kitSet[k.no] = 1;
    (k.parts || []).forEach(function (p) { if (p.no) partSet[p.no] = 1; });
  });
});
function pick(src, set) {
  var out = {};
  Object.keys(src || {}).forEach(function (k) { if (set[k]) out[k] = src[k]; });
  return out;
}
var names = {
  opt: pick(NAMES.opt, optSet),
  kit: pick(NAMES.kit, kitSet),
  part: pick(NAMES.part, partSet)
};

/* ================================================================ темы */
var TOPICS = loadVar("data/kb_topics.js", "KB_TOPICS").map(function (t) {
  return { t: t.t, d: t.d, ids: (t.ids || []).filter(function (id) { return docSet[id]; }) };
}).filter(function (t) { return t.ids.length; });

/* =============================================================== поиск */
var SEARCH = loadVar("data/kb_search.js", "KB_SEARCH")
  .filter(function (r) { return docSet[r[0]]; });

/* ============================================================== машины */
var MLIST = loadVar("data/kb_machines.js", "KB_MACHINE_LIST");
var mlist = {};
Object.keys(MLIST).forEach(function (m) { if (MACHINES[m]) mlist[m] = MLIST[m]; });

/* картинки машин — ссылками на уже имеющиеся файлы подпапок машин */
var MEDIA = loadVar("data/kb_media.js", "KB_MEDIA");
var media = {};
Object.keys(MEDIA).forEach(function (m) {
  if (!MACHINES[m]) return;
  var out = (media[m] = {});
  Object.keys(MEDIA[m]).forEach(function (key) {
    var rel = localMedia(m, MEDIA[m][key]);
    if (rel) out[key] = rel;
  });
});

/* ======================================== тексты документов (по кускам) */
var byChunk = {};
docIds.forEach(function (id) {
  var ch = docs[id].ch;
  if (ch == null || ch < 0) return;
  (byChunk[ch] = byChunk[ch] || []).push(id);
});
var figs = {}, hasBody = {};
var bodyBytes = 0, bodyFiles = 0;
Object.keys(byChunk).forEach(function (ch) {
  ["", "_ru"].forEach(function (suf) {
    var rel = "data/kb/body" + suf + "_" + ch + ".js";
    if (!fs.existsSync(path.join(SRC, rel))) return;
    var store = loadVar(rel, suf ? "KB_BODY_RU" : "KB_BODY");
    var src = store[ch] || {}, out = {};
    byChunk[ch].forEach(function (id) {
      var b = src[id];
      if (!b) return;
      out[id] = b;
      hasBody[id] = 1;
      (b.match(/assets\/figures\/[\w.\-]+\.png/g) || []).forEach(function (f) {
        figs[f.split("/").pop()] = 1;
      });
    });
    if (!Object.keys(out).length) return;
    var varName = suf ? "KB_BODY_RU" : "KB_BODY";
    var file = path.join(DST, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file,
      "window." + varName + "=window." + varName + "||{};\n" +
      "window." + varName + "[" + ch + "]=" + JSON.stringify(out) + ";\n");
    bodyBytes += fs.statSync(file).size;
    bodyFiles++;
  });
});

/* ------------------------- руководства и инструкции из каталога машины */
/* Читаем <машина>/data/manuals.js и <машина>/data/service.js: первый даёт
   список PDF, второй — актуальные названия разделов ремонта и разделы,
   которых в выгрузке базы знаний ещё нет (их текст берём из
   <машина>/service/<код>.html). */
function machineDocs(m) {
  var dir = path.join(ROOT, MACHINES[m]);
  var man = [], svc = [];
  var manFile = path.join(dir, "data", "manuals.js");
  if (fs.existsSync(manFile)) {
    var mm = loadFrom(dir, "data/manuals.js", "MANUALS") || {};
    man = (mm.files || []).filter(function (f) {
      return fs.existsSync(path.join(dir, f.file));
    });
  }
  var svcFile = path.join(dir, "data", "service.js");
  if (fs.existsSync(svcFile)) {
    var titles = loadFrom(dir, "data/service.js", "SERVICE") || {};
    Object.keys(titles).sort().forEach(function (code) {
      var page = path.join(dir, "service", code + ".html");
      if (!fs.existsSync(page)) return;
      svc.push({ c: code, t: titles[code], b: serviceBody(page, m) });
    });
  }
  return { man: man, svc: svc };
}
/* тело инструкции со страницы каталога машины; пути к картинкам — на файлы
   машины, как и во всей базе знаний */
function serviceBody(page, m) {
  var html = fs.readFileSync(page, "utf8");
  var body = /<div id="doc">([\s\S]*?)<\/div>\s*<\/main>/.exec(html);
  if (!body) return "";
  return body[1].replace(/src="\.\.\/([\w\-]+)\/([\w.\-]+)"/g, function (all, dir, file) {
    return 'src="../' + MACHINES[m] + "/" + dir + "/" + file + '"';
  });
}
/* названия и тексты из каталога машины важнее выгрузки; разделы, которых
   в каталоге машины нет, оставляем как были */
function mergeSvc(fromKb, own) {
  var byCode = {};
  fromKb.forEach(function (s) { byCode[s.c] = s; });
  own.forEach(function (s) {
    var cur = byCode[s.c];
    byCode[s.c] = { c: s.c, t: s.t, b: s.b || (cur && cur.b) || "" };
  });
  return Object.keys(byCode).sort().map(function (c) { return byCode[c]; });
}

/* =================================== машины: разделы, ремонт, чертежи */
var machineFiles = 0, machineBytes = 0;
Object.keys(MACHINES).forEach(function (m) {
  var rel = "data/kb/machine_" + m + ".js";
  if (!fs.existsSync(path.join(SRC, rel))) return;
  var data = loadVar(rel, "KB_MACHINE")[m];
  /* прямые ссылки на картинки в текстах инструкций — на файлы машины */
  data = JSON.parse(JSON.stringify(data)
    .replace(/assets\/machines\/([A-Z0-9]+)\/([\w.\-]+)/g, function (all, mm, file) {
      return localMedia(mm, file) || all;
    }));
  /* Каталог самой машины — источник истины по её руководствам и инструкциям
     по ремонту: там они пополняются (см. build/gen_nte240_service.py), поэтому
     список PDF и названия разделов берём оттуда, а не из выгрузки. */
  var own = machineDocs(m);
  if (own.man.length) data.man = own.man;
  if (own.svc.length) data.svc = mergeSvc(data.svc || [], own.svc);
  /* руководства машины лежат в её собственной подпапке */
  (data.man || []).forEach(function (f) {
    f.url = "../" + MACHINES[m] + "/" + String(f.file).replace(/^\.?\//, "");
    if (f.id === "repair") data.tocUrl = f.url;
  });
  /* счётчики на карточке машины — по итоговым данным, а не по выгрузке */
  if (mlist[m]) {
    mlist[m].ns = (data.s || []).length;
    mlist[m].nsvc = (data.svc || []).length;
    mlist[m].nes = (data.es || []).length;
    mlist[m].man = (data.man || []).map(function (f) {
      return { id: f.id, title: f.title, pages: f.pages };
    });
  }
  var file = path.join(DST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file,
    "window.KB_MACHINE=window.KB_MACHINE||{};\n" +
    "window.KB_MACHINE[" + JSON.stringify(m) + "]=" + JSON.stringify(data) + ";\n");
  machineBytes += fs.statSync(file).size;
  machineFiles++;
});

/* ================================================= запись индексов KB */
var idxBytes = 0;
idxBytes += writeVar("data/kb_docs.js", "KB_DOCS", docs);
idxBytes += writeVar("data/kb_manuals.js", "KB_MANUALS", man);
idxBytes += writeVar("data/kb_parts.js", "KB_PARTS", parts);
idxBytes += writeVar("data/kb_mparts.js", "KB_MPARTS", mparts);
idxBytes += writeVar("data/kb_names.js", "KB_NAMES", names);
idxBytes += writeVar("data/kb_topics.js", "KB_TOPICS", TOPICS);
idxBytes += writeVar("data/kb_search.js", "KB_SEARCH", SEARCH);
idxBytes += writeVar("data/kb_machines.js", "KB_MACHINE_LIST", mlist);
idxBytes += writeVar("data/kb_media.js", "KB_MEDIA", media);

/* ==================================================== рисунки процедур */
var figNames = Object.keys(figs), figBytes = 0, figMissing = 0;
figNames.forEach(function (f) {
  var from = path.join(SRC, "assets", "figures", f);
  if (!fs.existsSync(from)) { figMissing++; return; }
  figBytes += copyFile(from, path.join(DST, "assets", "figures", f));
});

/* ============================================================ PDF документов */
var pdfCount = 0, pdfBytes = 0, pdfMissing = 0, pdfNoBody = 0;
docIds.forEach(function (id) {
  var d = docs[id];
  if (!d.pdf) return;
  if (!PDF_CATS[d.c]) {
    /* процедура: PDF нужен только там, где текста не выгрузилось */
    if (hasBody[id]) { delete d.pdf; return; }
    pdfNoBody++;
  }
  var rel = String(d.pdf).replace(/\\/g, "/");
  var from = path.join(SRC, "bulletins", rel);
  if (!fs.existsSync(from)) { pdfMissing++; delete d.pdf; return; }
  pdfBytes += copyFile(from, path.join(DST, "bulletins", rel));
  pdfCount++;
});
/* часть PDF могла отсутствовать — переписываем индекс уже без них */
idxBytes += writeVar("data/kb_docs.js", "KB_DOCS", docs);

/* ================================================================ отчёт */
function byCat(list) {
  var c = {};
  list.forEach(function (id) { c[docs[id].c] = (c[docs[id].c] || 0) + 1; });
  return Object.keys(c).sort().map(function (k) { return k + ": " + c[k]; }).join(", ");
}
console.log("База знаний для " + ESN.join(", "));
console.log("  документов      " + docIds.length + "  (" + byCat(docIds) + ")");
console.log("  руководств      " + Object.keys(man).length);
console.log("  деталей Cummins " + Object.keys(parts).length);
console.log("  деталей машин   " + Object.keys(mparts).length);
console.log("  тем             " + TOPICS.length + ", строк поиска " + SEARCH.length);
console.log("  индексы         " + mb(idxBytes));
console.log("  тексты          " + bodyFiles + " файлов, " + mb(bodyBytes));
console.log("  машины          " + machineFiles + " файлов, " + mb(machineBytes) +
            (mediaMissing.length ? ", не найдено картинок: " + mediaMissing.length : ""));
console.log("  рисунки         " + (figNames.length - figMissing) + " файлов, " + mb(figBytes) +
            (figMissing ? ", нет в исходнике: " + figMissing : ""));
console.log("  PDF             " + pdfCount + " файлов, " + mb(pdfBytes) +
            (pdfMissing ? ", нет в исходнике: " + pdfMissing : "") +
            " (из них процедур без текста: " + pdfNoBody + ";" +
            " остальные PDF процедур не переносятся — их текст есть в базе)");
if (mediaMissing.length) {
  console.log("  ! нет в подпапках машин: " + mediaMissing.slice(0, 10).join(", ") +
              (mediaMissing.length > 10 ? " и ещё " + (mediaMissing.length - 10) : ""));
}
