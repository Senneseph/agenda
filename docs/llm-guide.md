# Driving Agenda from an LLM / voice agent

Agenda was designed so an agent can run it end-to-end. Two entry points:

## 1. `POST /commands` — natural language

Send a sentence, get an executed result:

```
POST /commands
{ "command": "add task call mom tomorrow at 6pm with a reminder" }

→ {
    "ok": true,
    "intent": "task.create",
    "summary": "Added “call mom” to Tuesday 2026-08-25 at 6:00 pm, reminder 15 min before.",
    "result": { "task": { "id": "…", "title": "call mom", "date": "2026-08-25", "time": "18:00" } }
  }
```

Guidelines for an agent:

- **Confirm before acting on deletions or irreversible moves.** The
  `summary` string is written to be read aloud.
- **Reference tracking:** after “schedule the taxes card”, you can say
  “move it to in progress”.
- **Ask for the missing piece** if `ok:false` (e.g. “no project matching X”).
- **Batch by re-using references**, e.g. “new project taxes” → “project taxes
  add card file Q3 return, schedule it for next tuesday at 10am”.

## 2. The REST API — precise operations

Read `specs/agenda-api.json`; every path has a machine-readable schema.
The useful quick set:

| Goal | Call |
|---|---|
| What should they do now? | `GET /now` |
| Today's tasks | `GET /tasks?date=2026-08-21&status=open` |
| Add a note | `POST /tasks {title, date}` |
| Add scheduled + reminder | `POST /tasks {title, date, time:"18:00", reminderMin:15}` |
| Complete | `POST /tasks/{id}/complete` |
| Events in a range | `GET /events?start=…&end=…` (recurrence expanded) |
| New event, weekly | `POST /events {title, start, end, rrule:"FREQ=WEEKLY;BYDAY=MO,WE,FR"}` |
| Projects | `GET /projects` · `POST /projects {name}` |
| Board | `GET /projects/{id}/cards` |
| New card | `POST /projects/{id}/cards {title, status:"ready"}` |
| Move card | `POST /cards/{id}/move {to:"inprogress"}` |
| **Schedule card for Tuesday** | `POST /cards/{id}/schedule {date:"2026-08-25", start:"10:00", minutes:90}` |
| Unschedule | `POST /cards/{id}/unschedule` |
| Sync a calendar | `POST /integrations/{id}/sync` |
| Export | `GET /ics/export?download=true` |

## Voice specifics

The in-browser build adds a microphone button (Web Speech API) that pipes
recognized text into `/commands`. For your own voice pipeline, send the
transcript to `/commands` and speak the `summary` back to the user.

## Workflow enforcement

Moves and completions are validated against `specs/workflow.json`:

- tasks: `open → done` (`complete`), `done → open` (`reopen`)
- cards: `backlog → ready → inprogress → review → done`, with labelled moves
  (`advance`, `back`, `finish`, `skip`) and arbitrary `move` pairs for drags.
  Moving to `done` auto-completes linked tasks.

A rejected transition returns `ok:false` / HTTP `409` — surface it to the user
(“the taxes card is already in review; moving it to done will complete its
scheduled tasks — confirm?”).
