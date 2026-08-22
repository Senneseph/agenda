# Agenda

**Task list · Day Planner · Kanban — with one quiet job: keep a human on-task.**

Agenda is a WebAX application. Launch it and you get a plain, dark screen with
**the current task** outlined in the middle. Slide up to unlock the full app:
the daily **Task List**, the **Day Planner** (calendar), and the **Projects**
(kanban) boards. Everything flows one way: *schedule a card on the kanban for
next Tuesday → it appears in the Day Planner as a work block → on Tuesday it is
a task in your task list → on Tuesday morning the lock screen tells you to do
it.*

No invented standards: calendar sync speaks **iCalendar (RFC 5545)** and
**CalDAV (RFC 4791)** — the same protocols Google Calendar, Apple Calendar,
Outlook and Fastmail speak. The API is an OpenAPI spec designed to be driven by
an **LLM or voice agent** (natural-language commands, deterministic parsing,
no hosted brain required).

## Quick start

```bash
# from the meta-project root (Project-Codename-Operation-Cyberdeck)
python3 -m http.server 8000
# open http://localhost:8000/agenda/app/index.html
```

Needs the sibling repos built once (same as pet-store):

```bash
(cd ../jcule && npm install && npm run build)
(cd ../jellicule && npm install && npm run build)
```

Everything is stored in your browser (localStorage). No account, no server.

## What's inside

| Path | Purpose |
|---|---|
| `specs/agenda-api.json` | The API contract (OpenAPI 3.0) — an agent's manual |
| `specs/workflow.json` | Task + card lifecycle state machines (decision trees) |
| `specs/voice-commands.md` | Natural-language grammar for `/commands` |
| `app/` | The application (ES modules, jcule BLC + jellicule components) |
| `docs/architecture.md` | How the pieces fit the WebAX model |
| `docs/llm-guide.md` | Driving Agenda from an LLM / voice agent |

## The five screens

1. **Now (lock)** — dark screen, current task centered, focus timer, next-up.
   Slide up / Space / ↑ to unlock.
2. **Today (task list)** — browse any day, add notes, schedule with time +
   reminder. Progress bar per day.
3. **Planner** — day/week/month views. Events with RFC 5545 recurrence
   (edit one instance or the whole series). Work blocks from scheduled cards
   render right beside events. Drag to reschedule.
4. **Projects** — kanban boards (Backlog → Ready → In progress → Review → Done)
   with workflow-enforced moves. **Schedule** a card and it flows into the
   planner and the task list.
5. **Integrations** — CalDAV (iCloud/Fastmail/Nextcloud/…), Google Calendar
   (OAuth client id), ICS import/export. Standards-based, nothing invented.

## Voice & LLM control

Press **Ctrl+K** (or the mic) and just talk:

```
add task call mom tomorrow at 6pm with a reminder
what am I doing today
new project taxes
project taxes add card file Q3 return, schedule it for next tuesday at 10am
move it to in progress
what's on my calendar friday
export my calendar
```

The same parser is exposed as `POST /commands` — see `specs/voice-commands.md`.

## License

MIT
