# Agenda — architecture

Agenda is built on the WebAX model: **the UI is a specification, the business
logic is a decision tree, the API is a contract.** The app is deliberately
thin — everything that makes it behave is data.

## The WebAX layers

```
┌────────────────────────────────────────────────────────────┐
│  app/ (views)          plain ES modules, jellicule tokens  │
│  ▸ now / tasks / planner / kanban / integrations           │
├────────────────────────────────────────────────────────────┤
│  app/src/api.js        the Agenda API (local impl)         │
│  ▸ implements specs/agenda-api.json 1:1 over storage       │
│  ▸ enforced by jcule createWorkflow (specs/workflow.json)  │
├────────────────────────────────────────────────────────────┤
│  jcule (BLC)           store · event bus · workflow engine │
├────────────────────────────────────────────────────────────┤
│  storage               localStorage (swap for any backend) │
└────────────────────────────────────────────────────────────┘
```

- **Spec → app.** `specs/agenda-api.json` is the contract. `app/src/api.js`
  implements it against local storage; a future hosted backend (e.g.
  CyberdeckOS) can implement the same contract and the views never change.
- **Business rules as data.** `specs/workflow.json` holds two state machines
  (task: `open ⇄ done`; card: five columns) enforced by jcule's `createWorkflow`.
  Illegal transitions are rejected with `409`-style errors — the UI and voice
  gateway both route through the same enforcement.
- **Events.** jcule's `createEventBus` carries `db:changed` / `ui:refresh`
  so views re-render from one source of truth.

## The pipeline (kanban → planner → today → now)

1. `POST /cards/{id}/schedule {date, start, minutes}` — sets the card's
   `scheduledDate` and upserts a **linked task** (`source: "card:<id>"`) on that
   day.
2. The planner renders `workBlocksForDate` (scheduled, non-done cards) as
   colored, striped blocks next to calendar events. Dragging a block calls
   `scheduleCard` again with the new day/time.
3. On the day, the task is in the daily task list; `GET /now` picks it as the
   current focus if its time window covers "now" (context `focus`), else as the
   next scheduled task.
4. Completing the linked task marks the card `scheduledDone`; moving the card
   to **Done** completes its open linked tasks. The loop closes.

## Calendar standards, not inventions

- **Recurrence:** RFC 5545 `RRULE` (`FREQ=WEEKLY;BYDAY=MO,WE,FR`). Expanded by
  `app/src/ical.js`. Single-instance edits detach via `EXDATE` + an override
  (a mini RECURRENCE-ID), so "edit this one" behaves like real calendar apps.
- **Sync:** CalDAV (RFC 4791) client in `app/src/caldav.js` —
  `/.well-known/caldav` discovery → calendar-home-set → `CALDAV:calendar-query`
  with time-range → ETag-based upsert → PUT for local changes. Works with
  iCloud, Fastmail, Nextcloud, Radicale, Baïkal…
- **Interchange:** ICS export/import via `serializeIcs`/`parseIcs`. Google
  Calendar is reached through Calendar API v3 with a user-supplied OAuth
  client id.

## The lock screen

`views/now.js` polls `GET /now`. Selection order: task whose
`[time, time+duration)` window contains now → next scheduled task → first open
task of the day → most recent day's carried-over open task → all clear.
The focus timer is a pomodoro-style ring; unlock is a swipe-up gesture, Space,
↑, or the handle. On unlock the hub slides up over the lock screen.

## LLM / voice surface

`POST /commands` (parser in `app/src/intents.js`) maps natural language to the
same API operations the UI uses. Intent patterns are documented in
`specs/voice-commands.md`; every response carries `{ok, intent, summary,
result}` so an agent can confirm before acting. An LLM may equally call the
REST endpoints directly — the OpenAPI spec is the single source of truth for
both.

## Extending

- New resource? Add it to `specs/agenda-api.json`, implement it in `api.js`,
  expose it in `webax.json` comlink list.
- New lifecycle? Add states/transitions to `specs/workflow.json` — enforcement
  is automatic.
- New intent? Add a pattern to `intents.js` and a row to
  `specs/voice-commands.md`.
