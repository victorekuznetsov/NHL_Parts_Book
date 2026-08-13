/* ============================================================
   Ограничение срока действия каталога.
   Каталог свободно открывается VALID_DAYS дней с даты издания
   (ISSUE_DATE). После этого требуется пароль (PASS_SHA256).
   Настройки задаются скриптом tools/set_catalog_password.py.

   ВНИМАНИЕ: это клиентская защита статического сайта — напоминание
   о сроке/лицензии, а не криптостойкая защита. Технически
   подготовленный пользователь может её обойти.
   ============================================================ */
(function () {
  "use strict";
  // ==== настройки доступа (см. tools/set_catalog_password.py) ====
  var ISSUE_DATE = "2026-07-31";   // дата издания (ГГГГ-ММ-ДД)
  var VALID_DAYS = 31;             // срок действия, дней (≈ 1 месяц)
  var PASS_SHA256 = "e40f67ca0d6d0460fcdc6a358c01747f1438510c6a0ed81cbb75fbc603d05397"; // sha-256 пароля
  // ===============================================================
  var LKEY = "razvitie_catalog_unlock_v1";

  // --- compact SHA-256 over the UTF-8 bytes of a string (hex out) ---
  function sha256(str) {
    function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }
    var bytes;
    if (typeof TextEncoder !== "undefined") {
      bytes = new TextEncoder().encode(str);
    } else {
      var u = unescape(encodeURIComponent(str)); bytes = [];
      for (var q = 0; q < u.length; q++) bytes.push(u.charCodeAt(q) & 0xff);
    }
    var K = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993,
      2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388,
      2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628,
      770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808,
      3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912,
      1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921,
      2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
      430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063,
      1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187,
      3204031479, 3329325298];
    var H = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924,
      528734635, 1541459225];
    var l = bytes.length, withOne = l + 1, k = (56 - withOne % 64 + 64) % 64;
    var total = withOne + k + 8, m = new Uint8Array(total);
    m.set(bytes); m[l] = 0x80;
    var bl = l * 8;
    m[total - 4] = (bl >>> 24) & 0xff; m[total - 3] = (bl >>> 16) & 0xff;
    m[total - 2] = (bl >>> 8) & 0xff; m[total - 1] = bl & 0xff;
    var w = new Array(64);
    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++)
        w[i] = (m[off + i * 4] << 24) | (m[off + i * 4 + 1] << 16) | (m[off + i * 4 + 2] << 8) | (m[off + i * 4 + 3]);
      for (i = 16; i < 64; i++) {
        var s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
        var s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var hex = "";
    for (i = 0; i < 8; i++) hex += ("00000000" + (H[i] >>> 0).toString(16)).slice(-8);
    return hex;
  }

  function expiryPassed() {
    var d = new Date(ISSUE_DATE + "T23:59:59");
    if (isNaN(d.getTime())) return false;
    d.setDate(d.getDate() + VALID_DAYS);
    return new Date() >= d;
  }

  var unlocked = false;
  try { unlocked = localStorage.getItem(LKEY) === PASS_SHA256; } catch (e) {}
  if (unlocked || !expiryPassed()) return;   // доступ разрешён

  function build() {
    var o = document.createElement("div");
    o.id = "__gate";
    o.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#2a3138;color:#fff;" +
      "display:flex;align-items:center;justify-content:center;font-family:Calibri,'Segoe UI',Arial,sans-serif";
    o.innerHTML =
      '<div style="max-width:440px;text-align:center;padding:26px">' +
      '<div style="font-size:44px">🔒</div>' +
      '<h2 style="margin:10px 0 6px;font-size:22px">Срок действия каталога истёк</h2>' +
      '<p style="color:#b9c0c6;font-size:14px;line-height:1.5">Каталог издан <b>' + ISSUE_DATE +
      "</b> и действителен " + VALID_DAYS + " дней. Для продолжения работы введите пароль." +
      '<br>Получить пароль: <a style="color:#3ef0af" href="mailto:KuznetsovVE@industrservice.ru">KuznetsovVE@industrservice.ru</a></p>' +
      '<input id="__gp" type="password" autocomplete="off" placeholder="Пароль" ' +
      'style="width:100%;height:44px;border-radius:8px;border:1px solid #4a525a;background:#222a30;color:#fff;padding:0 12px;font-size:15px;margin-top:10px">' +
      '<div id="__ge" style="color:#ff8a8a;font-size:13px;height:18px;margin:6px 0"></div>' +
      '<button id="__gb" style="width:100%;height:44px;border:none;border-radius:8px;background:#3ef0af;color:#06231a;font-weight:700;font-size:15px;cursor:pointer">Открыть каталог</button>' +
      "</div>";
    (document.body || document.documentElement).appendChild(o);
    document.documentElement.style.overflow = "hidden";
    var inp = o.querySelector("#__gp"), btn = o.querySelector("#__gb"), err = o.querySelector("#__ge");
    function tryOpen() {
      if (sha256(inp.value) === PASS_SHA256) {
        try { localStorage.setItem(LKEY, PASS_SHA256); } catch (e) {}
        o.parentNode.removeChild(o);
        document.documentElement.style.overflow = "";
      } else { err.textContent = "Неверный пароль"; inp.value = ""; inp.focus(); }
    }
    btn.addEventListener("click", tryOpen);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") tryOpen(); });
    inp.focus();
  }
  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
