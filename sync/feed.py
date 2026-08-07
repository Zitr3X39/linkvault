#!/usr/bin/env python3
"""LinkVault news feed collector.

Запускается из GitHub Actions раз в день (09:00 по Калининграду).
Собирает свежие находки про веб-разработку, нейросети и полезные тулзы:
  - Hacker News (топ за сутки, score >= 40)
  - dev.to (топ дня, с обложками)
  - Reddit r/programming + r/MachineLearning (топ дня, с превью)
  - GitHub Trending (daily, с og-картинками)
  - Product Hunt (RSS)

Для карточек без описания/картинки дотягивает og-данные с самого сайта.
Описания на английском переводит на русский (бесплатный endpoint переводчика).

Результат складывает в data/feed.json. Ссылки, которые уже есть
в хранилище (data/links.json), пропускаются. Записи старше 7 дней
вычищаются, лента ограничена 90 карточками.
"""
import json
import re
import html
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) linkvault-feed/1.1"}
FEED_PATH = "data/feed.json"
LINKS_PATH = "data/links.json"
CATS_PATH = "data/categories.json"
MAX_AGE_DAYS = 7
MAX_ITEMS = 90
MAX_OG_FETCH = 22  # сколько страниц максимум обходим за запуск за og-данными
TRACK = re.compile(r"^(utm_|fbclid|gclid|yclid|igshid|si$|ref$|ref_src)", re.IGNORECASE)


def http_text(url, timeout=25, limit=None):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(limit) if limit else r.read()
        return data.decode("utf-8", "replace")


def http_json(url):
    return json.loads(http_text(url))


def clean_url(raw):
    s = (raw or "").strip()
    if not s:
        return ""
    if not s.lower().startswith(("http://", "https://")):
        s = "https://" + s.lstrip("/")
    try:
        u = urllib.parse.urlsplit(s)
        host = (u.hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]
        query = [(k, v) for k, v in urllib.parse.parse_qsl(u.query) if not TRACK.match(k)]
        path = u.path[:-1] if len(u.path) > 1 and u.path.endswith("/") else u.path
        return urllib.parse.urlunsplit((u.scheme, host + ((":" + str(u.port)) if u.port else ""), path, urllib.parse.urlencode(query), ""))
    except Exception:
        return ""


def url_key(url):
    return url.split("://", 1)[-1].lower()


def host_of(url):
    try:
        return (urllib.parse.urlsplit(url).hostname or "").lower()
    except Exception:
        return ""


def detect_type(url):
    host = host_of(url)
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
    if host in ("chromewebstore.google.com", "microsoftedge.microsoft.com") or host.endswith("addons.mozilla.org"):
        return "extension"
    return "site"


def load_rules():
    try:
        with open(CATS_PATH, encoding="utf-8") as f:
            return json.load(f).get("rules", [])
    except Exception:
        return []


RULES = load_rules()
EXTRA_RULES = [
    ("vibecoding", ["llm", "gpt", "claude", "openai", "anthropic", " ai", "ai ", "ai-", "neural", "machine learning", "agent"]),
    ("video", ["video", "видео", "shorts", "youtube", "stream"]),
    ("gamedev", ["game", "игр", "godot", "unity", "unreal"]),
    ("design", ["design", "дизайн", "figma", "ui", "ux"]),
    ("automation", ["automation", "автоматиз", "workflow", "scraper", "bot"]),
    ("devops", ["deploy", "docker", "kubernetes", "ci/cd", "cloud", "server"]),
    ("security", ["security", "vulnerability", "безопасност", "exploit"]),
    ("learning", ["tutorial", "guide", "course", "learn", "docs"]),
    ("tools", ["cli", "tool", "utility", "converter"]),
]


def detect_category(url, text):
    hay = ((url or "") + " " + (text or "")).lower()
    host = host_of(url)
    for rule in RULES:
        for d in rule.get("domains", []):
            d = d.lower()
            if host == d or host.endswith("." + d):
                return rule["cat"]
    for rule in RULES:
        for w in rule.get("words", []):
            if w.lower() in hay:
                return rule["cat"]
    for cat, words in EXTRA_RULES:
        if any(w in hay for w in words):
            return cat
    return "other"


def clean_text(s):
    """Убирает HTML-теги и декодирует сущности (&amp; -> &)."""
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or ""))).strip()


def og_fetch(url):
    """Лучшее из возможного со страницы: og:description / og:image."""
    out = {}
    try:
        raw = http_text(url, timeout=10, limit=200000)
    except Exception:
        return out

    def pick(prop):
        m = re.search(r'<meta[^>]+(?:property|name)=["\']%s["\'][^>]+content=["\']([^"\']+)["\']' % re.escape(prop), raw, re.I)
        if not m:
            m = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']%s["\']' % re.escape(prop), raw, re.I)
        return html.unescape(m.group(1).strip()) if m else ""

    d = pick("og:description") or pick("description")
    i = pick("og:image")
    if d:
        out["description"] = clean_text(d)[:220]
    if i and i.startswith(("http://", "https://")):
        out["image"] = i
    return out


def needs_ru(t):
    letters = re.findall(r"[A-Za-z\u0400-\u04FF]", t or "")
    if len(letters) < 4:
        return False
    cyr = [c for c in letters if "\u0400" <= c <= "\u04FF"]
    return len(cyr) / len(letters) < 0.45


def translate_ru(text):
    q = text[:480]
    try:
        u = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=" + urllib.parse.quote(q)
        data = json.loads(http_text(u, timeout=15))
        out = "".join(part[0] for part in (data[0] or []) if part and part[0]).strip()
        return out
    except Exception:
        return ""


# ---------- collectors ----------

def from_hackernews(limit=14):
    out = []
    try:
        ids = http_json("https://hacker-news.firebaseio.com/v0/topstories.json")[:60]
    except Exception as e:
        print("HN список недоступен:", e)
        return out
    for i in ids:
        if len(out) >= limit:
            break
        try:
            it = http_json("https://hacker-news.firebaseio.com/v0/item/%d.json" % i)
        except Exception:
            continue
        if not it or it.get("type") != "story":
            continue
        title = clean_text(it.get("title") or "")
        score = it.get("score") or 0
        if not title or score < 40:
            continue
        url = clean_url(it.get("url") or ("https://news.ycombinator.com/item?id=%s" % i))
        if not url:
            continue
        out.append({"url": url, "title": title, "description": "", "image": "", "source": "Hacker News", "score": score})
    print("Hacker News:", len(out))
    return out


def from_devto(limit=14):
    out = []
    try:
        arts = http_json("https://dev.to/api/articles?top=1&per_page=30")
    except Exception as e:
        print("dev.to недоступен:", e)
        return out
    for a in arts or []:
        if len(out) >= limit:
            break
        url = clean_url(a.get("url") or "")
        title = clean_text(a.get("title") or "")
        if not url or not title:
            continue
        desc = clean_text(a.get("description") or "")[:220]
        img = a.get("cover_image") or ""
        out.append({"url": url, "title": title, "description": desc, "image": img,
                    "source": "dev.to", "score": a.get("positive_reactions_count") or 0})
    print("dev.to:", len(out))
    return out


def from_reddit(subs=("programming", "MachineLearning"), limit=8):
    out = []
    for sub in subs:
        got = 0
        try:
            data = http_json("https://www.reddit.com/r/%s/top.json?t=day&limit=%d&raw_json=1" % (sub, limit * 2))
        except Exception as e:
            print("Reddit r/%s недоступен:" % sub, e)
            continue
        for ch in ((data.get("data") or {}).get("children") or []):
            if got >= limit:
                break
            d = ch.get("data") or {}
            if d.get("stickied"):
                continue
            title = clean_text(d.get("title") or "")
            url = clean_url(d.get("url") or "")
            if not title or not url:
                continue
            desc = clean_text(d.get("selftext") or "")[:220]
            img = ""
            try:
                img = html.unescape(d["preview"]["images"][0]["source"]["url"])
            except Exception:
                th = d.get("thumbnail") or ""
                if th.startswith("http"):
                    img = th
            out.append({"url": url, "title": title, "description": desc, "image": img,
                        "source": "Reddit r/" + sub, "score": d.get("score") or 0})
            got += 1
        print("Reddit r/%s:" % sub, got)
    return out


def from_github_trending(limit=14):
    out = []
    try:
        page = http_text("https://github.com/trending?since=daily")
    except Exception as e:
        print("GitHub Trending недоступен:", e)
        return out
    blocks = re.findall(r'<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>(.*?)</article>', page, re.S)
    for b in blocks:
        if len(out) >= limit:
            break
        m = re.search(r'<h2[^>]*>\s*<a[^>]*href="(/[^"]+)"', b)
        if not m:
            continue
        path = m.group(1).strip()
        url = clean_url("https://github.com" + path)
        if not url:
            continue
        name = "/".join([p for p in path.split("/") if p])
        dm = re.search(r'<p[^>]*class="[^"]*col-9[^"]*"[^>]*>(.*?)</p>', b, re.S)
        desc = clean_text(dm.group(1))[:220] if dm else ""
        sm = re.search(r"([\d,]+)\s*stars\s*today", b)
        stars = int(sm.group(1).replace(",", "")) if sm else 0
        seg = [p for p in path.split("/") if p]
        img = "https://opengraph.githubassets.com/1/" + seg[0] + "/" + seg[1] if len(seg) >= 2 else ""
        out.append({"url": url, "title": name, "description": desc, "image": img,
                    "source": "GitHub Trending", "score": stars})
    print("GitHub Trending:", len(out))
    return out


def from_producthunt(limit=10):
    out = []
    try:
        xml = http_text("https://www.producthunt.com/feed")
    except Exception as e:
        print("Product Hunt недоступен:", e)
        return out
    for block in re.findall(r"<item>(.*?)</item>", xml, re.S):
        if len(out) >= limit:
            break

        def pick(tag):
            m = re.search(r"<%s>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</%s>" % (tag, tag), block, re.S)
            return m.group(1).strip() if m else ""

        title = clean_text(pick("title"))
        url = clean_url(pick("link"))
        desc = clean_text(pick("description"))[:220]
        if not title or not url:
            continue
        out.append({"url": url, "title": title, "description": desc, "image": "",
                    "source": "Product Hunt", "score": 0})
    print("Product Hunt:", len(out))
    return out


# ---------- main ----------

def main():
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    # что уже лежит в хранилище — не предлагать повторно
    vault_keys = set()
    try:
        with open(LINKS_PATH, encoding="utf-8") as f:
            for it in json.load(f).get("items", []):
                k = it.get("url_key") or url_key(clean_url(it.get("url", "")))
                if k:
                    vault_keys.add(k)
    except Exception:
        pass

    fresh = []
    seen = set()
    for batch in (from_github_trending(), from_hackernews(), from_devto(), from_reddit(), from_producthunt()):
        for it in batch:
            key = url_key(it["url"])
            if not key or key in seen or key in vault_keys:
                continue
            seen.add(key)
            text = it.get("title", "") + " " + it.get("description", "")
            fresh.append({
                "url": it["url"],
                "url_key": key,
                "title": it["title"][:160],
                "description": (it.get("description") or "")[:220],
                "image": it.get("image") or "",
                "source": it["source"],
                "type": detect_type(it["url"]),
                "category": detect_category(it["url"], text),
                "domain": host_of(it["url"]),
                "score": it.get("score") or 0,
                "found_at": now_iso,
            })

    # дотягиваем og-данные там, где пусто
    og_done = 0
    for it in fresh:
        if it["description"] and it["image"]:
            continue
        if og_done >= MAX_OG_FETCH:
            break
        og_done += 1
        og = og_fetch(it["url"])
        if og.get("description") and not it["description"]:
            it["description"] = og["description"]
        if og.get("image") and not it["image"]:
            it["image"] = og["image"]
    print("og-обход:", og_done)

    # перевод описаний на русский
    tr_done = 0
    for it in fresh:
        d = it.get("description") or ""
        if d and needs_ru(d):
            ru = translate_ru(d)
            if ru:
                it["description_ru"] = ru[:240]
                tr_done += 1
    print("переведено описаний:", tr_done)

    # старые записи ленты: держим неделю, не дублируя свежие
    old = []
    try:
        with open(FEED_PATH, encoding="utf-8") as f:
            old = json.load(f).get("items", [])
    except Exception:
        old = []
    cutoff = (now - timedelta(days=MAX_AGE_DAYS)).isoformat()
    kept = []
    for it in old:
        k = it.get("url_key") or ""
        if not k or k in seen or k in vault_keys:
            continue
        if str(it.get("found_at") or "") < cutoff:
            continue
        seen.add(k)
        kept.append(it)

    items = fresh + kept
    items.sort(key=lambda x: str(x.get("found_at") or ""), reverse=True)
    items = items[:MAX_ITEMS]

    with open(FEED_PATH, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "updated_at": now_iso, "items": items}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("Лента: всего", len(items), "| новых за сегодня:", len(fresh))


if __name__ == "__main__":
    main()
