# Agenda — Voice & LLM Command Grammar

The `/commands` endpoint (see `agenda-api.json`) is a plain-language gateway. It is
designed so that a voice assistant or LLM agent can run Agenda end-to-end with
short, human-sounding commands. A deterministic parser (`app/src/intents.js`)
handles the patterns below in the in-browser build; an LLM may either call
`/commands` or the individual REST endpoints directly.

---

## 1. Date & time tokens

| Token | Meaning |
|---|---|
| `today`, `tomorrow`, `yesterday`, `tonight` | days relative to now |
| `monday`…`sunday` | next occurrence (or "this monday" = the coming one, "next monday" = the one after) |
| `next tuesday`, `this friday` | explicit week targeting |
| `in 30 minutes`, `in an hour`, `in 2 hours` | offset from now |
| `at 6pm`, `at 6:30pm`, `at 14:00`, `at noon`, `at midnight` | clock time (12h/24h) |
| `9am`, `3:15pm` | bare clock |
| `for 30 minutes`, `for an hour`, `for 1.5 hours` | duration |
| `weekly`, `daily`, `every monday and wednesday`, `monthly` | recurrence (RRULE) |

## 2. Intents

### Tasks (daily list)
```
add task <text> [tomorrow|on <day>] [at <time>] [for <duration>] [with a reminder] [remind me at <time>]
add <text> to <day>            → quick note: "add 'call mom' to tomorrow"
remind me to <text> at <time> [on <day>]
what (do|am) I (have|doing) (today|tomorrow|on <day>)?   → list tasks for a day
complete|finish|done with|check off <task> [today]
mark <task> done
snooze <task> [to <day>|<time>]
reschedule|move <task> to <day> [at <time>]
delete|remove <task>
```

### Events (calendar)
```
add|schedule (an|a) event <title> <day> <start>-<end> [recurring <recurrence>]
schedule <title> <day> at <start> for <duration>
meeting <title> <day> <start>-<end>          → event (meeting ≈ event)
add <title> <day> all day
cancel|delete the event <title> [on <day>]
what's on my calendar <day>?                 → events + scheduled work for a day
```

### Projects & kanban
```
new project <name> [description <text>]
project <name> add (card|task|item) <text> [to <column>]
add (card|task) <text> to <project> [<column>]
move (the )<card> to <column>                → backlog|ready|in progress|review|done
schedule (the )<card> for <day> [at <time>]  → kanban→today pipeline
unschedule (the )<card>
list projects
what's on (the )<project> board?             → cards by column
```

### Day & focus
```
what should I (be doing|do) (now|right now)?  → GET /now
what's next?
```

### Integrations & data
```
export my calendar [for <week|month|range>]
import calendar <filename>                    → ICS import
sync (my )<calendar name>
```

### References
- After a command mentions a task/card/event, later commands can say `it` / `that`
  / `the <thing>` and resolve to the last referenced item.
- `<task>` / `<card>` may be a quoted phrase (`"taxes"`), a fragment matched by
  fuzzy prefix, or `it` (last referenced).

## 3. Examples

```
"add task call mom tomorrow at 6pm with a reminder"
"remind me to file the timesheet at 5pm today"
"what am I doing today"
"schedule design review friday 2pm-3pm recurring weekly"
"new project taxes"
"project taxes add card file Q3 return, schedule it for next tuesday at 10am for 2 hours"
"move it to in progress"
"mark the timesheet task done"
"what's on my calendar monday"
"export my calendar"
```

## 4. Response contract

Every command returns:

```json
{
  "ok": true,
  "intent": "task.create",
  "summary": "Added “call mom” to Tuesday 2026-08-25 at 18:00, reminder 15 min before.",
  "result": { "task": { "id": "…", "title": "call mom", "date": "2026-08-25" } }
}
```

`ok:false` with `error` when unparseable or when the workflow rejects a transition.
