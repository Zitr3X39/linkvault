# -*- coding: utf-8 -*-
"""LinkVault: общая логика для сбора ссылок (без внешних библиотек)."""

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import unescape
from urllib import request
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

SYNC_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SYNC_DIR)
DATA_DIR = os.path.join(ROOT, "data")
LINKS_PATH = os.path.join(DATA_DIR, "links.json")
CATEGORIES_PATH = os.path.join(DATA_DIR, "categories.json")
STATE_PATH = os.path.join(SYNC_DIR, "state.json")
CONFIG_PATH = os.path.join(SYNC_DIR, "config.json")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
URL_RE = re.compile(r"(?:https?://|www\.|t\.me/)[^\s<>\"'«»]+", re.I)
TRACK_RE = re.compile(r"^(?:utm_|fbclid|gclid|yclid|igshid|si$|ref$|ref_src|mc_cid|mc_eid|_openstat)", re.I)


def console(msg):
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(str(msg).encode("ascii", "replace").decode("ascii"), flush=True)


def _load_rules():
    try:
        with open(CATEGORIES_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


_CFG = _load_rules()
CATEGORIES = _CFG.get("categories") or [{"id": "other", "name": "Разное", "color": "#8B8B86"}]
TYPES = _CFG.get("types") or {"site": "Сайт"}
RULES = _CFG.get("rules") or []


def clean_url(raw):
    s = (raw or "").strip().strip("<>()[]\"'«».,;")
    if not s:
        return ""
    if not re.match(r"^https?://", s, re.I):
        s = "https://" + s.lstrip("/")
    try:
        u = urlparse(s)
        host = (u.hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]
        if not host or "." not in host:
            return ""
        query = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if not TRACK_RE.match(k)]
        path = u.path
        if len(path) > 1 and path.endswith("/"):
            path = path[:-1]
        port = ""
        if u.port and u.port not in (80, 443):
            port = ":" + str(u.port)
        return urlunparse((u.scheme.lower() or "https", host + port, path, "", urlencode(query), ""))
    except Exception:
        return ""


def domain_of(url):
    try:
        host = (urlparse(url).hostname or "").lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def url_key(url):
    return re.sub(r"^https?://", "", clean_url(url), flags=re.I).lower()


def detect_type(url):
    d = domain_of(url)
    if d == "github.com" or d.endswith(".github.com"):
        return "github"
    if d in ("t.me", "telegram.me", "telegram.org"):
        return "telegram"
    if d.endswith("tiktok.com"):
        return "tiktok"
    if d.endswith("youtube.com") or d == "youtu.be":
        return "youtube"
    if d.endswith("twitter.com") or d.endswith("x.com"):
        return "twitter"
    if d.endswith("reddit.com"):
        return "reddit"
    return "site"


def _domain_match(domain, listed):
    return any(domain == x or domain.endswith("." + x) for x in listed)


def detect_category(url, text=""):
    domain = domain_of(url)
    for rule in RULES:
        if _domain_match(domain, rule.get("domains", [])):
            return rule.get("cat", "other")
    hay = (url + " " + (text or "")).lower()
    for rule in RULES:
        for word in rule.get("words", []):
            if str(word).lower() in hay:
                return rule.get("cat", "other")
    return "other"


def guess_title(url):
    parts = [p for p in urlparse(url).path.split("/") if p]
    if detect_type(url) == "github" and len(parts) >= 2:
        return parts[0] + "/" + parts[1]
    if parts:
        tail = re.sub(r"\.\w{2,5}$", "", parts[-1])
        return re.sub(r"[-_+]+", " ", tail)[:90] or domain_of(url)
    return domain_of(url)


def extract_links(text):
    out = []
    seen = set()
    for line in (text or "").splitlines():
        for raw in URL_RE.findall(line):
            url = clean_url(raw)
            if not url:
                continue
            key = url_key(url)
            if key in seen:
                continue
            seen.add(key)
            out.append((url, line.replace(raw, " ").strip()))
    return out


def _get(url, timeout=12, limit=250000):
    req = request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ru,en;q=0.8"})
    with request.urlopen(req, timeout=timeout) as resp:
        return resp.read(limit)


def _meta(html):
    title = ""
    desc = ""
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if m:
        title = unescape(re.sub(r"\s+", " ", m.group(1))).strip()
    for pattern in (
        r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\'](.*?)["\']',
        r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']',
    ):
        m = re.search(pattern, html, re.I | re.S)
        if m:
            desc = unescape(re.sub(r"\s+", " ", m.group(1))).strip()
            break
    m = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\'](.*?)["\']', html, re.I | re.S)
    if m and not title:
        title = unescape(re.sub(r"\s+", " ", m.group(1))).strip()
    return title[:160], desc[:300]


def fetch_meta(url):
    """Возвращает (title, description, stars). Никаких ключей не требует."""
    kind = detect_type(url)
    try:
        if kind == "github":
            parts = [p for p in urlparse(url).path.split("/") if p]
            if len(parts) >= 2:
                api = "https://api.github.com/repos/" + parts[0] + "/" + parts[1]
                data = json.loads(_get(api, timeout=12).decode("utf-8", "replace"))
                desc = data.get("description") or ""
                if data.get("language"):
                    desc = (desc + " · " + data["language"]).strip(" ·")
                return data.get("full_name") or guess_title(url), desc[:300], int(data.get("stargazers_count") or 0)
        if kind in ("youtube", "tiktok", "twitter"):
            api = "https://noembed.com/embed?url=" + request.quote(url, safe="")
            data = json.loads(_get(api, timeout=12).decode("utf-8", "replace"))
            if data.get("title"):
                return data["title"][:160], (data.get("author_name") or "")[:300], 0
        html = _get(url).decode("utf-8", "replace")
        title, desc = _meta(html)
        return title or guess_title(url), desc, 0
    except Exception:
        return "", "", 0


def enrich(items, workers=8):
    todo = [i for i in items if not i.get("enriched")]
    if not todo:
        return 0
    done = 0

    def work(item):
        title, desc, stars = fetch_meta(item["url"])
        if title:
            item["title"] = title
        if desc and len(desc) > len(item.get("description") or ""):
            item["description"] = desc
        if stars:
            item["stars"] = stars
        item["enriched"] = bool(title)
        if item.get("category") in (None, "", "other"):
            item["category"] = detect_category(item["url"], (item.get("title") or "") + " " + (item.get("description") or ""))
        return bool(title)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for ok in pool.map(work, todo):
            done += 1 if ok else 0
    return done


def make_item(url, text="", source="", added_at=None):
    url = clean_url(url)
    return {
        "url": url,
        "url_key": url_key(url),
        "title": guess_title(url),
        "description": (text or "").strip()[:220],
        "note": "",
        "domain": domain_of(url),
        "category": detect_category(url, text),
        "type": detect_type(url),
        "source": source or "Вручную",
        "tags": [],
        "favorite": False,
        "stars": 0,
        "enriched": False,
        "added_at": added_at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def load_links():
    try:
        with open(LINKS_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        data.setdefault("version", 1)
        data.setdefault("items", [])
        return data
    except Exception:
        return {"version": 1, "updated_at": None, "items": []}


def save_links(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    data["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    data["items"].sort(key=lambda i: str(i.get("added_at") or ""), reverse=True)
    tmp = LINKS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    os.replace(tmp, LINKS_PATH)


def add_items(data, items):
    known = {i.get("url_key") or url_key(i.get("url", "")) for i in data["items"]}
    fresh = []
    for item in items:
        key = item.get("url_key") or url_key(item.get("url", ""))
        if not key or key in known:
            continue
        known.add(key)
        fresh.append(item)
    data["items"].extend(fresh)
    return fresh


def load_state():
    try:
        with open(STATE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def save_state(state):
    with open(STATE_PATH, "w", encoding="utf-8", newline="") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=1)


def load_config():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def summary(data):
    by_cat = {}
    for item in data["items"]:
        cat = item.get("category") or "other"
        by_cat[cat] = by_cat.get(cat, 0) + 1
    names = {c["id"]: c["name"] for c in CATEGORIES}
    console("")
    console("  Всего в хранилище: " + str(len(data["items"])))
    for cat, num in sorted(by_cat.items(), key=lambda kv: -kv[1]):
        console("   · " + names.get(cat, cat) + ": " + str(num))
