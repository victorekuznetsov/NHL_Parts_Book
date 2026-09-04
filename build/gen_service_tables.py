#!/usr/bin/env python3
"""Возвращает таблицы в инструкции по ремонту NTE240.

В заводском руководстве спецификации к рисункам, таблицы моментов затяжки,
перевода единиц, масс узлов и таблицы поиска неисправностей — обычные таблицы
Word. Прежний импорт разложил их в текст: где-то по абзацу на ячейку (да ещё в
порядке столбцов — 1, 4, 7, 10, 2, 5, 8…), а где-то склеил всю таблицу в один
абзац без пробелов («МножимоеМножительПроизведение…»). Читать это невозможно.

Скрипт берёт **структуру** таблиц из исходных файлов Word, находит
соответствующий текст на готовой странице каталога и собирает настоящую
таблицу. Совпадение проверяется посимвольно (без учёта пробелов), поэтому
текст страницы не может измениться — меняется только его разметка. Для
спецификаций, которых в исходнике не нашлось, остаётся запасной разбор
«номер позиции / наименование».

Запуск из корня репозитория (нужен LibreOffice):

    python3 build/gen_service_tables.py <папка с главами руководства по ремонту>
    python3 build/gen_service_tables.py <папка> --dry-run

Исходные главы — в ветке `rawdata` (архив `…NTE240维修手册-2023-译文.zip.001/.002`).
"""
import collections
import glob
import html as H
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE = os.path.join(ROOT, "nte240", "service")

MIN_CELLS = 3           # меньше — не таблица
MIN_CHARS = 15          # слишком короткий текст найдётся где угодно
FALLBACK_ROWS = 4       # запасной разбор «номер / наименование»
MAX_NAME = 90

CSS = ("table.tbl,table.spec{border-collapse:collapse;margin:14px 0;width:100%;"
       "max-width:900px;font-size:14px}"
       "table.tbl td,table.spec td{border:1px solid var(--line);padding:5px 9px;"
       "vertical-align:top}"
       "table.tbl tr:first-child td{background:#f7f9fa;font-weight:600}"
       "table.spec td.n{width:3.2em;text-align:right;color:var(--muted);"
       "font-variant-numeric:tabular-nums;background:#f7f9fa}"
       "table.tbl caption,table.spec caption{caption-side:top;text-align:left;"
       "font-weight:700;padding:0 0 6px}"
       ".tw{overflow-x:auto}")

NUM = re.compile(r"^\s*(\d{1,3})\s*[.．]?\s*$")


def plain(s):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", "", s))).strip()


def flat(s):
    return re.sub(r"\s+", "", s).lower()


def esc(s):
    return H.escape(s, quote=False)


# ------------------------------------------------------- конвертация глав
def convert(src_dir):
    tmp = tempfile.mkdtemp(prefix="nte240-tbl-")
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
    subprocess.run(["soffice", "-env:UserInstallation=file://" + os.path.join(tmp, "lo"),
                    "--headless", "--norestore", "--convert-to", "html", "--outdir", html_dir] +
                   [os.path.join(ascii_dir, f) for f in sorted(os.listdir(ascii_dir))],
                   check=True, stdout=subprocess.DEVNULL)
    return tmp, html_dir, names


def source_tables(path):
    """Таблицы главы: список строк, каждая строка — список ячеек (текст)."""
    s = open(path, encoding="utf-8", errors="replace").read()
    out = []
    for t in re.findall(r"(?is)<table[^>]*>.*?</table>", s):
        rows = []
        for tr in re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", t):
            rows.append([plain(td) for td in re.findall(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>", tr)])
        rows = [r for r in rows if r]
        if rows:
            out.append(rows)
    return out


# --------------------------------------------------------- страница раздела
def split_blocks(body):
    out, pos = [], 0
    for m in re.finditer(r"<p>(.*?)</p>", body, re.S):
        if m.start() > pos:
            out.append(["raw", body[pos:m.start()]])
        out.append(["p", m.group(1)])
        pos = m.end()
    if pos < len(body):
        out.append(["raw", body[pos:]])
    return out


def char_map(blocks):
    """Строка «весь текст абзацев без пробелов» и позиция каждого символа."""
    buf, idx = [], []
    for bi, (kind, val) in enumerate(blocks):
        if kind != "p":
            continue
        text = plain(val)
        for ci, ch in enumerate(text):
            if ch.isspace():
                continue
            buf.append(ch.lower())
            idx.append((bi, ci))
    return "".join(buf), idx


def render_table(rows):
    """Таблица как в исходнике; пустые столбцы (следы объединённых ячеек Word)
    убираем, одиночную ячейку в строке растягиваем на всю ширину."""
    width = max(len(r) for r in rows)
    grid = [list(r) + [""] * (width - len(r)) for r in rows]
    keep = [i for i in range(width) if any(row[i] for row in grid)]
    grid = [[row[i] for i in keep] for row in grid]
    width = len(keep) or 1

    caption, start = "", 0
    if len(grid) > 1 and width > 1 and grid[0][0] and not any(grid[0][1:]):
        caption, start = grid[0][0], 1

    body = []
    for row in grid[start:]:
        if row[0] and not any(row[1:]):
            body.append('<tr><td colspan="%d">%s</td></tr>' % (width, esc(row[0])))
            continue
        body.append("<tr>%s</tr>" % "".join("<td>%s</td>" % esc(c) for c in row))
    cap = "<caption>%s</caption>" % esc(caption) if caption else ""
    return '<div class="tw"><table class="tbl">%s%s</table></div>' % (cap, "".join(body))


def place_tables(blocks, tables):
    """Находит текст каждой таблицы среди абзацев и заменяет его таблицей."""
    text, idx = char_map(blocks)
    found = []
    for rows in tables:
        cells = [c for r in rows for c in r if c]
        if len(cells) < MIN_CELLS:
            continue
        needle = flat("".join(cells))
        if len(needle) < MIN_CHARS:
            continue
        at = text.find(needle)
        if at < 0:
            continue
        found.append((idx[at], idx[at + len(needle) - 1], rows))
    if not found:
        return blocks, 0
    found.sort(key=lambda f: f[0])

    out, used_to, placed = [], -1, 0
    taken = {}
    for (b0, c0), (b1, c1), rows in found:
        if b0 <= used_to:            # перекрывающиеся совпадения пропускаем
            continue
        taken[b0] = ((b0, c0), (b1, c1), rows)
        used_to = b1
    i = 0
    while i < len(blocks):
        if i in taken:
            (b0, c0), (b1, c1), rows = taken[i]
            head = plain(blocks[b0][1])[:c0].strip()
            tail = plain(blocks[b1][1])[c1 + 1:].strip()
            if head:
                out.append(["p", esc(head)])
            for k in range(b0, b1 + 1):     # рисунки внутри диапазона не теряем
                if blocks[k][0] == "raw":
                    out.append(blocks[k])
            out.append(["raw", render_table(rows)])
            if tail:
                out.append(["p", esc(tail)])
            placed += 1
            i = b1 + 1
            continue
        out.append(blocks[i])
        i += 1
    return out, placed


# ------------------------- запасной разбор: «номер позиции / наименование»
def fallback_specs(blocks):
    """Спецификации, которых не нашлось в исходнике: цепочка «номер, название».

    Ячейки переставляются по возрастанию номера позиции, поэтому проверяем не
    порядок, а состав символов — таблица обязана содержать ровно тот же текст,
    что и абзацы, которые она заменила; иначе цепочку не трогаем."""
    out, i, made, dropped = [], 0, 0, 0
    while i < len(blocks):
        rows, consumed, j = [], [], i
        while j + 1 < len(blocks):
            a, b = blocks[j], blocks[j + 1]
            if a[0] != "p" or b[0] != "p":
                break
            num, name = plain(a[1]), plain(b[1])
            if not NUM.match(num) or not name or NUM.match(name) or len(name) > MAX_NAME:
                break
            rows.append((int(NUM.match(num).group(1)), num, name))
            consumed += [num, name]
            j += 2
        if len(rows) < FALLBACK_ROWS:
            out.append(blocks[i])
            i += 1
            continue

        caption = ""
        if out and out[-1][0] == "p" and plain(out[-1][1]).lower().startswith("спецификация") \
                and len(plain(out[-1][1])) < 40:
            caption = plain(out[-1][1])
            consumed.append(caption)
            out.pop()
        # слипшийся дубль той же спецификации перед ней — его текст целиком
        # повторяет таблицу, поэтому его убираем
        dup = ""
        if out and out[-1][0] == "p":
            prev = plain(out[-1][1])
            if len(flat(prev)) > 40 and all(flat(n) in flat(prev) for _, _, n in rows):
                dup = prev
                out.pop()

        cells = [caption] + [t for r in rows for t in (r[1], r[2])]
        if collections.Counter(flat("".join(cells))) != collections.Counter(flat("".join(consumed))):
            out.extend(blocks[i:j])          # состав не сходится — оставляем как было
            i = j
            continue
        if dup:
            dropped += 1
        cap = "<caption>%s</caption>" % esc(caption) if caption else ""
        out.append(["raw", '<table class="spec">%s%s</table>' % (cap, "".join(
            '<tr><td class="n">%s</td><td>%s</td></tr>' % (esc(num), esc(name))
            for _, num, name in sorted(rows, key=lambda r: r[0])))])
        made += 1
        i = j
    return out, made, dropped


def join(blocks):
    return "".join(v if k == "raw" else "<p>%s</p>" % v for k, v in blocks)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        sys.exit(1)
    dry = "--dry-run" in sys.argv
    tmp, html_dir, names = convert(args[0])
    try:
        # Главы к разделам не привязываем: таблицу ищем по её собственному
        # тексту, а он в разных разделах не повторяется. Заодно это ловит
        # случаи, когда часть глав лежит на сводной странице (000-9999).
        tables = []
        for key, orig in sorted(names.items()):
            if "目录" in orig:
                continue          # титул и оглавление руководства — не раздел
            tables.extend(source_tables(os.path.join(html_dir, key + ".html")))
        pages = sorted(glob.glob(os.path.join(SERVICE, "*.html")))
        print("таблиц в исходных главах: %d, страниц каталога: %d\n" % (len(tables), len(pages)))

        total_t = total_f = changed = 0
        for page in pages:
            code = os.path.basename(page)[:-5]
            src = open(page, encoding="utf-8").read()
            m = re.search(r'(<div id="doc">)(.*)(</div>\s*</main>)', src, re.S)
            if not m:
                continue
            before = flat(plain(m.group(2)))
            blocks = split_blocks(m.group(2))
            blocks, placed = place_tables(blocks, tables)
            blocks, spec, dropped = fallback_specs(blocks)
            if not placed and not spec:
                continue
            body = join(blocks)
            after = flat(plain(body))
            # Ячейки встают в порядок строк таблицы, поэтому текст переставляется —
            # сверяем не строку, а состав символов: ничего не должно появиться,
            # а пропасть может только снятый слипшийся дубль спецификации.
            gained = collections.Counter(after) - collections.Counter(before)
            lost = collections.Counter(before) - collections.Counter(after)
            if gained or (lost and not dropped):
                print("!! %s: состав текста изменился, раздел пропущен "
                      "(лишних %d, потеряно %d)"
                      % (code, sum(gained.values()), sum(lost.values())))
                continue
            new = src[:m.start(2)] + body + src[m.end(2):]
            if "table.tbl{" not in new and "table.tbl," not in new:
                new = new.replace("</style>", CSS + "</style>", 1)
            total_t += placed
            total_f += spec
            changed += 1
            print("%s: таблиц из исходника %d%s"
                  % (code, placed, ", собрано по номерам %d" % spec if spec else ""))
            if not dry:
                open(page, "w", encoding="utf-8").write(new)
        print("\nразделов изменено: %d, таблиц по исходнику: %d, запасным разбором: %d%s"
              % (changed, total_t, total_f, "  (--dry-run)" if dry else ""))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
