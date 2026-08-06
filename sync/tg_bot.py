#!/usr/bin/env python3
"""LinkVault Telegram bot sync.

Запускается из GitHub Actions каждые 15 минут.
Читает новые сообщения бота через getUpdates (long-poll журнал),
вытаскивает ссылки и дописывает их в data/links.json.
Смещение (offset) хранится в data/tg_offset.json, чтобы не брать старое.

Нужен секрет репозитория TELEGRAM_BOT_TOKEN (бот создаётся у @BotFather).
"""
import json
import os
import re
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
if not TOKEN:
    print("BOT_TOKEN не задан — выхожу без ошибки")
    sys.exit(0)

API = "https://api.telegram.org/bot" + TOKEN
LINKS_PATH = "data/links.json"
OFFSET_PATH = "data/tg_offset.json"
URL_RE = re.compile(r"(?:https?://|www\.|t\.me/)[^\s<>\"'«»]+", re.IGNORECASE)
TRACK = re.compile(r"^(utm_|fbclid|gclid|yclid|igshid|si$|ref$|ref_src)", re.IGNORECASE)


def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "linkvault-bot/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def clean_url(raw):
    s = raw.strip().strip('<(["\'').strip('>)]."\'.,;«»')
    if not s:
        return ""
    if not s.lower().startswith(("http://", "https://")):
        s = "https://" + s.lstrip("/")
    try:
        u = urllib.parse.urlsplit(s)
        host = u.hostname or ""
        host = host.lower()
        if host.startswith("www."):
            host = host[4:]
        query = [(k, v) for k, v in urllib.parse.parse_qsl(u.query) if not TRACK.match(k)]
        path = u.path[:-1] if len(u.path) > 1 and u.path.endswith("/") else u.path
        return urllib.parse.urlunsplit((u.scheme, host + ((":" + str(u.port)) if u.port else ""), path, urllib.parse.urlencode(query), ""))
    except Exception:
        return ""


def detect_type(url):
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if host.endswith("github.com"):
        return "github"
    if host in ("t.me", "telegram.me") or host.endswith("telegram.org"):
        return "telegram"
    if host.endswith("tiktok.com"):
        return "tiktok"
    if host.endswith("youtube.com") or host == "youtu.be":
        return "youtube"
    if host.endswith("twitter.com") or host.endswith("x.com"):
        return "twitter"
    if host.endswith("reddit.com"):
        return "reddit"
    return "site"


def main():
    try:
        with open(OFFSET_PATH, encoding="utf-8") as f:
            offset = json.load(f).get("offset", 0)
    except Exception:
        offset = 0

    updates = http_json(API + "/getUpdates?timeout=0&limit=100&offset=" + str(offset))
    if not updates.get("ok"):
        print("getUpdates ошибка:", updates)
        sys.exit(1)

    try:
        with open(LINKS_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {"version": 1, "updated_at": None, "items": []}
    items = data.setdefault("items", [])
    known = set()
    for it in items:
        k = it.get("url_key") or clean_url(it.get("url", "")).split("://", 1)[-1].lower()
        if k:
            known.add(k)

    added = 0
    max_id = offset
    for upd in updates.get("result", []):
        max_id = max(max_id, upd["update_id"] + 1)
        msg = upd.get("message") or upd.get("channel_post") or {}
        text = msg.get("text") or msg.get("caption") or ""
        if not text:
            continue
        for raw in URL_RE.findall(text):
            url = clean_url(raw)
            if not url:
                continue
            key = url.split("://", 1)[-1].lower()
            if key in known:
                continue
            known.add(key)
            host = (urllib.parse.urlsplit(url).hostname or "").lower()
            items.append({
                "url": url,
                "url_key": key,
                "title": host,
                "description": "",
                "note": "",
                "domain": host,
                "category": "other",
                "type": detect_type(url),
                "source": "Telegram-бот",
                "tags": [],
                "favorite": False,
                "stars": 0,
                "enriched": False,
                "added_at": datetime.now(timezone.utc).isoformat(),
            })
            added += 1

    with open(OFFSET_PATH, "w", encoding="utf-8") as f:
        json.dump({"offset": max_id}, f)

    if added:
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        with open(LINKS_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")
    print("Новых ссылок:", added)


if __name__ == "__main__":
    main()
