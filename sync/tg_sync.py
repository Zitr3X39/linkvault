# -*- coding: utf-8 -*-
"""Собирает ссылки из Telegram (Избранное, каналы, чаты) в data/links.json."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vaultlib as vl


def message_text(msg):
    parts = [msg.message or ""]
    entities = getattr(msg, "entities", None) or []
    for ent in entities:
        url = getattr(ent, "url", None)
        if url:
            parts.append(url)
    media = getattr(msg, "media", None)
    webpage = getattr(media, "webpage", None) if media else None
    if webpage is not None:
        for attr in ("url", "title", "description"):
            value = getattr(webpage, attr, None)
            if value:
                parts.append(str(value))
    return "\n".join(parts)


def chat_title(entity):
    for attr in ("title", "username", "first_name"):
        value = getattr(entity, attr, None)
        if value:
            return str(value)
    return "Избранное"


def main():
    try:
        from telethon.sync import TelegramClient
    except ImportError:
        vl.console("")
        vl.console("  [!] Не установлена библиотека telethon.")
        vl.console("      Открой командную строку и выполни:  pip install telethon")
        return 1

    cfg = vl.load_config()
    api_id = int(cfg.get("api_id") or 0)
    api_hash = str(cfg.get("api_hash") or "")
    chats = cfg.get("chats") or ["me"]
    limit = int(cfg.get("limit") or 3000)

    if not api_id or not api_hash:
        vl.console("")
        vl.console("  [!] В файле sync\\config.json пустые api_id / api_hash.")
        vl.console("      Возьми их на https://my.telegram.org -> API development tools.")
        return 1

    state = vl.load_state()
    data = vl.load_links()
    session = os.path.join(vl.SYNC_DIR, "tg_session")
    collected = []

    with TelegramClient(session, api_id, api_hash) as client:
        for chat in chats:
            try:
                entity = client.get_entity(chat)
            except Exception as exc:
                vl.console("  Пропускаю " + str(chat) + ": " + str(exc))
                continue
            title = chat_title(entity)
            key = "tg:" + str(chat)
            last_id = int(state.get(key, 0))
            newest = last_id
            found = 0
            vl.console("  Читаю: " + title)
            for msg in client.iter_messages(entity, limit=limit, min_id=last_id):
                newest = max(newest, int(msg.id or 0))
                text = message_text(msg)
                if not text.strip():
                    continue
                stamp = msg.date.isoformat(timespec="seconds") if msg.date else None
                for url, context in vl.extract_links(text):
                    collected.append(vl.make_item(url, context or text, "Telegram · " + title, stamp))
                    found += 1
            state[key] = newest
            vl.console("    найдено ссылок: " + str(found))

    fresh = vl.add_items(data, collected)
    vl.console("  Новых ссылок после отсева дублей: " + str(len(fresh)))

    if fresh and cfg.get("enrich", True):
        vl.console("  Подтягиваю названия и описания…")
        vl.enrich(fresh)

    vl.save_links(data)
    vl.save_state(state)
    vl.summary(data)
    vl.console("")
    vl.console("  Готово. Запусти PUBLISH.bat, чтобы выложить на сайт.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
