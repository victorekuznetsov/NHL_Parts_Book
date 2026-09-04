#!/usr/bin/env python3
"""Пересобирает nte240/manual.html (руководство оператора NTE240) из исходного
файла Word «NTE240 Driver's Manual-Polyus.docx».

Зачем отдельный скрипт: в документе все иллюстрации вставлены старым способом
(VML, `w:pict`/`v:imagedata`), и 47 из них лежат внутри таблиц — прежний импорт
их потерял, в таблицах остались пустые ячейки на месте пиктограмм. Скрипт
собирает страницу заново со всеми картинками и на тех же местах.

Картинки берутся из `word/media/` документа и уже лежат в
`nte240/manual_media/` под теми же именами — заново их выкладывать не нужно,
но при запуске с `--media` недостающие будут дописаны.

Исходный .docx — в ветке `rawdata` этого репозитория (в `main` его нет:
17 МБ исходника в деплой не нужны).

Запуск из корня репозитория:

    python3 build/gen_nte240_manual.py "NTE240 Driver's Manual-Polyus.docx"
    python3 build/gen_nte240_manual.py <файл.docx> --media    # + выложить media
"""
import html
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "nte240", "manual.html")
MEDIA_DIR = os.path.join(ROOT, "nte240", "manual_media")
MEDIA_HREF = "manual_media/"

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

# стили заголовков документа: styleId -> тег на странице
HEADING = {"1": "h2", "2": "h3"}
# собственное оглавление документа (стили «toc 1» / «toc 2») на страницу не
# выводим: слева и так есть навигация по этим же заголовкам
SKIP_STYLES = {"10", "20"}

# ссылки из руководства в разделы каталога — по началу заголовка
XREF = [
    ("3.10Контроллер -главный выключатель", "030", "Электрооборудование"),
    ("3.12Реле", "030", "Электрооборудование"),
    ("3.13Реле изоляции", "030", "Электрооборудование"),
    ("3.15Индикация заднего света", "030", "Электрооборудование"),
    ("3.17Централизованное управление смазкой", "100", "Смазка / вспомогательные"),
    ("3.18Автоматический контроллер огнетушителя", "100", "Вспомогательные системы"),
    ("3.19Автоматическое взвешивание", "100", "Вспомогательные системы"),
    ("Приложение B: Коды неисправностей двигателя", "700", "Двигатель Cummins QSK60"),
]


def xref(title):
    """Заголовки в документе разделены табуляцией («3.10<tab>Контроллер…»),
    поэтому сравниваем без пробелов."""
    flat = re.sub(r"\s+", "", title)
    for prefix, chapter, label in XREF:
        if flat.startswith(re.sub(r"\s+", "", prefix)):
            return (' <a class="cat-xref" href="index.html#/ch/%s">🔧 %s в каталоге →</a>'
                    % (chapter, esc(label)))
    return ""


def local(tag):
    return tag.split("}")[-1]


def esc(s):
    return html.escape(s, quote=False)


def load(docx):
    z = zipfile.ZipFile(docx)
    rels = {}
    for m in re.finditer(r'Id="([^"]+)"[^>]*Target="([^"]+)"',
                         z.read("word/_rels/document.xml.rels").decode("utf-8")):
        rels[m.group(1)] = m.group(2)
    root = ET.fromstring(z.read("word/document.xml").decode("utf-8"))
    body = [c for c in root if local(c.tag) == "body"][0]
    return z, rels, body


def para_style(p):
    ppr = p.find(W + "pPr")
    if ppr is None:
        return ""
    st = ppr.find(W + "pStyle")
    return st.get(W + "val", "") if st is not None else ""


def walk_para(p, rels, seen):
    """Текст и картинки абзаца в порядке следования."""
    text, imgs = [], []
    for node in p.iter():
        t = local(node.tag)
        if t == "t":
            text.append(node.text or "")
        elif t == "tab":
            text.append(" ")
        elif t == "br":
            text.append("\n")
        elif t == "imagedata":
            rid = node.get(R + "id")
            target = rels.get(rid, "")
            if not target.startswith("media/"):
                continue
            name = os.path.basename(target)
            imgs.append(name)
            seen.add(name)
    return re.sub(r"[ \t]+", " ", "".join(text)).strip(), imgs


def figure(name):
    return '<figure><img loading="lazy" src="%s%s" alt=""></figure>' % (MEDIA_HREF, esc(name))


def cell_img(name):
    return '<img loading="lazy" class="cell-img" src="%s%s" alt="">' % (MEDIA_HREF, esc(name))


def build(body, rels):
    out, toc, seen = [], [], set()
    hid = 0

    def paragraph(p):
        nonlocal hid
        style = para_style(p)
        if style in SKIP_STYLES:
            return
        text, imgs = walk_para(p, rels, seen)
        for name in imgs:
            out.append(figure(name))
        if not text:
            return
        tag = HEADING.get(style)
        if tag:
            hid += 1
            out.append('<%s id="h%d">%s%s</%s>'
                       % (tag, hid, esc(text), xref(text), tag))
            toc.append((tag, hid, text))
        else:
            out.append("<p>%s</p>" % esc(text).replace("\n", "<br>"))

    def table(tbl):
        rows = []
        for tr in tbl.findall(W + "tr"):
            cells = []
            for tc in tr.findall(W + "tc"):
                bits = []
                for p in tc.findall(W + "p"):
                    text, imgs = walk_para(p, rels, seen)
                    bits.extend(cell_img(n) for n in imgs)
                    if text:
                        bits.append(esc(text).replace("\n", "<br>"))
                cells.append("<td>%s</td>" % " ".join(bits))
            if cells:
                rows.append("<tr>%s</tr>" % "".join(cells))
        if rows:
            out.append('<div class="tbl-wrap"><table>%s</table></div>' % "".join(rows))

    for child in body:
        name = local(child.tag)
        if name == "p":
            paragraph(child)
        elif name == "tbl":
            table(child)
    return out, toc, seen


def page(doc_html, toc):
    src = open(OUT, encoding="utf-8").read()
    head = src[:src.index('<nav class="toc">')]
    tail = src[src.index("</div>\n  </main>"):]
    nav = '<nav class="toc">' + "".join(
        '<a class="lvl%d" href="#h%d">%s</a>' % (2 if tag == "h2" else 3, i, esc(t))
        for tag, i, t in toc) + "</nav>"
    middle = ('\n  <main>\n    <h1>Руководство оператора NTE240</h1>\n'
              '    <div class="search"><input id="q" type="search"'
              ' placeholder="Поиск по тексту руководства…"></div>\n'
              '    <div id="doc">')
    return head + nav + middle + "\n".join(doc_html) + tail


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        sys.exit(1)
    docx = args[0]
    if not os.path.exists(docx):
        print("Не найден файл: " + docx)
        sys.exit(1)
    z, rels, body = load(docx)
    doc_html, toc, seen = build(body, rels)

    if "--media" in sys.argv:
        os.makedirs(MEDIA_DIR, exist_ok=True)
        added = 0
        for n in z.namelist():
            if not n.startswith("word/media/"):
                continue
            dst = os.path.join(MEDIA_DIR, os.path.basename(n))
            if not os.path.exists(dst):
                open(dst, "wb").write(z.read(n))
                added += 1
        print("выложено новых картинок: %d" % added)

    missing = [n for n in sorted(seen) if not os.path.exists(os.path.join(MEDIA_DIR, n))]
    rendered = page(doc_html, toc)          # собрать полностью до записи файла
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(rendered)
    figures = sum(1 for x in doc_html if x.startswith("<figure"))
    cells = sum(x.count('class="cell-img"') for x in doc_html)
    tables = sum(1 for x in doc_html if x.startswith('<div class="tbl-wrap">'))
    print("nte240/manual.html: блоков %d, заголовков %d, иллюстраций %d "
          "(отдельных %d, в таблицах %d), таблиц %d"
          % (len(doc_html), len(toc), len(seen), figures, cells,
             tables))
    if missing:
        print("! нет файлов картинок (%d): %s" % (len(missing), ", ".join(missing[:8])))


if __name__ == "__main__":
    main()
