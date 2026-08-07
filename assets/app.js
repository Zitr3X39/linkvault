(() => {
  "use strict";

  const PROTO = "https:" + "//";
  const GH_API = PROTO + "api.github.com";
  const NOEMBED = PROTO + "noembed.com/embed?url=";

  const LS = {
    overlay: "lv.overlay.v1",
    theme: "lv.theme",
    repo: "lv.repo",
    branch: "lv.branch",
    token: "lv.token",
    sha: "lv.sha",
  };

  const FALLBACK = {
    categories: [
      { id: "video", name: "Видео / YouTube", color: "#FF6B57" },
      { id: "vibecoding", name: "Вайб-кодинг / AI", color: "#A78BFA" },
      { id: "ai-skills", name: "AI-скиллы", color: "#E879F9" },
      { id: "prompts", name: "Промты", color: "#F2A03D" },
      { id: "design", name: "Дизайн / монтаж", color: "#F472B6" },
      { id: "3d", name: "3D / рендер", color: "#22D3EE" },
      { id: "gamedev", name: "Геймдев", color: "#34D399" },
      { id: "extensions", name: "Расширения браузера", color: "#F97316" },
      { id: "music", name: "Музыка / аудио", color: "#FB7185" },
      { id: "automation", name: "Автоматизация", color: "#38BDF8" },
      { id: "osint", name: "OSINT / безопасность", color: "#EF4444" },
      { id: "tools", name: "Софт / утилиты", color: "#94A3B8" },
      { id: "learning", name: "Обучение / языки", color: "#FACC15" },
      { id: "marketing", name: "Маркетинг / SMM", color: "#C08457" },
      { id: "other", name: "Разное", color: "#8B8B86" },
    ],
    types: { github: "GitHub", telegram: "Telegram", tiktok: "TikTok", youtube: "YouTube", twitter: "X / Twitter", reddit: "Reddit", site: "Сайт" },
    rules: [],
  };

  const state = {
    baseItems: [],
    items: [],
    categories: FALLBACK.categories,
    types: FALLBACK.types,
    rules: [],
    updatedAt: null,
    enrich: {},
    baseSha: "",
    filters: { q: "", cat: "all", src: "all", sort: "new", fav: false },
    editingId: null,
  };

  const $ = (id) => document.getElementById(id);
  const el = {};
  const nf = new Intl.NumberFormat("ru-RU");
  const df = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  let toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
  }

  /* ---------- overlay (local edits) ---------- */
  function readOverlay() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS.overlay) || "{}");
      return { added: raw.added || [], edits: raw.edits || {}, deleted: raw.deleted || [] };
    } catch (e) { return { added: [], edits: {}, deleted: [] }; }
  }
  function writeOverlay(o) { localStorage.setItem(LS.overlay, JSON.stringify(o)); }
  function overlayCount(o) { return o.added.length + Object.keys(o.edits).length + o.deleted.length; }
  function hasToken() { return Boolean((localStorage.getItem(LS.token) || "").trim()); }

  function updatePendingHint() {
    const n = overlayCount(readOverlay());
    if (!n || hasToken()) { el.pendingHint.hidden = true; return; }
    el.pendingHint.hidden = false;
    el.pendingHint.textContent = n + " " + plural(n, "правка живёт", "правки живут", "правок живёт") + " только в этом браузере. Скачай links.json и залей в репозиторий, либо добавь токен в настройках.";
  }

  /* ---------- link parsing ---------- */
  const TRACK = /^(utm_|fbclid|gclid|yclid|igshid|si$|ref$|ref_src|mc_cid|mc_eid|_openstat)/i;

  function cleanUrl(raw) {
    let s = String(raw || "").trim().replace(/^[<(\["']+|[>)\]"'.,;«»]+$/g, "");
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) s = PROTO + s.replace(/^\/+/, "");
    try {
      const u = new URL(s);
      u.hash = "";
      u.hostname = u.hostname.replace(/^www\./i, "").toLowerCase();
      const keep = new URLSearchParams();
      u.searchParams.forEach((v, k) => { if (!TRACK.test(k)) keep.append(k, v); });
      u.search = keep.toString() ? "?" + keep.toString() : "";
      if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
      return u.toString();
    } catch (e) { return ""; }
  }

  const urlKey = (u) => cleanUrl(u).replace(/^https?:\/\//i, "").toLowerCase();
  function domainOf(u) { try { return new URL(u).hostname.replace(/^www\./i, ""); } catch (e) { return ""; } }

  function detectType(u) {
    const d = domainOf(u);
    if (/(^|\.)github\.com$/.test(d)) return "github";
    if (/(^|\.)(t\.me|telegram\.me|telegram\.org)$/.test(d)) return "telegram";
    if (/tiktok\.com$/.test(d)) return "tiktok";
    if (/(youtube\.com|youtu\.be)$/.test(d)) return "youtube";
    if (/(twitter\.com|x\.com)$/.test(d)) return "twitter";
    if (/reddit\.com$/.test(d)) return "reddit";
    return "site";
  }

  const STRONG_RULES = [
    ["automation", ["mcp", "n8n", "zapier", "webhook", "telethon", "telegram bot", "автоматиз"]],
    ["gamedev", ["godot", "unity", "unreal"]],
    ["video", ["ffmpeg", "davinci", "capcut", "монтаж", "озвуч"]],
    ["design", ["figma", "photoshop", "illustrator", "ui/ux"]],
    ["vibecoding", ["llm", "gpt", "openai", "anthropic", "claude", "langchain", "prompt"]]
  ];

  const EXTRA_RULES = [
    ["video", ["video", "видео", "ffmpeg", "montage", "монтаж", "shorts", "tts", "voice", "озвуч", "subtitle", "субтитр", "davinci", "capcut", "premiere", "youtube", "stream", "ролик"]],
    ["vibecoding", ["ai ", "ai-", "-ai", "llm", "gpt", "claude", "openai", "anthropic", "prompt", "agent", "langchain", "copilot", "cursor", "neural", "нейрос", "machine learning", "fine-tun", "embedding", "vector db"]],
    ["gamedev", ["game", "игр", "godot", "unity", "unreal", "sprite", "pixel art"]],
    ["design", ["design", "дизайн", "figma", "ui/ux", "icon", "шрифт", "font", "mockup", "photoshop", "illustrator"]],
    ["automation", ["mcp", "telegram", "n8n", "zapier", "workflow", "automation", "automated", "автоматиз", "webhook", "scraper", "парсер", "selenium", "playwright", "integration", "bot ", "bots"]],
    ["learning", ["course", "курс", "tutorial", "learn", "обучен", "guide", "гайд", "docs", "documentation", "roadmap", "awesome ", "cheatsheet"]],
    ["tools", ["cli", "downloader", "converter", "конверт", "utility", "утилит", "manager", "backup", "extension", "расширен", "toolkit"]]
  ];

  function detectCategory(url, text) {
    const hay = ((url || "") + " " + (text || "")).toLowerCase();
    const d = domainOf(url);
    for (const rule of state.rules) {
      if ((rule.domains || []).some((x) => d === x || d.endsWith("." + x))) return rule.cat;
    }
    for (const pair of STRONG_RULES) {
      if (pair[1].some((w) => hay.includes(w))) return pair[0];
    }
    for (const rule of state.rules) {
      if ((rule.words || []).some((w) => hay.includes(String(w).toLowerCase()))) return rule.cat;
    }
    for (const pair of EXTRA_RULES) {
      if (pair[1].some((w) => hay.includes(w))) return pair[0];
    }
    return "other";
  }

  function guessTitle(u) {
    try {
      const url = new URL(u);
      const parts = url.pathname.split("/").filter(Boolean);
      if (detectType(u) === "github" && parts.length >= 2) return parts[0] + "/" + parts[1];
      if (parts.length) return decodeURIComponent(parts[parts.length - 1]).replace(/[-_+]/g, " ").replace(/\.\w{2,5}$/, "").slice(0, 90);
      return url.hostname.replace(/^www\./i, "");
    } catch (e) { return u; }
  }

  function extractLinks(text) {
    const out = [];
    const seen = new Set();
    const re = /(?:https?:\/\/|www\.|t\.me\/)[^\s<>"'«»]+/gi;
    const lines = String(text || "").split(/\r?\n/);
    for (const line of lines) {
      const found = line.match(re);
      if (!found) continue;
      for (const raw of found) {
        const url = cleanUrl(raw);
        if (!url) continue;
        const key = urlKey(url);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ url: url, context: line.replace(raw, " ").trim() });
      }
    }
    return out;
  }

  /* ---------- data ---------- */
  async function loadData() {
    const bust = "?v=" + Date.now();
    try {
      const res = await fetch("data/categories.json" + bust, { cache: "no-store" });
      if (res.ok) {
        const cfg = await res.json();
        if (Array.isArray(cfg.categories) && cfg.categories.length) state.categories = cfg.categories;
        if (cfg.types) state.types = cfg.types;
        if (Array.isArray(cfg.rules)) state.rules = cfg.rules;
      }
    } catch (e) { /* defaults */ }

    try {
      const resE = await fetch("data/enrich.json" + bust, { cache: "no-store" });
      if (resE.ok) {
        const ej = await resE.json();
        if (ej && ej.items) state.enrich = ej.items;
      }
    } catch (e) { /* enrich layer optional */ }

    const cfg = repoConfig();
    if (cfg.token && cfg.repo) {
      try {
        const r = await fetch(GH_API + "/repos/" + cfg.repo + "/contents/data/links.json?ref=" + encodeURIComponent(cfg.branch), { headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json" }, cache: "no-store" });
        if (r.ok) {
          const meta = await r.json();
          state.baseSha = meta.sha || "";
          try { localStorage.setItem(LS.sha, state.baseSha); } catch (e2) {}
          const bin = atob(String(meta.content || "").replace(/\n/g, ""));
          const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
          state.baseItems = Array.isArray(data.items) ? data.items : [];
          state.updatedAt = data.updated_at || null;
          return;
        }
      } catch (e3) { /* fall back to static file */ }
    }

    try {
      const res = await fetch("data/links.json" + bust, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        state.baseItems = Array.isArray(data.items) ? data.items : [];
        state.updatedAt = data.updated_at || null;
        try { localStorage.setItem(LS.sha, ""); } catch (e4) {}
      }
    } catch (e) {
      state.baseItems = [];
    }
  }

  function applyOverlay() {
    const o = readOverlay();
    const gone = new Set(o.deleted);
    const merged = [];
    for (const it of state.baseItems.concat(o.added)) {
      const key = it.url_key || urlKey(it.url);
      if (gone.has(key)) continue;
      const userEdits = o.edits[key] || {};
      const base = Object.assign({}, it, { url_key: key }, userEdits);
      const enr = state.enrich[key];
      if (enr) {
        const t = String(base.title || "").trim();
        const letters = t.replace(/[^a-z\u0400-\u04ff]/gi, "").length;
        const junk = !t || /^[a-p]{16,}$/i.test(t) || /^[a-z0-9]{20,}$/i.test(t) || letters < 4;
        if (enr.title && junk && !userEdits.title) base.title = enr.title;
        if (enr.description && !String(base.description || "").trim()) base.description = enr.description;
        if (enr.category && (base.category || "other") === "other" && !userEdits.category) base.category = enr.category;
      }
      merged.push(base);
    }
    const byKey = new Map();
    for (const it of merged) if (!byKey.has(it.url_key)) byKey.set(it.url_key, it);
    state.items = Array.from(byKey.values());
    updatePendingHint();
  }

  const catInfo = (id) => state.categories.find((c) => c.id === id) || { id: "other", name: "Разное", color: "#8B8B86" };
  const typeLabel = (t) => state.types[t] || "Сайт";

  function currentItems(ovr) {
    const f = Object.assign({}, state.filters, ovr || {});
    const q = f.q.trim().toLowerCase();
    let list = state.items.slice();
    if (f.cat !== "all") list = list.filter((i) => (i.category || "other") === f.cat);
    if (f.src !== "all") list = list.filter((i) => (i.type || "site") === f.src);
    if (f.fav) list = list.filter((i) => i.favorite);
    if (q) {
      list = list.filter((i) => [i.title, i.description, i.note, i.url, (i.tags || []).join(" "), i.source].join(" ").toLowerCase().includes(q));
    }
    const s = f.sort;
    list.sort((a, b) => {
      if (s === "az") return String(a.title || "").localeCompare(String(b.title || ""), "ru");
      if (s === "stars") return (b.stars || 0) - (a.stars || 0);
      const da = String(a.added_at || ""), db = String(b.added_at || "");
      return s === "old" ? da.localeCompare(db) : db.localeCompare(da);
    });
    return list;
  }

  /* ---------- render ---------- */
  function navButton(opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "nav-item";
    b.dataset.value = opts.value;
    b.setAttribute("aria-pressed", String(opts.active));
    b.innerHTML =
      '<span class="dot" style="background:' + esc(opts.color || "currentColor") + '"></span>' +
      '<span class="label">' + esc(opts.label) + "</span>" +
      '<span class="num">' + nf.format(opts.count) + "</span>";
    return b;
  }

  function renderNav() {
    const f = state.filters;
    el.navCategories.innerHTML = "";
    el.navCategories.appendChild(navButton({ value: "all", label: "Всё хранилище", count: currentItems({ cat: "all" }).length, active: f.cat === "all", color: "var(--text-3)" }));
    for (const c of state.categories) {
      const total = state.items.filter((i) => (i.category || "other") === c.id).length;
      if (!total && c.id !== "other") continue;
      const n = currentItems({ cat: c.id }).length;
      const b = navButton({ value: c.id, label: c.name, count: n, active: f.cat === c.id, color: c.color });
      if (!n) b.classList.add("is-zero");
      el.navCategories.appendChild(b);
    }
    el.navSources.innerHTML = "";
    el.navSources.appendChild(navButton({ value: "all", label: "Любой", count: currentItems({ src: "all" }).length, active: f.src === "all", color: "var(--text-3)" }));
    for (const t of Object.keys(state.types)) {
      const total = state.items.filter((i) => (i.type || "site") === t).length;
      if (!total) continue;
      const n = currentItems({ src: t }).length;
      const b = navButton({ value: t, label: typeLabel(t), count: n, active: f.src === t, color: "var(--text-3)" });
      if (!n) b.classList.add("is-zero");
      el.navSources.appendChild(b);
    }
  }

  function renderChips() {
    if (!el.chips) return;
    const f = state.filters;
    el.chips.innerHTML = "";
    const mk = (value, label, n, active) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (active ? " is-on" : "");
      b.dataset.value = value;
      b.setAttribute("aria-pressed", String(active));
      b.innerHTML = esc(label) + ' <span class="chip-num">' + nf.format(n) + "</span>";
      return b;
    };
    el.chips.appendChild(mk("all", "Все", currentItems({ src: "all" }).length, f.src === "all"));
    for (const t of Object.keys(state.types)) {
      const n = currentItems({ src: t }).length;
      if (!n && f.src !== t) continue;
      el.chips.appendChild(mk(t, typeLabel(t), n, f.src === t));
    }
  }

  /* Домены, где внешний скриншот всегда мусор (Cloudflare, логин-страницы) — им рисуем свою обложку */
  var NO_SHOT = ["chromewebstore.google.com", "curseforge.com", "t.me", "tiktok.com", "vm.tiktok.com"];

  function mediaSrc(u) {
    try {
      var url = new URL(u);
      var h = url.hostname.replace(/^www\./, "");
      var yt = null;
      if (h === "youtu.be") yt = url.pathname.slice(1);
      else if (/(^|\.)youtube\.com$/.test(h)) yt = url.searchParams.get("v") || (url.pathname.match(/\/(shorts|embed|live)\/([\w-]+)/) || [])[2] || null;
      if (yt) return "https://i.ytimg.com/vi/" + yt + "/hqdefault.jpg";
      if (h === "github.com") {
        var seg = url.pathname.split("/").filter(Boolean);
        if (seg.length >= 2) return "https://opengraph.githubassets.com/1/" + seg[0] + "/" + seg[1];
      }
      for (var i = 0; i < NO_SHOT.length; i++) if (h === NO_SHOT[i] || h.endsWith("." + NO_SHOT[i])) return "";
      return "https://s.wordpress.com/mshots/v1/" + encodeURIComponent(url.origin + url.pathname) + "?w=640&h=360";
    } catch (e) { return ""; }
  }

  var BRANDS = { "chromewebstore.google.com": "Chrome Web Store", "curseforge.com": "CurseForge", "21st.dev": "21st.dev", "t.me": "Telegram" };
  function prettyTitle(it) {
    var t = String(it.title || "").trim();
    var d = String(it.domain || domainOf(it.url) || "").replace(/^www\./, "");
    var letters = t.replace(/[^a-z\u0400-\u04ff]/gi, "").length;
    var junk = !t || /^[a-p]{16,}$/i.test(t) || /^[a-z0-9]{20,}$/i.test(t) || letters < 4;
    if (!junk) return t;
    if (BRANDS[d]) return BRANDS[d];
    if (!d) return t || guessTitle(it.url);
    var base = d.split(".")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  function cardHtml(it) {
    const cat = catInfo(it.category || "other");
    const tags = (it.tags || []).slice(0, 3).map((t) => '<span class="tag tag-plain">#' + esc(t) + "</span>").join("");
    const stars = it.stars ? '<span class="stars">★ ' + (it.stars >= 1000 ? (it.stars / 1000).toFixed(1).replace(".", ",") + "k" : nf.format(it.stars)) + "</span>" : "";
    const note = it.note ? '<p class="card-note">' + esc(it.note) + "</p>" : "";
    const desc = it.description ? '<p class="card-desc">' + esc(it.description) + "</p>" : "";
    const psrc = mediaSrc(it.url);
    const letter = esc(String(prettyTitle(it) || it.domain || "?").trim().charAt(0).toUpperCase() || "?");
    const dom = it.domain || domainOf(it.url);
    const favSrc = dom ? "https://icons.duckduckgo.com/ip3/" + dom + ".ico" : "";
    const starsCov = it.stars ? '<span class="cover-stars">\u2605 ' + (it.stars >= 1000 ? (it.stars / 1000).toFixed(1).replace(".", ",") + "k" : nf.format(it.stars)) + "</span>" : "";
    const media =
      '<div class="card-media is-ready is-cover' + (psrc ? " has-img" : "") + '" data-letter="' + letter + '">' +
      (favSrc ? '<img class="cover-fav" src="' + esc(favSrc) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">' : "") +
      '<span class="cover-title">' + esc(prettyTitle(it)) + "</span>" +
      starsCov +
      (psrc ? '<img class="cover-shot" src="' + esc(psrc) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">' : "") +
      "</div>";
    return (
      '<article class="card" style="--cat:' + esc(cat.color) + '" data-id="' + esc(it.url_key) + '">' +
        media +
        '<div class="card-top">' +
          '<h3 class="card-title"><a href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">' + esc(prettyTitle(it)) + "</a></h3>" +
          '<div class="card-actions">' +
            '<button type="button" class="icon-btn" data-action="fav" aria-pressed="' + (it.favorite ? "true" : "false") + '" aria-label="В избранное"><svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z" fill="' + (it.favorite ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="1.4"/></svg></button>' +
            '<button type="button" class="icon-btn" data-action="edit" aria-label="Изменить"><svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M13.4 3.6a1.9 1.9 0 0 1 2.7 2.7L7.6 14.8 4 16l1.2-3.6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></button>' +
          "</div>" +
        "</div>" +
        desc + note +
        '<div class="card-meta">' +
          '<span class="tag">' + esc(cat.name) + "</span>" +
          '<span class="tag tag-plain">' + esc(typeLabel(it.type)) + "</span>" +
          tags + stars +
          '<span class="domain" translate="no">' + esc(it.domain || domainOf(it.url)) + "</span>" +
        "</div>" +
      "</article>"
    );
  }

  function renderCards() {
    const list = currentItems();
    el.grid.innerHTML = list.map(cardHtml).join("");
    el.viewCount.textContent = nf.format(list.length) + " " + plural(list.length, "ссылка", "ссылки", "ссылок");
    const f = state.filters;
    el.viewTitle.textContent = f.cat === "all" ? "Всё хранилище" : catInfo(f.cat).name;
    const filtered = f.q || f.cat !== "all" || f.src !== "all" || f.fav;
    el.empty.hidden = list.length > 0;
    if (!list.length) {
      el.emptyTitle.textContent = filtered ? "Ничего не нашлось" : "Хранилище пустое";
      el.emptyText.textContent = filtered
        ? "Попробуй другой запрос или сбрось фильтры слева."
        : "Запусти синхронизацию с Telegram или вставь ссылки руками — разложит по категориям само.";
    }
  }

  function renderMeta() {
    const total = state.items.length;
    const when = state.updatedAt ? df.format(new Date(state.updatedAt)) : "—";
    el.brandMeta.textContent = nf.format(total) + " " + plural(total, "ссылка", "ссылки", "ссылок") + " · обновлено " + when;
  }

  function renderAll() { applyOverlay(); renderNav(); renderChips(); renderCards(); renderMeta(); }

  /* ---------- url state ---------- */
  function syncUrl() {
    const f = state.filters;
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.cat !== "all") p.set("cat", f.cat);
    if (f.src !== "all") p.set("src", f.src);
    if (f.sort !== "new") p.set("sort", f.sort);
    if (f.fav) p.set("fav", "1");
    const qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }

  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.filters.q = p.get("q") || "";
    state.filters.cat = p.get("cat") || "all";
    state.filters.src = p.get("src") || "all";
    state.filters.sort = p.get("sort") || "new";
    state.filters.fav = p.get("fav") === "1";
    el.q.value = state.filters.q;
    el.sort.value = state.filters.sort;
    el.btnFav.setAttribute("aria-pressed", String(state.filters.fav));
    const su = p.get("share_url"), stx = p.get("share_text"), sti = p.get("share_title");
    if (su || stx || sti) {
      el.addText.value = [su, stx, sti].filter(Boolean).join("\n");
      openDialog(el.dlgAdd);
    }
  }

  /* ---------- enrichment (no api keys; github token used if present) ---------- */
  async function fetchOg(url) {
    const proxies = ["https://api.allorigins.win/raw?url=", "https://corsproxy.io/?url="];
    for (const px of proxies) {
      try {
        const r = await fetch(px + encodeURIComponent(url));
        if (!r.ok) continue;
        const html = (await r.text()).slice(0, 150000);
        const pick = (re) => { const m = html.match(re); return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim() : ""; };
        const desc = pick(/<meta[^>]+(?:property|name)=["']og:description["'][^>]+content=["']([^"']+)["']/i)
          || pick(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:description["']/i)
          || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
        const title = pick(/<title[^>]*>([^<]{4,160})<\/title>/i);
        if (desc || title) return { title: title, description: desc };
      } catch (e) { /* next proxy */ }
    }
    return null;
  }

  async function enrichItem(item) {
    const type = item.type;
    try {
      if (type === "github") {
        const m = new URL(item.url).pathname.split("/").filter(Boolean);
        if (m.length >= 2) {
          const headers = { Accept: "application/vnd.github+json" };
          const tk = (localStorage.getItem(LS.token) || "").trim();
          if (tk) headers.Authorization = "Bearer " + tk;
          const r = await fetch(GH_API + "/repos/" + m[0] + "/" + m[1], { headers: headers });
          if (r.ok) {
            const j = await r.json();
            item.title = j.full_name || item.title;
            item.description = j.description || item.description;
            item.stars = j.stargazers_count || 0;
            if (j.language) item.description = (item.description || "") + " · " + j.language;
            item.enriched = true;
          }
        }
      } else if (type === "youtube" || type === "tiktok" || type === "twitter") {
        const r = await fetch(NOEMBED + encodeURIComponent(item.url));
        if (r.ok) {
          const j = await r.json();
          if (j && j.title && !j.error) {
            item.title = j.title;
            if (j.author_name) item.description = item.description || j.author_name;
            item.enriched = true;
          }
        }
      } else {
        const og = await fetchOg(item.url);
        if (og) {
          if (og.title) item.title = og.title;
          if (og.description && !item.description) item.description = og.description.slice(0, 220);
          item.enriched = true;
        }
      }
      if (item.description && needsRu(item.description)) {
        const ru = await translateOne(item.description);
        if (ru) item.description = ru;
      }
    } catch (e) { /* offline or blocked — keep guessed title */ }
    return item;
  }

  function flashCard(key) {
    if (!key) return;
    state.filters.q = "";
    state.filters.cat = "all";
    state.filters.src = "all";
    state.filters.fav = false;
    el.q.value = "";
    el.btnFav.setAttribute("aria-pressed", "false");
    renderAll();
    syncUrl();
    requestAnimationFrame(() => {
      const cards = el.grid.querySelectorAll(".card");
      for (const card of cards) {
        if (card.dataset.id !== key) continue;
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("is-flash");
        setTimeout(() => card.classList.remove("is-flash"), 2600);
        break;
      }
    });
  }

  /* ---------- mutations ---------- */
  async function addLinks(text, enrich) {
    const found = extractLinks(text);
    if (!found.length) { toast("Ссылок в тексте не нашлось"); return; }
    const known = new Set(state.items.map((i) => i.url_key));
    const now = new Date().toISOString();
    const fresh = [];
    const dupes = [];
    for (const f of found) {
      const key = urlKey(f.url);
      if (known.has(key)) { dupes.push(key); continue; }
      known.add(key);
      fresh.push({
        url: f.url, url_key: key,
        title: guessTitle(f.url),
        description: f.context ? f.context.slice(0, 220) : "",
        note: "", domain: domainOf(f.url),
        category: detectCategory(f.url, f.context),
        type: detectType(f.url), source: "Вручную",
        tags: [], favorite: false, stars: 0, enriched: false, added_at: now,
      });
    }
    if (!fresh.length) {
      toast(dupes.length ? "Уже в хранилище: " + dupes.length + " — подсвечиваю карточку" : "Ссылок в тексте не нашлось");
      flashCard(dupes[0]);
      return;
    }

    const o = readOverlay();
    o.added = o.added.concat(fresh);
    o.deleted = o.deleted.filter((k) => !fresh.some((f) => f.url_key === k));
    writeOverlay(o);
    renderAll();
    toast("Добавлено: " + fresh.length + (dupes.length ? ", уже было: " + dupes.length : ""));
    if (dupes.length) flashCard(dupes[0]);

    if (enrich) {
      for (const item of fresh.slice(0, 25)) {
        await enrichItem(item);
        const cur = readOverlay();
        cur.added = cur.added.map((x) => (x.url_key === item.url_key ? item : x));
        writeOverlay(cur);
      }
      renderAll();
    }
    await persist("Добавлено ссылок: " + fresh.length);
  }

  async function patchItem(key, patch, message) {
    const o = readOverlay();
    const inAdded = o.added.findIndex((x) => x.url_key === key);
    if (inAdded >= 0) o.added[inAdded] = Object.assign({}, o.added[inAdded], patch);
    else o.edits[key] = Object.assign({}, o.edits[key] || {}, patch);
    writeOverlay(o);
    renderAll();
    await persist(message);
  }

  async function deleteItem(key) {
    const o = readOverlay();
    o.added = o.added.filter((x) => x.url_key !== key);
    delete o.edits[key];
    if (state.baseItems.some((x) => (x.url_key || urlKey(x.url)) === key)) o.deleted.push(key);
    writeOverlay(o);
    renderAll();
    await persist("Удалена ссылка");
  }

  /* ---------- github push ---------- */
  function repoConfig() {
    return {
      repo: (localStorage.getItem(LS.repo) || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, ""),
      branch: (localStorage.getItem(LS.branch) || "main").trim() || "main",
      token: (localStorage.getItem(LS.token) || "").trim(),
    };
  }

  function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  function buildPayload() {
    const items = state.items.slice().sort((a, b) => String(b.added_at || "").localeCompare(String(a.added_at || "")));
    return JSON.stringify({ version: 1, updated_at: new Date().toISOString(), items: items }, null, 1) + "\n";
  }

  async function persist(message) {
    const cfg = repoConfig();
    if (!cfg.token || !cfg.repo) { updatePendingHint(); return false; }
    const path = "data/links.json";
    const headers = { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json" };
    try {
      let sha = null;
      let meta = null;
      const head = await fetch(GH_API + "/repos/" + cfg.repo + "/contents/" + path + "?ref=" + encodeURIComponent(cfg.branch) + "&_=" + Date.now(), { headers: headers, cache: "no-store" });
      if (head.ok) { meta = await head.json(); sha = meta.sha; }
      const knownSha = (localStorage.getItem(LS.sha) || "").trim();
      if (sha && knownSha && sha !== knownSha && meta && meta.content) {
        try {
          const bin = atob(String(meta.content).replace(/\n/g, ""));
          const remote = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
          const mine = new Set(state.items.map((i) => i.url_key));
          const extra = (Array.isArray(remote.items) ? remote.items : []).filter((x) => !mine.has(x.url_key || urlKey(x.url)));
          if (extra.length) {
            state.items = state.items.concat(extra.map((x) => Object.assign({}, x, { url_key: x.url_key || urlKey(x.url) })));
            toast("Подтянуто с другого устройства: " + extra.length);
          }
        } catch (e5) { /* merge skipped, local wins */ }
      }
      const body = { message: "LinkVault: " + (message || "обновление"), content: toBase64(buildPayload()), branch: cfg.branch };
      if (sha) body.sha = sha;
      const put = await fetch(GH_API + "/repos/" + cfg.repo + "/contents/" + path, { method: "PUT", headers: headers, body: JSON.stringify(body) });
      if (!put.ok) { toast("GitHub отказал: " + put.status + ". Проверь токен и имя репозитория."); return false; }
      const putJson = await put.json().catch(() => null);
      const newSha = (putJson && putJson.content && putJson.content.sha) || "";
      state.baseItems = state.items.slice();
      writeOverlay({ added: [], edits: {}, deleted: [] });
      state.updatedAt = new Date().toISOString();
      state.baseSha = newSha;
      try { localStorage.setItem(LS.sha, newSha); } catch (e6) {}
      renderAll();
      toast("Сохранено в репозиторий");
      return true;
    } catch (e) {
      toast("Нет связи с GitHub — правки остались в браузере");
      return false;
    }
  }

  /* ---------- dialogs ---------- */
  const openDialog = (d) => { if (!d.open) d.showModal(); };
  const closeDialog = (d) => { if (d.open) d.close(); };

  function openEdit(key) {
    const it = state.items.find((x) => x.url_key === key);
    if (!it) return;
    state.editingId = key;
    el.editTitle.value = it.title || "";
    el.editDesc.value = it.description || "";
    el.editNote.value = it.note || "";
    el.editTags.value = (it.tags || []).join(", ");
    el.editCat.innerHTML = state.categories.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>").join("");
    el.editCat.value = it.category || "other";
    el.editUrl.textContent = it.url;
    el.editUrl.href = it.url;
    openDialog(el.dlgEdit);
    setTimeout(() => el.editTitle.focus(), 30);
  }

  function openSettings() {
    const cfg = repoConfig();
    el.setRepo.value = cfg.repo;
    el.setBranch.value = cfg.branch;
    el.setToken.value = cfg.token;
    openDialog(el.dlgSettings);
  }

  function setTheme(mode) {
    document.documentElement.dataset.theme = mode;
    localStorage.setItem(LS.theme, mode);
    el.btnTheme.setAttribute("aria-pressed", String(mode === "light"));
  }

  /* ---------- events ---------- */
  function wireEvents() {
    el.searchForm.addEventListener("submit", (e) => e.preventDefault());
    let qTimer = 0;
    el.q.addEventListener("input", () => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { state.filters.q = el.q.value; renderCards(); syncUrl(); }, 120);
    });
    el.sort.addEventListener("change", () => { state.filters.sort = el.sort.value; renderCards(); syncUrl(); });
    el.btnFav.addEventListener("click", () => {
      state.filters.fav = !state.filters.fav;
      el.btnFav.setAttribute("aria-pressed", String(state.filters.fav));
      renderCards(); syncUrl();
    });
    el.navCategories.addEventListener("click", (e) => {
      const b = e.target.closest(".nav-item"); if (!b) return;
      state.filters.cat = b.dataset.value;
      renderNav(); renderChips(); renderCards(); syncUrl();
    });
    el.navSources.addEventListener("click", (e) => {
      const b = e.target.closest(".nav-item"); if (!b) return;
      state.filters.src = b.dataset.value; renderNav(); renderChips(); renderCards(); syncUrl();
    });
    if (el.chips) el.chips.addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      state.filters.src = b.dataset.value; renderNav(); renderChips(); renderCards(); syncUrl();
    });
    el.grid.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]"); if (!btn) return;
      const card = btn.closest(".card"); if (!card) return;
      const key = card.dataset.id;
      if (btn.dataset.action === "edit") { openEdit(key); return; }
      const it = state.items.find((x) => x.url_key === key);
      if (it) patchItem(key, { favorite: !it.favorite }, it.favorite ? "Убрано из избранного" : "Добавлено в избранное");
    });

    el.btnAdd.addEventListener("click", () => { el.addText.value = ""; openDialog(el.dlgAdd); setTimeout(() => el.addText.focus(), 30); });
    el.btnEmptyAdd.addEventListener("click", () => el.btnAdd.click());
    el.btnSettings.addEventListener("click", openSettings);
    el.btnTheme.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));

    document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeDialog($(b.dataset.close))));

    el.formAdd.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = el.addText.value;
      const enrich = el.addEnrich.checked;
      el.addSubmit.disabled = true;
      el.addSubmit.textContent = "Добавляю…";
      closeDialog(el.dlgAdd);
      await addLinks(text, enrich);
      el.addSubmit.disabled = false;
      el.addSubmit.textContent = "Добавить";
    });

    el.formEdit.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!state.editingId) return;
      const patch = {
        title: el.editTitle.value.trim(),
        description: el.editDesc.value.trim(),
        note: el.editNote.value.trim(),
        category: el.editCat.value,
        tags: el.editTags.value.split(",").map((t) => t.trim()).filter(Boolean),
      };
      const key = state.editingId;
      closeDialog(el.dlgEdit);
      patchItem(key, patch, "Правка карточки");
    });

    el.btnDelete.addEventListener("click", () => {
      if (!state.editingId) return;
      if (!confirm("Удалить эту ссылку из хранилища?")) return;
      const key = state.editingId;
      closeDialog(el.dlgEdit);
      deleteItem(key);
    });

    el.formSettings.addEventListener("submit", (e) => {
      e.preventDefault();
      localStorage.setItem(LS.repo, el.setRepo.value.trim());
      localStorage.setItem(LS.branch, el.setBranch.value.trim() || "main");
      localStorage.setItem(LS.token, el.setToken.value.trim());
      closeDialog(el.dlgSettings);
      updatePendingHint();
      if (hasToken() && overlayCount(readOverlay())) persist("Синхронизация накопленных правок");
      else toast("Настройки сохранены");
    });

    el.btnForget.addEventListener("click", () => {
      localStorage.removeItem(LS.token);
      el.setToken.value = "";
      updatePendingHint();
      toast("Токен удалён из браузера");
    });

    el.btnExport.addEventListener("click", () => {
      const blob = new Blob([buildPayload()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "links.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("Файл скачан — положи его в папку data и запусти PUBLISH.bat");
    });

    document.addEventListener("keydown", (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
      if (e.key === "/") {
        e.preventDefault(); el.q.focus(); el.q.select();
      } else if (e.key === "a" || e.key === "A" || e.key === "\u0444" || e.key === "\u0424") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault(); el.btnAdd.click();
      }
    });
  }

  function recategorize() {
    const o = readOverlay();
    let n = 0;
    for (const it of state.items) {
      if ((it.category || "other") !== "other") continue;
      const hay = [it.title, it.description, it.note, (it.tags || []).join(" ")].join(" ");
      const cat = detectCategory(it.url, hay);
      if (cat && cat !== "other") {
        o.edits[it.url_key] = Object.assign({}, o.edits[it.url_key] || {}, { category: cat });
        n++;
      }
    }
    if (!n) { toast("Всё уже разложено по категориям"); return; }
    writeOverlay(o);
    applyOverlay();
    renderAll();
    updatePendingHint();
    toast("Разложено: " + n);
  }

  const TR_KEY = "lv.tr.v1";
  function trCache() { try { return JSON.parse(localStorage.getItem(TR_KEY) || "{}"); } catch (e) { return {}; } }
  function trSave(c) { try { localStorage.setItem(TR_KEY, JSON.stringify(c)); } catch (e) {} }
  function needsRu(t) {
    if (!t) return false;
    const letters = (String(t).match(/\p{L}/gu) || []).length;
    if (letters < 4) return false;
    const cyr = (String(t).match(/[\u0400-\u04FF]/g) || []).length;
    return cyr / letters < 0.45;
  }
  async function translateOne(text) {
    const q = String(text).slice(0, 480);
    try {
      const r = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=" + encodeURIComponent(q));
      if (r.ok) {
        const j = await r.json();
        const out = (j[0] || []).map((x) => x[0]).join("").trim();
        if (out) return out;
      }
    } catch (e) {}
    try {
      const r2 = await fetch("https://api.mymemory.translated.net/get?langpair=en|ru&q=" + encodeURIComponent(q));
      if (r2.ok) {
        const j2 = await r2.json();
        const out2 = String(((j2 || {}).responseData || {}).translatedText || "").trim();
        if (out2 && !/MYMEMORY WARNING|QUERY LENGTH/i.test(out2)) return out2;
      }
    } catch (e) {}
    return "";
  }
  async function translateAll() {
    const targets = state.items.filter((it) => needsRu(it.description));
    if (!targets.length) { toast("\u0412\u0441\u0435 \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u0443\u0436\u0435 \u043d\u0430 \u0440\u0443\u0441\u0441\u043a\u043e\u043c"); return; }
    const cache = trCache();
    const o = readOverlay();
    let done = 0, ok = 0;
    const say = (n) => toast("\u041f\u0435\u0440\u0435\u0432\u043e\u0436\u0443: " + n + " / " + targets.length);
    say(0);
    for (const it of targets) {
      let ru = cache[it.description];
      if (!ru) { ru = await translateOne(it.description); if (ru) cache[it.description] = ru; }
      if (ru) {
        o.edits[it.url_key] = Object.assign({}, o.edits[it.url_key] || {}, { description: ru });
        ok++;
      }
      done++;
      say(done);
      await new Promise((r) => setTimeout(r, 220));
    }
    trSave(cache);
    if (!ok) { toast("\u041f\u0435\u0440\u0435\u0432\u043e\u0434\u0447\u0438\u043a \u043d\u0435 \u043e\u0442\u0432\u0435\u0442\u0438\u043b \u2014 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439 \u043f\u043e\u0437\u0436\u0435"); return; }
    writeOverlay(o);
    applyOverlay();
    renderAll();
    updatePendingHint();
    toast("\u041f\u0435\u0440\u0435\u0432\u0435\u0434\u0435\u043d\u043e: " + ok);
  }

  async function boot() {
    ["brandMeta","searchForm","q","btnAdd","btnTheme","btnSettings","navCategories","navSources","chips","btnExport","pendingHint","viewTitle","viewCount","sort","btnFav","grid","empty","emptyTitle","emptyText","btnEmptyAdd","dlgAdd","formAdd","addText","addEnrich","addSubmit","dlgEdit","formEdit","editTitle","editDesc","editCat","editTags","editNote","editUrl","btnDelete","dlgSettings","formSettings","setRepo","setBranch","setToken","btnForget","toast"].forEach((id) => { el[id] = $(id); });

    const saved = localStorage.getItem(LS.theme);
    setTheme(saved || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));

    wireEvents();
    const tb = document.getElementById("btnTranslate");
    if (tb) tb.addEventListener("click", translateAll);
    const rb = document.getElementById("btnRecat");
    if (rb) rb.addEventListener("click", recategorize);
    readUrl();
    await loadData();
    renderAll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
