/* TR100A interactive parts catalog — vanilla JS, no build, opens from file://. */
(function () {
  "use strict";
  var CAT = window.CATALOG || { chapters: [], sections: [], stats: {} };
  // Merge the Cummins QST30 engine parts catalog in as one extra chapter, so the
  // sidebar, section view, search and cart all treat it like any other chapter.
  if (window.ENGINE) {
    (window.ENGINE.chapters || []).forEach(function (c) { CAT.chapters.push(c); });
    (window.ENGINE.sections || []).forEach(function (s) { CAT.sections.push(s); });
  }
  var PRICES = window.PRICES || {};
  var SERVICE = (window.SERVICE && window.SERVICE.sections) || {};
  var CURRENCY = "CNY";
  function hasService(code) { return !!SERVICE[code]; }

  // ---- helpers ----------------------------------------------------------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function pad(ref) {
    var m = /^(\d+)([A-Za-z]*)$/.exec(ref || "");
    if (!m) return ref || "";
    return ("000" + m[1]).slice(-3) + m[2];
  }
  function money(n) {
    return (Math.round(n * 100) / 100).toLocaleString("ru-RU",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function price(pn) {
    var r = PRICES[pn];
    return r && typeof r.p === "number" ? r.p : null;
  }
  function esc(s) { return (s || "").replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var sectionByCode = {};
  CAT.sections.forEach(function (s) { sectionByCode[s.code] = s; });
  var chapterMeta = {};
  CAT.chapters.forEach(function (c) { chapterMeta[c.code] = c; });
  function sectionsOfChapter(code) {
    return CAT.sections.filter(function (s) { return s.chapter === code; });
  }
  function flatParts(sec) {
    var out = [];
    (sec.figures || []).forEach(function (f) {
      (f.parts || []).forEach(function (p) { out.push(p); });
    });
    return out;
  }
  // Display name: prefer Russian price-list name, else English, else Chinese.
  function displayName(p) {
    var r = PRICES[p.pn];
    if (r && r.n) return r.n;
    if (p.en) return p.en;
    return p.zh || "—";
  }

  // ---- cart (localStorage) ---------------------------------------------
  var CART_KEY = "tr100a_cart_v1";
  var cart = load();
  function load() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || { items: {}, serial: "" }; }
    catch (e) { return { items: {}, serial: "" }; }
  }
  function save() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} }

  function addToCart(p, sec, qty) {
    qty = Math.max(1, parseInt(qty, 10) || 1);
    var it = cart.items[p.pn];
    if (it) { it.qty += qty; }
    else {
      cart.items[p.pn] = { pn: p.pn, name: displayName(p), en: p.en || "",
        sec: sec.code, secEn: sec.en || "", qty: qty };
    }
    save(); renderCartCount(); renderCart();
  }
  function cartCount() {
    return Object.keys(cart.items).length;
  }
  function renderCartCount() { document.getElementById("cartCount").textContent = cartCount(); }

  function renderCart() {
    var box = document.getElementById("cartLines");
    box.innerHTML = "";
    var keys = Object.keys(cart.items);
    if (!keys.length) {
      box.appendChild(el("div", "cart-empty", "Корзина пуста. Добавляйте позиции кнопкой ＋."));
      document.getElementById("cartTotal").textContent = "0.00";
      document.getElementById("cartNote").textContent = "";
      return;
    }
    var total = 0, priced = 0, unpriced = 0;
    keys.forEach(function (pn) {
      var it = cart.items[pn];
      var line = el("div", "cline");
      var main = el("div", "cline-main");
      main.appendChild(el("div", "cline-pn", it.pn));
      main.appendChild(el("div", "cline-name", it.name));
      main.appendChild(el("div", "cline-sec", it.sec + (it.secEn ? " · " + it.secEn : "")));
      line.appendChild(main);

      var right = el("div", "cline-right");
      var qi = el("input", "cline-qty");
      qi.type = "number"; qi.min = "1"; qi.value = it.qty;
      qi.addEventListener("change", function () {
        it.qty = Math.max(1, parseInt(qi.value, 10) || 1);
        save(); renderCart();
      });
      right.appendChild(qi);
      var pr = price(pn);
      if (pr != null) { total += pr * it.qty; priced++;
        right.appendChild(el("div", "cline-sum", money(pr) + " × " + it.qty + " = " + money(pr * it.qty)));
      } else { unpriced++;
        right.appendChild(el("div", "cline-sum", "цена по запросу"));
      }
      var del = el("button", "cline-del", "✕");
      del.title = "Удалить";
      del.addEventListener("click", function () { delete cart.items[pn]; save(); renderCart(); renderCartCount(); });
      right.appendChild(del);
      line.appendChild(right);
      box.appendChild(line);
    });
    document.getElementById("cartTotal").textContent = money(total);
    var note = "Позиций: " + keys.length;
    if (unpriced) note += " · без цены в прайс-листе: " + unpriced + " (уточняется)";
    document.getElementById("cartNote").textContent = note;
  }

  // ---- navigation / rendering ------------------------------------------
  function buildSidebar() {
    var nav = document.getElementById("chapterNav");
    nav.innerHTML = "";
    CAT.chapters.forEach(function (c) {
      var wrap = el("div", "chap"); wrap.dataset.code = c.code;
      var btn = el("button", "chap-btn");
      btn.appendChild(el("span", "chap-code", c.code));
      var t = el("span"); t.appendChild(document.createTextNode(c.en || c.code));
      var zh = el("span", "chap-en", c.zh || ""); t.appendChild(document.createElement("br")); t.appendChild(zh);
      btn.appendChild(t);
      btn.addEventListener("click", function () { wrap.classList.toggle("open"); });
      wrap.appendChild(btn);
      var secBox = el("div", "chap-secs");
      sectionsOfChapter(c.code).forEach(function (s) {
        var sb = el("button", "sec-btn"); sb.dataset.code = s.code;
        sb.appendChild(el("span", "sec-code", s.code));
        sb.appendChild(el("span", "sec-name", s.en || s.zh || s.code));
        if (hasService(s.code)) {
          var mk = el("span", "sec-svc"); mk.textContent = "🛠"; mk.title = "Есть инструкции по обслуживанию";
          sb.appendChild(mk);
        }
        sb.addEventListener("click", function () { location.hash = "#" + s.code; closeSidebarMobile(); });
        secBox.appendChild(sb);
      });
      wrap.appendChild(secBox);
      nav.appendChild(wrap);
    });
  }

  function buildHome() {
    var st = document.getElementById("statRow");
    st.innerHTML = "";
    var nParts = 0;
    CAT.sections.forEach(function (s) { nParts += flatParts(s).length; });
    [["Разделов", CAT.sections.length], ["Позиций", nParts],
     ["Глав", CAT.chapters.length], ["Чертежей", drawCount()]].forEach(function (p) {
      var s = el("div", "stat");
      s.appendChild(el("b", null, String(p[1])));
      s.appendChild(el("span", null, p[0]));
      st.appendChild(s);
    });
    var hc = document.getElementById("homeChapters");
    hc.innerHTML = "";
    CAT.chapters.forEach(function (c) {
      var card = el("div", "hc");
      card.appendChild(el("div", "hc-code", c.code));
      card.appendChild(el("div", "hc-zh", c.zh || ""));
      card.appendChild(el("div", "hc-en", c.en || ""));
      var n = sectionsOfChapter(c.code).length;
      card.appendChild(el("div", "hc-count", n + " " + plural(n, "раздел", "раздела", "разделов")));
      card.addEventListener("click", function () {
        var w = document.querySelector('.chap[data-code="' + c.code + '"]');
        if (w) { w.classList.add("open"); w.scrollIntoView({ block: "nearest" }); }
        var first = sectionsOfChapter(c.code)[0];
        if (first) location.hash = "#" + first.code;
      });
      hc.appendChild(card);
    });
  }
  function drawCount() {
    var n = 0;
    CAT.sections.forEach(function (s) { (s.figures || []).forEach(function (f) { n += (f.images || []).length; }); });
    return n;
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function renderSection(code, tab) {
    var sec = sectionByCode[code];
    var home = document.getElementById("home");
    var view = document.getElementById("section-view");
    if (!sec) { home.hidden = false; view.hidden = true; return; }
    var svc = hasService(code);
    tab = (tab === "service" && svc) ? "service" : "parts";
    home.hidden = true; view.hidden = false;
    view.innerHTML = "";

    var head = el("div", "sec-header");
    var cr = el("div", "crumbs");
    var back = el("a", null, "Каталог"); back.addEventListener("click", function () { location.hash = ""; });
    cr.appendChild(back);
    cr.appendChild(document.createTextNode(" / "));
    var chap = chapterMeta[sec.chapter] || { en: sec.chapter };
    cr.appendChild(document.createTextNode(sec.chapter + " " + (chap.en || "")));
    head.appendChild(cr);
    var h = el("h2", "sec-title");
    var cspan = el("span", "code", sec.code); h.appendChild(cspan);
    h.appendChild(document.createTextNode(sec.en || sec.zh || ""));
    head.appendChild(h);
    if (sec.zh) head.appendChild(el("div", "sec-zh", sec.zh));
    if (sec.chapter === "QST30") {
      var xref = el("div", "engine-xref");
      var xa = el("a", null,
        "↗ Открыть каталог QST30 с сайта Cummins (цены, фото деталей, цепочки замен номера)");
      xa.href = "qst30-cummins/";
      xref.appendChild(xa);
      head.appendChild(xref);
    }
    view.appendChild(head);

    // ---- tab bar (Parts <-> Service). Second tab only when instructions exist.
    var tabs = el("div", "tabbar");
    var tParts = el("button", "tab" + (tab === "parts" ? " active" : ""), "Запчасти");
    tParts.addEventListener("click", function () { location.hash = "#" + code; });
    tabs.appendChild(tParts);
    if (svc) {
      var tSvc = el("button", "tab" + (tab === "service" ? " active" : ""));
      tSvc.appendChild(document.createTextNode("Обслуживание и ремонт"));
      tSvc.appendChild(el("span", "tab-badge", "🛠"));
      tSvc.addEventListener("click", function () { location.hash = "#" + code + "/service"; });
      tabs.appendChild(tSvc);
    }
    view.appendChild(tabs);

    if (tab === "service") {
      view.appendChild(renderService(sec, SERVICE[code]));
    } else {
      if (svc) {
        var promo = el("div", "svc-promo");
        promo.appendChild(document.createTextNode("Для этого раздела есть инструкции по обслуживанию и ремонту. "));
        var go2 = el("a", null, "Открыть →");
        go2.addEventListener("click", function () { location.hash = "#" + code + "/service"; });
        promo.appendChild(go2);
        view.appendChild(promo);
      }
      (sec.figures || []).forEach(function (f, i) {
        view.appendChild(renderFigure(sec, f, i, sec.figures.length));
      });
    }

    document.querySelectorAll(".sec-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.code === code);
    });
    var openChap = document.querySelector('.chap[data-code="' + sec.chapter + '"]');
    if (openChap) openChap.classList.add("open");
    document.getElementById("content").scrollTop = 0;
    window.scrollTo(0, 0);
  }

  // Turn any NNN-NNNN codes inside a text node into links to that section.
  // This is the "instructions -> catalog" jump (and cross-section jumps).
  function linkifyCodes(text, container) {
    var re = /\b(\d{3}-\d{4})\b/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) container.appendChild(document.createTextNode(text.slice(last, m.index)));
      var code = m[1];
      if (sectionByCode[code]) {
        var a = el("a", "xref-link", code);
        a.title = "Перейти к разделу " + code + (sectionByCode[code].en ? " · " + sectionByCode[code].en : "");
        a.addEventListener("click", function (c) {
          return function () { location.hash = "#" + c; };
        }(code));
        container.appendChild(a);
      } else {
        container.appendChild(document.createTextNode(code));
      }
      last = re.lastIndex;
    }
    if (last < text.length) container.appendChild(document.createTextNode(text.slice(last)));
  }

  function renderService(sec, data) {
    var wrap = el("div", "service");

    // toolbar: back to parts + cross-referenced sections
    var bar = el("div", "svc-bar");
    var toParts = el("button", "btn btn-sm", "← К позициям раздела");
    toParts.addEventListener("click", function () { location.hash = "#" + sec.code; });
    bar.appendChild(toParts);
    var xrefs = (data.xrefs || []).filter(function (c) { return sectionByCode[c]; });
    if (xrefs.length) {
      var xb = el("span", "svc-xrefs");
      xb.appendChild(el("span", "svc-xrefs-lbl", "Связанные разделы:"));
      xrefs.forEach(function (c) {
        var a = el("a", "xref-chip", c);
        a.title = sectionByCode[c].en || "";
        a.addEventListener("click", function () { location.hash = "#" + c; });
        xb.appendChild(a);
      });
      bar.appendChild(xb);
    }
    wrap.appendChild(bar);

    var srcNote = el("div", "svc-src", "Источник: Руководство по ремонту NHL TR100A (RU). Номера в скобках — позиции на рисунках.");
    wrap.appendChild(srcNote);

    var body = el("div", "svc-body");
    // «10-гайка», «1-Рама в сборе», «4-…» идут подряд и вперемешку: в исходном
    // руководстве это спецификация к чертежу, набранная столбцами. Собираем её
    // в таблицу и сортируем по номеру позиции.
    var SPEC = /^\s*(\d{1,3})\s*[-–—]\s*(.+?)\s*$/;
    var items = [];
    (data.items || []).forEach(function (it) {
      var m = it.t === "text" ? SPEC.exec(it.x || "") : null;
      var last = items[items.length - 1];
      if (m) {
        if (last && last.t === "spec") { last.rows.push([parseInt(m[1], 10), m[2]]); return; }
        items.push({ t: "spec", rows: [[parseInt(m[1], 10), m[2]]] });
        return;
      }
      items.push(it);
    });
    items = items.reduce(function (acc, it) {
      if (it.t === "spec" && it.rows.length < 3) {
        it.rows.forEach(function (r) { acc.push({ t: "text", x: r[0] + "-" + r[1] }); });
      } else acc.push(it);
      return acc;
    }, []);

    items.forEach(function (it) {
      if (it.t === "spec") {
        var tbl = el("table", "spec");
        var cap = document.createElement("caption");
        cap.textContent = "Позиции на рисунке";
        tbl.appendChild(cap);
        it.rows.slice().sort(function (a, b) { return a[0] - b[0]; }).forEach(function (r) {
          var tr = el("tr");
          tr.appendChild(el("td", "n", String(r[0])));
          var td = el("td");
          linkifyCodes(r[1], td);
          tr.appendChild(td);
          tbl.appendChild(tr);
        });
        body.appendChild(tbl);
        return;
      }
      if (it.t === "img") {
        var im = el("img", "svc-img");
        im.src = it.x; im.loading = "lazy"; im.alt = sec.code + " иллюстрация";
        im.addEventListener("click", function () { lightbox(it.x); });
        body.appendChild(im);
        return;
      }
      var cls = { head: "svc-head", step: "svc-step", note: "svc-note", text: "svc-text" }[it.t] || "svc-text";
      var p = el(it.t === "head" ? "h3" : "p", cls);
      linkifyCodes(it.x, p);
      body.appendChild(p);
    });
    wrap.appendChild(body);
    return wrap;
  }

  function renderFigure(sec, fig, idx, total) {
    var wrap = el("div", "figure");
    var parts = fig.parts || [];
    var refs = parts.map(function (p) { return p.ref; }).filter(Boolean).map(pad);
    var range = refs.length ? (refs[0] + "–" + refs[refs.length - 1]) : "—";

    var fh = el("div", "fig-head");
    fh.appendChild(el("span", "fig-n", "Рисунок " + (idx + 1) + " / " + total));
    fh.appendChild(el("span", null, "· позиции " + range + " · деталей: " + parts.length));
    wrap.appendChild(fh);

    var body = el("div", "fig-body");
    // drawing / carousel
    var draw = el("div", "fig-draw");
    var images = fig.images || [];
    if (images.length) {
      var car = el("div", "carousel");
      var img = el("img");
      img.src = images[0]; img.alt = sec.code + " чертёж 1"; img.loading = "lazy";
      img.addEventListener("click", function () { lightbox(img.src); });
      car.appendChild(img);
      if (images.length > 1) {
        var ci = 0;
        var navc = el("div", "car-nav");
        var prev = el("button", null, "‹");
        var cnt = el("span", "car-count", "1 / " + images.length);
        var next = el("button", null, "›");
        function upd() {
          img.src = images[ci]; img.alt = sec.code + " чертёж " + (ci + 1);
          cnt.textContent = (ci + 1) + " / " + images.length;
          prev.disabled = ci === 0; next.disabled = ci === images.length - 1;
        }
        prev.addEventListener("click", function () { if (ci > 0) { ci--; upd(); } });
        next.addEventListener("click", function () { if (ci < images.length - 1) { ci++; upd(); } });
        navc.appendChild(prev); navc.appendChild(cnt); navc.appendChild(next);
        car.appendChild(navc); upd();
      }
      draw.appendChild(car);
    } else {
      draw.appendChild(el("div", "cart-empty", "Чертёж отсутствует"));
    }
    body.appendChild(draw);

    // parts table
    var listWrap = el("div", "fig-list");
    listWrap.appendChild(buildPartsTable(sec, parts));
    body.appendChild(listWrap);
    wrap.appendChild(body);
    return wrap;
  }

  function buildPartsTable(sec, parts) {
    var table = el("table", "parts");
    var thead = el("thead");
    var htr = el("tr");
    ["№", "Номер детали", "Наименование", "Цена, " + CURRENCY, "Кол-во", "Нужно", ""]
      .forEach(function (t, i) {
        var th = el("th", null, t);
        th.className = ["", "", "", "col-price", "col-qty", "col-need", "col-add"][i] || "";
        htr.appendChild(th);
      });
    thead.appendChild(htr);
    table.appendChild(thead);   // NOTE: thead is NOT sticky (would hide row 001)
    var tb = el("tbody");
    parts.forEach(function (p) {
      var r = PRICES[p.pn] || {};
      var tr = el("tr", "lvl" + (p.lvl || 0));
      if (!p.pn) tr.classList.add("no-pn");
      tr.appendChild(el("td", "col-no", p.ref ? pad(p.ref) : "·"));

      var tdPn = el("td", "col-pn");
      tdPn.appendChild(document.createTextNode(p.pn || "—"));
      if (r.x) { var x = el("span", "xref", "↔ " + r.x); tdPn.appendChild(x); }
      tr.appendChild(tdPn);

      var tdName = el("td");
      var main = el("span", "name-main"); main.textContent = displayName(p);
      tdName.appendChild(main);
      if (r.g) { tdName.appendChild(el("span", "grp-chip", r.g)); }
      // secondary EN if the primary shown is RU
      if (r.n && p.en && p.en.toLowerCase() !== r.n.toLowerCase()) {
        tdName.appendChild(el("div", "name-en", p.en));
      }
      tr.appendChild(tdName);

      var pr = price(p.pn);
      tr.appendChild(el("td", "col-price", pr != null ? money(pr) : "—"));
      tr.appendChild(el("td", "col-qty", p.qty || "—"));

      var tdNeed = el("td", "col-need");
      var need = el("input", "need-input");
      need.type = "number"; need.min = "1";
      need.value = parseInt(p.qty, 10) > 0 ? parseInt(p.qty, 10) : 1;
      if (!p.pn) need.disabled = true;
      tdNeed.appendChild(need);
      tr.appendChild(tdNeed);

      var tdAdd = el("td", "col-add");
      if (p.pn) {
        var add = el("button", "add-btn", "＋");
        add.title = "Добавить в заказ";
        add.addEventListener("click", function () {
          addToCart(p, sec, need.value);
          tr.classList.remove("flash"); void tr.offsetWidth; tr.classList.add("flash");
        });
        tdAdd.appendChild(add);
      } else {
        tdAdd.appendChild(el("span", "no-order", "—"));
      }
      tr.appendChild(tdAdd);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    return table;
  }

  // ---- search -----------------------------------------------------------
  var searchIndex = [];
  CAT.sections.forEach(function (s) {
    flatParts(s).forEach(function (p) {
      if (!p.pn) return;
      var r = PRICES[p.pn] || {};
      searchIndex.push({
        pn: p.pn, name: displayName(p), en: p.en || "",
        sec: s.code, secEn: s.en || "",
        hay: (p.pn + " " + (r.x || "") + " " + displayName(p) + " " + (p.en || "") +
              " " + s.code + " " + (s.en || "")).toLowerCase()
      });
    });
  });
  var seenPn = {};
  var uniqIndex = searchIndex.filter(function (i) {
    if (seenPn[i.pn]) return false; seenPn[i.pn] = 1; return true;
  });

  function runSearch(q) {
    var box = document.getElementById("searchResults");
    q = q.trim().toLowerCase();
    if (q.length < 2) { box.hidden = true; return; }
    var terms = q.split(/\s+/);
    var secHits = CAT.sections.filter(function (s) {
      var h = (s.code + " " + (s.en || "") + " " + (s.zh || "")).toLowerCase();
      return terms.every(function (t) { return h.indexOf(t) >= 0; });
    }).slice(0, 6);
    var partHits = searchIndex.filter(function (i) {
      return terms.every(function (t) { return i.hay.indexOf(t) >= 0; });
    });
    // dedupe part hits by pn
    var seen = {}, parts = [];
    partHits.forEach(function (i) { if (!seen[i.pn]) { seen[i.pn] = 1; parts.push(i); } });
    parts = parts.slice(0, 40);

    box.innerHTML = "";
    if (!secHits.length && !parts.length) {
      box.appendChild(el("div", "sr-empty", "Ничего не найдено по запросу «" + esc(q) + "»"));
      box.hidden = false; return;
    }
    if (secHits.length) {
      box.appendChild(el("div", "sr-head", "Разделы"));
      secHits.forEach(function (s) {
        var it = el("div", "sr-item");
        it.appendChild(el("span", "sr-pn", s.code));
        it.appendChild(el("span", "sr-name", s.en || s.zh || ""));
        it.addEventListener("mousedown", function (e) { e.preventDefault(); go("#" + s.code); });
        box.appendChild(it);
      });
    }
    if (parts.length) {
      box.appendChild(el("div", "sr-head", "Детали (" + parts.length + (partHits.length > parts.length ? "+" : "") + ")"));
      parts.forEach(function (i) {
        var it = el("div", "sr-item");
        it.appendChild(el("span", "sr-pn", i.pn));
        it.appendChild(el("span", "sr-name", i.name + (i.en && i.en !== i.name ? " · " + i.en : "")));
        it.appendChild(el("span", "sr-sec", i.sec));
        it.addEventListener("mousedown", function (e) {
          e.preventDefault(); go("#" + i.sec, i.pn);
        });
        box.appendChild(it);
      });
    }
    box.hidden = false;
  }
  function go(hash, pn) {
    document.getElementById("searchResults").hidden = true;
    document.getElementById("search").value = "";
    pendingHighlight = pn || null;
    if (location.hash === hash) onHash(); else location.hash = hash;
  }
  var pendingHighlight = null;

  // ---- exports ----------------------------------------------------------
  function cartRows() {
    return Object.keys(cart.items).map(function (pn) {
      var it = cart.items[pn]; var pr = price(pn); var r = PRICES[pn] || {};
      return { pn: pn, name: it.name, en: it.en, sec: it.sec, secEn: it.secEn,
        qty: it.qty, price: pr, sum: pr != null ? pr * it.qty : null, group: r.g || "", xref: r.x || "" };
    });
  }
  function exportCsv() {
    var rows = cartRows();
    if (!rows.length) { alert("Корзина пуста."); return; }
    var head = ["Номер детали", "Взаимозам. артикул", "Наименование", "Description (EN)",
      "Раздел", "Раздел (EN)", "Группа", "Кол-во", "Цена CNY", "Сумма CNY"];
    var lines = [head];
    var total = 0;
    rows.forEach(function (r) {
      if (r.sum != null) total += r.sum;
      lines.push([r.pn, r.xref, r.name, r.en, r.sec, r.secEn, r.group, r.qty,
        r.price != null ? r.price : "", r.sum != null ? r.sum : ""]);
    });
    lines.push([]);
    lines.push(["", "", "", "", "", "", "", "", "ИТОГО:", Math.round(total * 100) / 100]);
    lines.push(["Серийный № машины:", cart.serial || ""]);
    var csv = "﻿" + lines.map(function (row) {
      return row.map(function (c) {
        c = c == null ? "" : String(c);
        return /[",;\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(";");
    }).join("\r\n");
    downloadBlob(csv, "text/csv;charset=utf-8", "TR100A_zakaz_" + stamp() + ".csv");
  }
  function printOrder() {
    var rows = cartRows();
    if (!rows.length) { alert("Корзина пуста."); return; }
    var total = 0;
    var body = rows.map(function (r) {
      if (r.sum != null) total += r.sum;
      return "<tr><td>" + esc(r.pn) + "</td><td>" + esc(r.name) + "</td><td>" + esc(r.sec) +
        "</td><td style='text-align:center'>" + r.qty + "</td><td style='text-align:right'>" +
        (r.price != null ? money(r.price) : "—") + "</td><td style='text-align:right'>" +
        (r.sum != null ? money(r.sum) : "—") + "</td></tr>";
    }).join("");
    var w = window.open("", "_blank");
    w.document.write("<html><head><meta charset='utf-8'><title>Заказ TR100A</title>" +
      "<style>body{font-family:Arial,sans-serif;font-size:12px;padding:24px;color:#1d2226}" +
      "h1{font-size:18px}table{width:100%;border-collapse:collapse;margin-top:12px}" +
      "th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f0f0f0}" +
      ".tot{text-align:right;font-size:15px;margin-top:12px}</style></head><body>" +
      "<h1>Заказ запасных частей — TR100A</h1>" +
      "<div>Серийный № машины: <b>" + esc(cart.serial || "—") + "</b> · Дата: " + new Date().toLocaleDateString("ru-RU") + "</div>" +
      "<table><thead><tr><th>Номер детали</th><th>Наименование</th><th>Раздел</th>" +
      "<th>Кол-во</th><th>Цена, CNY</th><th>Сумма, CNY</th></tr></thead><tbody>" + body +
      "</tbody></table><div class='tot'>Итого (без НДС): <b>" + money(total) + " CNY</b></div>" +
      "<p style='color:#888;font-size:11px'>Позиции без указанной цены уточняются отдельно.</p>" +
      "</body></html>");
    w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 250);
  }
  function exportAllNumbers() {
    // Unique catalog numbers WITH every analytic column — built from the same
    // in-page data, so it works from file:// without a fetch.
    var uniq = {};
    CAT.sections.forEach(function (s) {
      flatParts(s).forEach(function (p) {
        if (!p.pn) return;
        var u = uniq[p.pn] || (uniq[p.pn] = { pn: p.pn, en: p.en || "", zh: p.zh || "", secs: {} });
        u.secs[s.code] = 1;
        if (!u.en && p.en) u.en = p.en;
        if (!u.zh && p.zh) u.zh = p.zh;
      });
    });
    var head = ["Артикул (Part No.)", "Наименование (RU)", "Description (EN)", "Description (ZH)",
      "Цена, CNY без НДС", "Группа", "Взаимозаменяемый артикул", "Разделы"];
    var lines = [head];
    Object.keys(uniq).sort().forEach(function (pn) {
      var u = uniq[pn], r = PRICES[pn] || {};
      lines.push([pn, r.n || "", u.en, u.zh, r.p != null ? r.p : "", r.g || "", r.x || "",
        Object.keys(u.secs).sort().join(" ")]);
    });
    var csv = "﻿" + lines.map(function (row) {
      return row.map(function (c) {
        c = c == null ? "" : String(c);
        return /[",;\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(";");
    }).join("\r\n");
    downloadBlob(csv, "text/csv;charset=utf-8", "TR100A_vse_artikuly_" + stamp() + ".csv");
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2);
  }
  function downloadBlob(content, type, name) {
    var blob = new Blob([content], { type: type });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---- lightbox ---------------------------------------------------------
  function lightbox(src) {
    var lb = el("div"); lb.id = "lightbox";
    var img = el("img"); img.src = src; lb.appendChild(img);
    lb.addEventListener("click", function () { lb.remove(); });
    document.body.appendChild(lb);
  }

  // ---- routing ----------------------------------------------------------
  function onHash() {
    var raw = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
    var parts = raw.split("/");
    var code = parts[0];
    var tab = parts[1] === "service" ? "service" : "parts";
    if (code && sectionByCode[code]) {
      renderSection(code, tab);
      if (pendingHighlight) highlightPart(pendingHighlight);
      pendingHighlight = null;
    } else {
      document.getElementById("home").hidden = false;
      document.getElementById("section-view").hidden = true;
      document.querySelectorAll(".sec-btn").forEach(function (b) { b.classList.remove("active"); });
    }
  }
  function highlightPart(pn) {
    var rows = document.querySelectorAll("#section-view tr");
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i].querySelector(".col-pn");
      if (c && c.firstChild && c.firstChild.textContent === pn) {
        rows[i].scrollIntoView({ block: "center" });
        rows[i].classList.remove("flash"); void rows[i].offsetWidth; rows[i].classList.add("flash");
        break;
      }
    }
  }

  // ---- cart drawer open/close ------------------------------------------
  function openCart() {
    document.getElementById("cartOverlay").hidden = false;
    document.getElementById("cartDrawer").hidden = false;
    renderCart();
  }
  function closeCart() {
    document.getElementById("cartOverlay").hidden = true;
    document.getElementById("cartDrawer").hidden = true;
  }
  function closeSidebarMobile() { document.getElementById("sidebar").classList.remove("open"); }

  // ---- init -------------------------------------------------------------
  function init() {
    buildSidebar();
    buildHome();
    renderCartCount();
    document.getElementById("machineSerial").value = cart.serial || "";
    document.getElementById("machineSerial").addEventListener("input", function (e) {
      cart.serial = e.target.value; save();
    });

    var s = document.getElementById("search");
    s.addEventListener("input", function () { runSearch(s.value); });
    s.addEventListener("focus", function () { if (s.value.trim().length >= 2) runSearch(s.value); });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".search-wrap")) document.getElementById("searchResults").hidden = true;
    });

    document.getElementById("cartBtn").addEventListener("click", openCart);
    document.getElementById("cartClose").addEventListener("click", closeCart);
    document.getElementById("cartOverlay").addEventListener("click", closeCart);
    document.getElementById("clearCart").addEventListener("click", function () {
      if (confirm("Очистить корзину?")) { cart.items = {}; save(); renderCart(); renderCartCount(); }
    });
    document.getElementById("exportCsv").addEventListener("click", exportCsv);
    document.getElementById("printOrder").addEventListener("click", printOrder);
    document.getElementById("exportAll").addEventListener("click", exportAllNumbers);
    document.getElementById("menuToggle").addEventListener("click", function () {
      document.getElementById("sidebar").classList.toggle("open");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeCart(); document.getElementById("searchResults").hidden = true; }
    });

    window.addEventListener("hashchange", onHash);
    onHash();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
