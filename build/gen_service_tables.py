#!/usr/bin/env python3
"""Приводит спецификации в инструкциях по ремонту NTE240 к нормальному виду.

В исходных файлах Word спецификация к рисунку — это таблица «номер позиции /
наименование», которую прежний импорт разложил в отдельные абзацы, да ещё и
столбцами: 1, 4, 7, 10, 2, 5, 8, 11, 3, 6, 9. Читать это невозможно.

Скрипт находит такие цепочки на страницах `nte240/service/*.html`, собирает их
обратно в таблицу и сортирует по номеру позиции. Заодно убирает дубль, который
оставался перед спецификацией одной слипшейся строкой
(«Спецификация1защитник воздушного клапана4пружинная шайба…»).

Текст не переписывается: скрипт работает с уже готовыми страницами каталога и
только перегруппировывает то, что в них есть.

Запуск из корня репозитория:

    python3 build/gen_service_tables.py            # применить
    python3 build/gen_service_tables.py --dry-run  # только посчитать
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = os.path.join(ROOT, "nte240", "service", "*.html")

MIN_ROWS = 4            # короче — скорее нумерованный список, а не спецификация
MAX_NAME = 90           # длинные абзацы — это текст, а не ячейка таблицы

CSS = ("table.spec{border-collapse:collapse;margin:14px 0;width:100%;max-width:640px}"
       "table.spec td{border:1px solid var(--line);padding:5px 9px;vertical-align:top}"
       "table.spec td.n{width:3.2em;text-align:right;color:var(--muted);"
       "font-variant-numeric:tabular-nums;background:#f7f9fa}"
       "table.spec caption{caption-side:top;text-align:left;font-weight:700;padding:0 0 6px}")

NUM = re.compile(r"^\s*(\d{1,3})\s*[.．]?\s*$")


def flat(s):
    return re.sub(r"\s+", "", s).lower()


def text_of(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html)).strip()


def split_blocks(body):
    """Абзацы и всё остальное (рисунки, врезки) — в порядке следования."""
    out, pos = [], 0
    for m in re.finditer(r"<p>(.*?)</p>", body, re.S):
        if m.start() > pos:
            out.append(("raw", body[pos:m.start()]))
        out.append(("p", m.group(1)))
        pos = m.end()
    if pos < len(body):
        out.append(("raw", body[pos:]))
    return out


def find_run(blocks, start):
    """Цепочка «номер, наименование» начиная с blocks[start]."""
    rows, i = [], start
    while i + 1 < len(blocks):
        a, b = blocks[i], blocks[i + 1]
        if a[0] != "p" or b[0] != "p":
            break
        m = NUM.match(text_of(a[1]))
        name = text_of(b[1])
        if not m or not name or NUM.match(name) or len(name) > MAX_NAME:
            break
        rows.append((int(m.group(1)), name))
        i += 2
    return rows, i


def render(rows, caption):
    body = "".join('<tr><td class="n">%d</td><td>%s</td></tr>' % (n, t)
                   for n, t in sorted(rows, key=lambda r: r[0]))
    cap = "<caption>%s</caption>" % caption if caption else ""
    return '<table class="spec">%s%s</table>' % (cap, body)


def convert(body):
    blocks = split_blocks(body)
    out, i, tables, dropped = [], 0, 0, 0
    while i < len(blocks):
        rows, j = find_run(blocks, i)
        if len(rows) < MIN_ROWS:
            out.append(blocks[i])
            i += 1
            continue
        # подпись: предыдущий абзац «Спецификация», если он есть
        caption = ""
        if out and out[-1][0] == "p" and text_of(out[-1][1]).lower().startswith("спецификация") \
                and len(text_of(out[-1][1])) < 40:
            caption = text_of(out.pop()[1])
        # слипшийся дубль той же спецификации перед ней
        if out and out[-1][0] == "p":
            prev = flat(text_of(out[-1][1]))
            hits = sum(1 for _, name in rows if flat(name) in prev)
            if len(prev) > 40 and hits >= max(2, int(len(rows) * 0.6)):
                out.pop()
                dropped += 1
        out.append(("raw", render(rows, caption)))
        tables += 1
        i = j
    html = "".join(b if kind == "raw" else "<p>%s</p>" % b for kind, b in out)
    return html, tables, dropped


def main():
    dry = "--dry-run" in sys.argv
    total_t = total_d = changed = 0
    for path in sorted(glob.glob(PAGES)):
        src = open(path, encoding="utf-8").read()
        m = re.search(r'(<div id="doc">)(.*)(</div>\s*</main>)', src, re.S)
        if not m:
            continue
        body, tables, dropped = convert(m.group(2))
        if not tables:
            continue
        new = src[:m.start(2)] + body + src[m.end(2):]
        if "table.spec{" not in new:
            new = new.replace("</style>", CSS + "</style>", 1)
        total_t += tables
        total_d += dropped
        changed += 1
        print("%s: таблиц %d%s" % (os.path.basename(path)[:-5], tables,
                                   ", убрано дублей %d" % dropped if dropped else ""))
        if not dry:
            open(path, "w", encoding="utf-8").write(new)
    print("\nразделов изменено: %d, таблиц собрано: %d, дублей убрано: %d%s"
          % (changed, total_t, total_d, "  (--dry-run, файлы не тронуты)" if dry else ""))


if __name__ == "__main__":
    main()
