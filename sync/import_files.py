# -*- coding: utf-8 -*-
"""Импорт ссылок из файлов: экспорт TikTok, закладки браузера, текстовые списки."""

import json
import os
import re
import sys
from html import unescape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vaultlib as vl

INBOX = os.path.join(vl.ROOT, "inbox")
ANCHOR_RE = re.compile(r'<a[^>]+href=["\'](.*?)["\'][^>]*>(.*?)</a>', re.I | re.S)
TAG_RE = re.compile(r"<[^>]+>")


def read_text(path):
    for encoding in ("utf-8", "utf-8-sig", "cp1251", "latin-1"):
        try:
            with open(path, encoding=encoding) as fh:
                return fh.read()
        except (UnicodeDecodeError, LookupError):
            continue
        except Exception:
            return ""
    return ""


def from_html(text, source):
    items = []
    for href, label in ANCHOR_RE.findall(text):
        url = vl.clean_url(unescape(href))
        if not url:
            continue
        title = unescape(TAG_RE.sub(" ", label)).strip()
        item = vl.make_item(url, title, source)
        if title:
            item["title"] = title[:160]
        items.append(item)
    return items


def walk_json(node, out):
    if isinstance(node, dict):
        for value in node.values():
            walk_json(value, out)
    elif isinstance(node, list):
        for value in node:
            walk_json(value, out)
    elif isinstance(node, str) and vl.URL_RE.search(node):
        out.append(node)


def from_json(text, source):
    try:
        data = json.loads(text)
    except Exception:
        return from_plain(text, source)
    found = []
    walk_json(data, found)
    items = []
    for chunk in found:
        for url, context in vl.extract_links(chunk):
            items.append(vl.make_item(url, context, source))
    return items


def from_plain(text, source):
    return [vl.make_item(url, context, source) for url, context in vl.extract_links(text)]


def collect(path):
    name = os.path.basename(path)
    source = "Файл · " + name
    text = read_text(path)
    if not text.strip():
        return []
    ext = os.path.splitext(name)[1].lower()
    if ext in (".html", ".htm"):
        return from_html(text, source)
    if ext == ".json":
        return from_json(text, source)
    return from_plain(text, source)


def main():
    paths = [p for p in sys.argv[1:] if os.path.isfile(p)]
    if os.path.isdir(INBOX):
        for name in sorted(os.listdir(INBOX)):
            full = os.path.join(INBOX, name)
            if os.path.isfile(full):
                paths.append(full)
    if not paths:
        vl.console("")
        vl.console("  Файлов не найдено.")
        vl.console("  Положи их в папку inbox\\ или перетащи мышкой на IMPORT.bat")
        return 0

    data = vl.load_links()
    collected = []
    for path in paths:
        found = collect(path)
        vl.console("  " + os.path.basename(path) + ": ссылок найдено " + str(len(found)))
        collected.extend(found)

    fresh = vl.add_items(data, collected)
    vl.console("  Новых после отсева дублей: " + str(len(fresh)))
    if fresh:
        vl.console("  Подтягиваю названия и описания…")
        vl.enrich(fresh)
    vl.save_links(data)
    vl.summary(data)
    vl.console("")
    vl.console("  Готово. Запусти PUBLISH.bat, чтобы выложить на сайт.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
