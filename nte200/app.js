/* NTE200 interactive parts catalog — vanilla JS, no dependencies.
   Data comes from window.CATALOG (data/parts.js). Cart persists in localStorage.
   Each section holds one or more "figures": a drawing (or drawings) paired with
   exactly the list of positions shown on it. */
(function () {
  "use strict";
  var DATA = window.CATALOG;
  if (!DATA) { document.body.innerHTML = "<p style='padding:40px'>Не удалось загрузить данные каталога (data/parts.js).</p>"; return; }

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  var PRICES = window.PRICES || {};
  var MANUALS = window.MANUALS || { files: [], repairByCode: {}, repairByChapter: {}, repairToc: [], general: [], wiring: [] };
  function manualFile(id) { return (MANUALS.files.filter(function (f) { return f.id === id; })[0] || {}).file; }
  function repairLink(code, chapter) {
    var pg = MANUALS.repairByCode[code];
    if (pg) return { page: pg, exact: true };
    if (MANUALS.repairByChapter[chapter]) return { page: MANUALS.repairByChapter[chapter], exact: false };
    return null;
  }
  function priceOf(pn) { return PRICES[pn] || null; }
  // Part photos for the online QSK50 catalog are served from the public Cummins
  // CDN (like the standalone Cummins app), so we don't ship ~thousands of images.
  // 3639541_iso.png -> /graphics/parts/363/3639541/3639541_iso.png; onerror hides it.
  function photoSrc(file) {
    var num = String(file || "").split("_")[0];
    if (!num) return "";
    return "https://parts.cummins.com/graphics/parts/" + num.slice(0, 3) + "/" + num + "/" + file;
  }
  // other sections in the book that also list this part number (live cross-ref)
  function usedIn(pn, exceptCode) {
    var res = [], seen = {};
    if (!pn) return res;
    DATA.sections.forEach(function (s) {
      if (s.code === exceptCode || seen[s.code]) return;
      var has = (s.figures || []).some(function (f) {
        return f.parts.some(function (p) { return p.pn === pn; });
      });
      if (has) { seen[s.code] = 1; res.push(s); }
    });
    return res;
  }
  function fmtPrice(v) {
    if (v == null || v === "") return "";
    return Number(v).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  var byCode = {};
  DATA.sections.forEach(function (s) { byCode[s.code] = s; });
  function secParts(s) {
    var a = []; (s.figures || []).forEach(function (f) { a.push.apply(a, f.parts); }); return a;
  }
  function secImages(s) {
    var a = []; (s.figures || []).forEach(function (f) { a.push.apply(a, f.images); }); return a;
  }
  function findPart(pn) {
    var res = null;
    DATA.sections.some(function (s) {
      return (s.figures || []).some(function (f) {
        return f.parts.some(function (p) { if (p.pn === pn) { res = { p: p, s: s }; return true; } });
      });
    });
    return res;
  }

  /* ---------------- cart ---------------- */
  var CART_KEY = "nte200_cart_v1";
  var cart = load();
  function load() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch (e) { return {}; } }
  function persist() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} }

  function addToCart(part, sec, qty) {
    if (!part.pn) return;                       // positions without a catalog number are not orderable
    qty = Math.max(1, Math.floor(qty || 1));
    if (cart[part.pn]) { cart[part.pn].qty += qty; }
    else {
      var pr = priceOf(part.pn) || {};
      cart[part.pn] = { pn: part.pn, en: part.en, zh: part.zh,
                        sec: sec.code, secName: sec.en, qty: qty,
                        price: pr.p != null ? pr.p : null, ru: pr.n || "", grp: pr.g || "", xref: pr.x || "" };
    }
    persist(); renderCart(); flashCount();
    toast("В заказ: " + part.pn + " ×" + qty);
  }
  function cartSum() {
    return Object.keys(cart).reduce(function (a, k) {
      return a + (cart[k].price != null ? cart[k].price * cart[k].qty : 0);
    }, 0);
  }
  function setQty(pn, q) {
    q = Math.max(0, Math.floor(q || 0));
    if (!cart[pn]) return;
    if (q === 0) delete cart[pn]; else cart[pn].qty = q;
    persist(); renderCart();
  }
  function cartLines() { return Object.keys(cart).length; }
  function cartQty() { return Object.keys(cart).reduce(function (a, k) { return a + cart[k].qty; }, 0); }

  /* ---------------- sidebar ---------------- */
  // group chapters into the truck and the engine catalogs
  function chapGroup(code) {
    code = String(code);
    if (/^QO/.test(code)) return { id: "qsk50o", label: "Двигатель QSK50 · Cummins online (вес · размеры · фото)" };
    if (/^Q/.test(code)) return { id: "qsk50", label: "Двигатель QSK50 · книга (PDF)" };
    return { id: "nte200", label: "Самосвал NTE200 · NHL" };
  }
  function buildSidebar() {
    var nav = $("#chapters");
    var byChap = {};
    DATA.sections.forEach(function (s) { (byChap[s.chapter] = byChap[s.chapter] || []).push(s); });
    var lastGroup = null;
    nav.innerHTML = DATA.chapters.map(function (ch) {
      var g = chapGroup(ch.code);
      var header = "";
      if (g.id !== lastGroup) { lastGroup = g.id; header = '<div class="chap-group">' + esc(g.label) + "</div>"; }
      var items = (byChap[ch.code] || []).map(function (s) {
        return '<button class="sec-item" data-code="' + s.code + '">' +
          '<span class="sc">' + esc(s.code) + '</span>' +
          '<span class="cnt">' + secParts(s).length + '</span>' +
          '<span class="sn">' + esc(s.zh) + (s.en ? ' · ' + esc(s.en) : "") + '</span></button>';
      }).join("");
      return header + '<div class="chap" data-chap="' + ch.code + '">' +
        '<button class="chap-h"><span class="caret">&#9656;</span>' +
        '<span class="code">' + esc(ch.code) + '</span>' +
        '<span>' + esc(ch.zh) + '</span>' +
        '<span class="en">' + esc(ch.en) + '</span></button>' +
        '<div class="sec-list">' + items + '</div></div>';
    }).join("");
    nav.addEventListener("click", function (e) {
      var h = e.target.closest(".chap-h");
      if (h) { h.parentNode.classList.toggle("open"); return; }
      var it = e.target.closest(".sec-item");
      if (it) { showSection(it.getAttribute("data-code")); closeSidebar(); }
    });
  }
  function markActive(code) {
    $$(".sec-item").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-code") === code); });
    var it = $('.sec-item[data-code="' + code + '"]');
    if (it) it.closest(".chap").classList.add("open");
  }
  function chapterName(code) {
    var c = DATA.chapters.filter(function (x) { return x.code === code; })[0];
    return c ? c.zh + " · " + c.en : code;
  }

  /* ---------------- parts table ---------------- */
  function padRef(ref) {                     // show positions consistently as 001, 002…
    return /^\d{1,2}$/.test(ref) ? ("00" + ref).slice(-3) : ref;
  }
  function nameCell(p) {
    var pr = priceOf(p.pn) || {};
    var html = '<div class="zh">' + esc(p.zh || p.en) + "</div>" +
      (p.en && p.zh ? '<div class="en">' + esc(p.en) + "</div>" : "");
    // Russian name from the price list (only if it adds information)
    if (pr.n && pr.n.toUpperCase() !== (p.en || "").toUpperCase()) {
      html += '<div class="ru">' + esc(pr.n) + "</div>";
    }
    if (pr.g) html += '<span class="grp">' + esc(pr.g) + "</span>";
    return html;
  }
  function pnCell(p) {
    var pr = priceOf(p.pn) || {};
    var x = pr.x ? '<span class="xref" title="Взаимозаменяемый артикул">↔ ' + esc(pr.x) + "</span>" : "";
    return '<button data-pn="' + esc(p.pn) + '" title="Добавить в заказ">' + esc(p.pn) + "</button>" + x;
  }
  function priceCell(pn) {
    var pr = priceOf(pn);
    return pr && pr.p != null ? fmtPrice(pr.p) : '<span class="dash">—</span>';
  }

  // extra card data (weight, size, photo, spec sheet) that came with the online catalog
  function detailChip(p) {
    return p.d ? '<button class="pd-toggle" data-pd="' + esc(p.pn) + '" title="Вес, габариты, фото и характеристики">&#9432; детали</button>' : "";
  }
  var RU_ATTR = { "Sellable": "Продаётся отдельно", "Hazardous Material": "Опасный груз" };
  function partDetailRow(p, secCode, cols) {
    var d = p.d; if (!d) return "";
    var photo = d.img ? '<img class="pd-photo" loading="lazy" src="' + esc(photoSrc(d.img)) +
      '" alt="Фото детали ' + esc(p.pn) + '" onerror="this.closest(\'.pd\').classList.add(\'no-photo\');this.remove()">' : "";
    var rows = [];
    if (p.qty) rows.push(["Кол-во на схеме", p.qty]);
    if (d.wt) rows.push(["Масса, кг", d.wt]);
    if (d.dim) rows.push(["Габариты Д×Ш×В, мм", d.dim]);
    if (d.at) Object.keys(d.at).forEach(function (k) { rows.push([RU_ATTR[k] || k, d.at[k]]); });
    var attrs = '<table class="pd-attrs">' + rows.map(function (r) {
      return "<tr><th>" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>"; }).join("") + "</table>";
    var used = usedIn(p.pn, secCode).slice(0, 12);
    var usedHtml = used.length ? '<div class="pd-used"><b>Ещё в разделах:</b> ' + used.map(function (s) {
      return '<a href="#' + s.code + '" class="jump" data-code="' + s.code + '" title="' + esc(s.zh || s.en) + '">' + esc(s.code) + "</a>"; }).join(" ") + "</div>" : "";
    return '<tr class="pd-row" hidden><td colspan="' + cols + '">' +
      '<div class="pd' + (d.img ? "" : " no-photo") + '">' + photo +
      '<div class="pd-body">' + attrs + usedHtml + "</div></div></td></tr>";
  }

  function partsTable(parts, secCode) {
    var rows = parts.map(function (p) {
      var qn = parseInt(p.qty, 10); if (!(qn > 0)) qn = 1;
      var det = partDetailRow(p, secCode, 7);
      if (p.pn) {
        return '<tr class="lvl' + (p.lvl || 0) + (p.d ? " has-det" : "") + '">' +
          '<td class="c-ref">' + esc(padRef(p.ref)) + "</td>" +
          '<td class="c-pn">' + pnCell(p) + "</td>" +
          '<td class="c-name">' + nameCell(p) + detailChip(p) + "</td>" +
          '<td class="c-price" title="Цена, CNY без НДС">' + priceCell(p.pn) + "</td>" +
          '<td class="c-qty" title="Количество на схеме">' + esc(p.qty) + "</td>" +
          '<td class="c-need"><input class="need" type="number" min="1" value="' + qn + '" data-pn="' + esc(p.pn) + '" title="Требуемое количество" aria-label="Требуемое количество"></td>' +
          '<td class="c-add"><button class="addbtn" data-pn="' + esc(p.pn) + '" title="Добавить в заказ">&#65291;</button></td>' +
          "</tr>" + det;
      }
      // listed position without an orderable catalog number
      return '<tr class="lvl' + (p.lvl || 0) + ' norow' + (p.d ? " has-det" : "") + '">' +
        '<td class="c-ref">' + esc(padRef(p.ref)) + "</td>" +
        '<td class="c-pn dash">—</td>' +
        '<td class="c-name">' + nameCell(p) + detailChip(p) + "</td>" +
        '<td class="c-price dash">—</td>' +
        '<td class="c-qty">' + esc(p.qty) + "</td>" +
        '<td class="c-need"></td><td class="c-add"></td></tr>' + det;
    }).join("");
    return '<table class="parts-tbl"><thead><tr>' +
      "<th>№</th><th>Номер детали</th><th>Наименование</th>" +
      '<th title="Цена, CNY без НДС">Цена, CNY</th>' +
      '<th title="Количество на схеме">Кол-во</th><th>Нужно</th><th></th>' +
      "</tr></thead><tbody>" + rows + "</tbody></table>";
  }

  function drawingsMarkup(images, label) {
    if (!images.length) return "";
    if (images.length === 1) {
      return '<figure class="drawing" data-src="' + esc(images[0]) + '">' +
        '<img loading="lazy" src="' + esc(images[0]) + '" alt="Чертёж">' +
        '<span class="zoom-ic">&#128269;</span></figure>';
    }
    var slides = images.map(function (src, i) {
      return '<figure class="drawing slide' + (i === 0 ? " on" : "") + '" data-src="' + esc(src) + '">' +
        '<img loading="lazy" src="' + esc(src) + '" alt="Чертёж ' + (i + 1) + '">' +
        '<span class="zoom-ic">&#128269;</span></figure>';
    }).join("");
    return '<div class="carousel" data-i="0" data-n="' + images.length + '">' + slides +
      '<button class="cbtn prev" aria-label="Назад">&#8249;</button>' +
      '<button class="cbtn next" aria-label="Вперёд">&#8250;</button>' +
      '<span class="ccount">1 / ' + images.length + "</span></div>";
  }

  /* ---------------- section view ---------------- */
  function showSection(code) {
    var s = byCode[code];
    if (!s) return;
    $("#welcome").hidden = true; $("#searchView").hidden = true;
    var v = $("#sectionView"); v.hidden = false;
    location.hash = code; markActive(code);

    var figs = s.figures || [];
    var multi = figs.length > 1;
    var body = figs.map(function (f, fi) {
      var head = multi ? '<div class="fig-head">Рисунок ' + (fi + 1) + " / " + figs.length +
        ' · позиции ' + posRange(f.parts) + "</div>" : "";
      var draw = f.images.length
        ? '<div class="fig-draw">' + drawingsMarkup(f.images) + "</div>"
        : "";
      var tbl = f.parts.length ? partsTable(f.parts, s.code)
        : '<div class="no-parts">Для этого рисунка в книге приведён только чертёж.</div>';
      return '<section class="figure' + (f.images.length ? "" : " nofig") + '">' + head +
        draw + '<div class="fig-parts">' + tbl + "</div></section>";
    }).join("");

    var np = secParts(s).length;
    v.innerHTML =
      '<div class="sv-head"><span class="sv-code">' + esc(s.code) + "</span>" +
      '<h1 class="sv-title">' + esc(s.zh) + "</h1>" +
      '<span class="sv-chip">' + esc(chapterName(s.chapter)) + "</span></div>" +
      '<div class="sv-sub">' + esc(s.en) + " · " + np + " позиций · " +
      figs.length + (figs.length === 1 ? " рисунок" : " рисунк(ов)") + "</div>" +
      manualLinks(s) + body;

    wireSectionView(v);
    window.scrollTo(0, 0);
  }
  function manualLinks(s) {
    var out = [];
    var r = repairLink(s.code, s.chapter), rf = manualFile("repair");
    if (r && rf) {
      out.push('<a class="man-link" target="_blank" rel="noopener" href="' + esc(rf) + "#page=" + r.page + '">' +
        "&#128214; Руководство по ремонту" + (r.exact ? " (стр. " + r.page + ")" : " — раздел (стр. " + r.page + ")") + "</a>");
    }
    if (s.chapter === "030" && manualFile("wiring")) {
      out.push('<a class="man-link" target="_blank" rel="noopener" href="' + esc(manualFile("wiring")) + '">&#9889; Электросхема 24В</a>');
    }
    return out.length ? '<div class="man-links">' + out.join("") + "</div>" : "";
  }
  function posRange(parts) {
    var refs = parts.map(function (p) { return parseInt(p.ref, 10); }).filter(function (n) { return n > 0; });
    if (!refs.length) return "—";
    return Math.min.apply(null, refs) + "–" + Math.max.apply(null, refs);
  }

  function wireSectionView(root) {
    $$(".drawing", root).forEach(function (f) {
      f.addEventListener("click", function () { openLightbox(f.getAttribute("data-src")); });
    });
    $$(".carousel", root).forEach(function (c) { initCarousel(c); });
    root.onclick = function (e) { onPartClick(e); };
  }

  function initCarousel(c) {
    var n = +c.getAttribute("data-n");
    function go(delta, e) {
      if (e) { e.stopPropagation(); }
      var i = (+c.getAttribute("data-i") + delta + n) % n;
      c.setAttribute("data-i", i);
      $$(".slide", c).forEach(function (s, k) { s.classList.toggle("on", k === i); });
      $(".ccount", c).textContent = (i + 1) + " / " + n;
    }
    $(".prev", c).addEventListener("click", function (e) { go(-1, e); });
    $(".next", c).addEventListener("click", function (e) { go(1, e); });
  }

  function onPartClick(e) {
    var jl = e.target.closest(".jump");
    if (jl) { e.preventDefault(); showSection(jl.getAttribute("data-code")); return; }
    var tog = e.target.closest(".pd-toggle");
    if (tog) {
      var det = tog.closest("tr").nextElementSibling;
      if (det && det.classList.contains("pd-row")) {
        det.hidden = !det.hidden;
        tog.classList.toggle("open", !det.hidden);
      }
      return;
    }
    var b = e.target.closest(".addbtn, .c-pn button");
    if (!b) return;
    var pn = b.getAttribute("data-pn");
    var row = b.closest("tr");
    var need = row ? row.querySelector(".need") : null;
    var qty = need ? parseInt(need.value, 10) : 1;
    var hit = findPart(pn);
    if (hit) {
      addToCart(hit.p, hit.s, qty);
      if (b.classList.contains("addbtn")) {
        b.classList.add("added");
        setTimeout(function () { b.classList.remove("added"); }, 500);
      }
    }
  }

  /* ---------------- search ---------------- */
  var searchBox = $("#search"), tmr;
  searchBox.addEventListener("input", function () { clearTimeout(tmr); tmr = setTimeout(runSearch, 140); });
  function runSearch() {
    var q = searchBox.value.trim().toLowerCase();
    var sv = $("#searchView");
    if (q.length < 2) {
      sv.hidden = true; filterSidebar("");
      if (location.hash && byCode[location.hash.replace("#", "")]) $("#sectionView").hidden = false;
      else $("#welcome").hidden = false;
      return;
    }
    filterSidebar(q);
    $("#welcome").hidden = true; $("#sectionView").hidden = true; sv.hidden = false;

    var hits = [];
    DATA.sections.forEach(function (s) {
      secParts(s).forEach(function (p) {
        if ((p.pn && p.pn.toLowerCase().indexOf(q) >= 0) ||
            (p.en && p.en.toLowerCase().indexOf(q) >= 0) ||
            (p.zh && p.zh.toLowerCase().indexOf(q) >= 0)) hits.push({ p: p, s: s });
      });
    });
    var secHits = DATA.sections.filter(function (s) {
      return (s.code + " " + s.en + " " + s.zh).toLowerCase().indexOf(q) >= 0;
    });

    var html = "<h2>Поиск: «" + esc(searchBox.value.trim()) + "» — " + hits.length + " деталей</h2>";
    if (secHits.length) {
      html += '<div class="res-sec">Разделы</div>' + secHits.slice(0, 12).map(function (s) {
        return '<button class="sec-item" data-code="' + s.code + '" style="max-width:560px">' +
          '<span class="sc">' + esc(s.code) + '</span><span class="cnt">' + secParts(s).length + '</span>' +
          '<span class="sn">' + esc(s.zh) + " · " + esc(s.en) + "</span></button>";
      }).join("");
    }
    if (hits.length) {
      html += '<div class="res-sec">Детали</div><table class="parts-tbl"><thead><tr>' +
        "<th>Номер детали</th><th>Наименование</th><th>Цена, CNY</th><th>Раздел</th><th>Кол-во</th><th>Нужно</th><th></th></tr></thead><tbody>";
      html += hits.slice(0, 400).map(function (h) {
        var p = h.p, qn = parseInt(p.qty, 10); if (!(qn > 0)) qn = 1;
        var pr = priceOf(p.pn) || {};
        return "<tr>" +
          '<td class="c-pn"><button data-pn="' + esc(p.pn) + '">' + hl(p.pn, q) + "</button></td>" +
          '<td class="c-name"><div class="zh">' + hl(p.zh || p.en, q) + "</div>" +
          (p.en && p.zh ? '<div class="en">' + hl(p.en, q) + "</div>" : "") +
          (pr.n && pr.n.toUpperCase() !== (p.en || "").toUpperCase() ? '<div class="ru">' + hl(pr.n, q) + "</div>" : "") + "</td>" +
          '<td class="c-price">' + (pr.p != null ? fmtPrice(pr.p) : '<span class="dash">—</span>') + "</td>" +
          '<td class="c-jump"><a href="#' + h.s.code + '" class="jump" data-code="' + h.s.code + '">' + esc(h.s.code) + "</a></td>" +
          '<td class="c-qty">' + esc(p.qty) + "</td>" +
          '<td class="c-need"><input class="need" type="number" min="1" value="' + qn + '" data-pn="' + esc(p.pn) + '"></td>' +
          '<td class="c-add"><button class="addbtn" data-pn="' + esc(p.pn) + '">&#65291;</button></td></tr>';
      }).join("");
      html += "</tbody></table>";
      if (hits.length > 400) html += "<p class='note'>Показаны первые 400 — уточните запрос.</p>";
    }
    if (!hits.length && !secHits.length) html += "<p class='note'>Ничего не найдено.</p>";
    sv.innerHTML = html;
    sv.onclick = function (e) {
      var j = e.target.closest(".jump, .sec-item");
      if (j) { e.preventDefault(); showSection(j.getAttribute("data-code")); searchBox.value = ""; runSearch(); return; }
      onPartClick(e);
    };
  }
  function hl(txt, q) {
    txt = String(txt || ""); var i = txt.toLowerCase().indexOf(q);
    if (i < 0) return esc(txt);
    return esc(txt.slice(0, i)) + "<mark>" + esc(txt.slice(i, i + q.length)) + "</mark>" + esc(txt.slice(i + q.length));
  }
  function filterSidebar(q) {
    $$(".chap").forEach(function (ch) {
      var any = false;
      $$(".sec-item", ch).forEach(function (it) {
        var hit = !q || it.textContent.toLowerCase().indexOf(q) >= 0;
        it.style.display = hit ? "" : "none"; if (hit) any = true;
      });
      ch.style.display = any ? "" : (q ? "none" : "");
      if (q && any) ch.classList.add("open");
    });
  }

  /* ---------------- cart UI ---------------- */
  function renderCart() {
    var box = $("#cartItems"), empty = $("#cartEmpty"), keys = Object.keys(cart);
    $("#cartLines").textContent = cartLines();
    $("#cartQty").textContent = cartQty();
    $("#cartSum").textContent = fmtPrice(cartSum());
    renderAnalysis();
    var badge = $("#cartCount");
    if (cartLines()) { badge.hidden = false; badge.textContent = cartLines(); } else badge.hidden = true;
    if (!keys.length) { box.innerHTML = ""; box.style.display = "none"; empty.style.display = "flex"; return; }
    box.style.display = "block"; empty.style.display = "none";
    box.innerHTML = keys.map(function (k) {
      var c = cart[k];
      var line = c.price != null
        ? '<div class="cp">' + fmtPrice(c.price) + " × " + c.qty + " = <b>" + fmtPrice(c.price * c.qty) + "</b> CNY</div>"
        : '<div class="cp cp-no">нет цены в прайсе</div>';
      return '<div class="citem">' +
        '<div class="cn">' + esc(c.pn) + "</div>" +
        '<div class="qty"><button data-dec="' + esc(k) + '">&minus;</button>' +
        '<input type="number" min="0" value="' + c.qty + '" data-q="' + esc(k) + '">' +
        '<button data-inc="' + esc(k) + '">&#65291;</button></div>' +
        '<div class="cd">' + esc(c.ru || c.en || c.zh) + "</div>" +
        line +
        '<div class="cs">' + esc(c.sec) + " · " + esc(c.secName || "") + "</div>" +
        '<button class="rm" data-rm="' + esc(k) + '">Удалить</button></div>';
    }).join("");
  }
  // order analysis: breakdown by system (chapter), and price coverage
  function renderAnalysis() {
    var box = $("#cartAnalysis"); if (!box) return;
    var keys = Object.keys(cart);
    if (!keys.length) { box.innerHTML = ""; return; }
    var byChap = {}, priced = 0, unpriced = 0;
    keys.forEach(function (k) {
      var c = cart[k], s = byCode[c.sec], ch = s ? s.chapter : "—";
      var g = byChap[ch] || (byChap[ch] = { lines: 0, qty: 0, sum: 0 });
      g.lines += 1; g.qty += c.qty;
      if (c.price != null) { g.sum += c.price * c.qty; priced += 1; } else unpriced += 1;
    });
    var rows = Object.keys(byChap).sort().map(function (ch) {
      var g = byChap[ch];
      var c = DATA.chapters.filter(function (x) { return x.code === ch; })[0];
      var label = c ? c.code + " · " + (c.en || c.zh) : ch;
      return '<div class="an-row"><span>' + esc(label) + "</span>" +
        '<span>' + g.lines + " поз. · " + (g.sum ? fmtPrice(g.sum) + " CNY" : "—") + "</span></div>";
    }).join("");
    box.innerHTML = '<details class="an-box"><summary>Анализ заказа · по системам' +
      " · с ценой " + priced + " / без цены " + unpriced + "</summary>" + rows + "</details>";
  }

  $("#cartItems").addEventListener("click", function (e) {
    var t = e.target;
    if (t.dataset.inc) setQty(t.dataset.inc, cart[t.dataset.inc].qty + 1);
    else if (t.dataset.dec) setQty(t.dataset.dec, cart[t.dataset.dec].qty - 1);
    else if (t.dataset.rm) setQty(t.dataset.rm, 0);
  });
  $("#cartItems").addEventListener("change", function (e) {
    if (e.target.dataset.q) setQty(e.target.dataset.q, parseInt(e.target.value, 10));
  });

  /* ---------------- exports ---------------- */
  function orderRows() { return Object.keys(cart).map(function (k) { return cart[k]; }); }
  function csv(v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function download(name, text, mime) {
    var b = new Blob([text], { type: mime + ";charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }
  $("#exportCsv").addEventListener("click", function () {
    var rows = orderRows(); if (!rows.length) { toast("Корзина пуста"); return; }
    var serial = $("#serial").value.trim(), cust = $("#customer").value.trim();
    var out = ["NTE200 Parts Order", "Serial No.," + csv(serial)];
    if (cust) out.push("Customer/Note," + csv(cust));
    out.push("Date," + new Date().toISOString().slice(0, 10), "");
    out.push("Артикул,Кол-во,Цена CNY без НДС,Сумма CNY,Наименование (RU),Description (EN),Description (ZH),Группа,Взаимозаменяемый артикул,Раздел");
    rows.forEach(function (c) {
      var sum = c.price != null ? (c.price * c.qty) : "";
      out.push([csv(c.pn), c.qty, (c.price == null ? "" : c.price), sum,
        csv(c.ru), csv(c.en), csv(c.zh), csv(c.grp), csv(c.xref), csv(c.sec)].join(","));
    });
    out.push("", "Итого CNY без НДС," + cartSum());
    download("NTE200_order_" + new Date().toISOString().slice(0, 10) + ".csv", "﻿" + out.join("\r\n"), "text/csv");
  });
  $("#printOrder").addEventListener("click", function () {
    var rows = orderRows(); if (!rows.length) { toast("Корзина пуста"); return; }
    var serial = esc($("#serial").value.trim()), cust = esc($("#customer").value.trim());
    var old = $("#printArea"); if (old) old.remove();
    var d = document.createElement("div"); d.id = "printArea";
    d.innerHTML = "<h1 style='font-size:18px'>NTE200 — Заявка на запчасти / Parts Order</h1>" +
      "<p>Serial No.: <b>" + (serial || "____________") + "</b>" + (cust ? " | " + cust : "") +
      " | Дата: " + new Date().toLocaleDateString() + "</p>" +
      "<table border='1' cellspacing='0' cellpadding='5' style='border-collapse:collapse;width:100%;font-size:12px'>" +
      "<thead><tr><th>№</th><th>Артикул</th><th>Наименование</th><th>Кол-во</th>" +
      "<th>Цена CNY</th><th>Сумма CNY</th><th>Раздел</th></tr></thead><tbody>" +
      rows.map(function (c, i) {
        var sum = c.price != null ? fmtPrice(c.price * c.qty) : "—";
        return "<tr><td>" + (i + 1) + "</td><td>" + esc(c.pn) + "</td><td>" + esc(c.ru || c.en || c.zh) +
          "</td><td align='center'>" + c.qty + "</td><td align='right'>" + (c.price != null ? fmtPrice(c.price) : "—") +
          "</td><td align='right'>" + sum + "</td><td>" + esc(c.sec) + "</td></tr>";
      }).join("") + "</tbody></table><p style='margin-top:10px;font-size:12px'>Позиций: " + rows.length +
      " &nbsp; Всего шт.: " + cartQty() + " &nbsp; <b>Итого: " + fmtPrice(cartSum()) + " CNY без НДС</b></p>";
    document.body.appendChild(d); window.print();
  });
  function catalogOf(chapter) {
    var ch = String(chapter);
    return ch === "600" ? "GE" : (/^Q/.test(ch) ? "Cummins" : "NTE200");
  }
  function exportAllNumbers() {
    var uniq = {};
    DATA.sections.forEach(function (s) {
      var src = catalogOf(s.chapter);
      secParts(s).forEach(function (p) {
        if (!p.pn) return;
        var u = uniq[p.pn] || (uniq[p.pn] = { pn: p.pn, en: p.en, zh: p.zh, secs: {}, src: {} });
        u.secs[s.code] = 1; u.src[src] = 1;
        if (!u.en && p.en) u.en = p.en;
        if (!u.zh && p.zh) u.zh = p.zh;
      });
    });
    var keys = Object.keys(uniq).sort();
    // include the catalog flag (NTE200/GE/Cummins) and all price-list analytics
    var out = ["Артикул,Каталог,Наименование (RU),Description (EN),Description (ZH)," +
      "Цена CNY без НДС,Группа,Взаимозаменяемый артикул,Разделы"];
    keys.forEach(function (k) {
      var u = uniq[k], pr = priceOf(k) || {};
      out.push([csv(u.pn), Object.keys(u.src).sort().join("/"), csv(pr.n || ""), csv(u.en), csv(u.zh),
        (pr.p == null ? "" : pr.p), csv(pr.g || ""), csv(pr.x || ""),
        csv(Object.keys(u.secs).sort().join(" "))].join(","));
    });
    download("NTE200_all_part_numbers.csv", "﻿" + out.join("\r\n"), "text/csv");
    toast("Экспортировано номеров: " + keys.length);
  }
  $("#exportAll").addEventListener("click", exportAllNumbers);
  $("#exportAll2").addEventListener("click", exportAllNumbers);
  $("#clearCart").addEventListener("click", function () {
    if (cartLines() && confirm("Очистить весь заказ?")) { cart = {}; persist(); renderCart(); }
  });

  /* ---------------- check by list ---------------- */
  // one merged record per catalog part number, plus normalized/cross-ref lookups
  var PN_INDEX, PN_NORM, PN_XREF;
  function normPn(s) {
    return String(s == null ? "" : s).toUpperCase().replace(/[\s ]+/g, "");
  }
  function buildPnIndex() {
    if (PN_INDEX) return;
    PN_INDEX = {}; PN_NORM = {}; PN_XREF = {};
    DATA.sections.forEach(function (s) {
      var src = catalogOf(s.chapter);
      secParts(s).forEach(function (p) {
        if (!p.pn) return;
        var u = PN_INDEX[p.pn] || (PN_INDEX[p.pn] =
          { pn: p.pn, en: "", zh: "", wt: "", dim: "", secs: {}, src: {} });
        u.secs[s.code] = 1; u.src[src] = 1;
        if (!u.en && p.en) u.en = p.en;
        if (!u.zh && p.zh) u.zh = p.zh;
        if (p.d) {
          if (!u.wt && p.d.wt && p.d.wt !== "0" && p.d.wt !== "0.0") u.wt = p.d.wt;
          if (!u.dim && p.d.dim) u.dim = p.d.dim;
        }
      });
    });
    Object.keys(PN_INDEX).forEach(function (pn) { PN_NORM[normPn(pn)] = pn; });
    // interchangeable article -> catalog part number (only if the article itself
    // isn't already a catalog number, and the target part is in the catalog)
    Object.keys(PRICES).forEach(function (pn) {
      var x = PRICES[pn] && PRICES[pn].x;
      if (!x || !PN_INDEX[pn]) return;
      var nx = normPn(x);
      if (!PN_NORM[nx] && !PN_XREF[nx]) PN_XREF[nx] = pn;
    });
  }
  function resolvePn(token) {
    var nt = normPn(token);
    if (!nt) return null;
    if (PN_NORM[nt]) return { pn: PN_NORM[nt], via: "ok" };
    if (PN_XREF[nt]) return { pn: PN_XREF[nt], via: "xref" };
    return null;
  }
  // split pasted text / file into ordered, de-duplicated part-number tokens.
  // Each line may be one cell or a copied Excel row; the number is the first
  // word of each comma/semicolon/tab-separated cell.
  function parseTokens(text) {
    var seen = {}, out = [];
    String(text || "").split(/[\r\n]+/).forEach(function (line) {
      line.split(/[,;\t]+/).forEach(function (cell) {
        var tok = cell.trim().split(/\s+/)[0];
        if (!tok) return;
        var key = normPn(tok);
        if (!key || seen[key]) return;
        seen[key] = 1; out.push(tok.trim());
      });
    });
    return out;
  }
  var lastCheck = [];
  function runCheck() {
    buildPnIndex();
    var tokens = parseTokens($("#checkText").value);
    var results = tokens.map(function (tok) {
      var hit = resolvePn(tok);
      if (!hit) return { input: tok, status: "miss" };
      var u = PN_INDEX[hit.pn], pr = priceOf(hit.pn) || {};
      return { input: tok, status: hit.via, pn: hit.pn,
        src: Object.keys(u.src).sort().join("/"),
        ru: pr.n || "", en: u.en, zh: u.zh,
        price: pr.p != null ? pr.p : null, grp: pr.g || "", xref: pr.x || "",
        wt: u.wt || "", dim: u.dim || "", secs: Object.keys(u.secs).sort() };
    });
    lastCheck = results;
    renderCheck(results);
  }
  function renderCheck(results) {
    var sum = $("#checkSummary"), box = $("#checkResults"), foot = $("#checkFoot");
    if (!results.length) {
      sum.hidden = true; foot.hidden = true;
      box.innerHTML = '<div class="check-empty">Введите номера деталей и нажмите «Проверить».</div>';
      return;
    }
    var found = results.filter(function (r) { return r.status !== "miss"; }).length;
    var miss = results.length - found;
    sum.hidden = false;
    sum.innerHTML = '<span class="chip">Всего: <b>' + results.length + "</b></span>" +
      '<span class="chip ok">Найдено: <b>' + found + "</b></span>" +
      '<span class="chip miss">Не найдено: <b>' + miss + "</b></span>";
    var rows = results.map(function (r, i) {
      if (r.status === "miss") {
        return '<tr class="miss"><td>' + (i + 1) + '</td><td class="k-pn">' + esc(r.input) + "</td>" +
          '<td><span class="badge no">нет в каталоге</span></td>' +
          '<td colspan="11" class="check-empty">Позиция не найдена в каталоге</td></tr>';
      }
      var badge = r.status === "xref"
        ? '<span class="badge xref" title="Найдено по взаимозаменяемому артикулу">взаимозам. → ' + esc(r.pn) + "</span>"
        : '<span class="badge ok">в каталоге</span>';
      var secs = r.secs.slice(0, 8).map(function (c) {
        return '<a href="#' + esc(c) + '" class="jump" data-code="' + esc(c) + '">' + esc(c) + "</a>";
      }).join(" ") + (r.secs.length > 8 ? " +" + (r.secs.length - 8) : "");
      return "<tr><td>" + (i + 1) + '</td><td class="k-pn">' + esc(r.input) + "</td>" +
        "<td>" + badge + '</td><td class="k-pn">' + esc(r.pn) + "</td>" +
        '<td class="k-src">' + esc(r.src) + "</td>" +
        "<td>" + esc(r.ru) + "</td><td>" + esc(r.en) + "</td><td>" + esc(r.zh) + "</td>" +
        '<td class="k-price">' + (r.price != null ? fmtPrice(r.price) : "—") + "</td>" +
        "<td>" + esc(r.grp) + "</td><td>" + esc(r.xref) + "</td>" +
        '<td class="k-wt">' + esc(r.wt) + "</td><td>" + esc(r.dim) + "</td>" +
        '<td class="k-secs">' + secs + "</td></tr>";
    }).join("");
    box.innerHTML = '<table class="check-tbl"><thead><tr>' +
      "<th>№</th><th>Запрос</th><th>Статус</th><th>Артикул в каталоге</th><th>Каталог</th>" +
      "<th>Наименование (RU)</th><th>EN</th><th>ZH</th><th>Цена, CNY</th><th>Группа</th>" +
      "<th>Взаимозам.</th><th>Масса, кг</th><th>Габариты, мм</th><th>Разделы</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table>";
    foot.hidden = false;
    box.onclick = function (e) {
      var j = e.target.closest(".jump");
      if (j) { e.preventDefault(); showSection(j.getAttribute("data-code")); closeCheck(); }
    };
  }
  function exportCheck() {
    if (!lastCheck.length) { toast("Список пуст"); return; }
    var out = ["Запрос,Статус,Артикул в каталоге,Каталог,Наименование (RU)," +
      "Description (EN),Description (ZH),Цена CNY без НДС,Группа," +
      "Взаимозаменяемый артикул,Масса кг,Габариты мм,Разделы"];
    var st = { ok: "в каталоге", xref: "взаимозаменяемый", miss: "нет в каталоге" };
    lastCheck.forEach(function (r) {
      out.push([csv(r.input), st[r.status] || r.status, csv(r.pn || ""), csv(r.src || ""),
        csv(r.ru || ""), csv(r.en || ""), csv(r.zh || ""),
        (r.price == null ? "" : r.price), csv(r.grp || ""), csv(r.xref || ""),
        csv(r.wt || ""), csv(r.dim || ""),
        csv((r.secs || []).join(" "))].join(","));
    });
    download("NTE200_check_" + new Date().toISOString().slice(0, 10) + ".csv", "﻿" + out.join("\r\n"), "text/csv");
    toast("Экспортировано строк: " + lastCheck.length);
  }
  function addFoundToCart() {
    var n = 0;
    lastCheck.forEach(function (r) {
      if (r.status === "miss") return;
      var hit = findPart(r.pn);
      if (hit) { addToCart(hit.p, hit.s, 1); n++; }
    });
    if (n) { toast("Добавлено в заказ: " + n); openCart(); } else toast("Нет найденных позиций");
  }
  var checkEl = $("#check"), checkScrim = $("#checkScrim");
  function openCheck() { checkEl.classList.add("open"); checkScrim.classList.add("show"); if (!lastCheck.length) renderCheck([]); }
  function closeCheck() { checkEl.classList.remove("open"); checkScrim.classList.remove("show"); }
  $("#checkBtn").addEventListener("click", openCheck);
  var checkBtn2 = $("#checkBtn2"); if (checkBtn2) checkBtn2.addEventListener("click", openCheck);
  $("#checkClose").addEventListener("click", closeCheck);
  checkScrim.addEventListener("click", closeCheck);
  $("#checkRun").addEventListener("click", runCheck);
  $("#checkExport").addEventListener("click", exportCheck);
  $("#checkAddFound").addEventListener("click", addFoundToCart);
  $("#checkClear").addEventListener("click", function () {
    $("#checkText").value = ""; lastCheck = []; renderCheck([]);
  });
  $("#checkFile").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var t = String(rd.result || "");
      var cur = $("#checkText").value;
      $("#checkText").value = cur ? cur.replace(/\s*$/, "") + "\n" + t : t;
      runCheck();
    };
    rd.readAsText(f);
    e.target.value = "";
  });

  /* ---------------- lightbox ---------------- */
  var lb = $("#lightbox"), lbImg = $("#lbImg"), lbStage = $("#lbStage");
  var scale = 1, tx = 0, ty = 0, drag = false, sx = 0, sy = 0;
  function applyLb() { lbImg.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")"; }
  function openLightbox(src) { lbImg.src = src; scale = 1; tx = 0; ty = 0; applyLb(); lb.hidden = false; }
  function closeLb() { lb.hidden = true; lbImg.src = ""; }
  $("#lbClose").addEventListener("click", closeLb);
  lb.addEventListener("click", function (e) { if (e.target === lb || e.target === lbStage) closeLb(); });
  lbStage.addEventListener("wheel", function (e) {
    e.preventDefault(); scale = Math.min(8, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    if (scale === 1) { tx = 0; ty = 0; } applyLb();
  }, { passive: false });
  lbStage.addEventListener("mousedown", function (e) { drag = true; sx = e.clientX - tx; sy = e.clientY - ty; lbStage.style.cursor = "grabbing"; });
  window.addEventListener("mousemove", function (e) { if (!drag) return; tx = e.clientX - sx; ty = e.clientY - sy; applyLb(); });
  window.addEventListener("mouseup", function () { drag = false; lbStage.style.cursor = "grab"; });
  lbStage.addEventListener("dblclick", function () { scale = scale > 1 ? 1 : 2.5; if (scale === 1) { tx = 0; ty = 0; } applyLb(); });
  var pts = {}, pd = 0, ps = 1;
  lbStage.addEventListener("touchstart", function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) pts[e.changedTouches[i].identifier] = e.changedTouches[i];
    var ks = Object.keys(pts);
    if (ks.length === 2) { pd = dist(pts[ks[0]], pts[ks[1]]); ps = scale; }
    else if (ks.length === 1) { drag = true; sx = e.touches[0].clientX - tx; sy = e.touches[0].clientY - ty; }
  }, { passive: false });
  lbStage.addEventListener("touchmove", function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) if (pts[e.changedTouches[i].identifier]) pts[e.changedTouches[i].identifier] = e.changedTouches[i];
    var ks = Object.keys(pts);
    if (ks.length === 2) { scale = Math.min(8, Math.max(1, ps * dist(pts[ks[0]], pts[ks[1]]) / pd)); applyLb(); }
    else if (ks.length === 1 && drag && scale > 1) { tx = e.touches[0].clientX - sx; ty = e.touches[0].clientY - sy; applyLb(); }
  }, { passive: false });
  lbStage.addEventListener("touchend", function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) delete pts[e.changedTouches[i].identifier];
    if (!Object.keys(pts).length) drag = false;
  });
  function dist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeLb(); closeCart(); closeDocs(); closeCheck(); } });

  /* ---------------- drawers ---------------- */
  var cartEl = $("#cart"), cartScrim = $("#cartScrim");
  function openCart() { cartEl.classList.add("open"); cartScrim.classList.add("show"); }
  function closeCart() { cartEl.classList.remove("open"); cartScrim.classList.remove("show"); }
  $("#cartBtn").addEventListener("click", openCart);
  $("#cartClose").addEventListener("click", closeCart);
  cartScrim.addEventListener("click", closeCart);
  /* ---------------- documents drawer ---------------- */
  function renderDocs() {
    var box = $("#docsBody");
    var cards = MANUALS.files.map(function (f) {
      return '<a class="doc-card" target="_blank" rel="noopener" href="' + esc(f.file) + '">' +
        '<div class="dc-title">' + esc(f.title) + "</div>" +
        '<div class="dc-desc">' + esc(f.desc) + "</div>" +
        '<div class="dc-meta">' + f.pages + " стр. · PDF · открыть &#8599;</div></a>";
    }).join("");
    var rf = manualFile("repair");
    var toc = MANUALS.repairToc.map(function (t) {
      return '<a class="toc-row" target="_blank" rel="noopener" href="' + esc(rf) + "#page=" + t.page + '">' +
        '<span class="tc-code">' + esc(t.code) + "</span>" +
        '<span class="tc-name">' + esc(t.title) + "</span>" +
        '<span class="tc-page">стр. ' + t.page + "</span></a>";
    }).join("");
    var wf = manualFile("wiring");
    var wir = MANUALS.wiring.map(function (w) {
      return '<a class="toc-row" target="_blank" rel="noopener" href="' + esc(wf) + "#page=" + w.page + '">' +
        '<span class="tc-name">' + esc(w.title) + "</span>" +
        '<span class="tc-page">стр. ' + w.page + "</span></a>";
    }).join("");
    box.innerHTML = '<div class="doc-cards">' + cards + "</div>" +
      (toc ? '<details class="doc-sec" open><summary>Разделы руководства по ремонту (' + MANUALS.repairToc.length + ")</summary>" +
        '<div class="toc-list">' + toc + "</div></details>" : "") +
      (wir ? '<details class="doc-sec"><summary>Схемы электрооборудования 24В (' + MANUALS.wiring.length + ")</summary>" +
        '<div class="toc-list">' + wir + "</div></details>" : "");
  }
  var docsEl = $("#docs"), docsScrim = $("#docsScrim");
  function openDocs() { renderDocs(); docsEl.classList.add("open"); docsScrim.classList.add("show"); }
  function closeDocs() { docsEl.classList.remove("open"); docsScrim.classList.remove("show"); }
  $("#docsBtn").addEventListener("click", openDocs);
  var docsBtn2 = $("#docsBtn2"); if (docsBtn2) docsBtn2.addEventListener("click", openDocs);
  $("#docsClose").addEventListener("click", closeDocs);
  docsScrim.addEventListener("click", closeDocs);

  var sb = $("#sidebar"), scrim = $("#scrim");
  function openSidebar() { sb.classList.add("open"); scrim.classList.add("show"); }
  function closeSidebar() { sb.classList.remove("open"); scrim.classList.remove("show"); }
  $("#menuBtn").addEventListener("click", openSidebar);
  scrim.addEventListener("click", closeSidebar);

  /* ---------------- misc ---------------- */
  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add("show");
    clearTimeout(toastEl._t); toastEl._t = setTimeout(function () { toastEl.classList.remove("show"); }, 1400);
  }
  function flashCount() {
    var b = $("#cartCount"); b.style.transform = "scale(1.4)";
    setTimeout(function () { b.style.transform = ""; }, 160);
  }

  /* ---------------- init ---------------- */
  $("#sSections").textContent = DATA.stats.sections;
  $("#sParts").textContent = DATA.stats.parts;
  $("#sDraws").textContent = DATA.sections.reduce(function (a, s) { return a + secImages(s).length; }, 0);
  buildSidebar();
  renderCart();
  var initial = location.hash.replace("#", "");
  if (initial && byCode[initial]) showSection(initial);
})();
