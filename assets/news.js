/* MONOLITH v14.2 — рендер новостной ленты по контракту feed.json v2.

   Заменяет прежний полноэкранный слайдер со скриншотами mshots.
   Разделение ответственности: данные, фильтры и действия остаются в app.js,
   здесь — только разметка. Кнопки помечены data-feed-add / data-feed-copy,
   их слушает делегированный обработчик app.js; чипы — классом .chip с data-value.

   Формат v1 тоже поддержан: если у элементов нет topic, группировка идёт по source. */
(function () {
  "use strict";

  var TOPICS = {
    "ai-skills": { name: "AI-скиллы", color: "#7C5CFF" },
    "ai-agents": { name: "AI / агенты", color: "#3B82F6" },
    "ux-design": { name: "UX / веб-дизайн", color: "#FF5D8F" },
    "automation": { name: "Автоматизация", color: "#D8FF4A" },
    "dev-tools": { name: "Инструменты разработки", color: "#22D3A7" },
    "productivity": { name: "Продуктивность", color: "#FFB020" }
  };
  var DEFAULT_COLOR = "var(--accent)";

  var nf = new Intl.NumberFormat("ru-RU");
  var df = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function txt(v) { return String(v == null ? "" : v).trim(); }

  function arr(v) {
    if (!Array.isArray(v)) return [];
    return v.map(txt).filter(function (x) { return x.length > 0; });
  }

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function titleOf(it) {
    return txt(it.title_ru) || txt(it.title) || txt(it.domain) || txt(it.url);
  }

  function summaryOf(it) {
    return txt(it.summary_ru) || txt(it.description_ru) || txt(it.description);
  }

  function topicOf(it) {
    var id = txt(it.topic);
    if (!id) return null;
    var known = TOPICS[id];
    return {
      id: id,
      name: known ? known.name : (txt(it.topic_name) || id),
      color: known ? known.color : DEFAULT_COLOR
    };
  }

  function colorOf(it) {
    var t = topicOf(it);
    return t ? t.color : DEFAULT_COLOR;
  }

  function whenOf(it) {
    var raw = txt(it.found_at) || txt(it.published_at);
    if (!raw) return "";
    var d = new Date(raw);
    return isNaN(d.getTime()) ? "" : df.format(d);
  }

  function groupKey(it, byTopic) {
    return byTopic ? txt(it.topic) : txt(it.source);
  }

  function groupLabel(key, byTopic, items) {
    if (!byTopic) return key;
    if (TOPICS[key]) return TOPICS[key].name;
    for (var i = 0; i < items.length; i++) {
      if (txt(items[i].topic) === key && txt(items[i].topic_name)) return txt(items[i].topic_name);
    }
    return key;
  }

  function matches(it, q) {
    if (!q) return true;
    var hay = [
      titleOf(it), summaryOf(it), txt(it.why_it_matters_ru),
      arr(it.use_cases_ru).join(" "), txt(it.source), txt(it.domain), txt(it.url)
    ].join(" ").toLowerCase();
    return hay.indexOf(q) > -1;
  }

  function coverHtml(it, forceLetter) {
    var img = txt(it.image);
    var letter = esc((titleOf(it) || "?").charAt(0).toUpperCase() || "?");
    if (!img && !forceLetter) return "";
    return (
      '<a class="news-cover" href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">' +
        '<span class="news-letter">' + letter + "</span>" +
        (img
          ? '<img src="' + esc(img) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">'
          : "") +
      "</a>"
    );
  }

  function moreHtml(it) {
    var why = txt(it.why_it_matters_ru);
    var cases = arr(it.use_cases_ru);
    var caveats = arr(it.caveats_ru);
    if (!why && !cases.length && !caveats.length) return "";
    var inner = "";
    if (why) inner += '<div><p class="news-sub">Чем полезно</p><p>' + esc(why) + "</p></div>";
    if (cases.length) {
      inner += '<div><p class="news-sub">Как применить</p><ul class="news-list">' +
        cases.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul></div>";
    }
    if (caveats.length) {
      inner += '<div><p class="news-sub">Ограничения</p><ul class="news-list is-warn">' +
        caveats.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul></div>";
    }
    return (
      '<details class="news-more">' +
        "<summary>Разбор: чем полезно и как применить</summary>" +
        '<div class="news-more-in">' + inner + "</div>" +
      "</details>"
    );
  }

  function cardHtml(it, size, known) {
    var t = topicOf(it);
    var when = whenOf(it);
    var summary = summaryOf(it);
    var added = !!known[txt(it.url_key)];
    var quality = Number(it.quality_score);
    var score = Number(it.score);

    var kicker = "";
    if (t) kicker += '<span class="news-topic">' + esc(t.name) + "</span>";
    if (txt(it.source)) {
      if (kicker) kicker += '<span class="news-sep"></span>';
      kicker += "<span>" + esc(it.source) + "</span>";
    }
    if (when) {
      if (kicker) kicker += '<span class="news-sep"></span>';
      kicker += "<time>" + esc(when) + "</time>";
    }

    var metrics = "";
    if (isFinite(quality) && quality > 0) {
      metrics += '<span class="news-q" title="Оценка качества карточки"><i></i>' + nf.format(Math.round(quality)) + "</span>";
    }
    if (isFinite(score) && score > 0) {
      metrics += "<span>▲ " + nf.format(score) + "</span>";
    }

    return (
      '<article class="news-card' + (size ? " " + size : "") + '" style="--cat:' + esc(colorOf(it)) + '">' +
        coverHtml(it, size === "is-lead") +
        '<div class="news-body">' +
          (kicker ? '<div class="news-kicker">' + kicker + "</div>" : "") +
          '<h3 class="news-title"><a href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">' + esc(titleOf(it)) + "</a></h3>" +
          (summary
            ? '<p class="news-summary">' + esc(summary) + "</p>"
            : '<p class="news-summary is-dim">Описание появится после следующего сбора ленты.</p>') +
          moreHtml(it) +
          '<div class="news-foot">' +
            '<div class="news-metrics">' + metrics + "</div>" +
            '<div class="news-actions">' +
              '<a class="btn btn-sm" href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer">Открыть</a>' +
              '<button type="button" class="btn btn-sm" data-feed-copy="' + esc(it.url_key) + '">Копировать</button>' +
              (added
                ? '<button type="button" class="btn btn-sm is-done" disabled>В хранилище ✓</button>'
                : '<button type="button" class="btn btn-primary btn-sm" data-feed-add="' + esc(it.url_key) + '">Добавить себе</button>') +
            "</div>" +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function sizeFor(index, total) {
    if (total <= 2) return "is-major";
    if (index === 0) return "is-lead";
    if (total <= 4) return "is-major";
    return index <= 2 ? "is-major" : "";
  }

  function renderChips(host, items, byTopic, filter) {
    if (!host) return;
    host.innerHTML = "";
    var keys = [], seen = {};
    items.forEach(function (it) {
      var k = groupKey(it, byTopic);
      if (!k || seen[k]) return;
      seen[k] = 1;
      keys.push(k);
    });
    keys.sort(function (a, b) {
      var ca = items.filter(function (i) { return groupKey(i, byTopic) === a; }).length;
      var cb = items.filter(function (i) { return groupKey(i, byTopic) === b; }).length;
      return cb - ca;
    });

    function chip(value, label, n, color) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (filter === value ? " is-on" : "");
      b.dataset.value = value;
      if (color) b.style.setProperty("--cat", color);
      b.innerHTML = esc(label) + ' <span class="chip-num">' + nf.format(n) + "</span>";
      return b;
    }

    host.appendChild(chip("all", "Всё", items.length, ""));
    keys.forEach(function (k) {
      var n = items.filter(function (i) { return groupKey(i, byTopic) === k; }).length;
      var color = byTopic && TOPICS[k] ? TOPICS[k].color : "";
      host.appendChild(chip(k, groupLabel(k, byTopic, items), n, color));
    });
  }

  function render(ctx) {
    var list = $("feedList");
    if (!list) return;

    ctx = ctx || {};
    var items = Array.isArray(ctx.items) ? ctx.items : [];
    var known = ctx.known || {};
    var filter = txt(ctx.filter) || "all";
    var q = txt(ctx.query).toLowerCase();
    var byTopic = items.some(function (i) { return i && txt(i.topic); });

    list.classList.add("news-grid");
    renderChips($("feedChips"), items, byTopic, filter);

    var shown = items.filter(function (it) {
      if (filter !== "all" && groupKey(it, byTopic) !== filter) return false;
      return matches(it, q);
    });

    if (!shown.length) {
      list.innerHTML = items.length
        ? '<p class="news-note">Ничего не нашлось по этому фильтру.</p>'
        : "";
    } else {
      list.innerHTML = shown.map(function (it, i) {
        return cardHtml(it, sizeFor(i, shown.length), known);
      }).join("");
    }

    var empty = $("feedEmpty");
    if (empty) empty.hidden = items.length > 0;

    var badge = $("feedBadge");
    if (badge) {
      var fresh = items.filter(function (i) {
        var t = new Date(txt(i.found_at)).getTime();
        return t && (Date.now() - t) < 86400000;
      }).length;
      badge.hidden = fresh === 0;
      badge.textContent = String(fresh);
    }

    var meta = $("feedMeta");
    if (meta) {
      if (!items.length) {
        meta.textContent = "";
      } else {
        var when = ctx.updatedAt ? new Date(ctx.updatedAt) : null;
        var whenTxt = when && !isNaN(when.getTime()) ? df.format(when) : "—";
        var base = nf.format(items.length) + " " + plural(items.length, "находка", "находки", "находок") +
          " · обновлено " + whenTxt;
        meta.textContent = shown.length === items.length
          ? base
          : nf.format(shown.length) + " из " + base;
      }
    }
  }

  window.MONOLITH_NEWS = { render: render, topics: TOPICS };
})();
