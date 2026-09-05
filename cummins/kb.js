/* База знаний Cummins внутри каталога запасных частей.
   Документы QuickServe, руководства, темы, машины и детали — со сквозными
   перекрёстными ссылками. Данные лежат в data/kb_*.js, тела документов
   подгружаются кусками по мере надобности, поэтому работает и без сервера.

   Выборка сделана под парк NHL — двигатели NTE240 (33239746), NTE200
   (33239899) и TR100A (37295879) и три эти машины; собирается скриптом
   build/gen_kb.js из репозитория Cummins_Parts_Book. Чертежи машин,
   руководства и фотографии деталей не дублируются: база ссылается на файлы,
   которые уже лежат в nte240/, nte200/, tr100/ и cummins/photos/. */
(function () {
"use strict";

var DOCS   = window.KB_DOCS || {};
var MAN    = window.KB_MANUALS || {};
var PARTS  = window.KB_PARTS || {};
var TOPICS = window.KB_TOPICS || [];
var MLIST  = window.KB_MACHINE_LIST || {};
var MPARTS = window.KB_MPARTS || {};
var MEDIA  = window.KB_MEDIA || {};
var SEARCH = window.KB_SEARCH || [];
var NAMES  = window.KB_NAMES || {};
window.KB_BODY = window.KB_BODY || {};
window.KB_BODY_RU = window.KB_BODY_RU || {};
window.KB_MACHINE = window.KB_MACHINE || {};

/* двигатели те же три, что и в каталоге (см. NHL_ESN в app.js) */
var NHL_ESN = { "33239746": 1, "33239899": 1, "37295879": 1 };
function engines() {
  return (window.ENGINES || []).filter(function (e) { return NHL_ESN[e.esn]; });
}

var LANG = "ru";
try { LANG = localStorage.getItem("cummins_lang") || "ru"; } catch (e) {}
function setLang(v) {
  LANG = v === "en" ? "en" : "ru";
  try { localStorage.setItem("cummins_lang", LANG); } catch (e) {}
  var box = document.getElementById("lang-switch");
  if (box) {
    Array.prototype.forEach.call(box.querySelectorAll("button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-lang") === LANG);
    });
  }
  document.body.classList.toggle("lang-en", LANG === "en");
}

var CAT_RU = {
  procedures: "Процедура", tsb: "TSB", bulletin: "Сервисный бюллетень",
  sti: "Инструкция по инструменту", install_inst: "Инструкция по установке",
  outlines: "Габаритный чертёж", manual: "Руководство"
};
var CAT_MANY = {
  procedures: "Процедуры ремонта и обслуживания", tsb: "Технические бюллетени TSB",
  bulletin: "Сервисные бюллетени", sti: "Инструкции по сервисному инструменту",
  install_inst: "Инструкции по установке", outlines: "Габаритные чертежи",
  manual: "Руководства"
};
var PDF_BASE = "bulletins/";
var ENGINE_TITLE = {};
engines().forEach(function (e) {
  ENGINE_TITLE[e.esn] = (e.model || "") + (e.cpl ? " CPL " + e.cpl : "");
});

var root = document.getElementById("kb-root");
var lastQuery = "";

/* ------------------------------------------------------------- утилиты */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
function docLink(id, label) {
  var d = DOCS[id];
  if (!d && DOCS[id + "-history"]) {
    var mm = MAN[id] || {};
    return '<a class="lnk doc" href="#/manual/' + esc(id) + '">' +
           esc(label || mm.ru || mm.t || id) + "</a>";
  }
  if (!d) return esc(label || id);
  var href = d.c === "manual" ? "#/manual/" + id.replace("-history", "") : "#/doc/" + id;
  return '<a class="lnk doc" href="' + href + '">' + esc(label || d.t || id) + "</a>";
}
function partLink(no) {
  if (PARTS[no]) return '<a class="lnk part" href="#/part/' + esc(no) + '">' + esc(no) + "</a>";
  if (MPARTS[no]) return '<a class="lnk mpart" href="#/mpart/' + esc(no) + '">' + esc(no) + "</a>";
  return esc(no);
}
function engineLink(esn) {
  return '<a class="lnk eng" href="#/engine/' + esn + '">' + esn +
         (ENGINE_TITLE[esn] ? " · " + esc(ENGINE_TITLE[esn]) : "") + "</a>";
}
function docTitle(d, id) {
  var main = LANG === "en" ? (d.t || id) : (d.ru || d.t || id);
  var sub = LANG === "en" ? (d.ru || "") : (d.ru ? d.t : "");
  return esc(main) + (sub ? ' <span class="sub">— ' + esc(sub) + "</span>" : "");
}
function sortIds(ids) {
  return (ids || []).slice().sort(function (a, b) {
    var A = DOCS[a] || {}, B = DOCS[b] || {};
    return (A.c || "").localeCompare(B.c || "") || String(a).localeCompare(String(b));
  });
}
function badge(cat) {
  return '<span class="tag t-' + cat + '">' + esc(CAT_RU[cat] || cat) + "</span>";
}
/* фото деталей — те же файлы, что и в каталоге (photos/<3 цифры>/<номер>/),
   при их отсутствии пробуем публичный CDN Cummins */
function photoUrl(file) {
  var name = String(file).replace(/\.jpg$/i, ".png");
  var num = name.split("_")[0];
  return "photos/" + num.slice(0, 3) + "/" + num + "/" + name;
}
function photoCdn(file) {
  var num = String(file).split("_")[0];
  return "https://parts.cummins.com/graphics/parts/" + num.slice(0, 3) + "/" + num + "/" +
         String(file).replace(/\.jpg$/i, ".png");
}
/* чертежи и фотографии машин лежат в подпапках nte240/, nte200/, tr100/;
   в KB_MEDIA уже записан готовый путь относительно этой папки */
function mediaUrl(machine, file) {
  var base = String(file).replace(/\.[a-z]+$/i, "");
  var key = base.indexOf(machine + "_") === 0 ? base : machine + "_" + base;
  return (MEDIA[machine] || {})[key] || "";
}

/* --------------------------------------------------- подгрузка кусков */
var pending = {};
function loadScript(src, cb) {
  if (pending[src]) { pending[src].push(cb); return; }
  pending[src] = [cb];
  var s = document.createElement("script");
  s.src = src;
  s.onload = s.onerror = function () {
    var list = pending[src]; pending[src] = null;
    list.forEach(function (f) { f(); });
  };
  document.head.appendChild(s);
}
function withBody(id, cb) {
  var d = DOCS[id];
  if (!d || d.ch < 0) { cb("", "en"); return; }
  var ru = LANG === "ru" && d.ru_body;
  var store = ru ? window.KB_BODY_RU : window.KB_BODY;
  var file = ru ? "data/kb/body_ru_" + d.ch + ".js" : "data/kb/body_" + d.ch + ".js";
  if (store[d.ch]) { cb(store[d.ch][id] || "", ru ? "ru" : "en"); return; }
  loadScript(file, function () {
    var s2 = ru ? window.KB_BODY_RU : window.KB_BODY;
    cb((s2[d.ch] || {})[id] || "", ru ? "ru" : "en");
  });
}
function withMachine(name, cb) {
  if (window.KB_MACHINE[name]) { cb(window.KB_MACHINE[name]); return; }
  loadScript("data/kb/machine_" + name + ".js", function () {
    cb(window.KB_MACHINE[name] || null);
  });
}

/* -------------------------------------------------------------- режим */
function active() { return document.body.classList.contains("kb-mode"); }
function setMode(on) {
  document.body.classList.toggle("kb-mode", !!on);
  var nav = document.getElementById("kb-nav");
  if (nav) {
    Array.prototype.forEach.call(nav.querySelectorAll("a"), function (a) {
      a.classList.toggle("on", on && a.getAttribute("href") === location.hash);
    });
    var cat = document.getElementById("nav-catalog");
    if (cat) cat.classList.toggle("on", !on);
  }
  if (on) window.scrollTo(0, 0);
}
function render(html) {
  root.innerHTML = html;
  setMode(true);
  root.scrollTop = 0;
}

/* ---------------------------------------------------------- заголовок */
function crumbs(items) {
  return '<nav class="crumbs">' + items.map(function (it) {
    return it.href ? '<a href="' + it.href + '">' + esc(it.t) + "</a>"
                   : "<span>" + esc(it.t) + "</span>";
  }).join('<i>›</i>') + "</nav>";
}

/* ============================================================ главная */
function viewHome() {
  var byCat = {};
  Object.keys(DOCS).forEach(function (id) {
    var c = DOCS[id].c; byCat[c] = (byCat[c] || 0) + 1;
  });
  var tsbRecent = Object.keys(DOCS).filter(function (id) { return DOCS[id].c === "tsb" && DOCS[id].d; })
    .sort(function (a, b) { return DOCS[b].d.localeCompare(DOCS[a].d); }).slice(0, 12);

  var h = [];
  h.push('<div class="kb-hero">');
  h.push("<h1>База знаний Cummins</h1>");
  h.push('<p class="lead">Документация QuickServe, каталоги запчастей и машины — ' +
         "в одном месте и со сквозными ссылками: из процедуры в деталь, " +
         "из детали в узел и обратно в документы, где она упоминается.</p>");
  h.push('<div class="kb-counters">');
  [["Документов", Object.keys(DOCS).length, "#/docs/all"],
   ["Руководств", Object.keys(MAN).length, "#/docs/manual"],
   ["Деталей Cummins", Object.keys(PARTS).length, "#/parts"],
   ["Деталей машин", Object.keys(MPARTS).length, "#/mparts"],
   ["Двигателей", engines().length, "#/engines"],
   ["Машин", Object.keys(MLIST).length, "#/machines"]
  ].forEach(function (c) {
    h.push('<a class="counter" href="' + c[2] + '"><b>' + c[1] + "</b><span>" + c[0] + "</span></a>");
  });
  h.push("</div></div>");

  h.push('<div class="kb-cols">');
  h.push('<section class="kb-card"><h2>Документы</h2><ul class="kb-list">');
  ["manual", "procedures", "tsb", "bulletin", "sti", "install_inst", "outlines"].forEach(function (c) {
    if (!byCat[c]) return;
    h.push('<li><a href="#/docs/' + c + '">' + esc(CAT_MANY[c] || c) +
           '</a> <span class="cnt">' + byCat[c] + "</span></li>");
  });
  h.push("</ul></section>");

  /* коды неисправностей с дисплея — отдельным блоком, это не документ QuickServe */
  var fcList = Object.keys(window.KB_FAULT_CODES || {});
  if (fcList.length) {
    h.push('<section class="kb-card"><h2>Коды неисправностей</h2><ul class="kb-list">');
    fcList.forEach(function (e) {
      var cat = (window.CATALOGS || {})[e], fc = window.KB_FAULT_CODES[e];
      h.push('<li><a href="#/faults/' + esc(e) + '">' + esc(e) +
        (cat ? " · " + esc(cat.model) : "") + '</a> <span class="cnt">' +
        (fc.rows || []).length + "</span></li>");
    });
    h.push("</ul></section>");
  }

  h.push('<section class="kb-card"><h2>Темы</h2><ul class="kb-list">');
  TOPICS.forEach(function (t, i) {
    h.push('<li><a href="#/topic/' + i + '">' + esc(t.t) + '</a> <span class="cnt">' +
           t.ids.length + '</span><div class="sub">' + esc(t.d) + "</div></li>");
  });
  h.push("</ul></section>");

  h.push('<section class="kb-card"><h2>Машины</h2><ul class="kb-list">');
  Object.keys(MLIST).sort().forEach(function (m) {
    var mm = MLIST[m];
    h.push('<li><a href="#/machine/' + m + '">' + esc(m) + '</a>' +
           '<div class="sub">' + esc(mm.t) + " · разделов " + mm.ns +
           ", инструкций по ремонту " + mm.nsvc + "</div></li>");
  });
  h.push("</ul></section>");

  h.push('<section class="kb-card"><h2>Двигатели</h2><ul class="kb-list">');
  engines().forEach(function (e) {
    var docs = Object.keys(DOCS).filter(function (id) {
      return (DOCS[id].e || []).indexOf(e.esn) !== -1;
    }).length;
    h.push('<li><a href="#/engine/' + e.esn + '">' + e.esn + " · " + esc(e.model) +
           '</a> <span class="cnt">' + docs + "</span></li>");
  });
  h.push("</ul></section>");
  h.push("</div>");

  h.push('<section class="kb-card wide"><h2>Свежие бюллетени TSB</h2><table class="kb-table">');
  tsbRecent.forEach(function (id) {
    var d = DOCS[id];
    h.push("<tr><td class='c-id'>" + docLink(id, id) + "</td><td>" + docTitle(d, id) +
           "</td><td class='c-date'>" + esc(d.d) + "</td></tr>");
  });
  h.push("</table></section>");
  render(h.join(""));
}

/* ====================================================== список документов */
function viewDocs(cat, q) {
  var ids = Object.keys(DOCS).filter(function (id) {
    return cat === "all" ? true : DOCS[id].c === cat;
  });
  if (cat === "manual") {
    ids = Object.keys(MAN).map(function (m) { return m + "-history"; })
      .filter(function (id) { return DOCS[id]; });
  }
  ids.sort(function (a, b) {
    var A = DOCS[a], B = DOCS[b];
    if (cat === "tsb" || cat === "all") return (B.d || "").localeCompare(A.d || "") ||
      String(a).localeCompare(String(b));
    return String(a).localeCompare(String(b));
  });

  var h = [];
  h.push(crumbs([{ t: "База знаний", href: "#/kb" },
                 { t: cat === "all" ? "Все документы" : (CAT_MANY[cat] || cat) }]));
  h.push('<div class="kb-head"><h1>' + esc(cat === "all" ? "Все документы" : (CAT_MANY[cat] || cat)) +
         ' <span class="cnt">' + ids.length + "</span></h1>");
  h.push('<input class="kb-filter" id="kb-filter" placeholder="Фильтр по номеру или названию…" ' +
         'value="' + esc(q || "") + '"></div>');
  h.push('<div id="kb-doc-list">' + docRows(ids, q) + "</div>");
  render(h.join(""));

  var f = document.getElementById("kb-filter");
  if (f) {
    f.oninput = function () {
      document.getElementById("kb-doc-list").innerHTML = docRows(ids, this.value);
    };
    if (q) f.focus();
  }
}
function docRows(ids, q) {
  q = (q || "").trim().toLowerCase();
  var rows = [], n = 0;
  for (var i = 0; i < ids.length && n < 800; i++) {
    var id = ids[i], d = DOCS[id];
    if (q && (id + " " + d.t + " " + d.ru).toLowerCase().indexOf(q) === -1) continue;
    n++;
    rows.push("<tr><td class='c-id'>" + docLink(id, id) + "</td>" +
      "<td>" + docTitle(d, id) +
      (d.g ? '<div class="sub">' + esc(d.g) + "</div>" : "") + "</td>" +
      "<td class='c-eng'>" + (d.e || []).map(function (e) {
        return '<a class="chip" href="#/engine/' + e + '">' + e + "</a>";
      }).join(" ") + "</td>" +
      "<td class='c-date'>" + esc(d.d || d.mo || "") + "</td>" +
      (d.ok ? "" : '<td class="c-ext" title="В выгрузке нет — только на QuickServe">↗</td>') +
      "</tr>");
  }
  if (!rows.length) return '<p class="empty">Ничего не найдено.</p>';
  return '<table class="kb-table">' + rows.join("") + "</table>" +
    (n >= 800 ? '<p class="sub">Показаны первые 800 — уточните фильтр.</p>' : "");
}

/* ============================================================= документ */
function viewDoc(id) {
  var d = DOCS[id];
  if (!d) { notFound("Документ " + id); return; }
  if (d.c === "manual") { viewManual(id.replace("-history", "")); return; }

  var h = [];
  h.push(crumbs([{ t: "База знаний", href: "#/kb" },
                 { t: CAT_MANY[d.c] || d.c, href: "#/docs/" + d.c },
                 { t: id }]));
  h.push('<article class="kb-doc">');
  h.push('<header class="doc-head">');
  var mainTitle = LANG === "en" ? d.t : (d.ru || d.t);
  var subTitle = LANG === "en" ? (d.ru || "") : (d.ru ? d.t : "");
  h.push("<h1>" + esc(mainTitle) + "</h1>");
  if (subTitle) h.push('<div class="doc-en">' + esc(subTitle) + "</div>");
  h.push('<div class="doc-meta">' + badge(d.c) + '<span class="num">' + esc(id) + "</span>" +
    (d.d ? '<span class="mi">выпущен ' + esc(d.d) + "</span>" : "") +
    (d.mo ? '<span class="mi">изменён ' + esc(d.mo) + "</span>" : "") +
    (d.g ? '<span class="mi">' + esc(d.g) + "</span>" : "") + "</div>");
  h.push('<div class="doc-links">' +
    '<a class="btn-mini" href="' + esc(d.u) + '" target="_blank" rel="noopener">Оригинал в QuickServe ↗</a>' +
    (d.pdf ? ' <a class="btn-mini" href="' + PDF_BASE + esc(d.pdf.replace(/\\/g, "/")) +
             '" target="_blank" rel="noopener">PDF ↗</a>' : "") +
    ' <a class="btn-mini" href="#" onclick="window.print();return false;">Печать</a>' +
    "</div>");
  h.push("</header>");

  if (!d.ok) {
    h.push('<div class="callout missing"><div class="callout-head">' +
      '<span class="callout-ico">—</span>Документа нет в выгрузке</div><div class="callout-body">' +
      "<p>В песочнице этот документ отсутствует — доступна карточка и ссылка на оригинал " +
      "в QuickServe.</p></div></div>");
  }
  h.push('<div class="doc-body" id="doc-body"><p class="sub">Загрузка…</p></div>');
  h.push("</article>");
  h.push('<aside class="doc-side" id="doc-side">' + docSide(id, d) + "</aside>");
  render('<div class="doc-layout">' + h.join("") + "</div>");

  withBody(id, function (body, lang) {
    var box = document.getElementById("doc-body");
    if (!box) return;
    var head = "";
    if (lang === "ru") {
      head = '<div class="mt-note">Черновой перевод: выполнен автоматически, ' +
        'терминология выверена по словарю Cummins. Спорные места сверяйте с ' +
        'оригиналом — <a href="#" data-lang-set="en">показать английский текст</a>' +
        ' или <a href="' + esc(d.u) + '" target="_blank" rel="noopener">открыть в QuickServe ↗</a>.</div>';
    } else if (d.ru_body) {
      head = '<div class="mt-note">Оригинал Cummins. ' +
        '<a href="#" data-lang-set="ru">показать перевод на русский</a>.</div>';
    }
    box.innerHTML = head + (body || '<p class="sub">Текст документа не выгружен.</p>');
  });
}

function docSide(id, d) {
  var h = [];
  if (d.e && d.e.length) {
    h.push('<section><h3>Двигатели</h3><ul class="side-list">');
    d.e.forEach(function (e) { h.push("<li>" + engineLink(e) + "</li>"); });
    h.push("</ul></section>");
  }
  if (d.f && d.f.length) {
    h.push('<section><h3>Семейство</h3><p class="side-p">' + esc(d.f.join(", ")) + "</p></section>");
  }
  if (d.mn && d.mn.length) {
    h.push('<section><h3>Входит в руководства</h3><ul class="side-list">');
    d.mn.forEach(function (m) {
      var mm = MAN[m] || {};
      h.push('<li><a class="lnk doc" href="#/manual/' + m + '">' +
             esc(mm.ru || mm.t || m) + "</a></li>");
    });
    h.push("</ul></section>");
  }
  if (d.sec && d.sec.length) {
    h.push('<section><h3>Секции руководств</h3><ul class="side-list plain">');
    d.sec.forEach(function (s) { h.push("<li>" + esc(s) + "</li>"); });
    h.push("</ul></section>");
  }
  if (d.p && d.p.length) {
    h.push('<section><h3>Детали в тексте <span class="cnt">' + d.p.length + "</span></h3>");
    h.push('<ul class="side-list">');
    d.p.slice(0, 60).forEach(function (p) {
      var pp = PARTS[p] || {};
      h.push("<li>" + partLink(p) + (pp.ru || pp.n ? ' <span class="sub">' +
             esc(pp.ru || pp.n) + "</span>" : "") + "</li>");
    });
    h.push("</ul></section>");
  }
  if (d.bl && d.bl.length) {
    h.push('<section><h3>Ссылаются сюда <span class="cnt">' + d.bl.length + "</span></h3>");
    h.push('<ul class="side-list">');
    d.bl.slice(0, 60).forEach(function (b) {
      var bd = DOCS[b];
      h.push("<li>" + docLink(b, (bd && (bd.ru || bd.t)) || b) + "</li>");
    });
    h.push("</ul></section>");
  }
  var group = String(id).split("-")[0];
  var siblings = Object.keys(DOCS).filter(function (x) {
    return x !== id && DOCS[x].c === d.c && String(x).split("-")[0] === group;
  }).slice(0, 25);
  if (siblings.length) {
    h.push('<section><h3>Рядом в группе ' + esc(group) + "</h3><ul class=\"side-list\">");
    siblings.forEach(function (s) { h.push("<li>" + docLink(s, (DOCS[s].ru || DOCS[s].t)) + "</li>"); });
    h.push("</ul></section>");
  }
  return h.join("");
}

/* =========================================================== руководство */
function viewManual(mid) {
  var m = MAN[mid];
  if (!m) { notFound("Руководство " + mid); return; }
  var h = [];
  h.push(crumbs([{ t: "База знаний", href: "#/kb" },
                 { t: "Руководства", href: "#/docs/manual" }, { t: mid }]));
  h.push('<article class="kb-doc">');
  h.push('<header class="doc-head"><h1>' + esc(m.ru || m.t) + "</h1>");
  if (m.ru) h.push('<div class="doc-en">' + esc(m.t) + "</div>");
  h.push('<div class="doc-meta">' + badge("manual") + '<span class="num">' + esc(mid) + "</span>" +
    '<span class="mi">процедур: ' + m.n + "</span></div>");
  h.push('<div class="doc-links"><a class="btn-mini" href="' + esc(m.u) +
    '" target="_blank" rel="noopener">История изменений в QuickServe ↗</a>' +
    (m.pdf ? ' <a class="btn-mini" href="' + PDF_BASE + esc(String(m.pdf).replace(/\\/g, "/")) +
             '" target="_blank" rel="noopener">PDF ↗</a>' : "") + "</div></header>");

  h.push('<div class="doc-body">');
  m.s.forEach(function (pair) {
    var section = pair[0], items = pair[1];
    h.push("<h3>" + esc(section) + ' <span class="cnt">' + items.length + "</span></h3>");
    h.push('<div class="tw"><table class="doc-table"><thead><tr><th>Номер</th>' +
           "<th>Процедура</th><th>Изменена</th></tr></thead><tbody>");
    items.forEach(function (it) {
      var id = it[0], known = DOCS[id];
      h.push("<tr><td>" + (known ? docLink(id, id) : esc(id)) + "</td><td>" +
        (known && known.ru ? esc(known.ru) + ' <span class="sub">' + esc(it[1]) + "</span>"
                           : esc(it[1])) +
        (known ? "" : ' <span class="sub">— вне выгрузки</span>') +
        "</td><td>" + esc(it[2] || "") + "</td></tr>");
    });
    h.push("</tbody></table></div>");
  });
  h.push("</div></article>");

  var side = [];
  if (m.e && m.e.length) {
    side.push('<section><h3>Двигатели</h3><ul class="side-list">');
    m.e.forEach(function (e) { side.push("<li>" + engineLink(e) + "</li>"); });
    side.push("</ul></section>");
  }
  side.push('<section><h3>Другие руководства</h3><ul class="side-list">');
  Object.keys(MAN).sort(function (a, b) {
    return (MAN[a].ru || MAN[a].t).localeCompare(MAN[b].ru || MAN[b].t);
  }).forEach(function (x) {
    if (x === mid) return;
    side.push('<li><a class="lnk doc" href="#/manual/' + x + '">' +
      esc(MAN[x].ru || MAN[x].t) + "</a></li>");
  });
  side.push("</ul></section>");
  render('<div class="doc-layout">' + h.join("") +
         '<aside class="doc-side">' + side.join("") + "</aside></div>");
}

/* ================================================================ тема */
function viewTopic(i) {
  var t = TOPICS[i];
  if (!t) { notFound("Тема"); return; }
  var groups = {};
  t.ids.forEach(function (id) {
    var c = (DOCS[id] || {}).c || "прочее";
    (groups[c] = groups[c] || []).push(id);
  });
  var h = [];
  h.push(crumbs([{ t: "База знаний", href: "#/kb" }, { t: t.t }]));
  h.push('<div class="kb-head"><h1>' + esc(t.t) + ' <span class="cnt">' + t.ids.length +
         "</span></h1><p class=\"lead\">" + esc(t.d) + "</p></div>");
  ["manual", "tsb", "procedures", "bulletin", "sti", "install_inst", "outlines"].forEach(function (c) {
    if (!groups[c]) return;
    h.push('<section class="kb-card wide"><h2>' + esc(CAT_MANY[c] || c) +
           ' <span class="cnt">' + groups[c].length + "</span></h2>");
    h.push(docRows(groups[c].sort(), ""));
    h.push("</section>");
  });
  render(h.join(""));
}

/* ============================================================== деталь */
function viewPart(no) {
  var p = PARTS[no];
  if (!p) { if (MPARTS[no]) { location.hash = "#/mpart/" + no; return; } notFound("Деталь " + no); return; }
  var cat = window.CATALOGS || {};
  var uses = [];       // где применяется: двигатель -> узел -> позиция
  var kits = [];
  Object.keys(cat).forEach(function (esn) {
    var c = cat[esn];
    (c.options || []).forEach(function (o) {
      (o.parts || []).forEach(function (pp) {
        if (pp.no === no) uses.push({ esn: esn, o: o, p: pp });
      });
    });
    (c.kits || []).forEach(function (k) {
      (k.parts || []).forEach(function (pp) {
        if (pp.no === no) kits.push({ esn: esn, k: k });
      });
    });
  });
  var card = null;
  Object.keys(cat).some(function (esn) {
    if (cat[esn].cards && cat[esn].cards[no]) { card = cat[esn].cards[no]; return true; }
    return false;
  });

  var h = [];
  h.push(crumbs([{ t: "База знаний", href: "#/kb" }, { t: "Детали", href: "#/parts" }, { t: no }]));
  h.push('<article class="kb-doc part-page">');
  h.push('<header class="doc-head"><h1>' + esc(no) + " — " + esc(p.ru || p.n) + "</h1>");
  if (p.ru && p.n) h.push('<div class="doc-en">' + esc(p.n) + "</div>");
  h.push('<div class="doc-links">' +
    '<a class="btn-mini" href="#" data-open-catalog="' + esc(no) + '">Открыть в каталоге</a>' +
    ' <a class="btn-mini" href="https://parts.cummins.com/parts-catalog/?partNumber=' + esc(no) +
    '" target="_blank" rel="noopener">parts.cummins.com ↗</a></div></header>');

  h.push('<div class="doc-body">');
  if (p.ph && p.ph.length) {
    h.push('<div class="part-photos">');
    p.ph.forEach(function (f) {
      /* нет локальной копии — пробуем CDN Cummins, иначе прячем картинку */
      h.push('<img loading="lazy" src="' + photoUrl(f) + '" alt="" data-cdn="' +
             esc(photoCdn(f)) + '" onerror="if(this.dataset.cdn){this.src=this.dataset.cdn;' +
             'this.dataset.cdn=\'\';}else{this.style.display=\'none\';}">');
    });
    h.push("</div>");
  }
  if (card) {
    h.push('<div class="tw"><table class="doc-table"><tbody>');
    if (card.wt) h.push("<tr><th>Масса, кг (по каталогу)</th><td>" + esc(card.wt) + "</td></tr>");
    if (card.dim) h.push("<tr><th>Габариты Д×Ш×В, мм</th><td>" + esc(card.dim) + "</td></tr>");
    var attrs = card.attrs || {};
    Object.keys(attrs).forEach(function (k) {
      h.push("<tr><th>" + esc(k) + "</th><td>" + esc(attrs[k]) + "</td></tr>");
    });
    h.push("</tbody></table></div>");
  }
  if (p.pr) {
    h.push("<h3>Цена</h3><div class=\"tw\"><table class=\"doc-table\"><thead><tr><th>Каталог машины</th>" +
           "<th>Цена</th></tr></thead><tbody>");
    Object.keys(p.pr).forEach(function (m) {
      h.push('<tr><td><a class="lnk" href="#/machine/' + m + '">' + esc(m) + "</a></td><td>" +
             esc(p.pr[m]) + "</td></tr>");
    });
    h.push("</tbody></table></div>");
  }
  if (uses.length) {
    h.push("<h3>Где применяется</h3><div class=\"tw\"><table class=\"doc-table\"><thead><tr>" +
      "<th>Двигатель</th><th>Узел</th><th>Поз.</th><th>Кол-во</th><th>Типоразмер</th>" +
      "</tr></thead><tbody>");
    uses.forEach(function (u) {
      h.push("<tr><td>" + engineLink(u.esn) + "</td><td>" +
        '<a class="lnk" href="#" data-open-option="' + esc(u.esn) + "|" + esc(u.o.no) + "|" +
        esc(no) + '">' + esc(u.o.no) + " · " + esc(NAMES.opt && NAMES.opt[u.o.no] || u.o.name) +
        "</a></td><td>" + esc(u.p.pos || "") + "</td><td>" + esc(u.p.qty || "") +
        "</td><td>" + esc(u.p.dim || "") + "</td></tr>");
    });
    h.push("</tbody></table></div>");
  }
  if (kits.length) {
    h.push("<h3>Входит в комплекты</h3><ul>");
    kits.forEach(function (k) {
      h.push("<li>" + esc(k.k.no) + " — " + esc(NAMES.kit && NAMES.kit[k.k.no] || k.k.name) +
             " <span class=\"sub\">(" + esc(k.esn) + ")</span></li>");
    });
    h.push("</ul>");
  }
  if (p.sup) {
    h.push("<h3>Цепочка замен номера</h3><div class=\"tw\"><table class=\"doc-table\"><thead><tr>" +
      "<th>Номер</th><th>Статус</th><th>Продаётся</th></tr></thead><tbody>");
    p.sup.forEach(function (s) {
      h.push("<tr><td>" + (s[0] === no ? esc(s[0]) : partLink(s[0])) + "</td><td>" +
             esc(s[1]) + "</td><td>" + (s[2] ? "да" : "нет") + "</td></tr>");
    });
    h.push("</tbody></table></div>");
  }
  h.push("</div></article>");

  var side = [];
  if (p.e && p.e.length) {
    side.push('<section><h3>Двигатели</h3><ul class="side-list">');
    p.e.forEach(function (e) { side.push("<li>" + engineLink(e) + "</li>"); });
    side.push("</ul></section>");
  }
  if (p.d && p.d.length) {
    side.push('<section><h3>Упоминается в документах <span class="cnt">' + p.d.length +
              "</span></h3><ul class=\"side-list\">");
    sortIds(p.d).slice(0, 80).forEach(function (k) {
      var id = k.split("|")[1] || k;
      var dd = DOCS[id];
      side.push("<li>" + (dd ? badge(dd.c) + " " + docLink(id, dd.ru || dd.t) : esc(id)) + "</li>");
    });
    side.push("</ul></section>");
  }
  if (MPARTS[no]) {
    side.push('<section><h3>В каталогах машин</h3><ul class="side-list">' +
      '<li><a class="lnk mpart" href="#/mpart/' + esc(no) + '">карточка в каталоге машин</a></li>' +
      "</ul></section>");
  }
  render('<div class="doc-layout">' + h.join("") +
         '<aside class="doc-side">' + side.join("") + "</aside></div>");
}

/* ================================================= деталь каталога машин */
function viewMPart(no) {
  var p = MPARTS[no];
  if (!p) { if (PARTS[no]) { location.hash = "#/part/" + no; return; } notFound("Деталь " + no); return; }
  var h = [];
  h.push(crumbs([{ t: "База знаний", href: "#/kb" },
                 { t: "Детали машин", href: "#/mparts" }, { t: no }]));
  h.push('<article class="kb-doc"><header class="doc-head"><h1>' + esc(no) +
         (p.ru ? " — " + esc(p.ru) : "") + "</h1>");
  var sub = [p.en, p.zh].filter(Boolean).join(" · ");
  if (sub) h.push('<div class="doc-en">' + esc(sub) + "</div>");
  h.push("</header><div class=\"doc-body\">");
  h.push('<div class="tw"><table class="doc-table"><tbody>');
  if (p.gr) h.push("<tr><th>Группа</th><td>" + esc(p.gr) + "</td></tr>");
  if (p.alt) h.push("<tr><th>Взаимозаменяемый артикул</th><td>" + partLink(p.alt) + "</td></tr>");
  if (PARTS[no]) h.push('<tr><th>Каталог Cummins</th><td><a class="lnk part" href="#/part/' +
    esc(no) + '">карточка детали двигателя</a></td></tr>');
  h.push("</tbody></table></div>");

  h.push("<h3>Применяемость по машинам</h3><div class=\"tw\"><table class=\"doc-table\"><thead><tr>" +
    "<th>Машина</th><th>Цена, CNY</th><th>Разделы каталога</th></tr></thead><tbody>");
  Object.keys(p.m).forEach(function (m) {
    var rec = p.m[m];
    h.push('<tr><td><a class="lnk" href="#/machine/' + m + '">' + esc(m) + "</a></td><td>" +
      esc(rec.p || "") + "</td><td>" + (rec.s || []).map(function (s) {
        return '<a class="chip" href="#/msec/' + m + "/" + esc(s) + '">' + esc(s) + "</a>";
      }).join(" ") + "</td></tr>");
  });
  h.push("</tbody></table></div></div></article>");
  render('<div class="doc-layout">' + h.join("") + "</div>");
}

/* ============================================================== машины */
function viewMachines() {
  var h = [crumbs([{ t: "База знаний", href: "#/kb" }, { t: "Машины" }])];
  h.push('<div class="kb-head"><h1>Машины</h1></div><div class="kb-cols">');
  Object.keys(MLIST).sort().forEach(function (m) {
    var mm = MLIST[m];
    h.push('<section class="kb-card"><h2><a href="#/machine/' + m + '">' + esc(m) + "</a></h2>" +
      '<p class="sub">' + esc(mm.t) + "</p><ul class=\"kb-list\">" +
      "<li>Разделов каталога <span class=\"cnt\">" + mm.ns + "</span></li>" +
      "<li>Инструкций по ремонту <span class=\"cnt\">" + mm.nsvc + "</span></li>" +
      (mm.nes ? "<li>Разделов двигателя <span class=\"cnt\">" + mm.nes + "</span></li>" : "") +
      (mm.man && mm.man.length ? "<li>Руководств PDF <span class=\"cnt\">" + mm.man.length +
        "</span></li>" : "") + "</ul></section>");
  });
  h.push("</div>");
  render(h.join(""));
}

function viewMachine(name) {
  withMachine(name, function (m) {
    if (!m) { notFound("Машина " + name); return; }
    var chapters = {};
    (m.ch || []).forEach(function (c) { chapters[c.code] = c; });
    var byChapter = {};
    m.s.forEach(function (s) { (byChapter[s.ch] = byChapter[s.ch] || []).push(s); });

    var h = [crumbs([{ t: "База знаний", href: "#/kb" },
                     { t: "Машины", href: "#/machines" }, { t: name }])];
    h.push('<div class="kb-head"><h1>' + esc(name) + '</h1><p class="lead">' +
           esc(m.t) + (m.maker ? " · " + esc(m.maker) : "") + "</p></div>");

    if (m.man && m.man.length) {
      h.push('<section class="kb-card wide"><h2>Руководства (PDF)</h2><ul class="kb-list">');
      m.man.forEach(function (f) {
        /* PDF руководств лежат в подпапке самой машины (nte200/manuals/…) —
           путь к ним записан в данные скриптом build/gen_kb.js */
        var file = f.url || f.file;
        h.push('<li><a href="' + esc(file) + '" target="_blank" rel="noopener">' +
          esc(f.title) + "</a> <span class=\"sub\">" + esc(f.desc || "") +
          (f.pages ? " · " + f.pages + " с." : "") + "</span></li>");
      });
      h.push("</ul>");
      if (m.toc && m.toc.length) {
        h.push('<details class="kb-details"><summary>Оглавление руководства по ремонту (' +
               m.toc.length + ")</summary><div class=\"tw\"><table class=\"doc-table\">");
        m.toc.forEach(function (t) {
          h.push("<tr><td>" + esc(t.code) + '</td><td><a href="' + esc(m.tocUrl || "") +
            "#page=" + t.page + '" target="_blank" rel="noopener">' + esc(t.title) +
            "</a></td><td>стр. " + t.page + "</td></tr>");
        });
        h.push("</table></div></details>");
      }
      h.push("</section>");
    }

    if (m.svc && m.svc.length) {
      h.push('<section class="kb-card wide"><h2>Ремонт и обслуживание <span class="cnt">' +
             m.svc.length + "</span></h2><ul class=\"kb-list cols\">");
      m.svc.forEach(function (s) {
        h.push('<li><a href="#/msvc/' + name + "/" + esc(s.c) + '">' + esc(s.c) + " — " +
               esc(s.t) + "</a></li>");
      });
      h.push("</ul></section>");
    }

    h.push('<section class="kb-card wide"><h2>Каталог запчастей</h2>');
    Object.keys(byChapter).sort().forEach(function (ch) {
      var c = chapters[ch] || {};
      h.push("<h3>" + esc(ch) + " " + esc([c.en, c.zh].filter(Boolean).join(" · ")) + "</h3>");
      h.push('<ul class="kb-list cols">');
      byChapter[ch].forEach(function (s) {
        h.push('<li><a href="#/msec/' + name + "/" + esc(s.c) + '">' + esc(s.c) + " — " +
               esc([s.en, s.zh].filter(Boolean).join(" · ")) + "</a></li>");
      });
      h.push("</ul>");
    });
    h.push("</section>");

    if (m.es && m.es.length) {
      h.push('<section class="kb-card wide"><h2>Двигатель в книге машины <span class="cnt">' +
             m.es.length + "</span></h2><ul class=\"kb-list cols\">");
      m.es.forEach(function (s) {
        h.push('<li><a href="#/mesec/' + name + "/" + esc(s.c) + '">' + esc(s.c) + " — " +
               esc(s.en || s.zh) + "</a></li>");
      });
      h.push("</ul></section>");
    }
    render(h.join(""));
  });
}

function viewMachineSection(name, code, engineBook) {
  withMachine(name, function (m) {
    if (!m) { notFound("Машина " + name); return; }
    var list = engineBook ? m.es : m.s;
    var s = null;
    list.some(function (x) { if (x.c === code) { s = x; return true; } return false; });
    if (!s) { notFound("Раздел " + code); return; }

    var h = [crumbs([{ t: "База знаний", href: "#/kb" },
                     { t: "Машины", href: "#/machines" },
                     { t: name, href: "#/machine/" + name }, { t: code }])];
    h.push('<article class="kb-doc"><header class="doc-head"><h1>' + esc(code) + " — " +
      esc([s.en, s.zh].filter(Boolean).join(" · ")) +
      '</h1></header><div class="doc-body">');
    (s.f || []).forEach(function (fig, i) {
      if ((s.f || []).length > 1) h.push("<h3>Рисунок " + (i + 1) + "</h3>");
      (fig.i || []).forEach(function (img) {
        var url = mediaUrl(name, img);
        if (url) h.push('<figure class="fig"><img loading="lazy" src="' + url + '" alt=""></figure>');
      });
      if (fig.p && fig.p.length) {
        h.push('<div class="tw"><table class="doc-table"><thead><tr><th>№</th><th>Артикул</th>' +
          "<th>Наименование</th><th>中文</th><th>Кол-во</th></tr></thead><tbody>");
        fig.p.forEach(function (p) {
          var mp = MPARTS[p[1]] || {};
          h.push("<tr><td>" + esc(p[0]) + "</td><td>" + partLink(p[1]) + "</td><td>" +
            esc(mp.ru || p[2]) + (mp.ru && p[2] ? ' <span class="sub">' + esc(p[2]) + "</span>" : "") +
            "</td><td>" + esc(p[3]) + "</td><td>" + esc(p[4]) + "</td></tr>");
        });
        h.push("</tbody></table></div>");
      }
    });
    h.push("</div></article>");
    render('<div class="doc-layout">' + h.join("") + "</div>");
  });
}

function viewMachineService(name, code) {
  withMachine(name, function (m) {
    if (!m) { notFound("Машина " + name); return; }
    var s = null;
    (m.svc || []).some(function (x) { if (x.c === code) { s = x; return true; } return false; });
    if (!s) { notFound("Инструкция " + code); return; }
    var h = [crumbs([{ t: "База знаний", href: "#/kb" },
                     { t: "Машины", href: "#/machines" },
                     { t: name, href: "#/machine/" + name }, { t: "Ремонт " + code }])];
    h.push('<article class="kb-doc"><header class="doc-head"><h1>' + esc(code) + " — " +
      esc(s.t) + '</h1><div class="doc-meta"><span class="tag t-procedures">Ремонт машины</span>' +
      '<a class="chip" href="#/msec/' + name + "/" + esc(code) +
      '">раздел каталога ' + esc(code) + "</a></div></header>");
    var note = LANG === "en"
      ? '<div class="mt-note">This repair instruction exists only in Russian — ' +
        "it comes from the machine manufacturer's manual, not from QuickServe.</div>"
      : "";
    h.push('<div class="doc-body">' + note +
           (s.b || '<p class="sub">Текст не выгружен.</p>') + "</div></article>");
    render('<div class="doc-layout">' + h.join("") + "</div>");
  });
}

/* ============================================================ двигатель */
function viewEngine(esn) {
  var cat = (window.CATALOGS || {})[esn];
  var ids = Object.keys(DOCS).filter(function (id) {
    return (DOCS[id].e || []).indexOf(esn) !== -1;
  });
  var byCat = {};
  ids.forEach(function (id) { (byCat[DOCS[id].c] = byCat[DOCS[id].c] || []).push(id); });

  var h = [crumbs([{ t: "База знаний", href: "#/kb" }, { t: "Двигатель " + esn }])];
  h.push('<div class="kb-head"><h1>' + esc(esn) + (cat ? " — " + esc(cat.model) : "") + "</h1>");
  if (cat) {
    h.push('<p class="lead">CPL ' + esc(cat.cpl) + " · конфигурация " + esc(cat.config || "—") +
      " · сборка " + esc(cat.buildDate || "—") + " · узлов " + (cat.options || []).length +
      " · комплектов " + (cat.kits || []).length + "</p>");
  }
  h.push('<div class="doc-links"><a class="btn-mini" href="#" data-open-engine="' + esc(esn) +
    '">Открыть каталог этого двигателя</a>' +
    (faultsOf(esn) ? ' <a class="btn-mini" href="#/faults/' + esc(esn) +
      '">Коды неисправностей (' + (faultsOf(esn).rows || []).length + ")</a>" : "") +
    "</div></div>");

  /* Документы в QuickServe выкачаны по «документальному» серийному номеру
     семейства. Если это не сам этот двигатель — говорим об этом прямо, иначе
     чужие руководства читаются как «руководства этого ДВС». */
  /* Документы в QuickServe привязаны к серийному номеру. Для этого двигателя
     свой набор не выгружался — показываем набор семейства и честно пишем, по
     какому ESN и CPL он собран, чтобы чужое не читалось как своё. */
  var src = (window.KB_DOC_SOURCE || {})[esn];
  if (src && src.esn !== esn) {
    h.push('<div class="kb-note">Собственного набора документов QuickServe для ' +
      "этого двигателя (<b>" + esc(src.own_model || (cat && cat.model) || "") +
      "</b>, ESN <b>" + esc(esn) + "</b>, CPL <b>" + esc(src.own_cpl || (cat && cat.cpl) || "—") +
      "</b>) в песочнице нет. Ниже — общий набор семейства <b>" + esc(src.family) +
      "</b>, выгруженный по серийному номеру <b>" + esc(src.esn) + "</b> (" +
      esc(src.model) + ", CPL " + esc(src.cpl) + "). Документы, которые по названию " +
      "относятся к другим моделям семейства, к этому двигателю не привязаны. " +
      'Точный набор по своему ESN смотрите на <a class="lnk" ' +
      'href="https://quickserve.cummins.com/qs3/pubsys2/xml/en/index.html" target="_blank" ' +
      'rel="noopener">QuickServe ↗</a>.</div>');
  }

  if (byCat.manual) {
    h.push('<section class="kb-card wide"><h2>Руководства</h2><ul class="kb-list">');
    byCat.manual.forEach(function (id) {
      var mid = id.replace("-history", ""), mm = MAN[mid] || {};
      h.push('<li><a href="#/manual/' + mid + '">' + esc(mm.ru || mm.t || mid) +
        '</a> <span class="cnt">' + (mm.n || 0) + "</span></li>");
    });
    h.push("</ul></section>");
  }
  var hasDocs = ["procedures", "tsb", "bulletin", "sti", "install_inst", "outlines"]
    .some(function (c) { return byCat[c]; });
  if (hasDocs) {
    h.push('<section class="kb-card wide"><h2>Документация двигателя</h2><ul class="kb-list cols">');
    ["procedures", "tsb", "bulletin", "sti", "install_inst", "outlines"].forEach(function (c) {
      if (!byCat[c]) return;
      h.push('<li><a href="#/docs/' + c + '">' + esc(CAT_MANY[c]) + '</a> <span class="cnt">' +
             byCat[c].length + "</span></li>");
    });
    h.push("</ul></section>");
  } else {
    h.push('<section class="kb-card wide"><h2>Документация двигателя</h2>' +
      '<p class="lead">Для этого двигателя документы в песочницу не выгружались: ' +
      'в QuickServe документация привязана к другим серийным номерам того же семейства. ' +
      'Каталог запчастей доступен полностью, а документы смотрите на ' +
      '<a class="lnk" href="https://quickserve.cummins.com/qs3/pubsys2/xml/en/index.html" ' +
      'target="_blank" rel="noopener">QuickServe ↗</a> по номеру ' + esc(esn) +
      ".</p></section>");
  }

  if (cat) {
    h.push('<section class="kb-card wide"><h2>Системы и узлы</h2>');
    (cat.systems || []).forEach(function (s) {
      h.push("<h3>" + esc(s.name || s.code) + "</h3><ul class=\"kb-list cols\">");
      (s.options || []).forEach(function (on) {
        var o = null;
        (cat.options || []).some(function (x) { if (x.no === on) { o = x; return true; } return false; });
        var nm = (NAMES.opt && NAMES.opt[on]) || (o && o.name) || "";
        h.push('<li><a class="lnk" href="#" data-open-option="' + esc(esn) + "|" + esc(on) +
               '|">' + esc(on) + " — " + esc(nm) + "</a></li>");
      });
      h.push("</ul>");
    });
    h.push("</section>");
  }
  render(h.join(""));
}

/* =============================================================== поиск */
function viewSearch(q) {
  q = (q || "").trim();
  var h = [crumbs([{ t: "База знаний", href: "#/kb" }, { t: "Поиск" }])];
  h.push('<div class="kb-head"><h1>Поиск</h1>' +
    '<input class="kb-filter" id="kb-q" placeholder="Номер детали, название, номер документа…" value="' +
    esc(q) + '"></div><div id="kb-res"></div>');
  render(h.join(""));
  var inp = document.getElementById("kb-q");
  inp.focus();
  inp.oninput = function () {
    var v = this.value;
    clearTimeout(inp._t);
    inp._t = setTimeout(function () {
      location.replace("#/search/" + encodeURIComponent(v));
      document.getElementById("kb-res").innerHTML = searchHtml(v);
    }, 180);
  };
  document.getElementById("kb-res").innerHTML = searchHtml(q);
}

function searchHtml(q) {
  q = (q || "").trim();
  if (q.length < 2) return '<p class="sub">Введите минимум два символа.</p>';
  var lo = q.toLowerCase();
  var num = q.toUpperCase().replace(/[\s-]/g, "");
  var h = [];

  var pHits = [];
  Object.keys(PARTS).forEach(function (no) {
    if (pHits.length > 200) return;
    var p = PARTS[no];
    if (no.toUpperCase().indexOf(num) !== -1 ||
        (p.ru && p.ru.toLowerCase().indexOf(lo) !== -1) ||
        (p.n && p.n.toLowerCase().indexOf(lo) !== -1)) pHits.push(no);
  });
  var mHits = [];
  Object.keys(MPARTS).forEach(function (no) {
    if (mHits.length > 200) return;
    var p = MPARTS[no];
    if (no.toUpperCase().indexOf(num) !== -1 ||
        (p.ru && p.ru.toLowerCase().indexOf(lo) !== -1) ||
        (p.en && p.en.toLowerCase().indexOf(lo) !== -1)) mHits.push(no);
  });
  var dHits = SEARCH.filter(function (r) {
    return r[0].toLowerCase().indexOf(lo) !== -1 ||
           (r[1] && r[1].toLowerCase().indexOf(lo) !== -1) ||
           (r[2] && r[2].toLowerCase().indexOf(lo) !== -1);
  }).slice(0, 300);

  h.push('<div class="res-tabs"><span>Найдено: детали Cummins ' + pHits.length +
    " · детали машин " + mHits.length + " · документы " + dHits.length + "</span></div>");

  if (pHits.length) {
    h.push('<section class="kb-card wide"><h2>Детали Cummins</h2><table class="kb-table">');
    pHits.slice(0, 60).forEach(function (no) {
      var p = PARTS[no];
      h.push("<tr><td class='c-id'>" + partLink(no) + "</td><td>" + esc(p.ru || "") +
        (p.n ? ' <span class="sub">' + esc(p.n) + "</span>" : "") + "</td><td class='c-eng'>" +
        (p.e || []).map(function (e) { return '<span class="chip">' + e + "</span>"; }).join(" ") +
        "</td></tr>");
    });
    h.push("</table>" + (pHits.length > 60 ? '<p class="sub">…ещё ' + (pHits.length - 60) +
      "</p>" : "") + "</section>");
  }
  if (mHits.length) {
    h.push('<section class="kb-card wide"><h2>Детали машин NHL</h2><table class="kb-table">');
    mHits.slice(0, 60).forEach(function (no) {
      var p = MPARTS[no];
      h.push("<tr><td class='c-id'>" + partLink(no) + "</td><td>" + esc(p.ru || p.en || "") +
        "</td><td class='c-eng'>" + Object.keys(p.m).map(function (m) {
          return '<span class="chip">' + esc(m) + "</span>"; }).join(" ") + "</td></tr>");
    });
    h.push("</table>" + (mHits.length > 60 ? '<p class="sub">…ещё ' + (mHits.length - 60) +
      "</p>" : "") + "</section>");
  }
  if (dHits.length) {
    h.push('<section class="kb-card wide"><h2>Документы</h2><table class="kb-table">');
    dHits.slice(0, 120).forEach(function (r) {
      var d = DOCS[r[0]] || {};
      h.push("<tr><td class='c-id'>" + docLink(r[0], r[0]) + "</td><td>" + badge(r[3]) + " " +
        esc(r[2] || "") + (r[1] ? ' <span class="sub">' + esc(r[1]) + "</span>" : "") +
        "</td><td class='c-date'>" + esc(d.d || "") + "</td></tr>");
    });
    h.push("</table></section>");
  }
  if (!pHits.length && !mHits.length && !dHits.length) {
    h.push('<p class="empty">Ничего не найдено.</p>');
  }
  return h.join("");
}

/* ------------------------------------------------- списки деталей целиком */
function viewParts(kind, q) {
  var isM = kind === "mparts";
  var src = isM ? MPARTS : PARTS;
  var ids = Object.keys(src).sort();
  var h = [crumbs([{ t: "База знаний", href: "#/kb" },
                   { t: isM ? "Детали машин" : "Детали Cummins" }])];
  h.push('<div class="kb-head"><h1>' + (isM ? "Детали машин NHL" : "Детали Cummins") +
    ' <span class="cnt">' + ids.length + '</span></h1>' +
    '<input class="kb-filter" id="kb-filter" placeholder="Артикул или наименование…" value="' +
    esc(q || "") + '"></div><div id="kb-plist"></div>');
  render(h.join(""));

  function rows(f) {
    f = (f || "").trim().toLowerCase();
    var out = [], n = 0;
    for (var i = 0; i < ids.length && n < 600; i++) {
      var no = ids[i], p = src[no];
      var hay = (no + " " + (p.ru || "") + " " + (p.n || p.en || "")).toLowerCase();
      if (f && hay.indexOf(f) === -1) continue;
      n++;
      out.push("<tr><td class='c-id'>" + partLink(no) + "</td><td>" + esc(p.ru || "") +
        '<span class="sub"> ' + esc(p.n || p.en || "") + "</span></td><td class='c-eng'>" +
        (isM ? Object.keys(p.m).map(function (m) { return '<span class="chip">' + esc(m) + "</span>"; }).join(" ")
             : (p.e || []).map(function (e) { return '<span class="chip">' + e + "</span>"; }).join(" ")) +
        "</td></tr>");
    }
    if (!out.length) return '<p class="empty">Ничего не найдено.</p>';
    return '<table class="kb-table">' + out.join("") + "</table>" +
      (n >= 600 ? '<p class="sub">Показаны первые 600 — уточните фильтр.</p>' : "");
  }
  document.getElementById("kb-plist").innerHTML = rows(q);
  var f = document.getElementById("kb-filter");
  f.oninput = function () { document.getElementById("kb-plist").innerHTML = rows(this.value); };
}

function viewEngines() {
  var h = [crumbs([{ t: "База знаний", href: "#/kb" }, { t: "Двигатели" }])];
  h.push('<div class="kb-head"><h1>Двигатели</h1></div><table class="kb-table">');
  engines().forEach(function (e) {
    var n = Object.keys(DOCS).filter(function (id) {
      return (DOCS[id].e || []).indexOf(e.esn) !== -1; }).length;
    h.push('<tr><td class="c-id"><a class="lnk eng" href="#/engine/' + e.esn + '">' + e.esn +
      "</a></td><td>" + esc(e.model) + ' <span class="sub">CPL ' + esc(e.cpl) +
      "</span></td><td class='c-date'>документов: " + n + "</td></tr>");
  });
  h.push("</table>");
  render(h.join(""));
}

function notFound(what) {
  render('<div class="kb-head"><h1>Не найдено</h1><p class="lead">' + esc(what) +
    ' отсутствует в базе. Попробуйте <a href="#/search/">поиск</a>.</p></div>');
}

/* ============================================================ маршруты */
/* ================================================== коды неисправностей
   Таблица SPN/FMI из руководства машины: код на дисплее -> что он значит.
   Живёт отдельным экраном, потому что это не документ QuickServe, а
   приложение к руководству по эксплуатации самосвала. */
function faultsOf(esn) { return (window.KB_FAULT_CODES || {})[esn] || null; }

function viewFaults(esn, q) {
  var fc = faultsOf(esn);
  if (!fc) { notFound("Коды неисправностей " + (esn || "")); return; }
  var cat = (window.CATALOGS || {})[esn];
  var rows = fc.rows || [], cols = fc.cols || [];
  var query = String(q || "").trim().toLowerCase();
  var shown = rows;
  if (query) {
    var terms = query.split(/\s+/);
    shown = rows.filter(function (r) {
      var hay = r.join(" ").toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) >= 0; });
    });
  }
  var h = [crumbs([{ t: "База знаний", href: "#/kb" },
                   { t: "Двигатель " + esn, href: "#/engine/" + esn },
                   { t: "Коды неисправностей" }])];
  h.push('<div class="kb-head"><h1>Коды неисправностей ' + esc(esn) +
    (cat ? " — " + esc(cat.model) : "") + "</h1>");
  h.push('<p class="lead">' + rows.length + " кодов · SPN/FMI. " +
    "Введите номер кода с дисплея, SPN, FMI или слово из описания.</p>");
  if (fc.source) {
    h.push('<div class="kb-note"><b>Источник:</b> ' + esc(fc.source) +
      (fc.note ? ". " + esc(fc.note) : "") + "</div>");
  }
  h.push("</div>");
  h.push('<div class="fc-search"><input id="fcq" type="search" value="' + esc(q || "") +
    '" placeholder="Например: 115, SPN 612, датчик давления, Intake Manifold" ' +
    'autocomplete="off"><span class="fc-count" id="fccount">' +
    (query ? "найдено: " + shown.length + " из " + rows.length : "всего: " + rows.length) +
    "</span></div>");
  h.push('<section class="kb-card wide"><div class="tw"><table class="doc-table fc-table">' +
    "<thead><tr>" + cols.map(function (c, i) {
      return '<th class="fc-c' + i + '">' + esc(c) + "</th>";
    }).join("") + "</tr></thead><tbody id=\"fcbody\">" +
    faultRows(shown) + "</tbody></table></div></section>");
  render(h.join(""));

  var inp = document.getElementById("fcq");
  if (!inp) return;
  var t = null;
  inp.addEventListener("input", function () {
    clearTimeout(t);
    t = setTimeout(function () {
      var v = inp.value.trim().toLowerCase();
      var list = rows;
      if (v) {
        var ts = v.split(/\s+/);
        list = rows.filter(function (r) {
          var hay = r.join(" ").toLowerCase();
          return ts.every(function (x) { return hay.indexOf(x) >= 0; });
        });
      }
      document.getElementById("fcbody").innerHTML = faultRows(list);
      document.getElementById("fccount").textContent =
        v ? "найдено: " + list.length + " из " + rows.length : "всего: " + rows.length;
      /* адрес держим в актуальном виде — чтобы найденное можно было переслать */
      var want = "#/faults/" + esn + (v ? "/" + encodeURIComponent(inp.value.trim()) : "");
      if (location.hash !== want) history.replaceState(null, "", want);
    }, 120);
  });
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
}

function faultRows(list) {
  if (!list.length) {
    return '<tr><td colspan="6" class="sub">Ничего не найдено.</td></tr>';
  }
  return list.map(function (r) {
    return "<tr>" + r.map(function (v, i) {
      return '<td class="fc-c' + i + '">' + esc(v) + "</td>";
    }).join("") + "</tr>";
  }).join("");
}

function route() {
  var hash = location.hash || "";
  if (!hash || hash === "#" || hash.indexOf("#/catalog") === 0) { setMode(false); return; }
  var parts = hash.replace(/^#\//, "").split("/").map(decodeURIComponent);
  var head = parts[0];

  if (head === "kb") return viewHome();
  if (head === "docs") return viewDocs(parts[1] || "all", parts[2]);
  if (head === "doc") return viewDoc(parts.slice(1).join("/"));
  if (head === "manual") return viewManual(parts[1]);
  if (head === "topic") return viewTopic(parseInt(parts[1], 10) || 0);
  if (head === "part") return viewPart(parts[1]);
  if (head === "mpart") return viewMPart(parts[1]);
  if (head === "parts") return viewParts("parts", parts[1]);
  if (head === "mparts") return viewParts("mparts", parts[1]);
  if (head === "machines") return viewMachines();
  if (head === "machine") return viewMachine(parts[1]);
  if (head === "msec") return viewMachineSection(parts[1], parts[2], false);
  if (head === "mesec") return viewMachineSection(parts[1], parts[2], true);
  if (head === "msvc") return viewMachineService(parts[1], parts[2]);
  if (head === "faults") return viewFaults(parts[1], parts.slice(2).join("/"));
  if (head === "engine") return viewEngine(parts[1]);
  if (head === "engines") return viewEngines();
  if (head === "search") return viewSearch(parts.slice(1).join("/"));
  setMode(false);
}

/* ------------------------------------------------- клики внутри базы */
document.addEventListener("click", function (e) {
  var a = e.target.closest ? e.target.closest("a") : null;
  if (!a) return;
  var api = window.CATALOG_API;

  if (a.hasAttribute("data-open-catalog") && api) {
    e.preventDefault();
    var pn = a.getAttribute("data-open-catalog");
    setMode(false); location.hash = "#/catalog";
    api.openPart(pn);
    return;
  }
  if (a.hasAttribute("data-open-option") && api) {
    e.preventDefault();
    var v = a.getAttribute("data-open-option").split("|");
    setMode(false); location.hash = "#/catalog";
    api.openOption(v[0], v[1], v[2] || null);
    return;
  }
  if (a.hasAttribute("data-open-engine") && api) {
    e.preventDefault();
    setMode(false); location.hash = "#/catalog";
    api.selectEngine(a.getAttribute("data-open-engine"));
    return;
  }
  if (a.hasAttribute("data-lang-set")) {
    e.preventDefault();
    setLang(a.getAttribute("data-lang-set"));
    route();
    return;
  }
  if (a.id === "nav-catalog") {
    e.preventDefault();
    setMode(false);
    if (location.hash) location.hash = "#/catalog";
  }
});

/* просмотр иллюстрации во весь экран */
document.addEventListener("click", function (e) {
  var img = e.target;
  if (!img || img.tagName !== "IMG") return;
  if (!img.closest(".doc-body, .part-photos")) return;
  var ov = document.createElement("div");
  ov.className = "kb-lightbox";
  ov.innerHTML = '<img src="' + img.getAttribute("src") + '" alt="">';
  ov.onclick = function () { ov.remove(); };
  document.body.appendChild(ov);
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    var ov = document.querySelector(".kb-lightbox");
    if (ov) ov.remove();
  }
});

window.addEventListener("hashchange", route);

/* ------------------------------------------------------- внешний API */
window.KB = {
  active: active,
  lang: function () { return LANG; },
  setLang: function (v) { setLang(v); route(); },
  search: function (q) {
    lastQuery = q;
    if (q && q.trim().length >= 2) location.hash = "#/search/" + encodeURIComponent(q);
  },
  /* дописывает найденные документы в результаты поиска каталога */
  appendDocs: function (q, box) {
    if (!q || q.trim().length < 2 || !box) return;
    var lo = q.trim().toLowerCase();
    var hits = SEARCH.filter(function (r) {
      return r[0].toLowerCase().indexOf(lo) !== -1 ||
             (r[1] && r[1].toLowerCase().indexOf(lo) !== -1) ||
             (r[2] && r[2].toLowerCase().indexOf(lo) !== -1);
    });
    if (!hits.length) return;
    var wrap = document.createElement("div");
    wrap.className = "kb-inline";
    var head = "<h3>Документы базы знаний <span class=\"cnt\">" + hits.length + "</span>" +
      ' <a class="btn-mini" href="#/search/' + encodeURIComponent(q) + '">открыть поиск →</a></h3>';
    var rows = hits.slice(0, 12).map(function (r) {
      var d = DOCS[r[0]] || {};
      return "<tr><td class='c-id'>" + docLink(r[0], r[0]) + "</td><td>" + badge(r[3]) + " " +
        esc(r[2] || r[1]) + "</td><td class='c-date'>" + esc(d.d || "") + "</td></tr>";
    }).join("");
    wrap.innerHTML = head + '<table class="kb-table">' + rows + "</table>";
    box.appendChild(wrap);
  },
  /* ссылки на базу знаний в карточке детали каталога */
  decoratePartCard: function (pn) {
    var host = document.getElementById("pc-name");
    if (!host) return;
    var old = document.getElementById("pc-kb");
    if (old) old.remove();
    var p = PARTS[pn];
    var box = document.createElement("div");
    box.id = "pc-kb";
    box.className = "pc-kb";
    var bits = [];
    if (p && p.ru) bits.push("<b>" + esc(p.ru) + "</b>");
    bits.push('<a class="btn-mini" href="#/part/' + esc(pn) + '">Открыть в базе знаний →</a>');
    if (p && p.d && p.d.length) {
      bits.push('<span class="sub">упоминается в документах: ' + p.d.length + "</span>");
    }
    box.innerHTML = bits.join(" ");
    host.parentNode.insertBefore(box, host.nextSibling);
  },
  photoUrl: photoUrl,
  ruPart: function (pn) { return (PARTS[pn] && PARTS[pn].ru) || (MPARTS[pn] && MPARTS[pn].ru) || ""; },
  ruOption: function (no) { return (NAMES.opt && NAMES.opt[no]) || ""; },
  route: route
};

setLang(LANG);
var langBox = document.getElementById("lang-switch");
if (langBox) {
  langBox.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-lang]");
    if (!b) return;
    setLang(b.getAttribute("data-lang"));
    route();
  });
}
route();
})();
