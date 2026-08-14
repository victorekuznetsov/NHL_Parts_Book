/* Каталог запасных частей Cummins — вся логика на клиенте.
   Данные лежат в engines.js + data/<ESN>.js (window.CATALOGS), поэтому
   каталог открывается двойным щелчком, без сервера. */
(function () {
"use strict";

var ENGINES = window.ENGINES || [];
var ALL = window.CATALOGS || {};
if (!ENGINES.length || !Object.keys(ALL).length) {
  document.body.innerHTML = "<p style='padding:40px'>Не найдены файлы данных каталога</p>";
  return;
}

var LS_ENG = "cummins_engine";

var C = null;          // выбранный двигатель
var byNo = {};         // номер узла -> узел
var CARDS = {};        // номер детали -> карточка
var KITS_BY_PART = {}; // номер детали -> [комплекты, в которые она входит]
var SUP_INDEX = {};    // заменённый номер -> детали, которые его заменяют
var state = { option: null, sheet: 0, cart: {}, zoom: false };

/* ---------- вспомогательное ---------- */
function $(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function money(v) {
  if (v == null || isNaN(v)) return "";
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function normNo(s) { return String(s || "").toUpperCase().replace(/[\s-]/g, ""); }
/* цена по номеру из загруженного прайса (тот же источник, что у деталей) —
   используется, в т.ч. чтобы подтянуть цену комплекта при заказе комплектом */
function priceOf(no) {
  var v = PRICES[normNo(no)];
  return (v != null && !isNaN(v)) ? v : null;
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function engineOf(esn) {
  for (var i = 0; i < ENGINES.length; i++) if (ENGINES[i].esn === esn) return ENGINES[i];
  return { esn: esn };
}
function engineLabel(e) {
  return (e.machine ? e.machine + " · " : "") + e.model + " · ESN " + e.esn;
}
function drawingSrc(esn, file) { return "drawings/" + esn + "/" + file; }
/* Фото деталей берём с публичного CDN Cummins (parts.cummins.com),
   чтобы не тащить в деплой ~19 000 файлов. Имя файла начинается с номера
   детали: 3639541_iso.png -> /graphics/parts/363/3639541/3639541_iso.png.
   Если фото недоступно, onerror в разметке прячет картинку. */
function photoSrc(esn, file) {
  var num = String(file).split("_")[0];
  if (!num) return "";
  // Go through our own origin (/api/photo) so photos load even when the client
  // network can't reach parts.cummins.com directly; the server fetches the CDN.
  return "/api/photo?n=" + num + "&f=" + encodeURIComponent(file);
}

/* ---------- корзина (своя для каждого двигателя) ---------- */
function cartKey() { return "cummins_cart_" + C.esn; }
function serialKey() { return "cummins_serial_" + C.esn; }
function loadCart() {
  try { return JSON.parse(localStorage.getItem(cartKey())) || {}; } catch (e) { return {}; }
}
function saveCart() {
  try { localStorage.setItem(cartKey(), JSON.stringify(state.cart)); } catch (e) {}
  renderCartCount();
}

/* ---------- выбор двигателя ---------- */
function buildEngineSelect() {
  var sel = $("engine-select");
  sel.innerHTML = "";
  ENGINES.forEach(function (e) {
    var o = el("option", null, engineLabel(e));
    o.value = e.esn;
    sel.appendChild(o);
  });
  sel.onchange = function () { selectEngine(this.value); };
  sel.disabled = ENGINES.length < 2;
}

function selectEngine(esn) {
  if (!ALL[esn]) esn = ENGINES[0].esn;
  C = ALL[esn];
  try { localStorage.setItem(LS_ENG, esn); } catch (e) {}
  $("engine-select").value = esn;

  byNo = {};
  C.options.forEach(function (o) { byNo[o.no] = o; });
  CARDS = C.cards || {};

  // обратный индекс: деталь -> комплекты, в которые она входит (первый элемент
  // parts у комплекта — сам комплект, его пропускаем)
  KITS_BY_PART = {};
  (C.kits || []).forEach(function (kit) {
    (kit.parts || []).forEach(function (kp) {
      if (kp.no && kp.no !== kit.no) {
        var arr = KITS_BY_PART[kp.no] || (KITS_BY_PART[kp.no] = []);
        if (arr.indexOf(kit) < 0) arr.push(kit);
      }
    });
  });

  /* Индекс замен: любой номер из цепочки (в т.ч. снятый с производства)
     ведёт на деталь, которая есть в каталоге — так находится и «старый» номер. */
  SUP_INDEX = {};
  Object.keys(CARDS).forEach(function (pn) {
    (CARDS[pn].sup || []).forEach(function (s) {
      if (!s.no || s.no === pn) return;
      (SUP_INDEX[normNo(s.no)] = SUP_INDEX[normNo(s.no)] || []).push({ pn: pn, s: s });
    });
  });

  state.option = null; state.sheet = 0;
  state.cart = loadCart();

  renderPassport();
  renderTree();
  renderCartCount();
  $("search").value = "";
  show("view-welcome");
}

/* Действующий номер: цепочка отсортирована от старого к новому,
   последний элемент — актуальный. */
function currentNo(pn) {
  var chain = (CARDS[pn] || {}).sup || [];
  if (chain.length < 2) return "";
  var last = chain[chain.length - 1];
  return last && last.no !== pn ? last.no : "";
}

/* ---------- паспорт двигателя ---------- */
function renderPassport() {
  var e = engineOf(C.esn);
  var rows = [
    ["Машина", e.machine],
    ["Серийный номер (ESN)", C.esn],
    ["Модель", C.model],
    ["CPL", C.cpl],
    ["Дата сборки", C.buildDate],
    ["Конфигурация", C.config],
    ["Группа", C.group],
    ["Код завода", C.plant]
  ];
  var p = $("passport");
  p.innerHTML = "";
  rows.forEach(function (r) {
    if (!r[1]) return;
    var d = el("div");
    d.appendChild(el("span", null, r[0] + ": "));
    d.appendChild(el("b", null, String(r[1])));
    p.appendChild(d);
  });
  if (e.fleet && e.fleet.length) {
    var d = el("div");
    d.appendChild(el("span", null, "Тот же CPL ещё у машин: "));
    d.appendChild(el("b", null, e.fleet.length));
    d.title = e.fleet.join(", ");
    p.appendChild(d);
  }
  $("serial").value = localStorage.getItem(serialKey()) || C.esn;
}

/* ---------- дерево систем ---------- */
function renderTree() {
  var tree = $("tree");
  tree.innerHTML = "";
  C.systems.forEach(function (s) {
    var box  = el("div", "tree-sys");
    var head = el("div", "tree-sys-head");
    head.appendChild(el("span", null, s.name));
    head.appendChild(el("span", "cnt", s.options.length));
    head.onclick = function () { box.classList.toggle("open"); };
    box.appendChild(head);

    var list = el("div", "tree-opts");
    s.options.forEach(function (no) {
      var o = byNo[no];
      if (!o) return;
      var a = el("div", "tree-opt");
      a.appendChild(el("span", null, o.name));
      a.appendChild(el("span", "no", no + " · позиций: " + o.parts.length));
      a.dataset.no = no;
      a.onclick = function () { openOption(no); };
      list.appendChild(a);
    });
    box.appendChild(list);
    tree.appendChild(box);
  });
}

function highlightTree(no) {
  Array.prototype.forEach.call(document.querySelectorAll(".tree-opt"), function (a) {
    a.classList.toggle("active", a.dataset.no === no);
  });
  var active = document.querySelector('.tree-opt[data-no="' + no + '"]');
  if (active) {
    var sys = active.closest(".tree-sys");
    if (sys && !sys.classList.contains("open")) sys.classList.add("open");
    active.scrollIntoView({ block: "nearest" });
  }
}

/* ---------- показ узла ---------- */
function show(view) {
  ["view-welcome", "view-search", "view-option", "view-kits"].forEach(function (v) {
    $(v).classList.toggle("hidden", v !== view);
  });
}

function openOption(no, focusPart) {
  var o = byNo[no];
  if (!o) return;
  state.option = o; state.sheet = 0; state.zoom = false;
  show("view-option");
  highlightTree(no);

  $("opt-name").textContent = o.name;
  var meta = "Вариант исполнения " + o.no + " · позиций: " + o.parts.length;
  if (o.systems && o.systems.length) meta += " · система: " + o.systems.join(", ");
  $("opt-meta").textContent = meta;

  var rem = $("opt-remarks");
  if (o.remarks) { rem.textContent = o.remarks.replace(/\|/g, "\n"); rem.classList.remove("hidden"); }
  else rem.classList.add("hidden");

  renderSheets(o);
  renderParts(o, focusPart);
  window.scrollTo(0, 0);
}

function renderSheets(o) {
  var img = $("drawing"), car = $("carousel"), hint = $("drawing-hint");
  var wrap = img.parentNode;
  var old = wrap.querySelector(".no-drawing");
  if (old) wrap.removeChild(old);

  if (!o.sheets.length) {
    img.classList.add("hidden");
    car.classList.add("hidden");
    wrap.appendChild(el("div", "no-drawing",
      "Для этого узла Cummins не публикует чертёж — список позиций приведён справа."));
    hint.textContent = "";
    return;
  }
  img.classList.remove("hidden");
  img.classList.remove("zoomed");
  img.src = drawingSrc(C.esn, o.sheets[state.sheet]);
  img.alt = "Чертёж узла " + o.no;
  car.classList.toggle("hidden", o.sheets.length < 2);
  $("sheet-label").textContent = "Лист " + (state.sheet + 1) + " из " + o.sheets.length;
  hint.textContent = "Номер на чертеже = № позиции в таблице. Щелчок по чертежу — увеличить.";
}

$("sheet-prev").onclick = function () {
  var o = state.option; if (!o || !o.sheets.length) return;
  state.sheet = (state.sheet - 1 + o.sheets.length) % o.sheets.length;
  renderSheets(o);
};
$("sheet-next").onclick = function () {
  var o = state.option; if (!o || !o.sheets.length) return;
  state.sheet = (state.sheet + 1) % o.sheets.length;
  renderSheets(o);
};
$("drawing").onclick = function () {
  state.zoom = !state.zoom;
  this.classList.toggle("zoomed", state.zoom);
};

function renderParts(o, focusPart) {
  var tb = $("parts-body");
  tb.innerHTML = "";
  o.parts.forEach(function (p, i) {
    var tr = el("tr", p.lvl ? "lvl" + Math.min(p.lvl, 2) : "");
    tr.dataset.no = p.no;
    var kitsForPart = (p.no && KITS_BY_PART[p.no]) ? KITS_BY_PART[p.no] : [];

    // «ASSEMBLY» у Cummins — строка узла в сборе, а не номер позиции на чертеже
    var isAsm = /^assembly$/i.test(p.pos || "");
    var tdPos = el("td", "c-pos" + (isAsm ? " c-asm" : ""), isAsm ? "сборка" : (p.pos || ""));
    if (isAsm) tdPos.title = "Узел в сборе (ASSEMBLY)";
    tr.appendChild(tdPos);

    var tdNo = el("td", "c-no");
    if (p.img) {
      var im = document.createElement("img");
      im.className = "pn-photo"; im.src = photoSrc(C.esn, p.img); im.alt = "";
      im.onerror = function () { this.style.display = "none"; };
      tdNo.appendChild(im);
    }
    var pnSpan = el("span", "pn", p.no || "—");
    if (p.no && CARDS[p.no]) {
      pnSpan.className = "pn pn-link";
      pnSpan.title = "Открыть карточку детали";
      pnSpan.onclick = function () { openPartCard(p.no); };
    }
    tdNo.appendChild(pnSpan);
    var newNo = p.no ? currentNo(p.no) : "";
    if (newNo) {
      var chip = el("span", "chip-sup", "→ " + newNo);
      chip.title = "Номер заменён; действующий номер " + newNo;
      tdNo.appendChild(chip);
    }
    tr.appendChild(tdNo);

    var tdName = el("td", "c-name");
    tdName.appendChild(document.createTextNode(p.name || ""));
    if (p.dim) tdName.appendChild(el("span", "dim", p.dim));
    if (p.rem) tdName.appendChild(el("span", "dim", p.rem));
    if (p.alt) tdName.appendChild(el("span", "dim", "взаимозаменяемый: " + p.alt));
    if (kitsForPart.length) {
      var note = el("div", "in-kit-note");
      note.appendChild(document.createTextNode("🧰 Можно заказать комплектом: "));
      kitsForPart.forEach(function (kit, ki) {
        if (ki) note.appendChild(document.createTextNode(", "));
        var lk = el("span", "in-kit-link", kit.no + " · " + kit.name);
        lk.title = "Открыть состав комплекта";
        lk.onclick = (function (kn) { return function () { openKitCard(kn); }; })(kit.no);
        note.appendChild(lk);
      });
      tdName.appendChild(note);
    }
    tr.appendChild(tdName);

    tr.appendChild(el("td", "c-price", p.price != null ? money(p.price) : "—"));
    tr.appendChild(el("td", "c-qty", p.qty || ""));

    var tdNeed = el("td", "c-need");
    var inp = el("input", "need-input");
    inp.type = "number"; inp.min = "0"; inp.step = "1";
    inp.value = parseInt(p.qty, 10) > 0 ? parseInt(p.qty, 10) : 1;
    tdNeed.appendChild(inp);
    tr.appendChild(tdNeed);

    var tdAdd = el("td", "c-add");
    // варианты заказа: сама деталь (если продаётся) и/или комплект(ы), в которые она входит
    var choices = [];
    if (p.no && isSellable(p.no)) choices.push({ v: "part", label: "Деталь " + p.no });
    kitsForPart.forEach(function (kit) {
      var kp = priceOf(kit.no);
      choices.push({ v: "kit:" + kit.no, kit: kit,
        label: "Комплект " + kit.no + " · " + kit.name + (kp != null ? " · " + money(kp) : "") });
    });
    function orderChoice(v, n) {
      if (v === "part") { if (p.no && isSellable(p.no)) addToCart(p, o, n); return; }
      var kit = kitByNo(v.slice(4));
      if (kit) addToCart({ no: kit.no, name: kit.name, price: priceOf(kit.no), group: "", alt: "", isKit: true },
                         { no: "KIT", name: "Комплект" }, n);
    }
    function flash(btn, label) {
      btn.textContent = "✓ добавлено"; btn.classList.add("done");
      setTimeout(function () { btn.textContent = label; btn.classList.remove("done"); }, 1200);
    }
    if (!p.no) {
      var bd = el("button", "btn-add", "＋ в заказ"); bd.disabled = true; tdAdd.appendChild(bd);
    } else if (choices.length === 0) {
      // не продаётся и не входит ни в один комплект
      var bns = el("button", "btn-add not-sold", "не продаётся");
      bns.disabled = true; bns.title = "Деталь не продаётся отдельно (Sellable: N)";
      tr.classList.add("row-not-sold");
      tdAdd.appendChild(bns);
    } else if (choices.length === 1) {
      var single = choices[0];
      var lbl = single.v === "part" ? "＋ в заказ" : "＋ комплектом";
      var b1 = el("button", "btn-add" + (single.v === "part" ? "" : " kit-add"), lbl);
      if (single.v !== "part") { tr.classList.add("row-not-sold"); b1.title = "Деталь не продаётся отдельно — заказывается комплектом"; }
      b1.onclick = function () {
        var n = parseInt(inp.value, 10); if (!(n > 0)) n = 1;
        orderChoice(single.v, n); flash(b1, lbl);
      };
      tdAdd.appendChild(b1);
    } else {
      // выбор: деталь или комплект
      var sel = el("select", "order-choice");
      choices.forEach(function (c) { var op = el("option", null, c.label); op.value = c.v; sel.appendChild(op); });
      var b2 = el("button", "btn-add", "＋ в заказ");
      b2.onclick = function () {
        var n = parseInt(inp.value, 10); if (!(n > 0)) n = 1;
        orderChoice(sel.value, n); flash(b2, "＋ в заказ");
      };
      tdAdd.appendChild(sel);
      tdAdd.appendChild(b2);
    }
    tr.appendChild(tdAdd);

    tb.appendChild(tr);
    if (focusPart && p.no === focusPart && i < 400) {
      setTimeout(function () {
        tr.scrollIntoView({ block: "center", behavior: "smooth" });
        tr.style.background = "#fff5cc";
        setTimeout(function () { tr.style.background = ""; }, 2500);
      }, 150);
    }
  });
}

/* ---------- карточка детали ---------- */
function findPart(pn) {
  for (var i = 0; i < C.options.length; i++) {
    var ps = C.options[i].parts;
    for (var j = 0; j < ps.length; j++) if (ps[j].no === pn) return ps[j];
  }
  return null;
}

function openPartCard(pn) {
  var card = CARDS[pn] || {};
  var part = findPart(pn) || {};
  $("pc-components").classList.add("hidden");   // блок состава — только у карточки комплекта
  $("pc-title").textContent = "Деталь " + pn;
  $("pc-name").textContent = part.name || "";

  var views = card.views || (part.img ? [part.img] : []);
  var main = $("pc-img"), thumbs = $("pc-thumbs");
  thumbs.innerHTML = "";
  document.querySelector(".pc-gallery").style.display = views.length ? "" : "none";
  if (views.length) {
    main.style.display = "";
    main.onerror = function () {
      this.style.display = "none";
      var g = document.querySelector(".pc-gallery"); if (g) g.style.display = "none";
    };
    main.src = photoSrc(C.esn, views[0]);
    views.forEach(function (v, i) {
      var t = document.createElement("img");
      t.src = photoSrc(C.esn, v); t.alt = "";
      if (!i) t.className = "sel";
      t.onclick = function () {
        main.src = photoSrc(C.esn, v);
        Array.prototype.forEach.call(thumbs.children, function (c) { c.className = ""; });
        t.className = "sel";
      };
      t.onerror = function () { this.style.display = "none"; };
      thumbs.appendChild(t);
    });
  }

  // замены номеров: цепочка старый -> действующий
  var chain = card.sup || [];
  var supBox = $("pc-sup"), supBody = $("pc-sup-body");
  supBody.innerHTML = "";
  if (chain.length > 1) {
    var row = el("div", "sup-chain");
    chain.forEach(function (s, i) {
      var isLast = (i === chain.length - 1);
      if (i) row.appendChild(el("span", "sup-arrow", "→"));
      var b = el("span", "sup-no " + (isLast ? "cur" : "old"), s.no);
      b.title = (s.st || "") + (s.sell ? " · продаётся" : " · не продаётся");
      if (CARDS[s.no] && s.no !== pn) b.onclick = function () { openPartCard(s.no); };
      row.appendChild(b);
    });
    supBody.appendChild(row);
    var cur = currentNo(pn), lastSt = chain[chain.length - 1];
    var note;
    if (cur) {
      note = "Номер " + pn + " заменён, действующий номер — " + cur + ".";
      if (lastSt && !lastSt.sell) {
        note += " По данным Cummins он отмечен как «" + lastSt.st +
                "» — наличие уточняйте у поставщика.";
      }
    } else {
      note = "Номер " + pn + " действующий; левее приведены заменённые им номера.";
    }
    supBody.appendChild(el("div", "sup-note", note));
    supBox.classList.remove("hidden");
  } else supBox.classList.add("hidden");

  // заказать комплектом: деталь входит в комплект(ы) — особенно важно, когда
  // сама деталь не продаётся отдельно
  var kitsBox = $("pc-kits"), kitsBody = $("pc-kits-body");
  kitsBody.innerHTML = "";
  var kits = KITS_BY_PART[pn] || [];
  if (kits.length) {
    var sellable = isSellable(pn);
    kitsBody.appendChild(el("div", "kit-intro", sellable
      ? "Деталь также поставляется в составе комплекта:"
      : "Деталь не продаётся отдельно — заказывается в составе комплекта:"));
    kits.forEach(function (kit) {
      var cnt = (kit.parts || []).filter(function (x) { return x.no && x.no !== kit.no; }).length;
      var kitPrice = priceOf(kit.no);
      var line = el("div", "kit-line");
      var info = el("div", "kit-info kit-link");
      info.title = "Открыть состав комплекта";
      info.onclick = (function (kno) { return function () { openKitCard(kno); }; })(kit.no);
      info.appendChild(el("span", "kit-no", kit.no));
      info.appendChild(document.createTextNode(" · "));
      info.appendChild(el("span", "kit-name", kit.name));
      if (cnt) info.appendChild(el("span", "kit-cnt", " · " + cnt + " поз."));
      if (kitPrice != null) info.appendChild(el("span", "kit-price", " · " + money(kitPrice)));
      line.appendChild(info);
      var kbtn = el("button", "btn-add kit-add", "＋ заказать комплектом");
      kbtn.onclick = function () {
        addToCart({ no: kit.no, name: kit.name, price: priceOf(kit.no), group: "", alt: "", isKit: true },
                  { no: "KIT", name: "Комплект" }, 1);
        kbtn.textContent = "✓ добавлено"; kbtn.classList.add("done");
        setTimeout(function () { kbtn.textContent = "＋ заказать комплектом"; kbtn.classList.remove("done"); }, 1200);
      };
      line.appendChild(kbtn);
      kitsBody.appendChild(line);
    });
    kitsBox.classList.remove("hidden");
  } else kitsBox.classList.add("hidden");

  // характеристики
  var attrs = card.attrs || {};
  var at = $("pc-attrs"), atb = $("pc-attrs-body");
  atb.innerHTML = "";
  if (part.qty) addAttr(atb, "Количество на схеме", part.qty);
  if (part.dim) addAttr(atb, "Типоразмер", part.dim);
  if (card.wt) addAttr(atb, "Масса, кг", card.wt);
  if (card.dim) addAttr(atb, "Габариты Д×Ш×В, мм", card.dim);
  // размеры и массу уже показали в метрических единицах — дюймы/фунты не дублируем
  var SKIP = { "Length": 1, "Width": 1, "Height": 1, "Weight": 1 };
  var RU = { "Sellable": "Продаётся отдельно", "Hazardous Material": "Опасный груз" };
  Object.keys(attrs).forEach(function (k) {
    if (SKIP[k]) return;
    var v = attrs[k];
    if (k === "Sellable") v = (v === "Y" ? "да" : "нет");
    addAttr(atb, RU[k] || k, v);
  });
  if (card.recon) addAttr(atb, "Аналог Recon", card.recon);
  at.classList.toggle("hidden", !atb.children.length);

  // где применяется
  var used = card.used || [];
  var ub = $("pc-used-body");
  ub.innerHTML = "";
  used.forEach(function (u) {
    ub.appendChild(el("span", null, u.o + (u.n ? " · " + u.n : "")));
  });
  $("pc-used").classList.toggle("hidden", !used.length);

  $("part-card").classList.remove("hidden");
  $("part-overlay").classList.remove("hidden");
}

function addAttr(tbl, name, value) {
  var tr = el("tr");
  tr.appendChild(el("td", null, name));
  tr.appendChild(el("td", null, String(value).trim()));
  tbl.appendChild(tr);
}

function closePartCard() {
  $("part-card").classList.add("hidden");
  $("part-overlay").classList.add("hidden");
}
$("pc-close").onclick = closePartCard;
$("part-overlay").onclick = closePartCard;

/* ---------- комплекты (kits) ---------- */
function kitByNo(no) {
  var ks = C.kits || [];
  for (var i = 0; i < ks.length; i++) if (ks[i].no === no) return ks[i];
  return null;
}
function kitComponents(kit) {
  return (kit.parts || []).filter(function (x) { return x.no && x.no !== kit.no; });
}
// кнопка «＋ заказать комплектом»: подтягивает цену комплекта из прайса
function makeKitOrderBtn(kit) {
  var btn = el("button", "btn-add kit-add", "＋ заказать комплектом");
  btn.onclick = function () {
    addToCart({ no: kit.no, name: kit.name, price: priceOf(kit.no), group: "", alt: "", isKit: true },
              { no: "KIT", name: "Комплект" }, 1);
    btn.textContent = "✓ добавлено"; btn.classList.add("done");
    setTimeout(function () { btn.textContent = "＋ заказать комплектом"; btn.classList.remove("done"); }, 1200);
  };
  return btn;
}

// карточка комплекта: цена комплекта + его составляющие (с ценами и ссылками)
function openKitCard(no) {
  var kit = kitByNo(no);
  if (!kit) { openPartCard(no); return; }
  var price = priceOf(kit.no);
  $("pc-title").textContent = "Комплект " + kit.no;
  $("pc-name").textContent = kit.name + (price != null ? "  ·  " + money(price) : "");
  // прячем блоки, относящиеся только к детали
  document.querySelector(".pc-gallery").style.display = "none";
  $("pc-sup").classList.add("hidden");
  $("pc-kits").classList.add("hidden");
  $("pc-attrs").classList.add("hidden");
  $("pc-used").classList.add("hidden");

  var comps = kitComponents(kit);
  var head = $("pc-comp-head"); head.innerHTML = "";
  head.appendChild(el("span", "comp-count",
    comps.length + " составляющих" + (price != null ? " · цена комплекта " + money(price) : " · цена уточняется")));
  head.appendChild(makeKitOrderBtn(kit));

  var tb = $("pc-comp-body"); tb.innerHTML = "";
  var htr = el("tr");
  ["№", "Номер", "Наименование", "Цена"].forEach(function (h) { htr.appendChild(el("th", null, h)); });
  tb.appendChild(htr);
  comps.forEach(function (cp, i) {
    var tr = el("tr");
    tr.appendChild(el("td", "comp-i", String(i + 1)));
    var tdNo = el("td", "comp-no");
    if (CARDS[cp.no] || findPart(cp.no)) {
      var lnk = el("span", "pn pn-link", cp.no);
      lnk.onclick = (function (n) { return function () { openPartCard(n); }; })(cp.no);
      tdNo.appendChild(lnk);
    } else tdNo.appendChild(el("span", null, cp.no));
    tr.appendChild(tdNo);
    tr.appendChild(el("td", null, cp.name || ""));
    var cpP = priceOf(cp.no);
    tr.appendChild(el("td", "comp-price", cpP != null ? money(cpP) : "—"));
    tb.appendChild(tr);
  });
  $("pc-components").classList.remove("hidden");
  $("part-card").classList.remove("hidden");
  $("part-overlay").classList.remove("hidden");
}

// отдельная страница со всеми комплектами двигателя + ссылки
function showKits() {
  closePartCard();
  var kits = (C.kits || []).slice().sort(function (a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""), "ru");
  });
  var e = engineOf(C.esn);
  $("kits-hint").textContent = "Двигатель " + (e.machine ? e.machine + " · " : "") + C.model +
    " · ESN " + C.esn + " — комплектов: " + kits.length;
  var box = $("kits-list"); box.innerHTML = "";
  kits.forEach(function (kit) {
    var comps = kitComponents(kit), price = priceOf(kit.no);
    var card = el("div", "kit-card");
    var a = el("a", "kit-card-title", kit.no + " · " + kit.name);
    a.href = "#kit-" + kit.no;
    a.onclick = function (ev) { ev.preventDefault(); openKitCard(kit.no); };
    card.appendChild(a);
    card.appendChild(el("div", "kit-card-meta",
      comps.length + " составляющих" + (price != null ? " · " + money(price) : " · цена уточняется")));
    card.appendChild(makeKitOrderBtn(kit));
    box.appendChild(card);
  });
  highlightTree(null);
  show("view-kits");
  if (window.innerWidth <= 900) { var sb = document.querySelector(".sidebar"); if (sb) sb.classList.remove("open"); }
}

// выгрузка комплектов: по строке на каждую составляющую (полный состав)
function exportKits() {
  var e = engineOf(C.esn);
  var head = ["Машина", "Модель", "ESN", "Комплект №", "Комплект — наименование", "Цена комплекта",
              "Составляющая №", "Составляющая — наименование", "Цена составляющей", "Продаётся отдельно"];
  var rows = [head];
  (C.kits || []).forEach(function (kit) {
    var comps = kitComponents(kit), kp = priceOf(kit.no);
    if (!comps.length) {
      rows.push([e.machine || "", C.model, C.esn, kit.no, kit.name, priceCsv(kp), "", "", "", ""]);
      return;
    }
    comps.forEach(function (cp) {
      rows.push([e.machine || "", C.model, C.esn, kit.no, kit.name, priceCsv(kp),
                 cp.no, cp.name || "", priceCsv(priceOf(cp.no)),
                 sellableIn(C.cards, cp.no) ? "да" : "нет"]);
    });
  });
  var tag = (e.machine ? e.machine + "_" : "") + C.model.replace(/[^\wА-Яа-я]+/g, "_") + "_" + C.esn;
  downloadCsv("komplekty_" + tag + ".csv", rows);
}
$("show-kits").onclick = showKits;
$("dl-kits").onclick = exportKits;

/* ---------- поиск (по всем двигателям каталога) ---------- */
function doSearch(q) {
  q = (q || "").trim();
  if (q.length < 2) { show("view-welcome"); return; }
  var norm = normNo(q);
  var re = new RegExp(escapeRe(q), "i");
  var hits = [];

  ENGINES.forEach(function (eng) {
    var cat = ALL[eng.esn];
    if (!cat) return;
    var cards = cat.cards || {};
    var seen = {};

    // прямые совпадения по номеру и наименованию
    cat.options.forEach(function (o) {
      o.parts.forEach(function (p) {
        var num = normNo(p.no);
        var hitNo = num && num.indexOf(norm) !== -1;
        var hitNm = p.name && re.test(p.name);
        if (!hitNo && !hitNm) return;
        var key = p.no + "|" + o.no;
        if (seen[key]) return;
        seen[key] = 1;
        hits.push({ p: p, o: o, eng: eng, exact: num === norm });
      });
    });

    // совпадения по заменённым (старым) номерам
    var viaOf = {};
    Object.keys(cards).forEach(function (pn) {
      (cards[pn].sup || []).forEach(function (s) {
        if (s.no && s.no !== pn && normNo(s.no).indexOf(norm) !== -1) viaOf[pn] = s.no;
      });
    });
    Object.keys(viaOf).forEach(function (pn) {
      cat.options.forEach(function (o) {
        o.parts.forEach(function (p) {
          if (p.no !== pn) return;
          var key = p.no + "|" + o.no;
          if (seen[key]) return;
          seen[key] = 1;
          hits.push({ p: p, o: o, eng: eng, exact: false, via: viaOf[pn] });
        });
      });
    });
  });

  hits.sort(function (a, b) {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    if (a.eng.esn !== b.eng.esn) return a.eng.esn === C.esn ? -1 : 1;
    return (a.p.no || "").localeCompare(b.p.no || "");
  });

  show("view-search");
  $("search-title").textContent = "Найдено: " + hits.length +
    (hits.length ? "" : " — попробуйте другой номер или слово");
  var box = $("search-results");
  box.innerHTML = "";
  hits.slice(0, 400).forEach(function (h) {
    var d = el("div", "search-hit");
    var no = el("span", "hit-no", h.p.no || "—");
    if (h.via) no.appendChild(el("span", "chip-sup", "вместо " + h.via));
    d.appendChild(no);
    var nm = el("span", "hit-name");
    nm.innerHTML = highlight(h.p.name || "", q);
    d.appendChild(nm);
    var where = h.o.name + " · " + h.o.no + " · поз. " + (h.p.pos || "—");
    if (h.eng.esn !== C.esn) where = (h.eng.machine || h.eng.model) + " → " + where;
    d.appendChild(el("span", "hit-where", where));
    d.onclick = function () {
      if (h.eng.esn !== C.esn) selectEngine(h.eng.esn);
      openOption(h.o.no, h.p.no);
    };
    box.appendChild(d);
  });
  if (hits.length > 400) {
    box.appendChild(el("p", "sub", "Показаны первые 400 совпадений — уточните запрос."));
  }
}

function highlight(text, q) {
  var safeText = text.replace(/[&<>]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
  });
  try {
    return safeText.replace(new RegExp("(" + escapeRe(q) + ")", "ig"), "<mark>$1</mark>");
  } catch (e) { return safeText; }
}

var searchTimer = null;
$("search").addEventListener("input", function () {
  var v = this.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function () {
    if (v.trim().length < 2) { if (state.option) openOption(state.option.no); else show("view-welcome"); }
    else doSearch(v);
  }, 200);
});
$("search-clear").onclick = function () {
  $("search").value = "";
  if (state.option) openOption(state.option.no); else show("view-welcome");
};

/* ---------- корзина ---------- */
/* Продаётся ли деталь отдельно (attrs.Sellable === "N" => нет). */
function sellableIn(cards, pn) {
  var c = cards && cards[pn];
  return !(c && c.attrs && c.attrs.Sellable === "N");
}
function isSellable(pn) { return sellableIn(CARDS, pn); }

function addToCart(p, o, n) {
  var k = p.no;
  if (!p.isKit && !isSellable(p.no)) return;   // не продаётся отдельно — в заказ не кладём
  if (!state.cart[k]) {
    state.cart[k] = { no: p.no, name: p.name, price: (p.price != null ? p.price : null),
                      group: p.group || "", alt: p.alt || "",
                      option: o.no, optionName: o.name, pos: p.pos || "", qty: 0 };
  }
  state.cart[k].qty += n;
  saveCart();
  renderCart();
}

function renderCartCount() {
  $("cart-count").textContent = Object.keys(state.cart).length;
}

function renderCart() {
  var tb = $("cart-body"), keys = Object.keys(state.cart).sort();
  tb.innerHTML = "";
  var total = 0, anyPrice = false;
  keys.forEach(function (k) {
    var it = state.cart[k];
    var tr = el("tr");
    tr.appendChild(el("td", "pn", it.no));
    var nm = el("td");
    nm.appendChild(document.createTextNode(it.name || ""));
    nm.appendChild(el("span", "dim", it.optionName + " · " + it.option + " · поз. " + it.pos));
    tr.appendChild(nm);

    var tdQ = el("td");
    var inp = el("input", "need-input");
    inp.type = "number"; inp.min = "1"; inp.step = "1"; inp.value = it.qty;
    inp.onchange = function () {
      var v = parseInt(this.value, 10);
      if (v > 0) { it.qty = v; saveCart(); renderCart(); }
      else { this.value = it.qty; }
    };
    tdQ.appendChild(inp);
    tr.appendChild(tdQ);

    var sum = (it.price != null) ? it.price * it.qty : null;
    if (sum != null) { total += sum; anyPrice = true; }
    tr.appendChild(el("td", null, sum != null ? money(sum) : "—"));

    var tdDel = el("td");
    var del = el("button", "btn-plain", "✕");
    del.title = "Убрать из заказа";
    del.onclick = function () { delete state.cart[k]; saveCart(); renderCart(); };
    tdDel.appendChild(del);
    tr.appendChild(tdDel);

    tb.appendChild(tr);
  });
  $("cart-empty").classList.toggle("hidden", keys.length > 0);
  $("cart-total").textContent = anyPrice ? money(total) : String(keys.length);
  $("cart-total-cur").textContent = anyPrice ? "" : "позиций (цены не загружены)";
  $("cart-engine").textContent = engineLabel(engineOf(C.esn));
  renderCartCount();
}

function openCart() {
  renderCart();
  $("cart").classList.remove("hidden");
  $("cart-overlay").classList.remove("hidden");
}
function closeCart() {
  $("cart").classList.add("hidden");
  $("cart-overlay").classList.add("hidden");
}
$("cart-toggle").onclick = openCart;
$("cart-close").onclick = closeCart;
$("cart-overlay").onclick = closeCart;
$("serial").addEventListener("input", function () {
  try { localStorage.setItem(serialKey(), this.value); } catch (e) {}
});
$("cart-clear").onclick = function () {
  if (!confirm("Очистить весь заказ?")) return;
  state.cart = {}; saveCart(); renderCart();
};
$("cart-print").onclick = function () { window.print(); };

$("cart-csv").onclick = function () {
  var keys = Object.keys(state.cart).sort();
  if (!keys.length) { alert("Заказ пуст"); return; }
  var e = engineOf(C.esn);
  var serial = $("serial").value || C.esn;
  var head = ["Машина", "Двигатель", "ESN", "Серийный номер", "Номер детали",
              "Наименование", "Действующий номер", "Группа", "Взаимозаменяемый артикул",
              "Узел", "Номер узла", "Позиция", "Количество", "Цена", "Сумма"];
  var lines = [head.join(";")];
  var total = 0;
  keys.forEach(function (k) {
    var it = state.cart[k];
    var sum = (it.price != null) ? it.price * it.qty : null;
    if (sum != null) total += sum;
    lines.push([e.machine || "", C.model, C.esn, serial, it.no, it.name,
                currentNo(it.no), it.group, it.alt, it.optionName, it.option,
                it.pos, it.qty,
                it.price != null ? String(it.price).replace(".", ",") : "",
                sum != null ? String(sum.toFixed(2)).replace(".", ",") : ""]
      .map(function (v) {
        v = String(v == null ? "" : v);
        return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(";"));
  });
  var tail = new Array(head.length).fill("");
  tail[5] = "ИТОГО";
  tail[head.length - 1] = total ? String(total.toFixed(2)).replace(".", ",") : "";
  lines.push(tail.join(";"));

  var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "zakaz_" + (e.machine ? e.machine + "_" : "") + serial + ".csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
};

/* ==================================================================
   ДОП. ВОЗМОЖНОСТИ: выгрузка номеров, проверка списка, цены из файла
   ================================================================== */

/* --- общий помощник выгрузки CSV (открывается в Excel) --- */
function csvCell(v) {
  v = String(v == null ? "" : v);
  return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function priceCsv(v) { return (v != null && !isNaN(v)) ? String(v).replace(".", ",") : ""; }
function downloadCsv(name, rows) {
  var text = rows.map(function (r) { return r.map(csvCell).join(";"); }).join("\r\n");
  var blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8;" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}
/* действующий номер для произвольного каталога (не только текущего) */
function curNoFor(cat, pn) {
  var chain = ((cat.cards || {})[pn] || {}).sup || [];
  if (chain.length < 2) return "";
  var last = chain[chain.length - 1];
  return last && last.no !== pn ? last.no : "";
}

/* --- «Все номера этой модели» --- */
function exportModel() {
  var e = engineOf(C.esn), map = {};
  C.options.forEach(function (o) {
    o.parts.forEach(function (p) {
      if (!p.no) return;
      var k = normNo(p.no);
      var rec = map[k] || (map[k] = { no: p.no, name: p.name || "", price: p.price, units: {} });
      if (rec.price == null && p.price != null) rec.price = p.price;
      if (!rec.name && p.name) rec.name = p.name;
      rec.units[o.no] = o.name;
    });
  });
  var keys = Object.keys(map).sort(function (a, b) { return map[a].no.localeCompare(map[b].no); });
  var head = ["Машина", "Модель", "ESN", "Номер детали", "Наименование",
              "Продаётся отдельно", "Действующий номер", "Цена", "Узлов", "Узлы"];
  var rows = [head];
  keys.forEach(function (k) {
    var r = map[k], us = Object.keys(r.units);
    rows.push([e.machine || "", C.model, C.esn, r.no, r.name,
               sellableIn(C.cards, r.no) ? "да" : "нет", currentNo(r.no),
               priceCsv(r.price), us.length,
               us.map(function (u) { return r.units[u] + " (" + u + ")"; }).join(" | ")]);
  });
  var tag = (e.machine ? e.machine + "_" : "") + C.model.replace(/[^\wА-Яа-я]+/g, "_") + "_" + C.esn;
  downloadCsv("nomera_" + tag + ".csv", rows);
}

/* --- «Все номера всех каталогов» --- */
function exportAll() {
  var head = ["Машина", "Модель", "ESN", "CPL", "Номер детали", "Наименование",
              "Продаётся отдельно", "Действующий номер", "Цена", "Узлов"];
  var rows = [head];
  ENGINES.forEach(function (eng) {
    var cat = ALL[eng.esn]; if (!cat) return;
    var map = {};
    cat.options.forEach(function (o) {
      o.parts.forEach(function (p) {
        if (!p.no) return;
        var k = normNo(p.no);
        var rec = map[k] || (map[k] = { no: p.no, name: p.name || "", price: p.price, units: {} });
        if (rec.price == null && p.price != null) rec.price = p.price;
        if (!rec.name && p.name) rec.name = p.name;
        rec.units[o.no] = 1;
      });
    });
    Object.keys(map).sort(function (a, b) { return map[a].no.localeCompare(map[b].no); })
      .forEach(function (k) {
        var r = map[k];
        rows.push([eng.machine || "", cat.model, eng.esn, cat.cpl || "", r.no, r.name,
                   sellableIn(cat.cards, r.no) ? "да" : "нет",
                   curNoFor(cat, r.no), priceCsv(r.price), Object.keys(r.units).length]);
      });
  });
  downloadCsv("nomera_vse_katalogi.csv", rows);
}
$("dl-model").onclick = exportModel;
$("dl-all").onclick = exportAll;

/* --- проверка списка номеров по всему каталогу --- */
var GIDX = null;          // глобальный индекс: прямые номера и заменённые
var checkResults = null;
function buildGlobalIndex() {
  if (GIDX) return GIDX;
  var direct = {}, via = {};
  ENGINES.forEach(function (e) {
    var cat = ALL[e.esn]; if (!cat) return;
    cat.options.forEach(function (o) {
      o.parts.forEach(function (p) {
        if (!p.no) return;
        var n = normNo(p.no), arr = direct[n] || (direct[n] = []), rec = null;
        for (var i = 0; i < arr.length; i++) {
          if (arr[i].esn === e.esn && arr[i].no === p.no) { rec = arr[i]; break; }
        }
        if (!rec) {
          rec = { esn: e.esn, machine: e.machine, model: cat.model,
                  no: p.no, cur: curNoFor(cat, p.no), units: {} };
          arr.push(rec);
        }
        rec.units[o.no] = o.name;
      });
    });
    var cards = cat.cards || {};
    Object.keys(cards).forEach(function (pn) {
      (cards[pn].sup || []).forEach(function (s) {
        if (!s.no || s.no === pn) return;
        var n = normNo(s.no);
        (via[n] || (via[n] = [])).push({ esn: e.esn, machine: e.machine,
          model: cat.model, no: pn, cur: curNoFor(cat, pn) });
      });
    });
  });
  GIDX = { direct: direct, via: via };
  return GIDX;
}
function parseNumbers(text) {
  var toks = String(text || "").split(/[\s,;]+/).map(function (t) { return t.trim(); }).filter(Boolean);
  var seen = {}, out = [];
  toks.forEach(function (t) { var k = normNo(t); if (k && !seen[k]) { seen[k] = 1; out.push(t); } });
  return out;
}
function whereList(hits, sup) {
  return hits.map(function (h) {
    var label = (h.machine ? h.machine + " · " : "") + h.model;
    if (sup) return label + " → действующий " + h.no + (h.cur && h.cur !== h.no ? " (" + h.cur + ")" : "");
    var units = Object.keys(h.units).map(function (u) { return h.units[u]; });
    var u = units.length ? " · " + units.slice(0, 4).join(", ") +
            (units.length > 4 ? " и ещё " + (units.length - 4) : "") : "";
    return label + u;
  });
}
function findOptionOfPart(esn, pn) {
  var cat = ALL[esn]; if (!cat) return null;
  for (var i = 0; i < cat.options.length; i++) {
    var ps = cat.options[i].parts;
    for (var j = 0; j < ps.length; j++) if (ps[j].no === pn) return cat.options[i].no;
  }
  return null;
}
function openHit(r) {
  var h = r.hits[0]; if (!h) return;
  closeCheck();
  if (h.esn !== C.esn) selectEngine(h.esn);
  if (r.status === "sup") {
    var loc = findOptionOfPart(h.esn, h.no);
    if (loc) openOption(loc, h.no);
  } else {
    openOption(Object.keys(h.units)[0], h.no);
  }
}
function runCheck() {
  var nums = parseNumbers($("check-input").value), idx = buildGlobalIndex();
  var results = [], cOk = 0, cSup = 0, cNo = 0;
  nums.forEach(function (raw) {
    var n = normNo(raw), d = idx.direct[n], v = idx.via[n];
    if (d && d.length) { cOk++; results.push({ raw: raw, status: "ok", hits: d }); }
    else if (v && v.length) { cSup++; results.push({ raw: raw, status: "sup", hits: v }); }
    else { cNo++; results.push({ raw: raw, status: "no", hits: [] }); }
  });
  checkResults = results;
  renderCheck(results, { ok: cOk, sup: cSup, no: cNo, total: nums.length });
  $("check-dl").disabled = !results.length;
}
function renderCheck(results, sum) {
  var s = $("check-summary"); s.innerHTML = "";
  function pill(cls, txt) { s.appendChild(el("span", "pill " + cls, txt)); }
  pill("tot", "Проверено: " + sum.total);
  pill("ok", "В каталоге: " + sum.ok);
  pill("sup", "Как заменённый: " + sum.sup);
  pill("no", "Нет: " + sum.no);
  var box = $("check-results"); box.innerHTML = "";
  if (!results.length) { box.appendChild(el("p", "sub", "Введите номера и нажмите «Проверить».")); return; }
  var tbl = el("table"), thead = el("thead"), htr = el("tr");
  ["Номер", "Статус", "Где в каталоге"].forEach(function (h) { htr.appendChild(el("th", null, h)); });
  thead.appendChild(htr); tbl.appendChild(thead);
  var tb = el("tbody");
  results.forEach(function (r) {
    var tr = el("tr", "st-" + r.status);
    tr.appendChild(el("td", "r-no", r.raw));
    var tdS = el("td");
    var label = r.status === "ok" ? "в каталоге" : r.status === "sup" ? "заменённый" : "нет в каталоге";
    tdS.appendChild(el("span", "status " + r.status, label));
    tr.appendChild(tdS);
    var tdW = el("td", "r-where");
    if (r.status === "no") tdW.textContent = "—";
    else {
      whereList(r.hits, r.status === "sup").forEach(function (t) {
        tdW.appendChild(el("div", null, t));
      });
      tr.style.cursor = "pointer";
      tr.title = "Открыть в каталоге";
      tr.onclick = function () { openHit(r); };
    }
    tr.appendChild(tdW);
    tb.appendChild(tr);
  });
  tbl.appendChild(tb); box.appendChild(tbl);
}
function downloadCheck() {
  if (!checkResults || !checkResults.length) return;
  var head = ["Номер", "Статус", "Машины и узлы", "Действующий номер"];
  var rows = [head];
  checkResults.forEach(function (r) {
    var status = r.status === "ok" ? "в каталоге" : r.status === "sup" ? "заменённый" : "нет в каталоге";
    var where = r.status === "no" ? "" : whereList(r.hits, r.status === "sup").join(" | ");
    var cur = r.status === "sup" ? (r.hits[0] ? r.hits[0].no : "") : "";
    rows.push([r.raw, status, where, cur]);
  });
  downloadCsv("proverka_spiska.csv", rows);
}
function openCheck() {
  $("check-panel").classList.remove("hidden");
  $("check-overlay").classList.remove("hidden");
  $("check-input").focus();
}
function closeCheck() {
  $("check-panel").classList.add("hidden");
  $("check-overlay").classList.add("hidden");
}
$("check-list").onclick = openCheck;
$("check-close").onclick = closeCheck;
$("check-overlay").onclick = closeCheck;
$("check-run").onclick = runCheck;
$("check-dl").onclick = downloadCheck;
$("check-reset").onclick = function () {
  $("check-input").value = ""; checkResults = null;
  $("check-results").innerHTML = ""; $("check-summary").innerHTML = "";
  $("check-dl").disabled = true;
};
$("check-file-btn").onclick = function () { $("check-file").click(); };
$("check-file").addEventListener("change", function () {
  var f = this.files && this.files[0]; if (!f) return;
  var reader = new FileReader();
  reader.onload = function () {
    var lines = String(reader.result || "").split(/\r?\n/).map(function (l) {
      var c = l.split(/[;,\t]/)[0]; return c ? c.trim() : "";
    }).filter(Boolean);
    $("check-input").value = lines.join("\n");
    runCheck();
  };
  reader.readAsText(f, "utf-8");
  this.value = "";
});

/* --- цены из файла (клиентский прайс, сохраняется в браузере) --- */
var LS_PRICES = "cummins_prices";
var PRICES = {};
try { PRICES = JSON.parse(localStorage.getItem(LS_PRICES)) || {}; } catch (e) { PRICES = {}; }
function applyPrices() {
  var has = Object.keys(PRICES).length > 0;
  ENGINES.forEach(function (e) {
    var cat = ALL[e.esn]; if (!cat) return;
    cat.options.forEach(function (o) {
      o.parts.forEach(function (p) {
        if (!p.no) return;
        var v = PRICES[normNo(p.no)];
        if (v != null) p.price = v;
      });
    });
    if (has) cat.hasPrices = true;
  });
}
function parsePriceFile(text) {
  var lines = String(text || "").split(/\r?\n/), map = {}, n = 0;
  lines.forEach(function (raw) {
    var line = raw.trim(); if (!line) return;
    var cells;
    if (line.indexOf(";") >= 0) cells = line.split(";");
    else if (line.indexOf("\t") >= 0) cells = line.split("\t");
    else if (line.indexOf(",") >= 0) cells = line.split(",");
    else cells = line.split(/\s{2,}/);
    cells = cells.map(function (c) { return c.trim().replace(/^"|"$/g, ""); });
    if (cells.length < 2) return;
    var price = null, priceIdx = -1;
    for (var i = cells.length - 1; i >= 0; i--) {
      var num = parseFloat(cells[i].replace(/[^\d.,-]/g, "").replace(/\s/g, "").replace(",", "."));
      if (isFinite(num) && num > 0) { price = num; priceIdx = i; break; }
    }
    if (price == null) return;
    var no = "";
    for (var j = 0; j < cells.length; j++) {
      if (j === priceIdx) continue;
      if (cells[j]) { no = cells[j]; break; }
    }
    if (!no) return;
    map[normNo(no)] = price; n++;
  });
  return { map: map, rows: n };
}
function countPricedInCatalog() {
  var seen = {}, n = 0;
  ENGINES.forEach(function (e) {
    var cat = ALL[e.esn]; if (!cat) return;
    cat.options.forEach(function (o) {
      o.parts.forEach(function (p) {
        if (!p.no) return;
        var k = normNo(p.no);
        if (!seen[k] && PRICES[k] != null) { seen[k] = 1; n++; }
      });
    });
  });
  return n;
}
$("update-prices").onclick = function () { $("price-file").click(); };
$("price-file").addEventListener("change", function () {
  var f = this.files && this.files[0]; if (!f) { return; }
  if (/\.xlsx?$/i.test(f.name)) {
    alert("Файл Excel (.xlsx/.xls) напрямую не читается в офлайн-каталоге.\n" +
          "Сохраните прайс как CSV (Файл → Сохранить как → CSV, разделитель «;»): " +
          "первый столбец — номер детали, последний — цена.");
    this.value = ""; return;
  }
  var reader = new FileReader();
  reader.onload = function () {
    var res = parsePriceFile(String(reader.result || ""));
    if (!res.rows) {
      alert("Не найдено пар «номер — цена».\nНужен CSV/текст: в строке номер детали и цена " +
            "(через «;», табуляцию или запятую).");
      return;
    }
    PRICES = res.map;
    try { localStorage.setItem(LS_PRICES, JSON.stringify(PRICES)); } catch (e) {}
    applyPrices();
    var inCat = countPricedInCatalog();
    if (state.option) openOption(state.option.no); else renderTree();
    renderCart();
    alert("Загружено строк с ценой: " + res.rows +
          "\nСовпало с номерами каталога: " + inCat +
          "\n\nЦены сохранены в браузере и применены ко всем двигателям.");
  };
  reader.readAsText(f, "utf-8");
  this.value = "";
});

/* --- переключатель светлой/тёмной темы (по брендбуку «Развитие») --- */
function currentTheme() { return document.documentElement.getAttribute("data-theme") || "light"; }
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("cummins_theme", t); } catch (e) {}
}
$("theme-toggle").onclick = function () {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
};

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") { closeCart(); closePartCard(); closeCheck(); }
});

/* ---------- старт ---------- */
buildEngineSelect();
applyPrices();
var saved = null;
try { saved = localStorage.getItem(LS_ENG); } catch (e) {}
// Allow deep-linking a specific engine via ?esn=<ESN> (used when the unified
// NHL catalog opens this page in an iframe for a machine's "Двигатель").
var urlEsn = null;
try { urlEsn = new URLSearchParams(location.search).get("esn"); } catch (e) {}
selectEngine(urlEsn && ALL[urlEsn] ? urlEsn : (saved && ALL[saved] ? saved : ENGINES[0].esn));
})();
