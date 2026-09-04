#!/usr/bin/env python3
"""Собирает инструкции по ремонту NTE240 (`nte240/service/`) из перевода
заводского руководства «俄罗斯NTE240维修手册-2023-译文» — по одному файлу Word
на раздел каталога.

Что делает:
  1. Конвертирует главы (.doc/.docx) в HTML через LibreOffice.
  2. Из главы-оглавления берёт русские названия всех разделов и групп глав —
     ими заменяются оставшиеся с прежнего импорта китайские заголовки в
     `data/service.js`, в `service.html` и в самих страницах разделов.
  3. Добавляет страницы разделов, которых в каталоге ещё нет (их картинки
     кладёт в `service_media/<код>_<n>.<ext>`).
  4. Тексты уже существующих разделов не трогает — только заголовки.

Исходный архив (двумя частями `.zip.001` / `.zip.002`, внутри Deflate64) —
в ветке `rawdata` этого репозитория. Распаковать и запустить:

    python3 build/gen_nte240_service.py <папка с главами руководства>

Нужен LibreOffice (`soffice`) и, для распаковки архива, `zipfile-deflate64`.
"""
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M = os.path.join(ROOT, "nte240")
SERVICE_DIR = os.path.join(M, "service")
MEDIA_DIR = os.path.join(M, "service_media")

# группы глав каталога NTE240 (как в service.html)
GROUPS = {
    "000": "Общие сведения", "020": "Несущие конструкции", "030": "Электрооборудование",
    "040": "Двигатель / силовая установка", "050": "Гидросистема", "070": "Ходовая часть",
    "080": "Тормозная система", "090": "Кабина", "100": "Вспомогательные системы",
    "150": "Шины и диски", "200": "Опции", "260": "Опции",
}

# в оглавлении руководства водительское сиденье стоит под кодом 090-0070,
# а в каталоге запчастей этот раздел идёт как 260-0090 — сопоставляем вручную
OVERRIDE = {"260-0090": "Водительское сиденье и установка"}

LOGO = ('<span class="mark"><svg viewBox="0 0 196 196" width="26" height="26">'
        '<path d="M63.5941 165.078 114.786 64.5721 99.6758 31 83.5127 31 16 165.078 '
        '63.5941 165.078Z"/><path d="M107.608 118.291 152.342 118.291 179.684 64.5721 '
        '164.574 31 119.559 31 134.669 64.5721 107.608 118.291Z"/></svg></span>')


def esc(s):
    return html.escape(s, quote=False)


def strip_tags(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


# ------------------------------------------------------- конвертация глав
def convert(src_dir):
    """LibreOffice не открывает файлы с иероглифами в имени — переименовываем."""
    tmp = tempfile.mkdtemp(prefix="nte240-svc-")
    ascii_dir, html_dir = os.path.join(tmp, "in"), os.path.join(tmp, "html")
    os.makedirs(ascii_dir)
    names = {}
    for i, n in enumerate(sorted(os.listdir(src_dir))):
        if not n.lower().endswith((".doc", ".docx")):
            continue
        a = "ch%02d%s" % (i, os.path.splitext(n)[1])
        shutil.copyfile(os.path.join(src_dir, n), os.path.join(ascii_dir, a))
        names[os.path.splitext(a)[0]] = n
    if not names:
        sys.exit("В папке нет файлов .doc/.docx: " + src_dir)
    profile = os.path.join(tmp, "lo")
    subprocess.run(["soffice", "-env:UserInstallation=file://" + profile,
                    "--headless", "--norestore", "--convert-to", "html",
                    "--outdir", html_dir] +
                   [os.path.join(ascii_dir, f) for f in sorted(os.listdir(ascii_dir))],
                   check=True, stdout=subprocess.DEVNULL)
    return tmp, html_dir, names


def body_of(path):
    s = open(path, encoding="utf-8", errors="replace").read()
    b = re.search(r"(?is)<body[^>]*>(.*)</body>", s)
    b = b.group(1) if b else s
    return re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", b)


# ------------------------------------------------- оглавление руководства
def parse_toc(path):
    """Из главы-оглавления: код раздела -> русское название."""
    lines = []
    for chunk in re.split(r"(?i)</p>|<br[^>]*>|</td>|</tr>", body_of(path)):
        t = strip_tags(chunk)
        if t:
            lines.append(t)
    titles, pending = {}, []
    for t in lines:
        if re.fullmatch(r"\d{3}-\d{4}", t):
            pending.append(t)
        elif pending and not re.fullmatch(r"SM\d+|\d{3}", t):
            # названия идут следом за блоком кодов, по одному на код
            titles[pending.pop(0)] = t
    return titles


# ------------------------------------------------------- страница раздела
def blocks_of(path, code, media_prefix):
    """Абзацы и картинки главы; картинки сохраняются в service_media."""
    out, images, n = [], [], 0
    for chunk in re.split(r"(?i)</p>|<br[^>]*>|</td>|</tr>", body_of(path)):
        for src in re.findall(r'src="([^"]+)"', chunk):
            full = os.path.join(os.path.dirname(path), src)
            if not os.path.exists(full):
                continue
            # горизонтальные линейки Word — картинки высотой в 1 px, они не нужны
            if os.path.getsize(full) < 1200:
                continue
            n += 1
            name = "%s_%d%s" % (code, n, os.path.splitext(src)[1].lower())
            shutil.copyfile(full, os.path.join(MEDIA_DIR, name))
            images.append(media_prefix + name)
        t = strip_tags(chunk)
        if t:
            out.append(t)
    # в исходных файлах Word первым абзацем идёт колонтитул, и в части глав он
    # остался от другого раздела («Конструкционные детали - топливный бак
    # 020-0040» в главе про брызговики) — такую строку не показываем
    while out:
        if re.fullmatch(r"\d{3}-\d{4}", out[0]) and out[0] != code:
            out.pop(0)
            continue
        if (len(out) > 1 and re.fullmatch(r"\d{3}-\d{4}", out[1])
                and out[1] != code and len(out[0]) < 80):
            del out[:2]
            continue
        break
    return out, images


def render_page(code, title, paragraphs, images):
    tpl = open(os.path.join(SERVICE_DIR, "000-0000.html"), encoding="utf-8").read()
    head = tpl[:tpl.index("</style></head><body>") + len("</style></head><body>")]
    head = re.sub(r"<title>.*?</title>", "<title>%s — Ремонт и обслуживание</title>"
                  % esc(title), head, count=1, flags=re.S)
    doc = "".join("<p>%s</p>" % esc(p) for p in paragraphs)
    if images:
        doc += ('<div class="imgs"><h2>Иллюстрации</h2>' +
                "".join('<figure><img loading="lazy" src="%s" alt=""></figure>' % esc(i)
                        for i in images) + "</div>")
    script = tpl[tpl.index("<script>\n(function(){var q="):]
    return (head + "\n<div class=\"top\">\n  " + LOGO +
            '\n  <div><div class="t1">Развитие · Ремонт и обслуживание</div>'
            '<div class="t2">%s</div></div>\n' % esc(title) +
            '  <div class="sp"><a href="../index.html#/s/%s">← Раздел каталога %s</a>'
            '<a href="index.html">Все инструкции</a></div>\n</div>\n<main>\n' % (code, code) +
            '  <h1>%s</h1><div class="code">%s</div>\n' % (esc(title), code) +
            '  <div class="search"><input id="q" type="search" '
            'placeholder="Поиск по тексту раздела…"></div>\n'
            '  <div id="doc">%s</div>\n</main>\n' % doc + script)


def retitle(path, title, code):
    s = open(path, encoding="utf-8").read()
    s = re.sub(r"<title>.*?</title>", "<title>%s — Ремонт и обслуживание</title>" % esc(title),
               s, count=1, flags=re.S)
    s = re.sub(r'(<div class="t2">).*?(</div>)', r"\g<1>%s\g<2>" % esc(title), s, count=1, flags=re.S)
    s = re.sub(r"<h1>.*?</h1>", "<h1>%s</h1>" % esc(title), s, count=1, flags=re.S)
    s = re.sub(r'(<div class="code">).*?(</div>)', r"\g<1>%s\g<2>" % code, s, count=1, flags=re.S)
    open(path, "w", encoding="utf-8").write(s)


# --------------------------------------------------------- индексы каталога
def write_service_js(titles):
    path = os.path.join(M, "data", "service.js")
    import json
    data = json.dumps(titles, ensure_ascii=False, sort_keys=True)
    open(path, "w", encoding="utf-8").write("window.SERVICE = " + data + ";\n")


def write_index(titles):
    path = os.path.join(M, "service.html")
    s = open(path, encoding="utf-8").read()
    head = s[:s.index("<main>") + len("<main>")]
    body = []
    for chapter in sorted({c[:3] for c in titles}):
        body.append("\n<h2>%s · %s</h2>" % (chapter, esc(GROUPS.get(chapter, "Разделы"))))
        for code in sorted(c for c in titles if c.startswith(chapter)):
            body.append('\n<a class="sec" href="service/%s.html"><span class="c">%s</span>%s</a>'
                        % (code, code, esc(titles[code])))
    open(path, "w", encoding="utf-8").write(head + "".join(body) + "\n</main></body></html>")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src_dir = sys.argv[1]
    tmp, html_dir, names = convert(src_dir)
    try:
        # глава-оглавление: единственная, где в имени есть 目录
        toc_key = next((k for k, v in names.items() if "目录" in v), None)
        if not toc_key:
            sys.exit("Не найдена глава с оглавлением руководства")
        toc = parse_toc(os.path.join(html_dir, toc_key + ".html"))
        print("в оглавлении разделов: %d" % len(toc))

        import json
        cur = {}
        sjs = open(os.path.join(M, "data", "service.js"), encoding="utf-8").read()
        cur = json.loads(sjs[sjs.index("=") + 1:].rstrip().rstrip(";"))

        added, renamed = [], []
        for key, orig in sorted(names.items()):
            if key == toc_key:
                continue          # титул и оглавление руководства — не раздел
            m = re.search(r"(\d{3}-\d{4})", orig)
            code = m.group(1) if m else None
            if not code:
                # главы без кода в имени файла — ищем по названию в оглавлении
                for c, t in toc.items():
                    if c in cur:
                        continue
                    body = strip_tags(body_of(os.path.join(html_dir, key + ".html")))
                    if t.lower()[:18] in body.lower():
                        code = c
                        break
            if not code:
                continue
            title = OVERRIDE.get(code) or toc.get(code) or cur.get(code) or code
            page = os.path.join(SERVICE_DIR, code + ".html")
            if not os.path.exists(page):
                paras, imgs = blocks_of(os.path.join(html_dir, key + ".html"),
                                        code, "../service_media/")
                open(page, "w", encoding="utf-8").write(
                    render_page(code, title, paras, imgs))
                added.append((code, title, len(paras), len(imgs)))
            elif cur.get(code) != title:
                retitle(page, title, code)
                renamed.append((code, cur.get(code, ""), title))
            cur[code] = title

        # разделы, которых нет в архиве, но которые есть в каталоге — оставляем
        for code in list(cur):
            new = OVERRIDE.get(code) or toc.get(code)
            if new and cur[code] != new:
                cur[code] = new

        write_service_js(cur)
        write_index(cur)

        print("добавлено разделов: %d" % len(added))
        for c, t, np, ni in added:
            print("   + %s  %s  (абзацев %d, иллюстраций %d)" % (c, t, np, ni))
        print("переименовано разделов: %d" % len(renamed))
        for c, was, now in renamed[:80]:
            print("   ~ %s  %s  ->  %s" % (c, was, now))
        print("всего в service.js: %d" % len(cur))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
