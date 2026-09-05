#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Достраивает базу знаний NTE240 собственными документами QSK60.

ЗАЧЕМ. В песочнице Cummins документы QuickServe выкачивались по одному
«документальному» серийному номеру на семейство, а затем размножались на все
ESN семейства (DOC_ESN в Cummins_Parts_Book/obsidian-vault/_build/common.py).
Для ESN 33239746 (QSK60 CM2150 MCRS, двигатель NTE240) такого набора не было —
ему отдавали документы QSK50 по ESN 33239899. При этом в сыром обходе
(rawdata/quickserve) лежит полный комплект документов QSK60, выкачанный по
серийным номерам QSK60 CM500 из парка:

    33210083 · CPL 2699 · QSK60 CM500
    33219033 · CPL 2848 · QSK60 CM500
    33224343 · CPL 2849 · QSK60 CM500

В опубликованную базу (bulletins/index.json -> data/kb_*.js) он не попал:
в DOC_ESN этих номеров нет. Скрипт разбирает сырые документы штатными
средствами самой песочницы (qs2md.Converter, figures, web_render.Renderer) и
дописывает их в cummins/ этого репозитория, привязывая к ESN 33239746.

ПРИМЕНИМОСТЬ. Двигатель NTE240 — QSK60 CM2150 MCRS, а исходные документы сняты
с QSK60 CM500. Базовый двигатель у них один (блок, поршни, коленвал, головки,
турбокомпрессоры, смазка, охлаждение), а система управления разная. Поэтому
каждый документ получает признак применимости:

    base  — базовый двигатель, применимо к NTE240 как есть;
    ctrl  — система управления CM500/CENSE/судовая: на NTE240 стоит CM2150 MCRS,
            документ показывается с оговоркой.

Признак берётся из руководства, в оглавлении которого документ стоит.

ПОРЯДОК ЗАПУСКА. Скрипт дописывает то, что собрал gen_kb.js, поэтому запускать
строго после него:

    node build/gen_kb.js
    python3 build/gen_kb_qsk60.py [путь-к-Cummins_Parts_Book]
"""
import collections
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, "cummins")
SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1
                      else os.environ.get("CUMMINS_KB_SRC",
                                          os.path.join(ROOT, "..", "Cummins_Parts_Book")))
BUILD = os.path.join(SRC, "obsidian-vault", "_build")
RAW = os.path.join(SRC, "rawdata", "quickserve")

if not os.path.isdir(RAW):
    sys.exit("Не найден сырой обход QuickServe: " + RAW)
sys.path.insert(0, BUILD)

from bs4 import BeautifulSoup                                     # noqa: E402
from figures import FigureStore, map_document                     # noqa: E402
from qs2md import Converter                                       # noqa: E402
from web_render import Renderer                                   # noqa: E402

ESN = "33239746"                       # QSK60 CM2150 MCRS, двигатель NTE240
SRC_ESN = ["33210083", "33219033", "33224343"]   # QSK60 CM500, откуда документы
CHUNK = 100                            # документов в одном файле тел (как в источнике)
QS_IMG = "https://quickserve.cummins.com/rtgraphics/english/service/{a}/{b}/{name}"
# PDF переносим для всех категорий, кроме процедур: их текст с рисунками уже в базе
PDF_CATS = {"manual", "tsb", "bulletin", "sti", "install_inst", "outlines"}
# служебная заглушка QuickServe: ни текста, ни PDF — в базу не берём
STUB = {"refno"}

# Руководства QSK60 из сырого обхода и применимость их содержимого к CM2150 MCRS.
# «ctrl» — документы про другую систему управления (CM500 / CENSE / судовая).
MANUAL_KIND = {
    "3666260": "base",   # QSK45 and QSK60 Operation and Maintenance Manual
    "4021530": "base",   # QSK45 and QSK60 Service Manual
    "4915528": "base",   # QSK45 and QSK60 Owners Manual
    "3666113": "ctrl",   # QSK19/23/45/60/78 Electronic Control System (CM500)
    "3666410": "ctrl",   # QSK45 and QSK60 CENSE Electronic Control System
    "4021555": "ctrl",   # QSK60 Marine Alarm and Safety System
}


# --------------------------------------------------------------- утилиты
def read_js(name, var):
    """Читает window.<var>=<json>; из cummins/data/<name>."""
    path = os.path.join(DST, "data", name)
    if not os.path.exists(path):
        return None
    text = open(path, encoding="utf-8").read()
    head = "window." + var + "="
    i = text.index(head) + len(head)
    return json.loads(text[i:text.rindex(";")])


def write_js(rel, var, obj):
    path = os.path.join(DST, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("window." + var + "=" +
                 json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n")
    return os.path.getsize(path)


def html_title(path):
    try:
        head = open(path, encoding="utf-8", errors="replace").read(400000)
    except OSError:
        return ""
    m = re.search(r"<title>(.*?)</title>", head, re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


def raw_path(rel):
    """Путь к файлу сырого обхода; пустая строка, если файла в индексе нет."""
    if not rel:
        return ""
    return os.path.join(RAW, str(rel).replace("\\", "/"))


# ------------------------------------------------- что берём из сырого обхода
def pick_docs():
    """Документы группы QSK60, которых ещё нет в базе знаний NHL."""
    idx = json.load(open(os.path.join(RAW, "index.json"), encoding="utf-8"))
    mine = set(SRC_ESN)
    group = [d for d in idx if mine & set(map(str, d.get("engines", [])))]
    return group


def manual_toc():
    """Оглавления руководств QSK60: раздел -> документы, и обратная связь."""
    toc, of_manual, of_section = {}, collections.defaultdict(set), collections.defaultdict(set)
    for mid in MANUAL_KIND:
        path = os.path.join(RAW, "manual", mid + "-history.html")
        if not os.path.exists(path):
            continue
        soup = BeautifulSoup(open(path, encoding="utf-8", errors="replace").read(), "lxml")
        tab = soup.select_one("table.outline-history-table")
        rows = []
        if tab:
            for tr in tab.select("tbody tr"):
                tds = tr.find_all("td")
                if len(tds) < 4:
                    continue
                a = tds[2].find("a")
                if not a:
                    continue
                pid = a.get_text(strip=True)
                if pid in STUB:
                    continue
                cat = "manual" if "/manual/" in (a.get("href") or "") else "procedures"
                sec = re.sub(r"\s+", " ", tds[1].get_text(" ", strip=True))
                rows.append([pid, re.sub(r"\s+", " ", tds[3].get_text(" ", strip=True)),
                             tds[0].get_text(" ", strip=True), 1 if cat == "manual" else 0])
                of_manual[pid].add(mid)
                of_section[pid].add(sec)
        toc[mid] = rows
    return toc, of_manual, of_section


# ------------------------------------------------------------------- сборка
def main():
    docs = read_js("kb_docs.js", "KB_DOCS")
    manuals = read_js("kb_manuals.js", "KB_MANUALS")
    search = read_js("kb_search.js", "KB_SEARCH")
    parts = read_js("kb_parts.js", "KB_PARTS")
    doc_source = read_js("kb_doc_source.js", "KB_DOC_SOURCE") or {}
    if docs is None:
        sys.exit("Сначала соберите базу знаний: node build/gen_kb.js")

    toc, of_manual, of_section = manual_toc()
    group = pick_docs()

    # 1. документы группы, которые в базе уже есть (пришли по другому ESN):
    #    им просто добавляем принадлежность к QSK60
    added_esn = 0
    for d in group:
        did = d["id"]
        rec = docs.get(did)
        if rec and ESN not in rec.get("e", []):
            rec["e"] = sorted(set(rec.get("e", [])) | {ESN})
            added_esn += 1

    todo = [d for d in group if d["id"] not in docs and d["id"] not in STUB and
            d.get("html") and os.path.exists(raw_path(d["html"]))]
    print("документов группы QSK60: %d | уже были в базе: %d | к разбору: %d"
          % (len(group), len(group) - len(todo), len(todo)))

    # 2. новые документы: разбор HTML -> markdown -> HTML базы знаний
    fig_dir = os.path.join(DST, "assets", "figures")
    os.makedirs(fig_dir, exist_ok=True)
    store = FigureStore(fig_dir)
    have_figs = set(os.listdir(fig_dir))

    titles = {d["id"]: html_title(raw_path(d["html"])) or d["id"] for d in todo}
    for d in group:                       # названия нужны и для уже известных
        titles.setdefault(d["id"], (docs.get(d["id"]) or {}).get("t", d["id"]))
    note_of = {}                          # имя заметки -> маршрут (внутренние ссылки)
    for did, t in titles.items():
        note_of[did] = did

    def resolve(target):
        """Ссылка на другой документ базы знаний по его номеру."""
        t = str(target).strip()
        if t in docs or t in titles:
            return ("#/doc/" + t, "lnk doc")
        return None

    def image_url(name):
        base = os.path.splitext(name)[0]
        fallback = QS_IMG.format(a=base[:2].lower(), b=base[2].lower(),
                                 name=name) if len(base) >= 3 else ""
        local = "assets/figures/" + name if name in have_figs else None
        return local, fallback

    def ref(kind, num):
        if kind == "manual":
            return "#/manual/" + num if num in manuals or num in MANUAL_KIND else None
        return "#/doc/" + num if num in docs or num in titles else None

    rend = Renderer(resolve, image_url, ref)
    conv = Converter(link_resolver=lambda cat, doc_id: doc_id
                     if (doc_id in docs or doc_id in titles) else None)

    # тела кладём в новые куски, продолжая нумерацию существующих
    used_chunks = [int(m.group(1)) for m in
                   (re.match(r"body_(\d+)\.js$", f) for f in os.listdir(os.path.join(DST, "data", "kb")))
                   if m]
    chunk_no = (max(used_chunks) + 1) if used_chunks else 0
    bodies = collections.defaultdict(dict)

    part_nums = set(parts or {})
    num_re = re.compile(r"(?<![\w\-/])(\d{7,8})(?![\w\-/])")
    figs_added = 0
    pdf_added = pdf_bytes = 0
    stats = collections.Counter()

    for n, d in enumerate(sorted(todo, key=lambda x: (x["cat"], x["id"]))):
        did, cat = d["id"], d["cat"]
        html_file = raw_path(d["html"])
        pdf_file = raw_path(d.get("pdf"))
        md, meta, figs = "", {}, []
        if cat != "manual":
            try:
                meta, md, figs = conv.convert(open(html_file, encoding="utf-8",
                                                   errors="replace").read())
            except Exception as exc:                      # noqa: BLE001
                stats["ошибка разбора"] += 1
                md = "> [!bug] Документ не удалось разобрать: %s" % exc
        else:
            meta = {"title": titles[did]}

        # иллюстрации: ссылки из HTML сопоставляем с картинками из PDF
        if figs and pdf_file and os.path.exists(pdf_file):
            pairs, _ok = map_document(figs, pdf_file)
            for name, raw in pairs:
                if name in have_figs:
                    continue
                if store.add(name, raw):
                    have_figs.add(name)
                    figs_added += 1

        body = rend.render(md) if md else ""
        chunk = -1
        if cat != "manual" and body:
            chunk = chunk_no + (n // CHUNK)
            bodies[chunk][did] = body

        mans = sorted(of_manual.get(did, []))
        kinds = {MANUAL_KIND.get(m, "base") for m in mans} or {"base"}
        kind = "base" if "base" in kinds else "ctrl"
        used = sorted({x for x in num_re.findall(md) if x in part_nums})

        pdf_rel = ""
        if cat in PDF_CATS and pdf_file and os.path.exists(pdf_file):
            pdf_rel = "%s/%s.pdf" % (cat, os.path.basename(pdf_file)[:-4])
            out = os.path.join(DST, "bulletins", pdf_rel)
            if not os.path.exists(out):
                os.makedirs(os.path.dirname(out), exist_ok=True)
                shutil.copyfile(pdf_file, out)
                pdf_added += 1
                pdf_bytes += os.path.getsize(out)

        docs[did] = {
            "c": cat,
            "t": titles[did],
            "ru": "",
            "d": meta.get("doc_date", ""),
            "mo": meta.get("doc_year", ""),
            "g": (meta.get("group_name") or "").strip(),
            "e": [ESN],
            "f": ["QSK45/QSK60"],
            "mn": mans,
            "sec": sorted(of_section.get(did, []))[:8],
            "p": used,
            "u": d.get("url", ""),
            "pdf": pdf_rel,
            "ok": 1,
            "ch": chunk,
            "ru_body": 0,
            # откуда документ и применим ли он к CM2150 MCRS как есть
            "qs_esn": SRC_ESN[0],
            "kind": kind,
        }
        stats[cat] += 1
        for no in used:
            rec = parts.setdefault(no, {})
            refs = rec.setdefault("d", [])
            tag = cat + "|" + did
            if tag not in refs:
                refs.append(tag)

    # 3. руководства QSK60
    for mid, rows in toc.items():
        secs = collections.OrderedDict()
        for pid, title, date, is_man in rows:
            sec = sorted(of_section.get(pid, ["Без секции"]))
            secs.setdefault(sec[0] if sec else "Без секции", []).append(
                [pid, title, date if date != "Not Available" else "", is_man])
        mdoc = docs.get(mid + "-history", {})
        manuals[mid] = {
            "t": mdoc.get("t") or html_title(os.path.join(RAW, "manual", mid + "-history.html")) or mid,
            "ru": "",
            "e": [ESN],
            "u": mdoc.get("u", ""),
            "pdf": mdoc.get("pdf", ""),
            "n": len(rows),
            "s": [[name, items] for name, items in secs.items()],
            "qs_esn": SRC_ESN[0],
            "kind": MANUAL_KIND.get(mid, "base"),
        }

    # 4. строки поиска по новым документам
    known = {row[0] for row in search}
    for did in docs:
        if did not in known:
            search.append([did, docs[did]["t"], docs[did].get("ru", ""), docs[did]["c"]])

    # 5. запись
    for chunk, obj in bodies.items():
        write_js("data/kb/body_%d.js" % chunk, "KB_BODY[%d]" % chunk, obj)
    write_js("data/kb_docs.js", "KB_DOCS", docs)
    write_js("data/kb_manuals.js", "KB_MANUALS", manuals)
    write_js("data/kb_search.js", "KB_SEARCH", search)
    write_js("data/kb_parts.js", "KB_PARTS", parts)
    # у QSK60 два источника документов: общий набор семейства (по ESN QSK50) и
    # собственный, снятый с QSK60 CM500 — записываем оба, чтобы страница
    # двигателя могла честно сказать, что откуда
    src = doc_source.setdefault(ESN, {})
    src["own"] = {
        "esn": SRC_ESN, "model": "QSK60 CM500",
        "note": "базовый двигатель тот же, система управления другая "
                "(CM500 / CENSE против CM2150 MCRS)",
    }
    write_js("data/kb_doc_source.js", "KB_DOC_SOURCE", doc_source)

    by_kind = collections.Counter(d.get("kind", "") for d in docs.values() if d.get("qs_esn"))
    print("добавлено документов QSK60: %d (%s)"
          % (sum(stats[c] for c in stats if c != "ошибка разбора"),
             ", ".join("%s: %d" % kv for kv in sorted(stats.items()))))
    print("  из них применимы как есть (базовый двигатель): %d, про другую систему "
          "управления: %d" % (by_kind["base"], by_kind["ctrl"]))
    print("  руководств: %d | ESN дописан существующим документам: %d" % (len(toc), added_esn))
    print("  новых иллюстраций: %d | PDF: %d (%.1f МБ)"
          % (figs_added, pdf_added, pdf_bytes / 1048576))
    print("  тел документов: %d в кусках %s"
          % (sum(len(o) for o in bodies.values()), sorted(bodies)))


if __name__ == "__main__":
    main()
