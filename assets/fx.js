/* LinkVault motion layer — aurora, reveal, spotlight, counters, command palette */
(function () {
  "use strict";
  var doc = document;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var LS_OVERLAY = "lv.overlay.v1";

  function make(tag, cls, html) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (html) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- decorative layers ---------- */
  var aurora = make("div", "aurora", "<span class='blob blob-1'></span><span class='blob blob-2'></span><span class='blob blob-3'></span><span class='mesh'></span><span class='grain'></span>");
  aurora.setAttribute("aria-hidden", "true");
  doc.body.insertBefore(aurora, doc.body.firstChild);

  var progress = make("div", "progress");
  progress.setAttribute("aria-hidden", "true");
  doc.body.appendChild(progress);

  var toTop = make("button", "to-top", "<svg viewBox='0 0 24 24' width='18' height='18' aria-hidden='true'><path d='M12 19V6m0 0-6 6m6-6 6 6' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  toTop.type = "button";
  toTop.setAttribute("aria-label", "Наверх");
  toTop.hidden = true;
  toTop.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });
  doc.body.appendChild(toTop);

  var topbar = doc.querySelector(".topbar");
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY || 0;
      var max = doc.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (max > 0 ? Math.min(100, (y / max) * 100) : 0) + "%";
      if (topbar) topbar.classList.toggle("is-stuck", y > 8);
      toTop.hidden = y < 600;
      ticking = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- card reveal + spotlight ---------- */
  var grid = doc.getElementById("grid");
  var io = null;
  if (!reduce && "IntersectionObserver" in window) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -40px 0px", threshold: 0.05 });
  }

  function decorate() {
    if (!grid) return;
    var cards = grid.querySelectorAll(".card:not([data-fx])");
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      c.setAttribute("data-fx", "1");
      if (io) {
        c.classList.add("reveal");
        c.style.transitionDelay = (i % 8) * 45 + "ms";
        io.observe(c);
      }
    }
  }
  if (grid) {
    new MutationObserver(decorate).observe(grid, { childList: true });
    decorate();
    if (!reduce) {
      grid.addEventListener("pointermove", function (e) {
        var card = e.target.closest ? e.target.closest(".card") : null;
        if (!card) return;
        var r = card.getBoundingClientRect();
        card.style.setProperty("--mx", (e.clientX - r.left) + "px");
        card.style.setProperty("--my", (e.clientY - r.top) + "px");
      }, { passive: true });
    }
  }

  /* ---------- ripple + magnetic ---------- */
  if (!reduce) {
    doc.addEventListener("pointerdown", function (e) {
      var btn = e.target.closest ? e.target.closest(".btn") : null;
      if (!btn) return;
      var r = btn.getBoundingClientRect();
      var size = Math.max(r.width, r.height);
      var s = make("span", "ripple");
      s.style.width = s.style.height = size + "px";
      s.style.left = (e.clientX - r.left - size / 2) + "px";
      s.style.top = (e.clientY - r.top - size / 2) + "px";
      btn.appendChild(s);
      setTimeout(function () { s.remove(); }, 620);
    });

    var mag = doc.querySelector(".magnetic") || doc.getElementById("btnAdd");
    if (mag) {
      mag.addEventListener("pointermove", function (e) {
        var r = mag.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        var dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        mag.style.transform = "translate(" + dx * 6 + "px," + dy * 5 + "px)";
      });
      mag.addEventListener("pointerleave", function () { mag.style.transform = ""; });
    }
  }

  /* ---------- data for stats + palette ---------- */
  var ITEMS = [];

  function overlayItems() {
    try {
      var o = JSON.parse(localStorage.getItem(LS_OVERLAY) || "{}");
      return { added: o.added || [], deleted: o.deleted || [], edits: o.edits || {} };
    } catch (err) {
      return { added: [], deleted: [], edits: {} };
    }
  }

  function countUp(node, value) {
    if (!node) return;
    if (reduce || value < 2) { node.textContent = String(value); return; }
    var start = performance.now(), dur = 900;
    function step(now) {
      var p = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = String(Math.round(value * eased));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function paintStats() {
    var box = doc.getElementById("stats");
    if (!box) return;
    var cats = {}, srcs = {}, fav = 0;
    ITEMS.forEach(function (i) {
      cats[i.category || "other"] = 1;
      srcs[i.type || "site"] = 1;
      if (i.favorite) fav++;
    });
    countUp(doc.getElementById("statLinks"), ITEMS.length);
    countUp(doc.getElementById("statCats"), Object.keys(cats).length);
    countUp(doc.getElementById("statSources"), Object.keys(srcs).length);
    countUp(doc.getElementById("statFav"), fav);
  }

  fetch("data/links.json?t=" + Date.now())
    .then(function (r) { return r.ok ? r.json() : { items: [] }; })
    .catch(function () { return { items: [] }; })
    .then(function (data) {
      var ov = overlayItems();
      var base = (data.items || []).concat(ov.added || []);
      var dead = {};
      (ov.deleted || []).forEach(function (k) { dead[k] = 1; });
      ITEMS = base.filter(function (i) { return !dead[i.url_key]; }).map(function (i) {
        var patch = ov.edits[i.url_key];
        return patch ? Object.assign({}, i, patch) : i;
      });
      paintStats();
    });

  /* ---------- command palette ---------- */
  var pal = make("div", "cmdk");
  pal.hidden = true;
  pal.innerHTML =
    "<div class='cmdk-scrim' data-cmdk-close></div>" +
    "<div class='cmdk-panel' role='dialog' aria-modal='true' aria-label='Быстрый поиск'>" +
      "<div class='cmdk-head'>" +
        "<svg viewBox='0 0 24 24' width='17' height='17' aria-hidden='true'><circle cx='11' cy='11' r='7' fill='none' stroke='currentColor' stroke-width='1.8'/><path d='m20 20-3.6-3.6' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'/></svg>" +
        "<input id='cmdkInput' type='text' placeholder='Что ищем?' autocomplete='off' spellcheck='false'>" +
        "<kbd class='kbd'>Esc</kbd>" +
      "</div>" +
      "<ul class='cmdk-list' id='cmdkList'></ul>" +
      "<div class='cmdk-foot'><span><kbd class='kbd'>\u2191</kbd><kbd class='kbd'>\u2193</kbd> выбор</span><span><kbd class='kbd'>Enter</kbd> открыть</span></div>" +
    "</div>";
  doc.body.appendChild(pal);

  var palInput = pal.querySelector("#cmdkInput");
  var palList = pal.querySelector("#cmdkList");
  var hits = [], cursor = 0, lastFocus = null;

  function palRender() {
    var q = palInput.value.trim().toLowerCase();
    hits = (q
      ? ITEMS.filter(function (i) {
          return ((i.title || "") + " " + (i.description || "") + " " + (i.url || "") + " " + (i.tags || []).join(" ")).toLowerCase().indexOf(q) > -1;
        })
      : ITEMS
    ).slice(0, 40);
    cursor = 0;
    if (!hits.length) {
      palList.innerHTML = "<li class='cmdk-empty'>" + (ITEMS.length ? "Ничего не нашлось" : "Хранилище пока пустое") + "</li>";
      return;
    }
    palList.innerHTML = hits.map(function (i, n) {
      return "<li class='cmdk-item' role='option' data-n='" + n + "' aria-selected='" + (n === 0) + "'>" +
        "<span class='dot' style='background:" + esc(i.color || "var(--accent)") + "'></span>" +
        "<span class='t'>" + esc(i.title || i.url) + "</span>" +
        "<span class='d'>" + esc(i.domain || "") + "</span></li>";
    }).join("");
  }

  function palMove(step) {
    if (!hits.length) return;
    cursor = (cursor + step + hits.length) % hits.length;
    var nodes = palList.querySelectorAll(".cmdk-item");
    for (var i = 0; i < nodes.length; i++) nodes[i].setAttribute("aria-selected", String(i === cursor));
    if (nodes[cursor]) nodes[cursor].scrollIntoView({ block: "nearest" });
  }

  function palOpen() {
    lastFocus = doc.activeElement;
    pal.hidden = false;
    palInput.value = "";
    palRender();
    palInput.focus();
  }
  function palClose() {
    pal.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function palGo(n) {
    var it = hits[n];
    if (it && it.url) window.open(it.url, "_blank", "noopener");
    palClose();
  }

  palInput.addEventListener("input", palRender);
  palList.addEventListener("click", function (e) {
    var li = e.target.closest ? e.target.closest(".cmdk-item") : null;
    if (li) palGo(Number(li.dataset.n));
  });
  pal.addEventListener("click", function (e) {
    if (e.target.hasAttribute("data-cmdk-close")) palClose();
  });
  palInput.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); palMove(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); palMove(-1); }
    else if (e.key === "Enter") { e.preventDefault(); palGo(cursor); }
    else if (e.key === "Escape") { e.preventDefault(); palClose(); }
  });
  doc.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      pal.hidden ? palOpen() : palClose();
    }
  });
  var btnCmdk = doc.getElementById("btnCmdk");
  if (btnCmdk) btnCmdk.addEventListener("click", palOpen);
})();
