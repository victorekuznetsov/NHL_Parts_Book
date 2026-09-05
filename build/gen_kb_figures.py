#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Дособирает иллюстрации, которых нет в каталоге иллюстраций песочницы.

В HTML-страницах QuickServe картинки — ссылки на закрытый сервер Cummins, а
сами изображения лежат внутри PDF того же документа. Песочница извлекает их
своим `figures.py`, но её каталог иллюстраций собран не по всем документам:
после перехода на выгрузку с отдельным ESN для каждого двигателя часть текстов
ссылается на картинки, которых в `assets/figures` песочницы нет.

Скрипт находит такие ссылки в уже собранной базе (`cummins/data/kb/body_*.js`),
берёт PDF соответствующего документа из песочницы и достаёт недостающие
картинки тем же кодом, что и песочница (`obsidian-vault/_build/figures.py`:
`map_document` сопоставляет ссылки из HTML с картинками из PDF по порядку,
`FigureStore` сжимает и складывает).

Запускать после gen_kb.js:

    node build/gen_kb.js
    python3 build/gen_kb_figures.py [путь-к-Cummins_Parts_Book]
"""
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, "cummins")
SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1
                      else os.environ.get("CUMMINS_KB_SRC",
                                          os.path.join(ROOT, "..", "Cummins_Parts_Book")))
FIG_DIR = os.path.join(DST, "assets", "figures")
SKIP_IMG = re.compile(r"/graphics/common/|cookielaw|logo|arrow\d*\.png|spacer", re.I)
FIG_REF = re.compile(r"assets/figures/([^\"'\s)]+)")
IMG_SRC = re.compile(r'<img[^>]+src="([^"]+)"', re.I)
# блок, который сборщик песочницы ставит вместо картинки, которую не смог достать
FIG_MISSING = re.compile(
    r'<div class="fig-missing">[^<]*<code>([^<]+)</code>.*?</div>', re.S)


def load_figures_module():
    """figures.py живёт в ветке main песочницы — берём его оттуда."""
    path = os.path.join(SRC, "obsidian-vault", "_build", "figures.py")
    tmp = None
    if not os.path.exists(path):
        blob = subprocess.run(["git", "-C", SRC, "show",
                               "main:obsidian-vault/_build/figures.py"],
                              capture_output=True)
        if blob.returncode != 0:
            sys.exit("Не нашёл figures.py ни в рабочей копии, ни в main песочницы")
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "figures.py")
        open(path, "wb").write(blob.stdout)
    sys.path.insert(0, os.path.dirname(path))
    import figures                                              # noqa: E402
    return figures


def read_js(name, var):
    path = os.path.join(DST, "data", name)
    text = open(path, encoding="utf-8").read()
    head = "window." + var + "="
    i = text.index(head) + len(head)
    return json.loads(text[i:text.rindex(";")])


def bodies():
    """id документа -> его html-тело из собранных кусков."""
    out = {}
    kb = os.path.join(DST, "data", "kb")
    for fn in sorted(os.listdir(kb)):
        if not re.match(r"^body_(ru_)?\d+\.js$", fn):
            continue
        text = open(os.path.join(kb, fn), encoding="utf-8").read()
        # файл начинается со строки-заглушки window.KB_BODY=window.KB_BODY||{};
        # поэтому ищем именно присваивание куску: window.KB_BODY[<n>]={...};
        m = re.search(r"window\.KB_BODY(?:_RU)?\[\d+\]=", text)
        if not m:
            continue
        for did, html in json.loads(text[m.end():text.rindex(";")]).items():
            out.setdefault(did, []).append(html)
    return out


def html_figures(path):
    """Ссылки на иллюстрации в порядке появления — как их видит qs2md."""
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return []
    out = []
    for src in IMG_SRC.findall(text):
        if src.startswith("/rtgraphics/") and not SKIP_IMG.search(src):
            out.append(src)
    return out


def main():
    figures = load_figures_module()
    docs = read_js("kb_docs.js", "KB_DOCS")
    have = set(os.listdir(FIG_DIR))

    missing_by_doc = {}
    for did, parts in bodies().items():
        need = {n for html in parts for n in FIG_REF.findall(html) if n not in have}
        if need:
            missing_by_doc[did] = need
    total = {n for s in missing_by_doc.values() for n in s}
    print("не хватает иллюстраций: %d в %d документах"
          % (len(total), len(missing_by_doc)))
    if not total:
        return

    store = figures.FigureStore(FIG_DIR)
    added = no_pdf = no_match = 0
    for did in sorted(missing_by_doc):
        cat = (docs.get(did) or {}).get("c", "procedures")
        pdf = os.path.join(SRC, "bulletins", cat, did + ".pdf")
        html = os.path.join(SRC, "bulletins", cat, did + ".html")
        if not os.path.exists(pdf) or not os.path.exists(html):
            no_pdf += 1
            continue
        refs = html_figures(html)
        if not refs:
            no_match += 1
            continue
        pairs, _ok = figures.map_document(refs, pdf)
        got = False
        for name, raw in pairs:
            if name in have or name not in missing_by_doc[did]:
                continue
            if store.add(name, raw):
                have.add(name)
                added += 1
                got = True
        if not got:
            no_match += 1

    left = {n for s in missing_by_doc.values() for n in s} - have
    print("  добавлено: %d | без PDF: %d | не сопоставилось: %d | осталось без файла: %d"
          % (added, no_pdf, no_match, len(left)))
    fix_missing_blocks(figures, docs, store, have)


def fix_missing_blocks(figures, docs, store, have):
    """Блоки «иллюстрация не выгружена» — пробуем достать картинку и вернуть её.

    Сборщик песочницы ставит такой блок, когда не смог сопоставить ссылку из
    HTML с картинкой из PDF. Пробуем ещё раз по тому же PDF; что удалось —
    подменяем на обычный <img>, остальное оставляем как есть (ссылка на
    QuickServe в блоке продолжает работать)."""
    kb = os.path.join(DST, "data", "kb")
    files = [f for f in sorted(os.listdir(kb)) if re.match(r"^body_(ru_)?\d+\.js$", f)]
    want = {}                       # id документа -> имена картинок в блоках
    for fn in files:
        text = open(os.path.join(kb, fn), encoding="utf-8").read()
        m = re.search(r"window\.KB_BODY(?:_RU)?\[\d+\]=", text)
        if not m:
            continue
        for did, html in json.loads(text[m.end():text.rindex(";")]).items():
            for name in FIG_MISSING.findall(html):
                want.setdefault(did, set()).add(name)
    total = {n for s in want.values() for n in s}
    if not total:
        return
    got = set()
    for did, names in want.items():
        need = names - have
        if not need:
            got |= names & have
            continue
        cat = (docs.get(did) or {}).get("c", "procedures")
        pdf = os.path.join(SRC, "bulletins", cat, did + ".pdf")
        html = os.path.join(SRC, "bulletins", cat, did + ".html")
        if not (os.path.exists(pdf) and os.path.exists(html)):
            continue
        refs = html_figures(html)
        if not refs:
            continue
        pairs, _ok = figures.map_document(refs, pdf)
        for name, raw in pairs:
            if name in need and name not in have and store.add(name, raw):
                have.add(name)
                got.add(name)

    def repl(m):
        name = m.group(1)
        if name not in have:
            return m.group(0)
        return ('<figure class="fig"><img loading="lazy" src="assets/figures/'
                + name + '" alt="' + name + '"></figure>')

    changed = 0
    for fn in files:
        path = os.path.join(kb, fn)
        text = open(path, encoding="utf-8").read()
        m = re.search(r"window\.KB_BODY(?:_RU)?\[\d+\]=", text)
        if not m:
            continue
        obj = json.loads(text[m.end():text.rindex(";")])
        hit = False
        for did, html in obj.items():
            new = FIG_MISSING.sub(repl, html)
            if new != html:
                obj[did] = new
                hit = True
        if hit:
            changed += 1
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text[:m.end()] +
                         json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print("  блоков «не выгружена»: %d картинок в %d документах, восстановлено %d, "
          "переписано файлов тел: %d" % (len(total), len(want), len(got), changed))
    mark_absent(have)


FIG_IMG = re.compile(
    r'<figure class="fig"><img[^>]+src="assets/figures/([^"]+)"[^>]*></figure>')


def mark_absent(have):
    """Картинки, которых достать так и не удалось, не должны ломаться в вёрстке.

    Заменяем <img> на тот же блок «иллюстрация не выгружена» со ссылкой на
    QuickServe, который ставит сборщик песочницы."""
    kb = os.path.join(DST, "data", "kb")
    changed = fixed = 0

    def repl(m):
        nonlocal fixed
        name = m.group(1)
        if name in have:
            return m.group(0)
        fixed += 1
        base = os.path.splitext(name)[0]
        url = ("https://quickserve.cummins.com/rtgraphics/english/service/%s/%s/%s"
               % (base[:2].lower(), base[2:3].lower(), name)) if len(base) >= 3 else ""
        return ('<div class="fig-missing">Иллюстрация <code>' + name +
                '</code> не выгружена' +
                (' — <a href="' + url + '" target="_blank" rel="noopener">'
                 'открыть на QuickServe ↗</a>' if url else "") + "</div>")

    for fn in sorted(os.listdir(kb)):
        if not re.match(r"^body_(ru_)?\d+\.js$", fn):
            continue
        path = os.path.join(kb, fn)
        text = open(path, encoding="utf-8").read()
        m = re.search(r"window\.KB_BODY(?:_RU)?\[\d+\]=", text)
        if not m:
            continue
        obj = json.loads(text[m.end():text.rindex(";")])
        hit = False
        for did, html in obj.items():
            new = FIG_IMG.sub(repl, html)
            if new != html:
                obj[did] = new
                hit = True
        if hit:
            changed += 1
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text[:m.end()] +
                         json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n")
    if fixed:
        print("  битых <img> заменено блоком со ссылкой: %d в %d файлах тел"
              % (fixed, changed))


if __name__ == "__main__":
    main()
