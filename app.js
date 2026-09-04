/* ============================================================
   Unified NHL parts catalog (NTE200 / NTE240 / TR100A).
   Vanilla JS, no build step. Data arrives as globals:
     window.MACHINES   — [{id,name,subtitle,currency,hashPrefix,...}]
     window.CATALOGS   — { id: {chapters, sections} }  (image paths already
                          prefixed with the machine subfolder)
     window.PRICES_BY  — { id: {pn:{p,n,x,g}} }
   Browsing is per selected machine; "Экспорт всех номеров" and
   "Проверка списка" work across ALL machines. Opens from index.html.
   ============================================================ */
(function () {
  "use strict";

  var MACHINES = window.MACHINES || [];
  var CATALOGS = window.CATALOGS || {};
  var PRICES_BY = window.PRICES_BY || {};
  var machineById = {};
  MACHINES.forEach(function (m) { machineById[m.id] = m; });

  // ---- current machine --------------------------------------------------
  var MKEY = "nhl_machine_v1";
  var cur = null;
  try { cur = localStorage.getItem(MKEY); } catch (e) {}
  if (!machineById[cur]) cur = (MACHINES[0] || {}).id;
  function machine() { return machineById[cur] || { id: cur, name: cur, currency: "CNY", hashPrefix: "#" }; }
  function currencyOf(id) { return (machineById[id] || {}).currency || "CNY"; }

  // ---- categories: Машина / Электропривод / Двигатель ------------------
  var CATS = [
    { key: "machine", label: "Машина" },
    { key: "drive", label: "Электропривод" },
    { key: "engine", label: "Двигатель" }
  ];
  var curCat = "machine";
  function catLabel(key) { for (var i = 0; i < CATS.length; i++) if (CATS[i].key === key) return CATS[i].label; return key; }
  function catAvailable(id, key) {
    var m = machineById[id] || {};
    if (key === "machine") return true;
    if (key === "drive") return (m.driveChapters || []).length > 0;
    if (key === "engine") return !!m.engineSite || (m.engineEpcChapters || []).length > 0;
    return false;
  }
  // chapter codes shown in the sidebar for a given category
  function catChapterCodes(id, key) {
    var m = machineById[id] || {}, all = (CATALOGS[id].chapters || []).map(function (c) { return c.code; });
    if (key === "drive") return m.driveChapters || [];
    if (key === "engine") return m.engineEpcChapters || [];   // [] when the engine is a standalone site
    var excl = {};
    (m.driveChapters || []).concat(m.enginePdfChapters || [], m.engineEpcChapters || []).forEach(function (c) { excl[c] = 1; });
    return all.filter(function (c) { return !excl[c]; });
  }
  function isEngineSite(id, key) { return key === "engine" && !!(machineById[id] || {}).engineSite; }
  function firstSectionOfCat(id, key) {
    var codes = {}; catChapterCodes(id, key).forEach(function (c) { codes[c] = 1; });
    var s = (CATALOGS[id].sections || []).filter(function (x) { return codes[x.chapter]; })[0];
    return s ? s.code : null;
  }
  // which category a section's chapter belongs to (for navigation from search/check)
  function chapterCategory(id, chapter) {
    var m = machineById[id] || {};
    if ((m.driveChapters || []).indexOf(chapter) >= 0) return "drive";
    if ((m.engineEpcChapters || []).indexOf(chapter) >= 0) return "engine";
    return "machine";
  }
  function catHash(id, key, rest) {
    return "#/m/" + id + "/" + key + (rest ? "/" + rest : "");
  }

  // ---- prices (per-machine factory + localStorage overlay) --------------
  function priceKey(id) { return "nhl_prices_" + id + "_v1"; }
  function loadOverlay(id) {
    try { return JSON.parse(localStorage.getItem(priceKey(id))) || null; } catch (e) { return null; }
  }
  function mergePrices(id) {
    var base = {}, f = PRICES_BY[id] || {}, ov = loadOverlay(id), k;
    for (k in f) base[k] = f[k];
    if (ov) for (k in ov) base[k] = ov[k];
    return base;
  }
  var pricesCache = {};
  function pricesFor(id) { return pricesCache[id] || (pricesCache[id] = mergePrices(id)); }
  function invalidatePrices(id) { delete pricesCache[id]; checkIndex = null; searchIndex = null; }
  function priceOf(pn, id) { var p = pricesFor(id || cur); return p[pn] || null; }

  // ---- helpers ----------------------------------------------------------
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var el = function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  function pad(ref) {
    if (ref == null || ref === "") return "";
    return /^\d+$/.test(ref) ? ("00" + ref).slice(-3) : ref;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function fmt(n) {
    return (Math.round(n * 100) / 100).toLocaleString("ru-RU",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function defNeed(qty) {
    var m = /^\d+$/.test(qty) ? parseInt(qty, 10) : 1;
    return m > 0 ? m : 1;
  }
  function secName(s) {
    if (!s) return "";
    var en = s.en || "", zh = s.zh || "";
    if (en && /\s/.test(en)) return en;
    return zh || en;
  }
  function sectionParts(s) {
    var out = [];
    (s.figures || []).forEach(function (f) { (f.parts || []).forEach(function (p) { out.push(p); }); });
    return out;
  }
  // Каталоги Машина/Электропривод (в отличие от EPC Cummins) не содержат
  // структурированного состава комплектов — только позиции, чьё наименование
  // само указывает, что это комплект. Помечаем такие по названию.
  var KIT_RE = /\bkit\b|комплект/i;
  function isKitPart(p, pr) {
    return KIT_RE.test(p.zh || "") || KIT_RE.test(p.en || "") || (pr && pr.n && KIT_RE.test(pr.n));
  }

  // ---- per-machine derived state ---------------------------------------
  var CAT, sectionByCode, chapterName, CATALOG_PNS, searchIndex;
  function buildDerived() {
    CAT = CATALOGS[cur] || { chapters: [], sections: [] };
    sectionByCode = {};
    CAT.sections.forEach(function (s) { sectionByCode[s.code] = s; });
    chapterName = {};
    CAT.chapters.forEach(function (c) { chapterName[c.code] = c; });
    CATALOG_PNS = {};
    CAT.sections.forEach(function (s) {
      (s.figures || []).forEach(function (f) {
        (f.parts || []).forEach(function (p) { if (p.pn) CATALOG_PNS[p.pn] = 1; });
      });
    });
    searchIndex = null;
  }

  // ---- cart (localStorage, keyed by machine|pn) ------------------------
  var CART_KEY = "nhl_cart_v1";
  var SERIAL_KEY = "nhl_serial_v1";
  var cart = loadCart();
  function loadCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
    renderCartCount();
  }
  function cartKey(m, pn) { return m + "|" + pn; }
  function addToCart(pn, qty, meta) {
    if (!pn) return;
    var k = cartKey(cur, pn);
    if (!cart[k]) cart[k] = { m: cur, pn: pn, qty: 0, zh: meta.zh || "", en: meta.en || "" };
    cart[k].qty += qty;
    if (meta.zh) cart[k].zh = meta.zh;
    if (meta.en) cart[k].en = meta.en;
    saveCart();
    toast("Добавлено в заказ: " + machine().name + " · " + pn + " × " + qty);
  }

  // ---- machine switcher / header UI ------------------------------------
  function renderMachineSwitch() {
    var box = $("#machineSwitch");
    box.innerHTML = "";
    MACHINES.forEach(function (m) {
      var b = el("button", m.id === cur ? "active" : "", esc(m.name));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.title = m.name + " — " + (m.subtitle || "");
      b.addEventListener("click", function () {
        var cat = catAvailable(m.id, curCat) ? curCat : "machine";
        location.hash = catHash(m.id, cat);
      });
      box.appendChild(b);
    });
  }
  function updateMachineUI() {
    var m = machine();
    var onLanding = document.body.classList.contains("on-landing");
    var btns = $("#machineSwitch").querySelectorAll("button");
    for (var i = 0; i < btns.length; i++)
      btns[i].classList.toggle("active", !onLanding && btns[i].textContent === m.name);
    $("#machineSub").textContent = onLanding
      ? "Всё оборудование NHL — самосвалы с ДВС"
      : m.name + " · " + (m.subtitle || "");
    var site = $("#machineSite");
    site.href = m.id + "/index.html";
    site.title = "Полный каталог " + m.name + ": руководства по эксплуатации, ремонт, каталог двигателя";
    $("#pmMachine").textContent = m.name;
    $("#pmPath").textContent = m.id + "/data/";
  }
  function setMachine(id) {
    if (!machineById[id]) return;
    cur = id;
    try { localStorage.setItem(MKEY, id); } catch (e) {}
    buildDerived();
  }

  // ---- category tabs + sidebar -----------------------------------------
  function renderCatTabs() {
    var box = $("#catTabs");
    if (!box) return;
    box.innerHTML = "";
    CATS.forEach(function (c) {
      if (!catAvailable(cur, c.key)) return;
      var b = el("button", c.key === curCat ? "active" : "", esc(c.label));
      b.type = "button";
      b.addEventListener("click", function () { location.hash = catHash(cur, c.key); });
      box.appendChild(b);
    });
  }
  function renderSidebar() {
    renderCatTabs();
    var m = machine();
    $("#sidebarMachine").innerHTML =
      "<b>" + esc(m.name) + "</b> · " + esc(catLabel(curCat)) +
      "<div class='sm-sub'>" + esc(m.subtitle || "") + "</div>";
    var root = $("#chapters");
    root.innerHTML = "";
    if (isEngineSite(cur, curCat)) {
      root.innerHTML = "<div class='engine-note'>Каталог двигателя <b>" +
        esc(m.engineLabel || "Cummins (EPC)") + "</b> открыт в области справа.<br>" +
        "Это отдельный каталог двигателя, полученный из EPC Cummins (не из PDF).</div>";
      return;
    }
    var kitsBtn = el("button", "kits-link", "🧰 Комплекты в этом разделе");
    kitsBtn.type = "button";
    kitsBtn.title = "Показать позиции этого раздела, чьё наименование содержит KIT / комплект";
    kitsBtn.addEventListener("click", function () { location.hash = catHash(cur, curCat, "k"); });
    root.appendChild(kitsBtn);

    var codes = {}; catChapterCodes(cur, curCat).forEach(function (c) { codes[c] = 1; });
    CAT.chapters.forEach(function (ch) {
      if (!codes[ch.code]) return;
      var secs = CAT.sections.filter(function (s) { return s.chapter === ch.code; });
      if (!secs.length) return;
      var wrap = el("div", "chapter collapsed");
      wrap.dataset.code = ch.code;
      var h = el("div", "chap-h");
      h.innerHTML = '<span class="code">' + esc(ch.code) + '</span>' +
        '<span>' + esc(ch.en || ch.zh) + '</span>' +
        '<span class="caret">▾</span>';
      h.addEventListener("click", function () { wrap.classList.toggle("collapsed"); });
      wrap.appendChild(h);
      var ul = el("ul", "sec-list");
      secs.forEach(function (s) {
        var li = el("li");
        li.dataset.code = s.code;
        li.innerHTML = '<span class="code">' + esc(s.code) + '</span>' +
          '<span>' + esc(secName(s)) + '</span>';
        li.addEventListener("click", function () { location.hash = catHash(cur, curCat, "s/" + s.code); });
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
      root.appendChild(wrap);
    });
  }

  // ---- model-selection landing + engine iframe -------------------------
  function renderLanding() {
    curCat = "machine";
    document.body.classList.add("on-landing");
    updateMachineUI();
    highlightSidebar(null);
    var c = $("#content");
    c.innerHTML = "";
    var wrap = el("div", "landing");
    wrap.appendChild(el("div", "landing-h",
      "<h1>Выбор моделей</h1><p>Единый каталог запасных частей самосвалов NHL с ДВС. " +
      "Выберите машину и раздел: <b>Машина</b>, <b>Электропривод</b> или <b>Двигатель</b> (EPC Cummins).</p>"));
    var grid = el("div", "landing-grid");
    MACHINES.forEach(function (m) {
      var card = el("div", "mcard");
      var btns = CATS.filter(function (c2) { return catAvailable(m.id, c2.key); }).map(function (c2) {
        return '<a class="mcard-cat cat-' + c2.key + '" href="' + catHash(m.id, c2.key) + '">' + esc(c2.label) + "</a>";
      }).join("");
      card.innerHTML =
        '<div class="mcard-badge ' + esc(m.id) + '">' + esc(m.name) + "</div>" +
        '<div class="mcard-sub">' + esc(m.subtitle || "") + "</div>" +
        '<div class="mcard-cats">' + btns + "</div>" +
        '<a class="mcard-full" href="' + esc(m.id) + '/index.html" target="_blank" rel="noopener">' +
        "📚 Полный родной каталог (руководства, ремонт) ↗</a>";
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    c.appendChild(wrap);
    window.scrollTo(0, 0);
  }
  function renderEngine() {
    var m = machine();
    var c = $("#content");
    c.innerHTML = "";
    var head = el("div", "sec-head");
    head.innerHTML =
      '<div class="crumb"><a class="crumb-link" href="#/">Выбор моделей</a> · ' + esc(m.name) + " · Двигатель (EPC Cummins)</div>" +
      "<h1>" + esc(m.engineLabel || "Двигатель Cummins (EPC)") + "</h1>" +
      '<div class="xref-row"><a class="xref-link tomachine" href="' + esc(m.engineSite) +
      '" target="_blank" rel="noopener">↗ Открыть каталог двигателя в отдельной вкладке</a></div>';
    c.appendChild(head);
    var frame = el("iframe", "engine-frame");
    var src = m.engineSite;
    if (engineFocusPn) {
      src += (src.indexOf("?") >= 0 ? "&" : "?") + "pn=" + encodeURIComponent(engineFocusPn);
      engineFocusPn = null;
    }
    frame.src = src;
    frame.setAttribute("title", "Каталог двигателя " + m.name);
    frame.setAttribute("loading", "lazy");
    c.appendChild(frame);
    window.scrollTo(0, 0);
  }
  function highlightSidebar(code) {
    var prev = $(".sec-list li.active");
    if (prev) prev.classList.remove("active");
    if (!code) return;
    var li = $('.sec-list li[data-code="' + code + '"]');
    if (li) {
      li.classList.add("active");
      var chap = li.closest(".chapter");
      if (chap) chap.classList.remove("collapsed");
      li.scrollIntoView({ block: "nearest" });
    }
  }

  // ---- section view -----------------------------------------------------
  function renderSection(code) {
    var s = sectionByCode[code];
    var content = $("#content");
    content.innerHTML = "";
    if (!s) { content.appendChild(el("p", null, "Раздел не найден.")); return; }
    var m = machine();
    var ch = chapterName[s.chapter] || { code: s.chapter, en: "" };
    var head = el("div", "sec-head");
    var count = sectionParts(s).filter(function (p) { return p.pn; }).length;
    var nativeHref = m.id + "/index.html" + (m.hashPrefix || "#") + encodeURIComponent(s.code);
    var toMachine = '<a class="xref-link tomachine" href="' + nativeHref + '" target="_blank" rel="noopener">' +
      '🔧 Открыть раздел в полном каталоге ' + esc(m.name) + ' (руководство, ремонт, двигатель) →</a>';
    // инструкция по ремонту именно этого узла, если она есть в базе знаний
    var svc = (SERVICE_PAGES[m.id] || {})[s.code];
    var toService = svc
      ? '<a class="xref-link toservice" href="' + esc(svc.u) + '" target="_blank" rel="noopener">' +
        '📘 Инструкция по ремонту: ' + esc(svc.t) + " →</a>"
      : "";
    head.innerHTML =
      '<div class="crumb"><a class="crumb-link" href="#/">Выбор моделей</a> · ' +
      '<a class="crumb-link" href="' + catHash(m.id, curCat) + '">' + esc(m.name) + " · " + esc(catLabel(curCat)) + "</a> · " +
      esc(ch.code) + " · " + esc(ch.en || ch.zh || "") + "</div>" +
      "<h1>" + esc(s.code) + " " + esc(s.zh || "") +
      ' <span class="en">' + esc(s.en || "") + "</span></h1>" +
      '<div class="meta">' + (s.figures || []).length + " рис. · " +
      count + " позиц. с номером детали</div>" +
      '<div class="xref-row">' + toMachine + toService + "</div>";
    content.appendChild(head);

    var figs = s.figures || [];
    figs.forEach(function (f, i) { content.appendChild(renderFigure(s, f, i, figs.length)); });
    window.scrollTo(0, 0);
    if (focusPN) { focusRow(focusPN); focusPN = null; }
  }

  var focusPN = null;
  var engineFocusPn = null;   // деталь двигателя, которую надо открыть в iframe Cummins
  function focusRow(pn) {
    // снять прошлую подсветку и подсветить выбранную деталь — стойко, пока
    // пользователь не перейдёт в другой раздел (чтобы деталь не искать глазами)
    var prev = document.querySelectorAll('#content tr.pn-selected');
    for (var j = 0; j < prev.length; j++) prev[j].classList.remove("pn-selected");
    var rows = document.querySelectorAll('#content tr[data-pn]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-pn") === pn) {
        rows[i].classList.add("pn-flash", "pn-selected");
        rows[i].scrollIntoView({ block: "center" });
        (function (r) { setTimeout(function () { r.classList.remove("pn-flash"); }, 2400); })(rows[i]);
        break;
      }
    }
  }

  function refRange(parts) {
    var nums = parts.map(function (p) { return parseInt(p.ref, 10); })
      .filter(function (n) { return !isNaN(n); });
    if (!nums.length) return "";
    var lo = Math.min.apply(null, nums), hi = Math.max.apply(null, nums);
    return " · позиции " + pad("" + lo) + "–" + pad("" + hi);
  }

  function renderFigure(s, f, idx, total) {
    var wrap = el("div", "figure");
    var head = el("div", "fig-head");
    head.innerHTML = '<span class="n">Рисунок ' + (idx + 1) + " / " + total + "</span>" +
      '<span class="sub">' + esc(s.code) + refRange(f.parts || []) + "</span>";
    wrap.appendChild(head);
    var body = el("div", "fig-body");
    body.appendChild(renderDrawing(f.images || []));
    body.appendChild(renderParts(f.parts || []));
    wrap.appendChild(body);
    return wrap;
  }

  function renderDrawing(images) {
    var dw = el("div", "drawing-wrap");
    if (!images.length) {
      dw.appendChild(el("div", "no-drawing", "Чертёж не приводится"));
      return dw;
    }
    var idx = 0;
    var car = el("div", "carousel");
    var stage = el("div", "stage");
    var img = el("img");
    img.alt = "Чертёж";
    img.addEventListener("click", function () { openLightbox(img.src); });
    stage.appendChild(img);
    car.appendChild(stage);
    var nav = el("div", "nav");
    var prev = el("button", null, "‹");
    var counter = el("span", "counter");
    var next = el("button", null, "›");
    nav.appendChild(prev); nav.appendChild(counter); nav.appendChild(next);
    car.appendChild(nav);
    function show() {
      img.src = images[idx];
      counter.textContent = (idx + 1) + " / " + images.length;
      prev.disabled = idx === 0;
      next.disabled = idx === images.length - 1;
    }
    prev.addEventListener("click", function () { if (idx > 0) { idx--; show(); } });
    next.addEventListener("click", function () { if (idx < images.length - 1) { idx++; show(); } });
    if (images.length === 1) nav.style.display = "none";
    show();
    dw.appendChild(car);
    return dw;
  }

  function sortByPos(parts) {
    var last = -1;
    var keyed = parts.map(function (p, i) {
      var m = /^(\d+)/.exec(p.ref || "");
      var own = m ? parseInt(m[1], 10) : null;
      if (own !== null) last = own;
      return { p: p, i: i, n: own !== null ? own : last, refless: own === null ? 1 : 0, s: p.ref || "" };
    });
    keyed.sort(function (a, b) {
      return (a.n - b.n) || (a.refless - b.refless) ||
        (a.s < b.s ? -1 : a.s > b.s ? 1 : 0) || (a.i - b.i);
    });
    return keyed.map(function (k) { return k.p; });
  }

  /* jump — переход из списка результатов в сам каталог. Если он задан, строки
     кликабельны: щелчок открывает раздел и подсвечивает там эту позицию. */
  function renderParts(parts, jump) {
    parts = sortByPos(parts);
    var cur3 = currencyOf(cur);
    var pw = el("div", "parts-wrap");
    var table = el("table", "parts");
    table.innerHTML =
      "<thead><tr>" +
      '<th class="num">№</th>' +
      "<th>Номер детали</th>" +
      "<th>Наименование</th>" +
      '<th class="price" style="text-align:right">Текущий, ' + cur3 + "</th>" +
      '<th class="price" style="text-align:right">Несогласованный, ' + cur3 + "</th>" +
      '<th class="qty">Кол-во</th>' +
      "<th>Нужно</th>" +
      "<th></th>" +
      "</tr></thead>";
    var tb = el("tbody");
    parts.forEach(function (p) { tb.appendChild(renderRow(p, jump)); });
    table.appendChild(tb);
    pw.appendChild(table);
    return pw;
  }

  function renderRow(p, jump) {
    var pr = p.pn ? priceOf(p.pn) : null;
    var isKit = isKitPart(p, pr);
    var cls = [];
    if (p.lvl) cls.push("lvl" + Math.min(p.lvl, 2));
    if (isKit) cls.push("row-kit");
    var tr = el("tr", cls.join(" "));
    if (p.pn) tr.dataset.pn = p.pn;
    if (jump && p.pn) {
      tr.classList.add("jumpable");
      tr.title = "Перейти к этой позиции в каталоге";
      tr.addEventListener("click", function (e) {
        // клики по номеру, полю «нужно» и кнопке «+» оставляем им
        if (e.target.closest("input, button, details")) return;
        jump(p);
      });
    }
    var pnCell;
    if (p.pn) {
      var xref = pr && pr.x ? '<span class="xref">↔ ' + esc(pr.x) + "</span>" : "";
      pnCell = '<span class="code">' + esc(p.pn) + "</span>" + xref;
    } else {
      tr.classList.add("no-order");
      pnCell = '<span class="muted">—</span>';
    }
    var nameHtml = "";
    if (isKit) nameHtml += '<span class="kit-badge" title="Комплект (по названию позиции)">🧰 комплект</span>';
    if (p.zh) nameHtml += '<div class="zh">' + esc(p.zh) + "</div>";
    if (p.en) nameHtml += '<div class="en">' + esc(p.en) + "</div>";
    if (pr && pr.n) nameHtml += '<div class="ru">' + esc(pr.n) + "</div>";
    if (pr && pr.g) nameHtml += '<span class="grp">' + esc(pr.g) + "</span>";
    if (!nameHtml) nameHtml = '<span class="en">—</span>';
    var curHtml = pr && pr.cp != null ? fmt(pr.cp) : '<span class="muted">—</span>';
    var priceHtml = pr && pr.p != null ? fmt(pr.p) : '<span class="muted">—</span>';
    var need = defNeed(p.qty);
    tr.innerHTML =
      '<td class="num">' + esc(pad(p.ref)) + "</td>" +
      '<td class="pn">' + pnCell + "</td>" +
      '<td class="name">' + nameHtml + "</td>" +
      '<td class="price">' + curHtml + "</td>" +
      '<td class="price">' + priceHtml + "</td>" +
      '<td class="qty">' + esc(p.qty || "") + "</td>";
    if (p.pn) {
      var needTd = el("td");
      var inp = el("input", "need");
      inp.type = "number"; inp.min = "1"; inp.value = need;
      needTd.appendChild(inp);
      tr.appendChild(needTd);
      var addTd = el("td");
      var btn = el("button", "add", "+");
      btn.title = "Добавить в заказ";
      btn.addEventListener("click", function () {
        var q = parseInt(inp.value, 10);
        if (!q || q < 1) q = 1;
        addToCart(p.pn, q, { zh: p.zh, en: p.en });
      });
      addTd.appendChild(btn);
      tr.appendChild(addTd);
    } else {
      tr.appendChild(el("td", "dash", "—"));
      tr.appendChild(el("td", "dash", ""));
    }
    return tr;
  }

  // ---- search (within current machine) ---------------------------------
  function buildIndex() {
    if (searchIndex) return searchIndex;
    searchIndex = [];
    CAT.sections.forEach(function (s) {
      sectionParts(s).forEach(function (p) {
        var pr = p.pn ? priceOf(p.pn) : null;
        searchIndex.push({
          sec: s.code, secEn: s.en || "", p: p,
          hay: [p.pn, p.zh, p.en, pr && pr.n, pr && pr.x].join(" ").toLowerCase()
        });
      });
    });
    return searchIndex;
  }
  function renderSearch(q) {
    var content = $("#content");
    content.innerHTML = "";
    var query = q.trim().toLowerCase();
    var head = el("div", "results-head");
    if (query.length < 2) {
      head.innerHTML = "<h1>Поиск</h1><div class='sub'>Введите минимум 2 символа — номер детали или название. Поиск идёт по каталогу " +
        esc(machine().name) + ". Для проверки по всем машинам используйте «🔎 Проверить список».</div>";
      content.appendChild(head);
      return;
    }
    var terms = query.split(/\s+/);
    var hits = buildIndex().filter(function (r) {
      return terms.every(function (t) { return r.hay.indexOf(t) >= 0; });
    });
    head.innerHTML = "<h1>Результаты поиска · " + esc(machine().name) + "</h1><div class='sub'>«" + esc(q) +
      "» — найдено позиций: " + hits.length + "</div>";
    content.appendChild(head);
    var bySec = {};
    hits.slice(0, 600).forEach(function (r) { (bySec[r.sec] = bySec[r.sec] || []).push(r.p); });
    Object.keys(bySec).forEach(function (code) {
      var s = sectionByCode[code];
      var block = el("div", "result-sec");
      var rsh = el("div", "rsh", esc(code) + " · " + esc(secName(s)));
      var goSec = function (pn) {
        focusPN = pn || null;
        location.hash = catHash(cur, chapterCategory(cur, s ? s.chapter : ""), "s/" + code);
      };
      rsh.addEventListener("click", function () { goSec(null); });
      block.appendChild(rsh);
      block.appendChild(renderParts(bySec[code], function (p) { goSec(p.pn); }));
      content.appendChild(block);
    });
    if (hits.length > 600) content.appendChild(el("p", "sub", "Показаны первые 600 из " + hits.length + " — уточните запрос."));
    window.scrollTo(0, 0);
  }

  // ---- комплекты в текущей категории (по названию позиции; см. isKitPart) ---
  function kitPartsInCat() {
    var codes = {}; catChapterCodes(cur, curCat).forEach(function (c) { codes[c] = 1; });
    var out = [];
    CAT.sections.forEach(function (s) {
      if (!codes[s.chapter]) return;
      sectionParts(s).forEach(function (p) {
        var pr = p.pn ? priceOf(p.pn) : null;
        if (isKitPart(p, pr)) out.push({ sec: s.code, p: p });
      });
    });
    return out;
  }
  function renderKits() {
    var content = $("#content");
    content.innerHTML = "";
    var hits = kitPartsInCat();
    var head = el("div", "results-head");
    head.innerHTML = "<h1>Комплекты · " + esc(machine().name) + " · " + esc(catLabel(curCat)) + "</h1>" +
      "<div class='sub'>Позиции этого раздела, чьё наименование содержит «KIT» / «комплект» — найдено: " +
      hits.length + ". У этих каталогов (в отличие от EPC Cummins) нет расписанного состава " +
      "комплекта, это обычная позиция с одним номером.</div>";
    content.appendChild(head);
    if (!hits.length) { window.scrollTo(0, 0); return; }
    var bySec = {};
    hits.forEach(function (h) { (bySec[h.sec] = bySec[h.sec] || []).push(h.p); });
    Object.keys(bySec).forEach(function (code) {
      var s = sectionByCode[code];
      var block = el("div", "result-sec");
      var rsh = el("div", "rsh", esc(code) + " · " + esc(secName(s)));
      var goSec = function (pn) {
        focusPN = pn || null;
        location.hash = catHash(cur, curCat, "s/" + code);
      };
      rsh.addEventListener("click", function () { goSec(null); });
      block.appendChild(rsh);
      block.appendChild(renderParts(bySec[code], function (p) { goSec(p.pn); }));
      content.appendChild(block);
    });
    window.scrollTo(0, 0);
  }

  // ---- cart UI ----------------------------------------------------------
  function renderCartCount() {
    var n = Object.keys(cart).reduce(function (a, k) { return a + (cart[k].qty > 0 ? 1 : 0); }, 0);
    $("#cartCount").textContent = n;
  }
  function renderCart() {
    var box = $("#cartLines");
    box.innerHTML = "";
    var keys = Object.keys(cart).filter(function (k) { return cart[k].qty > 0; });
    keys.sort(function (a, b) { return (cart[a].m + cart[a].pn < cart[b].m + cart[b].pn) ? -1 : 1; });
    var total = 0, priced = 0, unpriced = 0, curTotal = null;
    if (!keys.length) {
      box.appendChild(el("div", "cart-empty", "Заказ пуст.<br>Добавляйте позиции кнопкой «+» в таблице."));
    }
    keys.forEach(function (k) {
      var it = cart[k];
      var pr = priceOf(it.pn, it.m);
      var line = el("div", "cline");
      var each = pr && pr.p != null ? pr.p : null;
      var sum = each != null ? each * it.qty : null;
      if (sum != null) { total += sum; priced++; } else { unpriced++; }
      curTotal = currencyOf(it.m);
      var nm = (pr && pr.n) || it.en || it.zh || "";
      var mm = machineById[it.m] || { name: it.m };
      line.innerHTML =
        '<div class="info"><div class="pn"><span class="mchip ' + esc(it.m) + '">' + esc(mm.name) + "</span>" + esc(it.pn) + "</div>" +
        '<div class="nm">' + esc(nm) + "</div>" +
        '<div class="ctrls"><input type="number" min="1" value="' + it.qty + '" data-k="' + esc(k) + '">' +
        '<button class="rm" data-k="' + esc(k) + '">удалить</button></div></div>' +
        '<div class="sum">' + (sum != null ? fmt(sum) + " " + currencyOf(it.m) : "—") +
        (each != null ? '<div class="each">' + fmt(each) + " × " + it.qty + "</div>" : '<div class="each">нет цены</div>') +
        "</div>";
      box.appendChild(line);
    });
    box.querySelectorAll(".cline input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var q = parseInt(inp.value, 10), k = inp.dataset.k;
        if (!q || q < 1) q = 1;
        cart[k].qty = q; saveCart(); renderCart();
      });
    });
    box.querySelectorAll(".cline .rm").forEach(function (b) {
      b.addEventListener("click", function () { delete cart[b.dataset.k]; saveCart(); renderCart(); });
    });
    $("#cartTotal").textContent = fmt(total) + " " + (curTotal || "CNY");
    var note = priced + " позиц. с ценой";
    if (unpriced) note += " · " + unpriced + " без цены (уточняется)";
    var machines = {};
    keys.forEach(function (k) { machines[cart[k].m] = 1; });
    if (Object.keys(machines).length > 1) note += " · заказ по нескольким машинам — итог считается в CNY";
    $("#cartNote").textContent = note;
  }
  function openCart() { renderCart(); $("#cart").classList.add("open"); $("#overlay").classList.add("open"); }
  function closeCart() { $("#cart").classList.remove("open"); $("#overlay").classList.remove("open"); }

  // ---- exports (blob + minimal xlsx writer) ----------------------------
  function downloadBlob(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = el("a"); a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }
  var CRC = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    var c = -1;
    for (var i = 0; i < b.length; i++) c = (c >>> 8) ^ CRC[(c ^ b[i]) & 0xff];
    return (c ^ -1) >>> 0;
  }
  function zipStore(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    var u16 = function (n) { return [n & 0xff, (n >> 8) & 0xff]; };
    var u32 = function (n) { return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; };
    files.forEach(function (f) {
      var data = enc.encode(f.data), name = enc.encode(f.name), crc = crc32(data);
      var lh = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(lh), name, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0),
        u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += lh.length + name.length + data.length;
    });
    var cdStart = offset, cdLen = 0;
    central.forEach(function (p) { cdLen += p.length; });
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0),
      u16(files.length), u16(files.length), u32(cdLen), u32(cdStart), u16(0)));
    var all = parts.concat(central, [end]), total = 0;
    all.forEach(function (a) { total += a.length; });
    var out = new Uint8Array(total), o = 0;
    all.forEach(function (a) { out.set(a, o); o += a.length; });
    return out;
  }
  function xlsx(sheetName, headers, rows, types) {
    var esc2 = function (s) {
      return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    };
    var colRef = function (c) { var s = ""; c++; while (c) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; };
    var cell = function (r, c, v, t) {
      if (v == null || v === "") return "";
      var ref = colRef(c) + r;
      if (t === "n" && v !== "" && !isNaN(v)) return '<c r="' + ref + '"><v>' + v + "</v></c>";
      return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc2(v) + "</t></is></c>";
    };
    var body = '<row r="1">' + headers.map(function (h, c) { return cell(1, c, h, "s"); }).join("") + "</row>";
    rows.forEach(function (row, ri) {
      body += '<row r="' + (ri + 2) + '">' +
        row.map(function (v, c) { return cell(ri + 2, c, v, types[c] || "s"); }).join("") + "</row>";
    });
    var files = [
      { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
      { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: "xl/workbook.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + esc2(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: "xl/_rels/workbook.xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: "xl/worksheets/sheet1.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + "</sheetData></worksheet>" }
    ];
    return new Blob([zipStore(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function exportOrderCsv() {
    var keys = Object.keys(cart).filter(function (k) { return cart[k].qty > 0; });
    if (!keys.length) { toast("Заказ пуст"); return; }
    var serial = $("#serial").value.trim();
    var headers = ["Машина", "Номер детали", "Наименование", "Взаимозам. артикул", "Цена",
      "Кол-во", "Сумма", "Валюта", "Группа"];
    var types = ["s", "s", "s", "s", "n", "n", "n", "s", "s"];
    var rows = [], total = 0;
    keys.sort(function (a, b) { return (cart[a].m + cart[a].pn < cart[b].m + cart[b].pn) ? -1 : 1; });
    keys.forEach(function (k) {
      var it = cart[k], pr = priceOf(it.pn, it.m) || {};
      var each = pr.p != null ? pr.p : null;
      var sum = each != null ? each * it.qty : null;
      if (sum != null) total += sum;
      rows.push([(machineById[it.m] || {}).name || it.m, it.pn, pr.n || it.en || it.zh || "", pr.x || "",
        each != null ? each : "", it.qty, sum != null ? Math.round(sum * 100) / 100 : "",
        currencyOf(it.m), pr.g || ""]);
    });
    rows.push(["", "", "", "", "", "ИТОГО", Math.round(total * 100) / 100, "CNY", ""]);
    var name = "NHL_заказ" + (serial ? "_" + serial : "") + ".xlsx";
    downloadBlob(name, xlsx("Заказ", headers, rows, types));
  }

  function baseName(p) { var s = String(p || ""); var i = s.lastIndexOf("/"); return i >= 0 ? s.slice(i + 1) : s; }

  // Global export of every catalog part number across ALL machines, with every
  // available attribute: one row per occurrence (a number that appears in
  // several figures/sections yields several rows, keeping its distinct position,
  // quantity, level and drawing). No attribute is dropped.
  function exportAllNumbers() {
    var headers = ["Машина", "Глава (код)", "Глава", "Раздел (код)", "Раздел",
      "Рисунок", "№ позиции", "Артикул (Part No.)", "Взаимозаменяемый артикул",
      "Наименование (RU)", "Description (EN)", "Описание (ZH)",
      "Кол-во на схеме", "Уровень", "Текущая цена", "Несогласованная цена", "Валюта", "Группа", "Чертёж (файлы)"];
    var types = ["s", "s", "s", "s", "s", "s", "s", "s", "s", "s", "s", "s",
      "s", "s", "n", "n", "s", "s", "s"];
    var rows = [];
    MACHINES.forEach(function (mm) {
      var id = mm.id, prices = pricesFor(id);
      var chById = {};
      (CATALOGS[id].chapters || []).forEach(function (c) { chById[c.code] = c; });
      (CATALOGS[id].sections || []).forEach(function (s) {
        var ch = chById[s.chapter] || { code: s.chapter, en: "", zh: "" };
        var chName = ch.en && /\s/.test(ch.en) ? ch.en : (ch.zh || ch.en || "");
        var figs = s.figures || [];
        figs.forEach(function (f, fi) {
          var drawing = (f.images || []).map(baseName).join(" ");
          (f.parts || []).forEach(function (p) {
            if (!p.pn) return;
            var pr = prices[p.pn] || {};
            rows.push([mm.name, s.chapter, chName, s.code, secName(s),
              figs.length > 1 ? (fi + 1) + " / " + figs.length : "",
              pad(p.ref), p.pn, pr.x || "",
              pr.n || "", p.en || "", p.zh || "",
              p.qty || "", p.lvl != null ? p.lvl : "",
              pr.cp != null ? pr.cp : "", pr.p != null ? pr.p : "",
              currencyOf(id), pr.g || "", drawing]);
          });
        });
      });
    });
    downloadBlob("NHL_все_номера_со_всеми_атрибутами.xlsx",
      xlsx("Все номера", headers, rows, types));
    toast("Экспортировано строк: " + rows.length);
  }

  function printOrder() {
    var keys = Object.keys(cart).filter(function (k) { return cart[k].qty > 0; });
    if (!keys.length) { toast("Заказ пуст"); return; }
    var serial = $("#serial").value.trim();
    var total = 0, body = "";
    keys.sort(function (a, b) { return (cart[a].m + cart[a].pn < cart[b].m + cart[b].pn) ? -1 : 1; });
    keys.forEach(function (k, i) {
      var it = cart[k], pr = priceOf(it.pn, it.m) || {};
      var each = pr.p != null ? pr.p : null, sum = each != null ? each * it.qty : null;
      if (sum != null) total += sum;
      body += "<tr><td>" + (i + 1) + "</td><td>" + esc((machineById[it.m] || {}).name || it.m) +
        "</td><td>" + esc(it.pn) + "</td><td>" +
        esc(pr.n || it.en || it.zh || "") + "</td><td style='text-align:right'>" +
        (each != null ? fmt(each) : "—") + "</td><td style='text-align:center'>" + it.qty +
        "</td><td style='text-align:right'>" + (sum != null ? fmt(sum) : "—") + "</td></tr>";
    });
    var w = window.open("", "_blank");
    w.document.write(
      "<html><head><meta charset='utf-8'><title>Заказ NHL</title><style>" +
      "body{font:13px Arial,sans-serif;padding:24px;color:#2a3138}h1{font-size:18px}" +
      "table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #ccc;padding:6px 8px}" +
      "th{background:#f2f4f5;text-align:left}tfoot td{font-weight:bold}</style></head><body>" +
      "<h1>Заказ-спецификация · Самосвалы NHL</h1>" +
      "<div>" + (serial ? "Машина: <b>" + esc(serial) + "</b> · " : "") +
      "Дата: " + new Date().toLocaleDateString("ru-RU") + "</div>" +
      "<table><thead><tr><th>№</th><th>Машина</th><th>Номер детали</th><th>Наименование</th>" +
      "<th>Цена</th><th>Кол-во</th><th>Сумма</th></tr></thead><tbody>" +
      body + "</tbody><tfoot><tr><td colspan='6' style='text-align:right'>ИТОГО, CNY</td>" +
      "<td style='text-align:right'>" + fmt(total) + "</td></tr></tfoot></table>" +
      "<p style='margin-top:18px;color:#80868b;font-size:11px'>Цены без НДС. Позиции без цены уточняются отдельно.</p>" +
      "</body></html>");
    w.document.close(); w.focus(); w.print();
  }

  // ---- price update (per current machine) ------------------------------
  function normArt(x) {
    if (x == null) return "";
    var s = String(x).replace(/ /g, " ").trim();
    if (/\.0$/.test(s)) s = s.slice(0, -2);
    return s;
  }
  function toPrice(x) {
    if (x == null || x === "") return null;
    var s = String(x).replace(/ /g, "").replace(/\s/g, "").replace(",", ".");
    var v = parseFloat(s);
    return isNaN(v) ? null : Math.round(v * 100) / 100;
  }
  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref || ""); if (!m) return 0;
    var s = m[1], n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  function readZipEntries(buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf), i = u8.length - 22;
    for (; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) break; }
    if (i < 0) throw new Error("не похоже на .xlsx");
    var count = dv.getUint16(i + 10, true), off = dv.getUint32(i + 16, true);
    var entries = {}, p = off, dec = new TextDecoder();
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      var lNameLen = dv.getUint16(lho + 26, true), lExtraLen = dv.getUint16(lho + 28, true);
      var start = lho + 30 + lNameLen + lExtraLen;
      entries[name] = { method: method, comp: u8.subarray(start, start + compSize) };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }
  function inflateEntry(entry) {
    if (!entry) return Promise.resolve(null);
    if (entry.method === 0) return Promise.resolve(entry.comp);
    if (typeof DecompressionStream === "undefined")
      return Promise.reject(new Error("браузер не умеет читать сжатый .xlsx — сохраните прайс как .csv"));
    var ds = new DecompressionStream("deflate-raw");
    return new Response(new Blob([entry.comp]).stream().pipeThrough(ds)).arrayBuffer()
      .then(function (ab) { return new Uint8Array(ab); });
  }
  function readXlsx(buf) {
    var entries = readZipEntries(buf), dec = new TextDecoder(), cache = {};
    function textOf(name) {
      if (name in cache) return Promise.resolve(cache[name]);
      return inflateEntry(entries[name]).then(function (bytes) {
        return (cache[name] = bytes ? dec.decode(bytes) : null);
      });
    }
    function sheetPath() {
      return Promise.all([textOf("xl/workbook.xml"), textOf("xl/_rels/workbook.xml.rels")])
        .then(function (r) {
          var wb = r[0], rels = r[1];
          if (!wb || !rels) return "xl/worksheets/sheet1.xml";
          var wdoc = new DOMParser().parseFromString(wb, "application/xml");
          var sheet = wdoc.getElementsByTagName("sheet")[0];
          var rid = sheet && (sheet.getAttribute("r:id") ||
            sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"));
          var rdoc = new DOMParser().parseFromString(rels, "application/xml");
          var rs = rdoc.getElementsByTagName("Relationship");
          for (var i = 0; i < rs.length; i++) {
            if (rs[i].getAttribute("Id") === rid) {
              var t = rs[i].getAttribute("Target") || "";
              t = t.charAt(0) === "/" ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
              return t;
            }
          }
          return "xl/worksheets/sheet1.xml";
        });
    }
    return textOf("xl/sharedStrings.xml").then(function (ssXml) {
      var shared = [];
      if (ssXml) {
        var sdoc = new DOMParser().parseFromString(ssXml, "application/xml");
        var sis = sdoc.getElementsByTagName("si");
        for (var i = 0; i < sis.length; i++) {
          var ts = sis[i].getElementsByTagName("t"), str = "";
          for (var j = 0; j < ts.length; j++) str += ts[j].textContent;
          shared.push(str);
        }
      }
      return sheetPath().then(textOf).then(function (sheetXml) {
        if (!sheetXml) throw new Error("лист не найден в файле");
        var doc = new DOMParser().parseFromString(sheetXml, "application/xml");
        var rowEls = doc.getElementsByTagName("row"), rows = [];
        for (var r = 0; r < rowEls.length; r++) {
          var cells = rowEls[r].getElementsByTagName("c"), arr = [];
          for (var c = 0; c < cells.length; c++) {
            var cell = cells[c], t = cell.getAttribute("t"), v = "";
            if (t === "s") {
              var vi = cell.getElementsByTagName("v")[0];
              if (vi) v = shared[parseInt(vi.textContent, 10)] || "";
            } else if (t === "inlineStr" || t === "str") {
              var te = cell.getElementsByTagName("t")[0];
              if (!te) te = cell.getElementsByTagName("v")[0];
              v = te ? te.textContent : "";
            } else {
              var ve = cell.getElementsByTagName("v")[0];
              v = ve ? ve.textContent : "";
            }
            arr[colIndex(cell.getAttribute("r"))] = v;
          }
          rows.push(arr);
        }
        return rows;
      });
    });
  }
  function parseCsv(text) {
    text = text.replace(/^﻿/, "");
    var head = text.slice(0, (text.indexOf("\n") + 1) || text.length);
    var delim = (head.split(";").length > head.split(",").length) ? ";" : ",";
    var rows = [], row = [], cur2 = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur2 += '"'; i++; } else q = false; }
        else cur2 += ch;
      } else if (ch === '"') { q = true; }
      else if (ch === delim) { row.push(cur2); cur2 = ""; }
      else if (ch === "\r") { /* skip */ }
      else if (ch === "\n") { row.push(cur2); rows.push(row); row = []; cur2 = ""; }
      else cur2 += ch;
    }
    if (cur2 !== "" || row.length) { row.push(cur2); rows.push(row); }
    return rows;
  }
  function rowsToPrices(rows) {
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
          else if (v === "наименование") col.name = c;
          else if (v.indexOf("цена") >= 0) col.price = c;
          else if (v.indexOf("группа") >= 0) col.group = c;
        });
      }
    }
    if (hr < 0) throw new Error("не найден столбец «Артикул» — проверьте файл прайса");
    var out = {};
    for (var r = hr + 1; r < rows.length; r++) {
      var rw = rows[r] || [], art = normArt(rw[col.art]);
      if (!art) continue;
      var rec = {
        p: toPrice(rw[col.price]),
        g: rw[col.group] != null ? String(rw[col.group]).trim() : "",
        x: normArt(rw[col.xref]),
        n: rw[col.name] != null ? String(rw[col.name]).replace(/ /g, " ").trim() : ""
      };
      if (!(art in out)) out[art] = rec;
      if (rec.x && !(rec.x in out)) out[rec.x] = { p: rec.p, g: rec.g, x: rec.x, n: rec.n };
    }
    return out;
  }
  function pmStatus(msg, err) {
    var s = $("#priceStatus"); if (!s) return;
    s.textContent = msg || ""; s.classList.toggle("err", !!err);
  }
  function applyPriceRows(rows) {
    var parsed = rowsToPrices(rows), overlay = loadOverlay(cur) || {}, added = 0, priced = 0;
    Object.keys(parsed).forEach(function (pn) {
      if (!CATALOG_PNS[pn]) return;
      overlay[pn] = parsed[pn]; added++;
      if (parsed[pn].p != null) priced++;
    });
    if (!added) { pmStatus("В файле не найдено ни одного артикула из каталога " + machine().name + ".", true); return; }
    try { localStorage.setItem(priceKey(cur), JSON.stringify(overlay)); } catch (e) {}
    invalidatePrices(cur);
    route(); renderCartCount();
    if ($("#cart").classList.contains("open")) renderCart();
    pmStatus("Готово (" + machine().name + "): обновлено номеров — " + added + ", из них с ценой — " + priced + ".");
    toast("Цены обновлены: " + added);
  }
  function onPriceFile(file) {
    if (!file) return;
    $("#pmFileLabel").textContent = file.name;
    pmStatus("Читаю файл…");
    var reader = /\.csv$/i.test(file.name)
      ? file.text().then(parseCsv)
      : file.arrayBuffer().then(readXlsx);
    reader.then(applyPriceRows).catch(function (e) {
      pmStatus("Не удалось прочитать файл: " + (e && e.message ? e.message : e) +
        ". Попробуйте сохранить прайс в формате .csv.", true);
    });
  }
  function downloadPricesJs() {
    downloadBlob("prices.js",
      new Blob(["window.PRICES = " + JSON.stringify(pricesFor(cur)) + ";\n"],
        { type: "application/javascript" }));
    toast("Файл prices.js скачан (" + machine().name + ")");
  }
  function resetPrices() {
    if (!confirm("Сбросить цены " + machine().name + " к заводским?")) return;
    try { localStorage.removeItem(priceKey(cur)); } catch (e) {}
    invalidatePrices(cur);
    route(); renderCartCount();
    if ($("#cart").classList.contains("open")) renderCart();
    pmStatus("Цены " + machine().name + " сброшены к заводским."); toast("Цены сброшены");
  }
  function openPriceModal() {
    pmStatus(""); updateMachineUI();
    $("#priceModal").classList.add("open"); $("#pmOverlay").classList.add("open");
  }
  function closePriceModal() {
    $("#priceModal").classList.remove("open"); $("#pmOverlay").classList.remove("open");
  }

  // ---- check a list of numbers across ALL machines ---------------------
  function normNo(s) { return String(s == null ? "" : s).toUpperCase().replace(/[\s\-]/g, ""); }
  function stripZeros(s) { return s.replace(/^0+/, ""); }

  // замены номеров двигателя Cummins (см. build/gen_engine_sup.js) — используются,
  // когда запрошенный номер не найден в собственном прайсе/каталоге машины, но
  // является старым/заменённым номером в каталоге двигателя (EPC Cummins)
  var ENGINE_SUP = window.ENGINE_SUP || {};
  // поставляется ли номер двигателя отдельно и в какие ремкомплекты он входит
  // (см. build/gen_engine_parts.js; данные — из каталога EPC Cummins)
  var ENGINE_PART_INFO = window.ENGINE_PART_INFO || {};
  // всё, что о номере знает база знаний: документы QuickServe и русское
  // наименование (см. build/gen_part_docs.js), плюс инструкции по ремонту
  // разделов каталога — чтобы по найденной позиции была вся информация
  var PART_DOCS = window.PART_DOCS || {};
  // весь состав трёх двигателей: номер -> узлы (см. build/gen_engine_parts.js).
  // Нужен, чтобы «Проверить список» находил номера, которых нет в каталоге
  // машины, но которые есть в каталоге двигателя Cummins.
  var ENGINE_PARTS = window.ENGINE_PARTS || {};
  var SERVICE_PAGES = window.SERVICE_PAGES || {};
  var CUMMINS_PRICES = window.CUMMINS_PRICES || {};
  var CUMMINS_PRICES_CUR = window.CUMMINS_PRICES_CUR || {};
  /* сведения о комплектности по номеру: {sold:true|false|null, kits:[{no,name}]} */
  function partInfo(no) {
    var k = normNo(no);
    var rec = ENGINE_PART_INFO[k];
    if (!rec) {
      var z = stripZeros(k);
      if (z !== k) rec = ENGINE_PART_INFO[z];
    }
    if (!rec) return { sold: null, kits: [] };
    return { sold: rec.s === 0 ? false : true, kits: rec.k || [] };
  }
  /* документы базы знаний по номеру */
  function docsFor(no) {
    var k = normNo(no), rec = PART_DOCS[k];
    if (!rec) { var z = stripZeros(k); if (z !== k) rec = PART_DOCS[z]; }
    return rec || {};
  }
  /* инструкции по ремонту разделов, в которых стоит деталь */
  function serviceFor(machine, secs) {
    var pages = SERVICE_PAGES[machine] || {}, out = [];
    (secs || []).forEach(function (code) {
      var p = pages[code];
      if (p) out.push({ code: code, t: p.t, u: p.u });
    });
    return out;
  }
  function docsText(docs) {
    return (docs || []).map(function (d) { return d[0] + " · " + d[1]; }).join("; ");
  }
  function serviceText(machine, svc) {
    var name = (machineById[machine] || {}).name || machine;
    return (svc || []).map(function (s) { return name + " " + s.code + " · " + s.t; }).join("; ");
  }
  function kitsText(kits) {
    return (kits || []).map(function (k) {
      return k.no + (k.name ? " · " + k.name : "");
    }).join("; ");
  }
  /* номер в составе двигателя (прямое совпадение, не замена) */
  function lookupEngineCat(raw) {
    var k = normNo(raw), rec = ENGINE_PARTS[k];
    if (!rec) { var z = stripZeros(k); if (z !== k) rec = ENGINE_PARTS[z]; }
    return rec || null;
  }
  function lookupEngineSup(raw) {
    var k = normNo(raw);
    if (!k) return null;
    if (ENGINE_SUP[k]) return ENGINE_SUP[k];
    var z = stripZeros(k);
    if (z !== k && ENGINE_SUP[z]) return ENGINE_SUP[z];
    return null;
  }

  var checkIndex = null;   // { meta, byNo, byXref } across all machines
  function buildCheckIndex() {
    if (checkIndex) return checkIndex;
    var meta = {};   // "machine|pn" -> { machine, pn, zh, en, secs:{} }
    MACHINES.forEach(function (mm) {
      var id = mm.id;
      (CATALOGS[id].sections || []).forEach(function (s) {
        (s.figures || []).forEach(function (f) {
          (f.parts || []).forEach(function (p) {
            if (!p.pn) return;
            var mk = id + "|" + p.pn;
            var m = meta[mk] || (meta[mk] = { machine: id, pn: p.pn, zh: p.zh || "", en: p.en || "", secs: {} });
            m.secs[s.code] = 1;
            if (!m.zh && p.zh) m.zh = p.zh;
            if (!m.en && p.en) m.en = p.en;
          });
        });
      });
    });
    var byNo = {}, byXref = {};
    function push(map, key, mk) { if (!key) return; (map[key] = map[key] || []).push(mk); }
    Object.keys(meta).forEach(function (mk) {
      var m = meta[mk], k = normNo(m.pn), z = stripZeros(k);
      push(byNo, k, mk); if (z !== k) push(byNo, z, mk);
      var pr = pricesFor(m.machine)[m.pn];
      if (pr && pr.x) {
        var xk = normNo(pr.x), xz = stripZeros(xk);
        push(byXref, xk, mk); if (xz !== xk) push(byXref, xz, mk);
      }
    });
    return (checkIndex = { meta: meta, byNo: byNo, byXref: byXref });
  }
  function lookupNo(raw) {
    var idx = buildCheckIndex(), k = normNo(raw);
    if (!k) return null;
    if (idx.byNo[k]) return { mks: idx.byNo[k], via: "no" };
    if (idx.byXref[k]) return { mks: idx.byXref[k], via: "xref" };
    var z = stripZeros(k);
    if (idx.byNo[z]) return { mks: idx.byNo[z], via: "no" };
    if (idx.byXref[z]) return { mks: idx.byXref[z], via: "xref" };
    return null;
  }

  var checkResults = [];     // last run rows (for export)
  var checkMatchedMk = {};   // catalog entries touched by the last list (for "missing in list")
  var checkRan = false;
  function parseNumbers(text) {
    return String(text || "").split(/[\s,;]+/).map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length > 0; });
  }
  function runCheck(nums) {
    var idx = buildCheckIndex();
    var seen = {}, out = [];
    checkMatchedMk = {};
    nums.forEach(function (raw) {
      var key = normNo(raw);
      if (!key || seen[key]) return;
      seen[key] = 1;
      var hit = lookupNo(raw);
      if (hit) {
        hit.mks.forEach(function (mk) {
          checkMatchedMk[mk] = 1;
          var m = idx.meta[mk], pr = pricesFor(m.machine)[m.pn] || {};
          var inf = partInfo(m.pn), kb = docsFor(m.pn);
          out.push({
            query: raw, found: true, via: hit.via, machine: m.machine, pn: m.pn,
            ru: pr.n || "", en: m.en || "", zh: m.zh || "",
            curPrice: pr.cp != null ? pr.cp : null, price: pr.p != null ? pr.p : null,
            group: pr.g || "", xref: pr.x || "",
            sold: inf.sold, kits: inf.kits,
            docs: kb.d || [], kbRu: kb.ru || "",
            svc: serviceFor(m.machine, Object.keys(m.secs).sort()),
            secs: Object.keys(m.secs).sort()
          });
        });
      } else if (lookupEngineCat(raw)) {
        var ec = lookupEngineCat(raw);
        var pn = raw.trim(), einf2 = partInfo(pn), ekb2 = docsFor(pn);
        var cpn2 = normNo(pn);
        ec.m.forEach(function (h) {
          out.push({
            query: raw, found: true, via: "engine", machine: h.m, pn: pn,
            ru: "", en: ec.n || "", zh: "",
            curPrice: CUMMINS_PRICES_CUR[cpn2] != null ? CUMMINS_PRICES_CUR[cpn2] : null,
            price: CUMMINS_PRICES[cpn2] != null ? CUMMINS_PRICES[cpn2] : null,
            group: "Двигатель Cummins (EPC)", xref: "",
            sold: einf2.sold, kits: einf2.kits,
            docs: ekb2.d || [], kbRu: ekb2.ru || "", svc: [],
            secs: [], engineEsn: h.e, engineOpts: h.o || []
          });
        });
      } else {
        var esHits = lookupEngineSup(raw);
        if (esHits && esHits.length) {
          esHits.forEach(function (h) {
            var cpn = normNo(h.cur);
            var einf = partInfo(h.cur), ekb = docsFor(h.cur);
            out.push({
              query: raw, found: true, via: "engine", machine: h.machine, pn: h.cur,
              ru: h.name || "", en: "", zh: "",
              curPrice: CUMMINS_PRICES_CUR[cpn] != null ? CUMMINS_PRICES_CUR[cpn] : null,
              price: CUMMINS_PRICES[cpn] != null ? CUMMINS_PRICES[cpn] : null,
              group: "Двигатель Cummins (EPC)", xref: raw,
              sold: einf.sold, kits: einf.kits,
              docs: ekb.d || [], kbRu: ekb.ru || "", svc: [],
              secs: [], engineEsn: h.esn
            });
          });
        } else {
          out.push({ query: raw, found: false, via: null, machine: "", pn: "", ru: "", en: "", zh: "",
            curPrice: null, price: null, group: "", xref: "",
            sold: null, kits: [], docs: [], kbRu: "", svc: [], secs: [] });
        }
      }
    });
    checkResults = out;
    checkRan = true;
    renderCheckResults();
  }
  function renderCheckResults() {
    var box = $("#chkResults"), st = $("#chkStatus");
    box.innerHTML = "";
    if (!checkResults.length) {
      st.textContent = ""; $("#chkExport").disabled = true;
      $("#chkMissing").disabled = !checkRan; return;
    }
    var queries = {}; checkResults.forEach(function (r) { queries[normNo(r.query)] = 1; });
    var qCount = Object.keys(queries).length;
    var foundQ = {}, miss = 0, viaX = 0;
    checkResults.forEach(function (r) {
      if (r.found) { foundQ[normNo(r.query)] = 1; if (r.via === "xref") viaX++; }
    });
    checkResults.forEach(function (r) { if (!r.found) miss++; });
    st.innerHTML = "Запросов: <b>" + qCount + "</b> · найдено (уникальных): <b>" + Object.keys(foundQ).length +
      "</b> · не найдено: <b>" + (qCount - Object.keys(foundQ).length) + "</b> · всего совпадений по машинам: <b>" +
      checkResults.filter(function (r) { return r.found; }).length + "</b>" +
      (viaX ? " · по взаимозам. артикулу: <b>" + viaX + "</b>" : "");
    $("#chkExport").disabled = false;
    $("#chkMissing").disabled = false;

    var table = el("table", "chk-table");
    table.innerHTML = "<thead><tr>" +
      "<th>Запрос</th><th>Машина</th><th>Номер детали</th><th>Наименование</th>" +
      '<th class="price">Текущая</th><th class="price">Несогласованная</th><th>Группа</th><th>Взаимозам.</th>' +
      '<th title="Деталь не поставляется отдельно — только в составе узла или комплекта">' +
      "Не поставляется отдельно</th><th>Входит в комплект</th>" +
      '<th title="Документы QuickServe и инструкции по ремонту, где встречается номер">' +
      "База знаний</th><th>Разделы</th></tr></thead>";
    var tb = el("tbody");
    checkResults.forEach(function (r) {
      var tr = el("tr", r.found ? "" : "chk-miss");
      if (!r.found) {
        tr.innerHTML = '<td class="chk-q">' + esc(r.query) + "</td>" +
          '<td colspan="11" class="chk-none">не найдено ни в одном каталоге</td>';
        tb.appendChild(tr); return;
      }
      var mm = machineById[r.machine] || { name: r.machine };
      var nameHtml = "";
      if (r.ru) nameHtml += '<div class="ru">' + esc(r.ru) + "</div>";
      else if (r.kbRu) nameHtml += '<div class="ru">' + esc(r.kbRu) + "</div>";
      if (r.zh) nameHtml += '<div class="zh">' + esc(r.zh) + "</div>";
      if (r.en) nameHtml += '<div class="en">' + esc(r.en) + "</div>";
      if (!nameHtml) nameHtml = "—";
      // «вместо …» показываем только когда номер в каталоге другой
      var via = ((r.via === "xref" || r.via === "engine") && normNo(r.pn) !== normNo(r.query))
        ? '<div class="chk-via">вместо ' + esc(r.query) + "</div>" : "";
      var openBtn;
      if (r.via === "engine") {
        openBtn = '<button class="chk-open" data-m="' + esc(r.machine) + '" data-engine="1" data-pn="' + esc(r.pn) +
          '" title="Открыть в каталоге двигателя Cummins">' + esc(r.pn) + "</button>";
      } else {
        openBtn = '<button class="chk-open" data-m="' + esc(r.machine) + '" data-sec="' + esc(r.secs[0] || "") +
          '" data-pn="' + esc(r.pn) + '" title="Открыть в каталоге">' + esc(r.pn) + "</button>";
      }
      var secChips = r.via === "engine"
        ? '<span class="chk-eng-note">двигатель (EPC Cummins)</span>' +
          (r.engineOpts || []).slice(0, 4).map(function (o) {
            return '<span class="chk-eng-opt">' + esc(o) + "</span>";
          }).join("") +
          ((r.engineOpts || []).length > 4
            ? '<span class="muted">и ещё ' + (r.engineOpts.length - 4) + "</span>" : "")
        : r.secs.map(function (code) {
            var s = (CATALOGS[r.machine] && CATALOGS[r.machine].sections || []).filter(function (x) { return x.code === code; })[0];
            return '<button class="chk-sec" data-m="' + esc(r.machine) + '" data-sec="' + esc(code) + '" data-pn="' + esc(r.pn) +
              '" title="Открыть раздел ' + esc(code) + ' в каталоге ' + esc(mm.name) + '">' + esc(code) +
              " · " + esc(secName(s)) + "</button>";
          }).join("");
      var soldCell = r.sold === false
        ? '<span class="chk-nosep">не поставляется отдельно</span>'
        : (r.sold === true ? '<span class="muted">поставляется</span>' : '<span class="muted">—</span>');
      var kitCell = (r.kits && r.kits.length)
        ? r.kits.map(function (k) {
            return '<div class="chk-kit"><b>' + esc(k.no) + "</b>" +
                   (k.name ? " · " + esc(k.name) : "") + "</div>";
          }).join("")
        : '<span class="muted">—</span>';
      var kbBits = [];
      if (r.docs && r.docs.length) {
        kbBits.push('<a class="chk-kb" target="_blank" rel="noopener" href="cummins/index.html#/part/' +
          esc(r.pn) + '" title="Открыть карточку детали в базе знаний">📄 документов: ' +
          r.docs.length + "</a>");
        r.docs.slice(0, 3).forEach(function (d) {
          kbBits.push('<a class="chk-doc" target="_blank" rel="noopener" href="cummins/index.html#/doc/' +
            esc(d[0]) + '">' + esc(d[1]) + "</a>");
        });
        if (r.docs.length > 3) kbBits.push('<span class="muted">и ещё ' + (r.docs.length - 3) + "</span>");
      }
      (r.svc || []).forEach(function (sv) {
        kbBits.push('<a class="chk-doc" target="_blank" rel="noopener" href="' + esc(sv.u) +
          '" title="Инструкция по ремонту раздела ' + esc(sv.code) + '">🔧 ' + esc(sv.code) +
          " · " + esc(sv.t) + "</a>");
      });
      if (!kbBits.length) kbBits.push('<span class="muted">—</span>');
      tr.innerHTML =
        '<td class="chk-q">' + esc(r.query) + "</td>" +
        '<td class="chk-machinecell"><span class="mchip ' + esc(r.machine) + '">' + esc(mm.name) + "</span></td>" +
        '<td class="chk-pn">' + openBtn + via + "</td>" +
        '<td class="chk-name">' + nameHtml + "</td>" +
        '<td class="price">' + (r.curPrice != null ? fmt(r.curPrice) : '<span class="muted">—</span>') + "</td>" +
        '<td class="price">' + (r.price != null ? fmt(r.price) : '<span class="muted">—</span>') + "</td>" +
        "<td>" + esc(r.group || "") + "</td>" +
        "<td>" + esc(r.xref || "") + "</td>" +
        '<td class="chk-sep">' + soldCell + "</td>" +
        '<td class="chk-kits">' + kitCell + "</td>" +
        '<td class="chk-kb">' + kbBits.join("") + "</td>" +
        '<td class="chk-secs">' + secChips + "</td>";
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    box.appendChild(table);
    box.querySelectorAll(".chk-sec, .chk-open").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var mid = btn.getAttribute("data-m"), pn = btn.getAttribute("data-pn");
        if (!mid) return;
        if (btn.getAttribute("data-engine")) {
          engineFocusPn = pn; closeCheck();
          location.hash = catHash(mid, "engine");
          return;
        }
        var sec = btn.getAttribute("data-sec");
        if (!sec) return;
        focusPN = pn; closeCheck();
        var secObj = (CATALOGS[mid].sections || []).filter(function (x) { return x.code === sec; })[0];
        var cat = chapterCategory(mid, secObj ? secObj.chapter : "");
        location.hash = catHash(mid, cat, "s/" + sec);
      });
    });
  }
  /* как номер нашёлся: в каталоге машины, по взаимозаменяемому или в EPC */
  function checkStatus(r) {
    if (!r.found) return "не найдено";
    if (r.via === "xref") return "найдено (взаимозам.)";
    if (r.via === "engine") {
      return normNo(r.pn) === normNo(r.query)
        ? "найдено (каталог двигателя)" : "найдено (взаимозам., двигатель)";
    }
    return "найдено";
  }
  function exportCheck() {
    if (!checkResults.length) { toast("Список пуст"); return; }
    var headers = ["Запрошенный номер", "Статус", "Машина", "Номер в каталоге", "Наименование (RU)",
      "Description (EN)", "Описание (ZH)", "Текущая цена", "Несогласованная цена", "Валюта", "Группа",
      "Взаимозаменяемый артикул", "Не поставляется отдельно", "Входит в комплект",
      "Документы базы знаний", "Инструкции по ремонту", "Разделы"];
    var types = ["s", "s", "s", "s", "s", "s", "s", "n", "n", "s", "s", "s", "s", "s", "s", "s", "s"];
    var rows = checkResults.map(function (r) {
      var status = checkStatus(r);
      return [r.query, status, (machineById[r.machine] || {}).name || "", r.pn, r.ru || r.kbRu, r.en, r.zh,
        r.curPrice != null ? r.curPrice : "", r.price != null ? r.price : "",
        r.machine ? currencyOf(r.machine) : "", r.group, r.xref,
        r.sold === false ? "да" : (r.sold === true ? "нет" : ""), kitsText(r.kits),
        docsText(r.docs), serviceText(r.machine, r.svc),
        // у позиций двигателя вместо разделов машины — узлы EPC
        (r.secs.length ? r.secs : (r.engineOpts || [])).join(" ")];
    });
    downloadBlob("NHL_проверка_номеров.xlsx", xlsx("Проверка", headers, rows, types));
    toast("Выгружено строк: " + rows.length);
  }
  // catalog numbers absent from the checked list
  function exportMissing() {
    if (!checkRan) { toast("Сначала выполните проверку"); return; }
    var idx = buildCheckIndex();
    var headers = ["Машина", "Артикул (Part No.)", "Наименование (RU)", "Description (EN)",
      "Описание (ZH)", "Текущая цена", "Несогласованная цена", "Валюта", "Группа",
      "Взаимозаменяемый артикул", "Не поставляется отдельно", "Входит в комплект",
      "Документы базы знаний", "Инструкции по ремонту", "Разделы"];
    var types = ["s", "s", "s", "s", "s", "n", "n", "s", "s", "s", "s", "s", "s", "s", "s"];
    var rows = [];
    Object.keys(idx.meta).forEach(function (mk) {
      if (checkMatchedMk[mk]) return;           // present in the list — skip
      var m = idx.meta[mk], pr = pricesFor(m.machine)[m.pn] || {}, inf = partInfo(m.pn);
      var secs = Object.keys(m.secs).sort(), kb = docsFor(m.pn);
      rows.push([(machineById[m.machine] || {}).name || m.machine, m.pn, pr.n || kb.ru || "", m.en, m.zh,
        pr.cp != null ? pr.cp : "", pr.p != null ? pr.p : "", currencyOf(m.machine), pr.g || "", pr.x || "",
        inf.sold === false ? "да" : (inf.sold === true ? "нет" : ""), kitsText(inf.kits),
        docsText(kb.d), serviceText(m.machine, serviceFor(m.machine, secs)),
        secs.join(" ")]);
    });
    rows.sort(function (a, b) { return (a[0] + a[1] < b[0] + b[1]) ? -1 : 1; });
    downloadBlob("NHL_отсутствуют_в_списке.xlsx", xlsx("Отсутствуют в списке", headers, rows, types));
    toast("Отсутствуют в списке: " + rows.length);
  }
  function onCheckFile(file) {
    if (!file) return;
    chkStatusMsg("Читаю файл…");
    var done = function (nums) {
      var cur2 = $("#chkInput").value.trim();
      $("#chkInput").value = (cur2 ? cur2 + "\n" : "") + nums.join("\n");
      runCheck(parseNumbers($("#chkInput").value));
    };
    if (/\.xlsx$/i.test(file.name)) {
      file.arrayBuffer().then(readXlsx).then(function (rows) {
        var nums = [];
        rows.forEach(function (row) {
          if (!row) return;
          for (var c = 0; c < row.length; c++) {
            var v = (row[c] == null ? "" : String(row[c])).trim();
            if (v) { nums.push(v); break; }
          }
        });
        if (nums.length && !/\d/.test(nums[0]) && /артикул|номер|наимен|деталь|part|no\.?/i.test(nums[0])) nums.shift();
        done(nums);
      }).catch(function (e) {
        chkStatusMsg("Не удалось прочитать .xlsx: " + (e && e.message ? e.message : e) +
          ". Сохраните список как .csv или .txt.", true);
      });
    } else {
      file.text().then(function (text) {
        var nums = [];
        text.split(/\r?\n/).forEach(function (line) {
          var cell = line.split(/[,;\t]/)[0].trim();
          if (cell) nums.push(cell);
        });
        if (nums.length && !/\d/.test(nums[0]) && /артикул|номер|наимен|деталь|part|no\.?/i.test(nums[0])) nums.shift();
        done(nums);
      }).catch(function (e) {
        chkStatusMsg("Не удалось прочитать файл: " + (e && e.message ? e.message : e), true);
      });
    }
  }
  function chkStatusMsg(msg, err) {
    var s = $("#chkStatus"); if (!s) return;
    s.innerHTML = msg || ""; s.classList.toggle("err", !!err);
  }
  function openCheck() {
    var total = 0;
    MACHINES.forEach(function (mm) { total += Object.keys(pricesFor(mm.id)).length; });
    $("#chkScope").textContent = "Проверка идёт по каталогам: " +
      MACHINES.map(function (m) { return m.name; }).join(", ") + ".";
    $("#checkModal").classList.add("open"); $("#chkOverlay").classList.add("open");
    setTimeout(function () { var t = $("#chkInput"); if (t) t.focus(); }, 30);
  }
  function closeCheck() {
    $("#checkModal").classList.remove("open"); $("#chkOverlay").classList.remove("open");
  }

  // ---- lightbox + toast -------------------------------------------------
  function openLightbox(src) { $("#lbImg").src = src; $("#lightbox").classList.add("open"); }
  function closeLightbox() { $("#lightbox").classList.remove("open"); }
  var toastT;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  // ---- routing ----------------------------------------------------------
  // ensure cur machine, curCat and the sidebar reflect the requested context
  function applyContext(id, cat) {
    document.body.classList.remove("on-landing");
    if (id !== cur) setMachine(id);
    if (!catAvailable(cur, cat)) cat = "machine";
    curCat = cat;
    updateMachineUI();
    renderSidebar();
  }
  function route() {
    var h = location.hash || "";
    if (h === "" || h === "#" || h === "#/") { renderLanding(); return; }
    var m = /^#\/m\/([^\/]+)\/([^\/]+)(?:\/(s|q|k)(?:\/([\s\S]*))?)?$/.exec(h);
    if (!m) { renderLanding(); return; }
    var id = decodeURIComponent(m[1]);
    if (!machineById[id]) id = cur;
    var cat = decodeURIComponent(m[2]);
    if (!catAvailable(id, cat)) cat = "machine";
    applyContext(id, cat);
    var kind = m[3], rest = m[4] != null ? decodeURIComponent(m[4]) : null;
    if (kind === "s") {
      highlightSidebar(rest); renderSection(rest); $("#search").value = "";
    } else if (kind === "q") {
      highlightSidebar(null); $("#search").value = rest; renderSearch(rest);
    } else if (kind === "k") {
      highlightSidebar(null); $("#search").value = ""; renderKits();
    } else {
      // category home
      if (isEngineSite(cur, curCat)) { highlightSidebar(null); renderEngine(); $("#search").value = ""; }
      else {
        var first = firstSectionOfCat(cur, curCat);
        if (first) { location.hash = catHash(cur, curCat, "s/" + first); return; }
        $("#content").innerHTML = "<p style='padding:24px'>В этом разделе нет позиций.</p>";
      }
    }
    if (window.innerWidth <= 900) $("#sidebar").classList.remove("open");
  }

  // ---- wire up ----------------------------------------------------------
  function init() {
    if (!MACHINES.length) {
      $("#content").innerHTML = "<p style='padding:24px'>Данные каталога не загрузились.</p>";
      return;
    }
    buildDerived();
    renderMachineSwitch();
    updateMachineUI();
    renderSidebar();
    renderCartCount();

    var searchT;
    $("#search").addEventListener("input", function () {
      var v = this.value;
      clearTimeout(searchT);
      searchT = setTimeout(function () {
        if (v.trim().length >= 2) location.hash = catHash(cur, curCat, "q/" + encodeURIComponent(v));
        else if (!v.trim() && location.hash.indexOf("/q/") >= 0) history.back();
      }, 220);
    });

    $("#cartBtn").addEventListener("click", openCart);
    $("#cartClose").addEventListener("click", closeCart);
    $("#overlay").addEventListener("click", closeCart);
    $("#clearCart").addEventListener("click", function () {
      if (confirm("Очистить заказ?")) { cart = {}; saveCart(); renderCart(); }
    });
    $("#exportCsv").addEventListener("click", exportOrderCsv);
    $("#printOrder").addEventListener("click", printOrder);
    $("#exportAll").addEventListener("click", exportAllNumbers);

    $("#pricesBtn").addEventListener("click", openPriceModal);
    $("#pmClose").addEventListener("click", closePriceModal);
    $("#pmOverlay").addEventListener("click", closePriceModal);
    $("#priceFile").addEventListener("change", function () { onPriceFile(this.files[0]); });
    $("#priceDownload").addEventListener("click", downloadPricesJs);
    $("#priceReset").addEventListener("click", resetPrices);

    $("#checkBtn").addEventListener("click", openCheck);
    $("#chkClose").addEventListener("click", closeCheck);
    $("#chkOverlay").addEventListener("click", closeCheck);
    $("#chkRun").addEventListener("click", function () { runCheck(parseNumbers($("#chkInput").value)); });
    $("#chkFile").addEventListener("change", function () { onCheckFile(this.files[0]); this.value = ""; });
    $("#chkExport").addEventListener("click", exportCheck);
    $("#chkMissing").addEventListener("click", exportMissing);
    $("#chkClear").addEventListener("click", function () {
      $("#chkInput").value = ""; checkResults = []; checkRan = false; checkMatchedMk = {};
      renderCheckResults(); $("#chkStatus").textContent = "";
    });

    var serial = $("#serial");
    serial.value = localStorage.getItem(SERIAL_KEY) || "";
    serial.addEventListener("input", function () {
      try { localStorage.setItem(SERIAL_KEY, serial.value); } catch (e) {}
    });

    $("#lbClose").addEventListener("click", closeLightbox);
    $("#lightbox").addEventListener("click", function (e) { if (e.target.id === "lightbox") closeLightbox(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeLightbox(); closeCart(); closePriceModal(); closeCheck(); }
    });
    $("#menuBtn").addEventListener("click", function () { $("#sidebar").classList.toggle("open"); });
    $("#homeBtn").addEventListener("click", function () { location.hash = "#/"; });
    var logoutBtn = $("#logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", function () {
      fetch("/api/logout", { method: "POST" }).catch(function () {})
        .then(function () { location.href = "/login.html"; });
    });

    window.addEventListener("hashchange", route);
    route();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
