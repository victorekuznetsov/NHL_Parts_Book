/* ============================================================
   Interactive NTE240 parts catalog — vanilla JS, no build step.
   Data arrives as globals: window.CATALOG, window.PRICES.
   Opens directly from index.html over file://.
   ============================================================ */
(function () {
  "use strict";

  var CAT = window.CATALOG || { chapters: [], sections: [] };
  // Prices come from data/prices.js (factory). A locally-loaded price file is
  // kept as an overlay in localStorage and layered on top, so the user can
  // update prices in the browser without rebuilding. See the "price update"
  // section below.
  var FACTORY_PRICES = window.PRICES || {};
  var PRICE_KEY = "nte240_prices_v1";
  function loadOverlay() {
    try { return JSON.parse(localStorage.getItem(PRICE_KEY)) || null; } catch (e) { return null; }
  }
  function mergePrices() {
    var base = {}, ov = loadOverlay(), k;
    for (k in FACTORY_PRICES) base[k] = FACTORY_PRICES[k];
    if (ov) for (k in ov) base[k] = ov[k];
    return base;
  }
  var PRICES = mergePrices();
  var CURRENCY = "CNY";

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
  // required-quantity default from the on-scheme QTY ("AR"/blank -> 1)
  function defNeed(qty) {
    var m = /^\d+$/.test(qty) ? parseInt(qty, 10) : 1;
    return m > 0 ? m : 1;
  }
  function priceOf(pn) { return PRICES[pn] || null; }
  // Human-readable section name. Some chapters put the descriptive name in `zh`
  // (e.g. the Russian QSK60 sections) and only an option code in `en`; others
  // put the English name in `en`. A bare code (no space) is not a name, so
  // prefer a real phrase in `en`, else the `zh` name, else fall back to `en`.
  function secName(s) {
    if (!s) return "";
    var en = s.en || "", zh = s.zh || "";
    if (en && /\s/.test(en)) return en;
    return zh || en;
  }

  var sectionByCode = {};
  CAT.sections.forEach(function (s) { sectionByCode[s.code] = s; });
  var chapterName = {};
  CAT.chapters.forEach(function (c) { chapterName[c.code] = c; });

  // every part number that appears in the catalog (used to keep the loaded
  // price overlay small — only prices for real catalog numbers are stored)
  var CATALOG_PNS = {};
  CAT.sections.forEach(function (s) {
    (s.figures || []).forEach(function (f) {
      (f.parts || []).forEach(function (p) { if (p.pn) CATALOG_PNS[p.pn] = 1; });
    });
  });

  // Cross-reference between the parts catalog and the operator/service manual:
  // a chapter maps to a Russian topic keyword the manual is searched for.
  var MANUAL_KW = {
    "020": "рама", "030": "электр", "040": "двигатель", "050": "гидравл",
    "070": "мост", "080": "тормоз", "090": "кабина", "100": "смазк",
    "150": "шина", "210": "", "600": "инвертор", "700": "двигатель"
  };

  // flatten a section's parts (single source of truth is figures[].parts)
  function sectionParts(s) {
    var out = [];
    (s.figures || []).forEach(function (f) { (f.parts || []).forEach(function (p) { out.push(p); }); });
    return out;
  }

  // ---- cart (localStorage) ---------------------------------------------
  var CART_KEY = "nte240_cart_v1";
  var SERIAL_KEY = "nte240_serial_v1";
  var cart = load();
  function load() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
    renderCartCount();
  }
  function addToCart(pn, qty, meta) {
    if (!pn) return;
    if (!cart[pn]) cart[pn] = { qty: 0, zh: meta.zh || "", en: meta.en || "" };
    cart[pn].qty += qty;
    if (meta.zh) cart[pn].zh = meta.zh;
    if (meta.en) cart[pn].en = meta.en;
    save();
    toast("Добавлено в заказ: " + pn + " × " + qty);
  }

  // ---- sidebar ----------------------------------------------------------
  function renderSidebar() {
    var root = $("#chapters");
    root.innerHTML = "";
    CAT.chapters.forEach(function (ch) {
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
        li.addEventListener("click", function () { location.hash = "#/s/" + s.code; });
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
      root.appendChild(wrap);
    });
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

    var ch = chapterName[s.chapter] || { code: s.chapter, en: "" };
    var head = el("div", "sec-head");
    var count = sectionParts(s).filter(function (p) { return p.pn; }).length;
    var kw = MANUAL_KW[s.chapter] || "";
    var manualHref = "manual.html?from=" + encodeURIComponent(s.code) +
      (kw ? "&q=" + encodeURIComponent(kw) : "");
    var SERVICE = window.SERVICE || {};
    var serviceLink = SERVICE[s.code]
      ? '<a class="xref-link repair" href="service/' + encodeURIComponent(s.code) +
        '.html">🔧 Инструкция по ремонту раздела →</a>'
      : "";
    var engineLink = s.chapter === "700"
      ? '<a class="xref-link engine" href="engine/index.html">🛠 Подробный каталог двигателя QSK60 (Cummins, с фото и ценами) →</a>'
      : "";
    head.innerHTML =
      '<div class="crumb">' + esc(ch.code) + " · " + esc(ch.en || ch.zh || "") + "</div>" +
      "<h1>" + esc(s.code) + " " + esc(s.zh || "") +
      ' <span class="en">' + esc(s.en || "") + "</span></h1>" +
      '<div class="meta">' + (s.figures || []).length + " рис. · " +
      count + " позиц. с номером детали</div>" +
      '<div class="xref-row">' + serviceLink + engineLink +
      '<a class="xref-link" href="' + manualHref + '">📖 Открыть тему в руководстве по эксплуатации →</a>' +
      '</div>';
    content.appendChild(head);

    var figs = s.figures || [];
    figs.forEach(function (f, i) { content.appendChild(renderFigure(s, f, i, figs.length)); });
    window.scrollTo(0, 0);
    if (focusPN) { focusRow(focusPN); focusPN = null; }
  }

  // when arriving from the "check list" results, flash the requested part row
  var focusPN = null;
  function focusRow(pn) {
    var rows = document.querySelectorAll('#content tr[data-pn]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-pn") === pn) {
        rows[i].classList.add("pn-flash");
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

  // order rows by position number (№). Rows without their own number inherit
  // the previous position so kit sub-items / wrapped names stay under their
  // parent; ties keep the original book order.
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

  function renderParts(parts) {
    parts = sortByPos(parts);
    var pw = el("div", "parts-wrap");
    var table = el("table", "parts");
    table.innerHTML =
      "<thead><tr>" +
      '<th class="num">№</th>' +
      "<th>Номер детали</th>" +
      "<th>Наименование</th>" +
      '<th class="price" style="text-align:right">Цена, ' + CURRENCY + "</th>" +
      '<th class="qty">Кол-во</th>' +
      "<th>Нужно</th>" +
      "<th></th>" +
      "</tr></thead>";
    var tb = el("tbody");
    parts.forEach(function (p) { tb.appendChild(renderRow(p)); });
    table.appendChild(tb);
    pw.appendChild(table);
    return pw;
  }

  function renderRow(p) {
    var tr = el("tr", p.lvl ? "lvl" + Math.min(p.lvl, 2) : "");
    if (p.pn) tr.dataset.pn = p.pn;
    var pr = p.pn ? priceOf(p.pn) : null;

    // № + part number
    var pnCell;
    if (p.pn) {
      var xref = pr && pr.x ? '<span class="xref">↔ ' + esc(pr.x) + "</span>" : "";
      pnCell = '<span class="code">' + esc(p.pn) + "</span>" + xref;
    } else {
      tr.classList.add("no-order");
      pnCell = '<span class="muted">—</span>';
    }

    // name: ZH / EN, plus RU from price list when it adds info, plus group chip
    var nameHtml = "";
    if (p.zh) nameHtml += '<div class="zh">' + esc(p.zh) + "</div>";
    if (p.en) nameHtml += '<div class="en">' + esc(p.en) + "</div>";
    if (pr && pr.n) nameHtml += '<div class="ru">' + esc(pr.n) + "</div>";
    if (pr && pr.g) nameHtml += '<span class="grp">' + esc(pr.g) + "</span>";
    if (!nameHtml) nameHtml = '<span class="en">—</span>';

    var priceHtml = pr && pr.p != null ? fmt(pr.p) : '<span class="muted">—</span>';
    var need = defNeed(p.qty);

    tr.innerHTML =
      '<td class="num">' + esc(pad(p.ref)) + "</td>" +
      '<td class="pn">' + pnCell + "</td>" +
      '<td class="name">' + nameHtml + "</td>" +
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

  // ---- search -----------------------------------------------------------
  var searchIndex = null;
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
      head.innerHTML = "<h1>Поиск</h1><div class='sub'>Введите минимум 2 символа — номер детали или название.</div>";
      content.appendChild(head);
      return;
    }
    var terms = query.split(/\s+/);
    var hits = buildIndex().filter(function (r) {
      return terms.every(function (t) { return r.hay.indexOf(t) >= 0; });
    });
    head.innerHTML = "<h1>Результаты поиска</h1><div class='sub'>«" + esc(q) + "» — найдено позиций: " +
      hits.length + "</div>";
    content.appendChild(head);

    var bySec = {};
    hits.slice(0, 600).forEach(function (r) { (bySec[r.sec] = bySec[r.sec] || []).push(r.p); });
    Object.keys(bySec).forEach(function (code) {
      var s = sectionByCode[code];
      var block = el("div", "result-sec");
      var rsh = el("div", "rsh", esc(code) + " · " + esc(secName(s)));
      rsh.addEventListener("click", function () { location.hash = "#/s/" + code; });
      block.appendChild(rsh);
      block.appendChild(renderParts(bySec[code]));
      content.appendChild(block);
    });
    if (hits.length > 600) content.appendChild(el("p", "sub", "Показаны первые 600 из " + hits.length + " — уточните запрос."));
    window.scrollTo(0, 0);
  }

  // ---- cart UI ----------------------------------------------------------
  function renderCartCount() {
    var n = Object.keys(cart).reduce(function (a, pn) { return a + (cart[pn].qty > 0 ? 1 : 0); }, 0);
    $("#cartCount").textContent = n;
  }
  function renderCart() {
    var box = $("#cartLines");
    box.innerHTML = "";
    var pns = Object.keys(cart).filter(function (pn) { return cart[pn].qty > 0; });
    var total = 0, priced = 0, unpriced = 0;
    if (!pns.length) {
      box.appendChild(el("div", "cart-empty", "Заказ пуст.<br>Добавляйте позиции кнопкой «+» в таблице."));
    }
    pns.forEach(function (pn) {
      var it = cart[pn];
      var pr = priceOf(pn);
      var line = el("div", "cline");
      var each = pr && pr.p != null ? pr.p : null;
      var sum = each != null ? each * it.qty : null;
      if (sum != null) { total += sum; priced++; } else { unpriced++; }
      var nm = (pr && pr.n) || it.en || it.zh || "";
      line.innerHTML =
        '<div class="info"><div class="pn">' + esc(pn) + "</div>" +
        '<div class="nm">' + esc(nm) + "</div>" +
        '<div class="ctrls"><input type="number" min="1" value="' + it.qty + '" data-pn="' + esc(pn) + '">' +
        '<button class="rm" data-pn="' + esc(pn) + '">удалить</button></div></div>' +
        '<div class="sum">' + (sum != null ? fmt(sum) + " " + CURRENCY : "—") +
        (each != null ? '<div class="each">' + fmt(each) + " × " + it.qty + "</div>" : '<div class="each">нет цены</div>') +
        "</div>";
      box.appendChild(line);
    });
    box.querySelectorAll(".cline input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var q = parseInt(inp.value, 10);
        var pn = inp.dataset.pn;
        if (!q || q < 1) q = 1;
        cart[pn].qty = q; save(); renderCart();
      });
    });
    box.querySelectorAll(".cline .rm").forEach(function (b) {
      b.addEventListener("click", function () { delete cart[b.dataset.pn]; save(); renderCart(); });
    });
    $("#cartTotal").textContent = fmt(total) + " " + CURRENCY;
    var note = priced + " позиц. с ценой";
    if (unpriced) note += " · " + unpriced + " без цены (уточняется)";
    $("#cartNote").textContent = note;
  }
  function openCart() { renderCart(); $("#cart").classList.add("open"); $("#overlay").classList.add("open"); }
  function closeCart() { $("#cart").classList.remove("open"); $("#overlay").classList.remove("open"); }

  // ---- exports ----------------------------------------------------------
  function downloadBlob(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = el("a"); a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }

  // ---- minimal .xlsx writer (no dependencies, works over file://) ----------
  // A worksheet where each column is typed: "n" cells become real numbers,
  // everything else is written as an inline string — so catalog numbers keep
  // their leading zeros (00106267) as genuine text, no ="…" formula needed.
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
    var esc = function (s) {
      return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    };
    var colRef = function (c) { var s = ""; c++; while (c) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; };
    var cell = function (r, c, v, t) {
      if (v == null || v === "") return "";
      var ref = colRef(c) + r;
      if (t === "n" && v !== "" && !isNaN(v)) return '<c r="' + ref + '"><v>' + v + "</v></c>";
      return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + "</t></is></c>";
    };
    var body = '<row r="1">' + headers.map(function (h, c) { return cell(1, c, h, "s"); }).join("") + "</row>";
    rows.forEach(function (row, ri) {
      body += '<row r="' + (ri + 2) + '">' +
        row.map(function (v, c) { return cell(ri + 2, c, v, types[c] || "s"); }).join("") + "</row>";
    });
    var files = [
      { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
      { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: "xl/workbook.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + esc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: "xl/_rels/workbook.xml.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: "xl/worksheets/sheet1.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + "</sheetData></worksheet>" }
    ];
    return new Blob([zipStore(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function exportOrderCsv() {
    var pns = Object.keys(cart).filter(function (pn) { return cart[pn].qty > 0; });
    if (!pns.length) { toast("Заказ пуст"); return; }
    var serial = $("#serial").value.trim();
    var headers = ["Номер детали", "Наименование", "Взаимозам. артикул", "Цена, " + CURRENCY,
      "Кол-во", "Сумма, " + CURRENCY, "Группа"];
    var types = ["s", "s", "s", "n", "n", "n", "s"];
    var rows = [], total = 0;
    pns.forEach(function (pn) {
      var it = cart[pn], pr = priceOf(pn) || {};
      var each = pr.p != null ? pr.p : null;
      var sum = each != null ? each * it.qty : null;
      if (sum != null) total += sum;
      rows.push([pn, pr.n || it.en || it.zh || "", pr.x || "",
        each != null ? each : "", it.qty, sum != null ? Math.round(sum * 100) / 100 : "", pr.g || ""]);
    });
    rows.push(["", "", "", "", "ИТОГО", Math.round(total * 100) / 100, ""]);
    var name = "NTE240_заказ" + (serial ? "_" + serial : "") + ".xlsx";
    downloadBlob(name, xlsx("Заказ", headers, rows, types));
  }

  function exportAllNumbers() {
    var headers = ["Артикул (Part No.)", "Наименование (RU)", "Description (EN)", "Описание (ZH)",
      "Цена, " + CURRENCY, "Группа", "Взаимозаменяемый артикул", "Разделы"];
    var types = ["s", "s", "s", "s", "n", "s", "s", "s"];
    var uniq = {};
    CAT.sections.forEach(function (s) {
      sectionParts(s).forEach(function (p) {
        if (!p.pn) return;
        var u = uniq[p.pn] || (uniq[p.pn] = { en: p.en || "", zh: p.zh || "", secs: {} });
        u.secs[s.code] = 1;
        if (!u.en && p.en) u.en = p.en;
        if (!u.zh && p.zh) u.zh = p.zh;
      });
    });
    var rows = Object.keys(uniq).sort().map(function (pn) {
      var u = uniq[pn], pr = priceOf(pn) || {};
      return [pn, pr.n || "", u.en, u.zh, pr.p != null ? pr.p : "", pr.g || "", pr.x || "",
        Object.keys(u.secs).sort().join(" ")];
    });
    downloadBlob("NTE240_все_номера.xlsx", xlsx("Номера", headers, rows, types));
    toast("Экспортировано номеров: " + rows.length);
  }

  function printOrder() {
    var pns = Object.keys(cart).filter(function (pn) { return cart[pn].qty > 0; });
    if (!pns.length) { toast("Заказ пуст"); return; }
    var serial = $("#serial").value.trim();
    var total = 0, body = "";
    pns.forEach(function (pn, i) {
      var it = cart[pn], pr = priceOf(pn) || {};
      var each = pr.p != null ? pr.p : null, sum = each != null ? each * it.qty : null;
      if (sum != null) total += sum;
      body += "<tr><td>" + (i + 1) + "</td><td>" + esc(pn) + "</td><td>" +
        esc(pr.n || it.en || it.zh || "") + "</td><td style='text-align:right'>" +
        (each != null ? fmt(each) : "—") + "</td><td style='text-align:center'>" + it.qty +
        "</td><td style='text-align:right'>" + (sum != null ? fmt(sum) : "—") + "</td></tr>";
    });
    var w = window.open("", "_blank");
    w.document.write(
      "<html><head><meta charset='utf-8'><title>Заказ NTE240</title><style>" +
      "body{font:13px Arial,sans-serif;padding:24px;color:#2a3138}h1{font-size:18px}" +
      "table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #ccc;padding:6px 8px}" +
      "th{background:#f2f4f5;text-align:left}tfoot td{font-weight:bold}</style></head><body>" +
      "<h1>Заказ-спецификация · NTE240 Mining Truck</h1>" +
      "<div>" + (serial ? "Машина: <b>" + esc(serial) + "</b> · " : "") +
      "Дата: " + new Date().toLocaleDateString("ru-RU") + "</div>" +
      "<table><thead><tr><th>№</th><th>Номер детали</th><th>Наименование</th>" +
      "<th>Цена, " + CURRENCY + "</th><th>Кол-во</th><th>Сумма, " + CURRENCY + "</th></tr></thead><tbody>" +
      body + "</tbody><tfoot><tr><td colspan='5' style='text-align:right'>ИТОГО, " + CURRENCY +
      "</td><td style='text-align:right'>" + fmt(total) + "</td></tr></tfoot></table>" +
      "<p style='margin-top:18px;color:#80868b;font-size:11px'>Цены без НДС. Позиции без цены уточняются отдельно.</p>" +
      "</body></html>");
    w.document.close(); w.focus(); w.print();
  }

  // ---- price update (load a price file locally, no rebuild) -------------
  // Reads an .xlsx or .csv price list in the browser and layers it over the
  // factory prices. Same columns as tools/extract_prices.py: Артикул,
  // Взаимозаменяемый артикул, Наименование, Цена CNY без НДС, Группа.
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
  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref || ""); if (!m) return 0;
    var s = m[1], n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  // --- .xlsx (a zip of XML): read via the browser, inflate with DecompressionStream
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
  // --- .csv
  function parseCsv(text) {
    text = text.replace(/^﻿/, "");
    var head = text.slice(0, (text.indexOf("\n") + 1) || text.length);
    var delim = (head.split(";").length > head.split(",").length) ? ";" : ",";
    var rows = [], row = [], cur = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') { q = true; }
      else if (ch === delim) { row.push(cur); cur = ""; }
      else if (ch === "\r") { /* skip */ }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  // --- rows -> {pn:{p,g,x,n}}, mirroring extract_prices.py's column logic
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
        n: rw[col.name] != null ? String(rw[col.name]).replace(/ /g, " ").trim() : ""
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
    var parsed = rowsToPrices(rows), overlay = loadOverlay() || {}, added = 0, priced = 0;
    Object.keys(parsed).forEach(function (pn) {
      if (!CATALOG_PNS[pn]) return;                 // keep the overlay small
      overlay[pn] = parsed[pn]; added++;
      if (parsed[pn].p != null) priced++;
    });
    if (!added) { pmStatus("В файле не найдено ни одного артикула из каталога.", true); return; }
    try { localStorage.setItem(PRICE_KEY, JSON.stringify(overlay)); } catch (e) {}
    PRICES = mergePrices(); searchIndex = null; checkIndex = null;
    route(); renderCartCount();
    if ($("#cart").classList.contains("open")) renderCart();
    pmStatus("Готово: обновлено номеров — " + added + ", из них с ценой — " + priced + ".");
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
      new Blob(["window.PRICES = " + JSON.stringify(PRICES) + ";\n"],
        { type: "application/javascript" }));
    toast("Файл prices.js скачан");
  }
  function resetPrices() {
    if (!confirm("Сбросить цены к заводским (из файла prices.js)?")) return;
    try { localStorage.removeItem(PRICE_KEY); } catch (e) {}
    PRICES = mergePrices(); searchIndex = null; checkIndex = null;
    route(); renderCartCount();
    if ($("#cart").classList.contains("open")) renderCart();
    pmStatus("Цены сброшены к заводским."); toast("Цены сброшены");
  }
  function openPriceModal() {
    pmStatus(""); $("#priceModal").classList.add("open"); $("#pmOverlay").classList.add("open");
  }
  function closePriceModal() {
    $("#priceModal").classList.remove("open"); $("#pmOverlay").classList.remove("open");
  }

  // ---- check a list of part numbers against the catalog -----------------
  // Normalise a number for matching (case, spaces, dashes). Leading zeros are
  // significant in these catalogs, so they are kept; a zero-stripped key is
  // tried only as a fallback.
  function normNo(s) { return String(s == null ? "" : s).toUpperCase().replace(/[\s\-]/g, ""); }
  function stripZeros(s) { return s.replace(/^0+/, ""); }

  var checkIndex = null;   // { byNo, byXref, meta }
  function buildCheckIndex() {
    if (checkIndex) return checkIndex;
    var meta = {};   // pn -> { pn, zh, en, secs:{} }
    CAT.sections.forEach(function (s) {
      sectionParts(s).forEach(function (p) {
        if (!p.pn) return;
        var m = meta[p.pn] || (meta[p.pn] = { pn: p.pn, zh: p.zh || "", en: p.en || "", secs: {} });
        m.secs[s.code] = 1;
        if (!m.zh && p.zh) m.zh = p.zh;
        if (!m.en && p.en) m.en = p.en;
      });
    });
    var byNo = {}, byXref = {};
    Object.keys(meta).forEach(function (pn) {
      var k = normNo(pn);
      byNo[k] = pn; byNo[stripZeros(k)] = byNo[stripZeros(k)] || pn;
      var pr = priceOf(pn);
      if (pr && pr.x) {
        var xk = normNo(pr.x);
        if (xk && !byNo[xk]) { byXref[xk] = pn; byXref[stripZeros(xk)] = byXref[stripZeros(xk)] || pn; }
      }
    });
    return (checkIndex = { byNo: byNo, byXref: byXref, meta: meta });
  }
  function lookupNo(raw) {
    var idx = buildCheckIndex(), k = normNo(raw);
    if (!k) return null;
    if (idx.byNo[k]) return { pn: idx.byNo[k], via: "no" };
    if (idx.byXref[k]) return { pn: idx.byXref[k], via: "xref" };
    var z = stripZeros(k);
    if (idx.byNo[z]) return { pn: idx.byNo[z], via: "no" };
    if (idx.byXref[z]) return { pn: idx.byXref[z], via: "xref" };
    return null;
  }

  var checkResults = [];   // last run, for export
  function parseNumbers(text) {
    return String(text || "").split(/[\s,;]+/).map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length > 0; });
  }
  function runCheck(nums) {
    var idx = buildCheckIndex();
    var seen = {}, out = [];
    nums.forEach(function (raw) {
      var key = normNo(raw);
      if (!key || seen[key]) return;   // skip blanks and duplicates
      seen[key] = 1;
      var hit = lookupNo(raw), rec;
      if (hit) {
        var m = idx.meta[hit.pn], pr = priceOf(hit.pn) || {};
        rec = {
          query: raw, found: true, via: hit.via, pn: hit.pn,
          ru: pr.n || "", en: m.en || "", zh: m.zh || "",
          price: pr.p != null ? pr.p : null, group: pr.g || "", xref: pr.x || "",
          secs: Object.keys(m.secs).sort()
        };
      } else {
        rec = { query: raw, found: false, via: null, pn: "", ru: "", en: "", zh: "",
          price: null, group: "", xref: "", secs: [] };
      }
      out.push(rec);
    });
    checkResults = out;
    renderCheckResults();
  }
  function renderCheckResults() {
    var box = $("#chkResults"), st = $("#chkStatus");
    box.innerHTML = "";
    if (!checkResults.length) {
      st.textContent = ""; $("#chkExport").disabled = true; return;
    }
    var found = checkResults.filter(function (r) { return r.found; }).length;
    var viaX = checkResults.filter(function (r) { return r.via === "xref"; }).length;
    st.innerHTML = "Проверено: <b>" + checkResults.length + "</b> · найдено: <b>" + found +
      "</b> · не найдено: <b>" + (checkResults.length - found) + "</b>" +
      (viaX ? " · по взаимозам. артикулу: <b>" + viaX + "</b>" : "");
    $("#chkExport").disabled = false;

    var table = el("table", "chk-table");
    table.innerHTML = "<thead><tr>" +
      "<th>Запрос</th><th>Номер детали</th><th>Наименование</th>" +
      '<th class="price">Цена, ' + CURRENCY + "</th><th>Группа</th><th>Взаимозам.</th>" +
      "<th>Разделы</th></tr></thead>";
    var tb = el("tbody");
    checkResults.forEach(function (r) {
      var tr = el("tr", r.found ? "" : "chk-miss");
      if (!r.found) {
        tr.innerHTML = '<td class="chk-q">' + esc(r.query) + "</td>" +
          '<td colspan="6" class="chk-none">не найдено в каталоге</td>';
        tb.appendChild(tr); return;
      }
      var nameHtml = "";
      if (r.ru) nameHtml += '<div class="ru">' + esc(r.ru) + "</div>";
      if (r.zh) nameHtml += '<div class="zh">' + esc(r.zh) + "</div>";
      if (r.en) nameHtml += '<div class="en">' + esc(r.en) + "</div>";
      if (!nameHtml) nameHtml = "—";
      var via = r.via === "xref"
        ? '<div class="chk-via">вместо ' + esc(r.query) + "</div>" : "";
      var secChips = r.secs.map(function (code) {
        var s = sectionByCode[code];
        return '<button class="chk-sec" data-sec="' + esc(code) + '" data-pn="' + esc(r.pn) +
          '" title="Открыть раздел ' + esc(code) + ' в каталоге">' + esc(code) +
          " · " + esc(secName(s)) + "</button>";
      }).join("");
      tr.innerHTML =
        '<td class="chk-q">' + esc(r.query) + "</td>" +
        '<td class="chk-pn"><button class="chk-open" data-sec="' + esc(r.secs[0] || "") +
          '" data-pn="' + esc(r.pn) + '" title="Открыть в каталоге">' + esc(r.pn) + "</button>" + via + "</td>" +
        '<td class="chk-name">' + nameHtml + "</td>" +
        '<td class="price">' + (r.price != null ? fmt(r.price) : '<span class="muted">—</span>') + "</td>" +
        "<td>" + esc(r.group || "") + "</td>" +
        "<td>" + esc(r.xref || "") + "</td>" +
        '<td class="chk-secs">' + secChips + "</td>";
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    box.appendChild(table);
    // navigate to the catalog section (and flash the part) on click
    box.querySelectorAll(".chk-sec, .chk-open").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var sec = btn.getAttribute("data-sec"), pn = btn.getAttribute("data-pn");
        if (!sec) return;
        focusPN = pn; closeCheck();
        var target = "#/s/" + sec;
        if (location.hash === target) { highlightSidebar(sec); renderSection(sec); }
        else location.hash = target;
      });
    });
  }
  function exportCheck() {
    if (!checkResults.length) { toast("Список пуст"); return; }
    var headers = ["Запрошенный номер", "Статус", "Номер в каталоге", "Наименование (RU)",
      "Description (EN)", "Описание (ZH)", "Цена, " + CURRENCY, "Группа",
      "Взаимозаменяемый артикул", "Разделы"];
    var types = ["s", "s", "s", "s", "s", "s", "n", "s", "s", "s"];
    var rows = checkResults.map(function (r) {
      var status = !r.found ? "не найдено" : (r.via === "xref" ? "найдено (взаимозам.)" : "найдено");
      return [r.query, status, r.pn, r.ru, r.en, r.zh,
        r.price != null ? r.price : "", r.group, r.xref, r.secs.join(" ")];
    });
    downloadBlob("NTE240_проверка_номеров.xlsx", xlsx("Проверка", headers, rows, types));
    toast("Выгружено строк: " + rows.length);
  }
  function chkStatusMsg(msg, err) {
    var s = $("#chkStatus"); if (!s) return;
    s.innerHTML = msg || ""; s.classList.toggle("err", !!err);
  }
  function onCheckFile(file) {
    if (!file) return;
    chkStatusMsg("Читаю файл…");
    var done = function (nums) {
      var cur = $("#chkInput").value.trim();
      $("#chkInput").value = (cur ? cur + "\n" : "") + nums.join("\n");
      runCheck(parseNumbers($("#chkInput").value));
    };
    if (/\.xlsx$/i.test(file.name)) {
      file.arrayBuffer().then(readXlsx).then(function (rows) {
        var nums = [];
        rows.forEach(function (row) {
          if (!row) return;
          for (var c = 0; c < row.length; c++) {
            var v = (row[c] == null ? "" : String(row[c])).trim();
            if (v) { nums.push(v); break; }   // first non-empty cell of the row
          }
        });
        // drop an obvious header token
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
  function openCheck() {
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
  function route() {
    var h = location.hash || "";
    if (h.indexOf("#/ch/") === 0) {
      // deep link to a chapter (used by manual → catalog cross-references):
      // open the chapter's first section and expand it in the sidebar
      var chc = decodeURIComponent(h.slice(5));
      var first = CAT.sections.filter(function (s) { return s.chapter === chc; })[0];
      location.hash = first ? "#/s/" + first.code : "";
      return;
    } else if (h.indexOf("#/s/") === 0) {
      var code = decodeURIComponent(h.slice(4));
      highlightSidebar(code);
      renderSection(code);
      $("#search").value = "";
    } else if (h.indexOf("#/q/") === 0) {
      var q = decodeURIComponent(h.slice(4));
      highlightSidebar(null);
      $("#search").value = q;
      renderSearch(q);
    } else {
      var first = CAT.sections[0];
      if (first) { location.hash = "#/s/" + first.code; return; }
    }
    if (window.innerWidth <= 900) $("#sidebar").classList.remove("open");
  }

  // ---- wire up ----------------------------------------------------------
  function init() {
    renderSidebar();
    renderCartCount();

    var searchT;
    $("#search").addEventListener("input", function () {
      var v = this.value;
      clearTimeout(searchT);
      searchT = setTimeout(function () {
        if (v.trim().length >= 2) location.hash = "#/q/" + encodeURIComponent(v);
        else if (!v.trim() && location.hash.indexOf("#/q/") === 0) history.back();
      }, 220);
    });

    $("#cartBtn").addEventListener("click", openCart);
    $("#cartClose").addEventListener("click", closeCart);
    $("#overlay").addEventListener("click", closeCart);
    $("#clearCart").addEventListener("click", function () {
      if (confirm("Очистить заказ?")) { cart = {}; save(); renderCart(); }
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
    $("#chkClear").addEventListener("click", function () {
      $("#chkInput").value = ""; checkResults = []; renderCheckResults(); $("#chkStatus").textContent = "";
    });

    var serial = $("#serial");
    serial.value = localStorage.getItem(SERIAL_KEY) || "";
    serial.addEventListener("input", function () {
      try { localStorage.setItem(SERIAL_KEY, serial.value); } catch (e) {}
    });

    $("#lbClose").addEventListener("click", closeLightbox);
    $("#lightbox").addEventListener("click", function (e) { if (e.target.id === "lightbox") closeLightbox(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeLightbox(); closeCart(); closePriceModal(); }
    });
    $("#menuBtn").addEventListener("click", function () { $("#sidebar").classList.toggle("open"); });

    window.addEventListener("hashchange", route);
    route();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
