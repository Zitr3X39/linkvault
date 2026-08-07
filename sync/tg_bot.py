#!/usr/bin/env python3
"""LinkVault Telegram bot sync.

Запускается из GitHub Actions каждые 15 минут.
Читает новые сообщения бота через getUpdates (long-poll журнал),
вытаскивает ссылки и дописывает их в data/links.json.
Смещение (offset) хранится в data/tg_offset.json, чтобы не брать старое.

Категория определяется автоматически: сначала по домену (правила из
data/categories.json), потом по ключевым словам в ссылке и тексте сообщения.
Пустые категории на сайте не показываются — они появляются сами,
как только в них попадает первая ссылка.

Нужен секрет репозитория TELEGRAM_BOT_TOKEN (бот создаётся у @BotFather).
Если секрета нет — падаем с ошибкой, чтобы это было видно во вкладке Actions.
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
    print("ОШИБКА: секрет TELEGRAM_BOT_TOKEN не задан.")
    print("Репозиторий → Settings → Secrets and variables → Actions → New repository secret")
    print("Name: TELEGRAM_BOT_TOKEN, Secret: токен от @BotFather")
    sys.exit(1)

API = "https://api.telegram.org/bot" + TOKEN
LINKS_PATH = "data/links.json"
OFFSET_PATH = "data/tg_offset.json"
CATS_PATH = "data/categories.json"
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
    if host in ("chromewebstore.google.com", "microsoftedge.microsoft.com") or host.endswith("addons.mozilla.org") or host.endswith("addons.opera.com"):
        return "extension"
    return "site"


def load_rules():
    try:
        with open(CATS_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
        return cfg.get("rules", [])
    except Exception:
        return []


RULES = load_rules()

STRONG_RULES = [
    ("automation", ["mcp", "n8n", "zapier", "webhook", "telethon", "telegram bot", "автоматиз"]),
    ("gamedev", ["godot", "unity", "unreal"]),
    ("video", ["ffmpeg", "davinci", "capcut", "монтаж", "озвуч"]),
    ("design", ["figma", "photoshop", "illustrator", "ui/ux"]),
    ("vibecoding", ["llm", "gpt", "openai", "anthropic", "claude", "langchain", "prompt"]),
]

EXTRA_RULES = [
    ("video", ["video", "видео", "shorts", "tts", "voice", "субтитр", "premiere", "youtube", "stream", "ролик"]),
    ("vibecoding", ["ai ", "ai-", "-ai", "llm", "gpt", "claude", "openai", "anthropic", "agent", "langchain", "copilot", "cursor", "neural", "нейрос", "machine learning", "embedding"]),
    ("gamedev", ["game", "игр", "godot", "unity", "unreal", "sprite", "pixel art"]),
    ("design", ["design", "дизайн", "figma", "ui/ux", "icon", "шрифт", "font", "mockup"]),
    ("automation", ["mcp", "telegram", "n8n", "zapier", "workflow", "automation", "автоматиз", "webhook", "scraper", "парсер", "selenium", "playwright", "bot ", "bots"]),
    ("learning", ["course", "курс", "tutorial", "learn", "обучен", "guide", "гайд", "docs", "roadmap", "cheatsheet"]),
    ("tools", ["cli", "downloader", "converter", "конверт", "utility", "утилит", "manager", "backup", "extension", "расширен", "toolkit"]),
]


def host_of(url):
    try:
        return (urllib.parse.urlsplit(url).hostname or "").lower()
    except Exception:
        return ""


def detect_category(url, text):
    """Категория по домену и ключевым словам в ссылке и тексте сообщения."""
    hay = ((url or "") + " " + (text or "")).lower()
    host = host_of(url)
    for rule in RULES:
        for d in rule.get("domains", []):
            d = d.lower()
            if host == d or host.endswith("." + d):
                return rule["cat"]
    for cat, words in STRONG_RULES:
        if any(w in hay for w in words):
            return cat
    for rule in RULES:
        for w in rule.get("words", []):
            if w.lower() in hay:
                return rule["cat"]
    for cat, words in EXTRA_RULES:
        if any(w in hay for w in words):
            return cat
    return "other"


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
            host = host_of(url)
            context = text.replace(raw, " ").strip()
            items.append({
                "url": url,
                "url_key": key,
                "title": host,
                "description": context[:220],
                "note": "",
                "domain": host,
                "category": detect_category(url, context),
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
