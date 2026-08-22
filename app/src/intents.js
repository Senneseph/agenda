// agenda — natural-language command gateway (specs/voice-commands.md).
// Turns plain sentences into Agenda API operations. This is the deterministic
// parser used by POST /commands; an LLM can either call /commands or the REST
// endpoints directly. Reference tracking lets you say "it" / "that" after a
// first mention.

import { parseClock, parseDayToken, parseDurationToken, todayStr, addDays, fmtTime, fmtDay, fmtDateTime } from './ui.js';

export function createCommandParser(api) {
  let lastRef = null; // last mentioned task/card/event

  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  function findTaskRef(text, day) {
    if (/^it$|^that$/.test(text.trim()) && lastRef?.kind === 'task') return lastRef.obj;
    const q = text.trim().toLowerCase().replace(/\s+(task|to-do|todo|item|reminder)s?$/, '');
    if (q === 'it' || q === 'that' || !q) return null;
    const dayTasks = api.listTasks({ date: day ?? todayStr(), status: 'open' });
    // exact prefix / substring match
    return dayTasks.find((t) => t.title.toLowerCase().includes(q)) ??
      api.listTasks({ status: 'open' }).find((t) => t.title.toLowerCase().includes(q)) ?? null;
  }

  function findCardRef(text) {
    if (/^it$|^that$/.test(text.trim()) && lastRef?.kind === 'card') return lastRef.obj;
    const q = text.trim().toLowerCase().replace(/\s+(card|task|item|ticket)s?$/, '');
    if (q === 'it' || q === 'that' || !q) return null;
    const cards = api.listCards();
    return cards.find((c) => c.title.toLowerCase().includes(q)) ?? null;
  }

  function extractDay(text, ctxDay) {
    const ref = ctxDay ? new Date(ctxDay + 'T12:00:00') : new Date();
    // try whole-text tokens first
    for (const tok of [text, ...text.split(/\s+(?:on|for|to)\s+/).flatMap((s) => s.split(/\s+at\s+/)[0].split(/\s+from\s+/)[0])]) {
      const d = parseDayToken(tok, ref);
      if (d) return d;
    }
    return ctxDay ?? todayStr();
  }

  function setLast(kind, obj) { lastRef = { kind, obj }; }

  function ok(intent, summary, result = {}) { return { ok: true, intent, summary, result }; }
  function fail(intent, error) { return { ok: false, intent, error, summary: error }; }

  // ---------------------------------------------------------------- patterns

  const DAY_TOKEN = '(?:today|tomorrow|yesterday|tonight|(?:next|this|coming)?\s*(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2}|[a-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+\d{4})?)';

  const patterns = [
    // ---- tasks ----
    {
      id: 'task.create',
      re: new RegExp(`^(?:add|create|make)(?: a| an)?(?: task| to-do| todo| reminder)?\\s+(.+?)(?:\\s+(?:on|for|to)\\s+(.+))?$`, 'i'),
      run: (m, ctx) => {
        const combined = m[1] + (m[2] ? ' ' + m[2] : '');
        const tok = splitTokens(combined, ctx.day);
        const title = tok.text;
        const task = api.createTask({
          title, date: tok.day, time: tok.time, durationMin: tok.dur,
          reminderMin: tok.remind ?? (tok.time ? api.settings.reminderDefault : null),
        });
        setLast('task', task);
        const at = tok.time ? ` at ${fmtTime(tok.time)}` : '';
        const rem = tok.remind ? `, reminder ${tok.remind} min before` : '';
        return ok('task.create', `Added “${task.title}” to ${fmtDay(tok.day)}${at}${rem}`, { task });
      },
    },
    {
      id: 'task.quicknote',
      re: /^(?:add|note)\s+(?:a note\s+)?(.+?)\s+(?:for|on|to)\s+(today|tomorrow|yesterday|(?:next|this)?\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|\d{4}-\d{2}-\d{2}|[a-z]{3,9}\s+\d{1,2})$/i,
      run: (m, ctx) => {
        const title = m[1].trim();
        const day = parseDayToken(m[2], ctx.day ? new Date(ctx.day + 'T12:00:00') : new Date()) ?? ctx.day;
        const task = api.createTask({ title, date: day, reminderMin: null });
        setLast('task', task);
        return ok('task.quicknote', `Added note “${task.title}” to ${fmtDay(day)}`, { task });
      },
    },
    {
      id: 'task.remind',
      re: new RegExp(`^remind me to\\s+(.+?)(?:\\s+(?:at|on|for)\\s+(.+))?$`, 'i'),
      run: (m, ctx) => {
        const combined = m[1] + (m[2] ? ' ' + m[2] : '');
        const tok = splitTokens(combined, ctx.day);
        const task = api.createTask({
          title: tok.text, date: tok.day, time: tok.time ?? '09:00',
          reminderMin: tok.remind ?? api.settings.reminderDefault,
        });
        setLast('task', task);
        return ok('task.remind', `Reminder set: “${task.title}” ${fmtDay(tok.day)} at ${fmtTime(tok.time ?? '09:00')}`, { task });
      },
    },
    {
      id: 'task.complete',
      re: /^(?:complete|finish|check off|mark)\s+(?:the\s+)?(?:task\s+)?(.+?)(?:\s+(?:today|done|off|as done))?$/i,
      run: (m, ctx) => {
        const t = findTaskRef(m[1], ctx.day);
        if (!t) return fail('task.complete', 'I could not find that open task.');
        api.completeTask(t.id);
        setLast('task', t);
        return ok('task.complete', `Done — “${t.title}” completed.`, { task: t });
      },
    },
    {
      id: 'task.complete.doneWith',
      re: /^done with\s+(.+)$/i,
      run: (m, ctx) => {
        const t = findTaskRef(m[1], ctx.day);
        if (!t) return fail('task.complete.doneWith', 'I could not find that open task.');
        api.completeTask(t.id);
        setLast('task', t);
        return ok('task.complete', `Done — “${t.title}” completed.`, { task: t });
      },
    },
    {
      id: 'task.snooze',
      re: /^snooze\s+(?:the\s+)?(?:task\s+)?(.+?)(?:\s+(?:to|until)\s+(.+))?$/i,
      run: (m, ctx) => {
        const t = findTaskRef(m[1], ctx.day);
        if (!t) return fail('task.snooze', 'I could not find that open task.');
        const day = m[2] ? extractDay(m[2], ctx.day) : addDays(t.date, 1);
        const time = m[2] ? extractTime(m[2]) : t.time;
        api.rescheduleTask(t.id, { date: day, time });
        setLast('task', t);
        return ok('task.snooze', `Snoozed “${t.title}” to ${fmtDay(day)}${time ? ` at ${fmtTime(time)}` : ''}.`, { task: t });
      },
    },
    {
      id: 'card.move',
      re: /^move\s+(?:the\s+)?(.+?)\s+to\s+(backlog|ready|in\s*progress|review|done|in progress)$/i,
      run: (m) => {
        const card = findCardRef(m[1]);
        if (!card) return fail('card.move', 'I could not find that card.');
        const to = normalizeCol(m[2]);
        try {
          api.moveCard(card.id, { to });
        } catch (e) {
          return fail('card.move', String(e.message ?? e));
        }
        setLast('card', card);
        return ok('card.move', `Moved “${card.title}” to ${api.COLUMN_LABEL[to]}.`, { card: { ...card, status: to } });
      },
    },
    {
      id: 'task.reschedule',
      re: /^(?:reschedule|move|push)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+(?:to|until)\s+(.+)$/i,
      run: (m, ctx) => {
        const t = findTaskRef(m[1], ctx.day);
        if (!t) return fail('task.reschedule', 'I could not find that open task.');
        const rest = m[2];
        const day = extractDay(rest, t.date);
        const time = extractTime(rest);
        api.rescheduleTask(t.id, { date: day, time: time ?? t.time });
        setLast('task', t);
        return ok('task.reschedule', `Moved “${t.title}” to ${fmtDay(day)}${time ? ` at ${fmtTime(time)}` : ''}.`, { task: t });
      },
    },
    {
      id: 'task.delete',
      re: /^(?:delete|remove|drop)\s+(?:the\s+)?(?:task\s+)?(.+)$/i,
      run: (m, ctx) => {
        const t = findTaskRef(m[1], ctx.day);
        if (!t) return fail('task.delete', 'I could not find that task.');
        api.deleteTask(t.id);
        return ok('task.delete', `Deleted “${t.title}”.`);
      },
    },
    {
      id: 'task.list',
      re: /^what(?:\s+(?:do|am|have|'s))?\s*(?:i|we)?\s*(?:have|doing|got|on)\s*(?:my|our)?\s*(?:list|plate|agenda|day|today|tomorrow|for\s+.+)?$/i,
      run: (m, ctx) => {
        // which day?
        const rest = m[0].toLowerCase();
        let day = ctx.day;
        if (/tomorrow/.test(rest)) day = addDays(ctx.day, 1);
        else if (/on\s+(.+)/.test(rest)) day = parseDayToken(rest.match(/on\s+(.+)/)[1]) ?? day;
        else if (/(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.test(rest)) {
          const dm = rest.match(/((?:next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
          day = parseDayToken((dm[1] ?? '') + dm[2]) ?? day;
        }
        const tasks = api.listTasks({ date: day, status: 'open' });
        const done = api.listTasks({ date: day, status: 'done' }).length;
        setLast('task', tasks[0] ?? null);
        const lines = tasks.length
          ? tasks.map((t) => `${t.time ? fmtTime(t.time) + ' — ' : ''}“${t.title}”`).join('\n')
          : 'nothing scheduled';
        return ok('task.list', `${fmtDay(day)} (${tasks.length} open, ${done} done):\n${lines}`, { day, tasks });
      },
    },

    // ---- events ----
    {
      id: 'event.create',
      // “schedule X on friday 2-3pm recurring weekly”
      re: /^(?:add|schedule|create)\s+(?:an?\s+)?(?:event|meeting|appointment)\s+(.+?)\s+on\s+(.+?)(?:\s+recurring\s+(.+))?$/i,
      run: (m, ctx) => {
        const title = m[1].trim();
        const rest = m[2];
        const day = extractDay(rest, ctx.day);
        const range = extractRange(rest);
        const start = range?.start ?? extractTime(rest) ?? '09:00';
        const end = range?.end ?? addMinutes(start, range?.minutes ?? 60);
        const rrule = m[3] ? parseRecurrence(m[3]) : null;
        const ev = api.createEvent({
          title, start: `${day}T${start}:00`, end: `${day}T${end}:00`,
          rrule, reminders: [{ minutes: api.settings.reminderDefault }],
        });
        setLast('event', ev);
        const rec = rrule ? `, recurring ${m[3].trim().toLowerCase()}` : '';
        return ok('event.create', `Scheduled “${ev.title}” ${fmtDay(day)} ${fmtTime(start)}–${fmtTime(end)}${rec}.`, { event: ev });
      },
    },
    {
      id: 'event.create.bare',
      // “schedule a meeting friday 2pm-3pm recurring weekly” (bare day token)
      re: /^(?:add|schedule|create)\s+(?:an?\s+)?(?:event|meeting|appointment)\s+(.+?)(?:\s+recurring\s+(.+))?$/i,
      run: (m, ctx) => {
        const recText = m[2];
        const rrule = recText ? parseRecurrence(recText) : null;
        const tok = splitTokens(m[1], ctx.day);
        const day = tok.day;
        const start = tok.time ?? '09:00';
        const end = tok.endTime ?? addMinutes(start, tok.dur ?? 60);
        const ev = api.createEvent({
          title: tok.text || 'Meeting', start: `${day}T${start}:00`, end: `${day}T${end}:00`,
          rrule, reminders: [{ minutes: api.settings.reminderDefault }],
        });
        setLast('event', ev);
        const rec = rrule ? `, recurring ${recText.trim().toLowerCase()}` : '';
        return ok('event.create', `Scheduled “${ev.title}” ${fmtDay(day)} ${fmtTime(start)}–${fmtTime(end)}${rec}.`, { event: ev });
      },
    },
    {
      id: 'event.allDay',
      re: /^add\s+(?:an?\s+)?(?:event|appointment)\s+(.+?)\s+(?:on|for)\s+(.+?)\s+all\s*day$/i,
      run: (m, ctx) => {
        const day = extractDay(m[2], ctx.day);
        const ev = api.createEvent({ title: m[1].trim(), start: `${day}T00:00:00`, end: `${day}T23:59:00`, allDay: true });
        setLast('event', ev);
        return ok('event.allDay', `Added all-day “${ev.title}” on ${fmtDay(day)}.`, { event: ev });
      },
    },
    {
      id: 'event.cancel',
      re: /^(?:cancel|delete|remove)\s+(?:the\s+)?(?:event|meeting|appointment)\s+(.+?)(?:\s+on\s+(.+))?$/i,
      run: (m, ctx) => {
        const q = m[1].trim().toLowerCase();
        const day = m[2] ? extractDay(m[2], ctx.day) : null;
        const candidates = day ? api.listEvents({ start: `${day}T00:00:00`, end: addDays(day, 1) + 'T00:00:00' }) : api.listEvents();
        const ev = candidates.find((e) => (e.title ?? '').toLowerCase().includes(q)) ?? api.getEvent(m[1].trim());
        if (!ev) return fail('event.cancel', 'I could not find that event.');
        api.deleteEvent(ev.eventId ?? ev.id, { instance: ev.instanceStart });
        return ok('event.cancel', `Cancelled “${ev.title}”.`);
      },
    },
    {
      id: 'event.list',
      re: /^(?:what'?s|what is|show me)\s+on\s+(?:my\s+)?calendar\s*(?:for\s+(.+))?$/i,
      run: (m, ctx) => {
        const day = m[1] ? extractDay(m[1], ctx.day) : ctx.day;
        const evs = api.listEvents({ start: `${day}T00:00:00`, end: addDays(day, 1) + 'T00:00:00' });
        const blocks = api.workBlocksForDate(day);
        const lines = [
          ...evs.map((e) => `${e.allDay ? 'all day — ' : fmtTime(e.start.slice(11, 16)) + ' — '}${e.title}`),
          ...blocks.map((b) => `${b.start ? fmtTime(b.start) + ' — ' : ''}${b.title} (${b.projectName} work)`),
        ];
        return ok('event.list', `${fmtDay(day)}: ${lines.length ? '\n' + lines.join('\n') : 'nothing on the calendar'}`, { day, events: evs, blocks });
      },
    },

    // ---- projects & cards ----
    {
      id: 'project.create',
      re: /^new project\s+(.+?)(?:\s+description\s+(.+))?$/i,
      run: (m) => {
        const p = api.createProject({ name: m[1].trim(), description: m[2]?.trim() ?? '' });
        return ok('project.create', `Created project “${p.name}”.`, { project: p });
      },
    },
    {
      id: 'project.card.add',
      re: /^(?:project|in)\s+(.+?)\s+(?:add|create)\s+(?:a\s+)?(?:card|task|item|ticket)\s+(.+?)(?:\s+to\s+(backlog|ready|in\s*progress|review|done))?(?:,|\s+and)?\s*(?:schedule\s+(?:it|the\s+(?:card|task))?\s*(?:for|on)?\s*(.+))?$/i,
      run: (m) => {
        const name = m[1].trim();
        const p = api.listProjects().find((x) => x.name.toLowerCase().includes(name.toLowerCase()));
        if (!p) return fail('project.card.add', `No project matching “${name}”.`);
        const col = m[3] ? normalizeCol(m[3]) : 'backlog';
        const card = api.createCard(p.id, { title: m[2].trim(), status: col });
        setLast('card', card);
        let extra = '';
        if (m[4]) {
          const day = extractDay(m[4], todayStr());
          const time = extractTime(m[4]);
          const dur = extractDuration(m[4]);
          api.scheduleCard(card.id, { date: day, start: time, minutes: dur });
          extra = ` and scheduled for ${fmtDay(day)}${time ? ' at ' + fmtTime(time) : ''}`;
        }
        return ok('project.card.add', `Added “${card.title}” to ${p.name} (${api.COLUMN_LABEL[col]})${extra}.`, { card });
      },
    },
    {
      id: 'card.add',
      re: /^(?:add|create)\s+(?:a\s+)?(?:card|task|item)\s+(.+?)\s+to\s+(.+?)(?:\s+as\s+(backlog|ready|in\s*progress|review|done))?(?:,|\s+and)?\s*(?:schedule\s+(?:it|the\s+(?:card|task))?\s*(?:for|on)?\s*(.+))?$/i,
      run: (m) => {
        const name = m[2].trim();
        const p = api.listProjects().find((x) => x.name.toLowerCase().includes(name.toLowerCase()));
        if (!p) return fail('card.add', `No project matching “${name}”.`);
        const col = m[3] ? normalizeCol(m[3]) : 'backlog';
        const card = api.createCard(p.id, { title: m[1].trim(), status: col });
        setLast('card', card);
        let extra = '';
        if (m[4]) {
          const day = extractDay(m[4], todayStr());
          const time = extractTime(m[4]);
          const dur = extractDuration(m[4]);
          api.scheduleCard(card.id, { date: day, start: time, minutes: dur });
          extra = ` and scheduled for ${fmtDay(day)}${time ? ' at ' + fmtTime(time) : ''}`;
        }
        return ok('card.add', `Added “${card.title}” to ${p.name} (${api.COLUMN_LABEL[col]})${extra}.`, { card });
      },
    },
    {
      id: 'card.schedule',
      re: /^schedule\s+(?:the\s+)?(.+?)\s+for\s+(.+)$/i,
      run: (m, ctx) => {
        const card = findCardRef(m[1]);
        if (!card) return fail('card.schedule', 'I could not find that card.');
        const rest = m[2];
        const day = extractDay(rest, ctx.day);
        const time = extractTime(rest);
        const dur = extractDuration(rest);
        const { task } = api.scheduleCard(card.id, { date: day, start: time, minutes: dur });
        setLast('card', card);
        const at = time ? ` at ${fmtTime(time)}` : '';
        const durTxt = dur ? ` for ${dur} min` : '';
        return ok('card.schedule', `Scheduled “${card.title}” for ${fmtDay(day)}${at}${durTxt} — it is now in your task list.`, { card, task });
      },
    },
    {
      id: 'card.unschedule',
      re: /^unschedule\s+(?:the\s+)?(.+)$/i,
      run: (m) => {
        const card = findCardRef(m[1]);
        if (!card) return fail('card.unschedule', 'I could not find that card.');
        api.unscheduleCard(card.id);
        setLast('card', card);
        return ok('card.unschedule', `Unscheduled “${card.title}”.`, { card });
      },
    },
    {
      id: 'project.list',
      re: /^list projects$/i,
      run: () => {
        const ps = api.listProjects();
        return ok('project.list', ps.length ? 'Projects:\n' + ps.map((p) => `• ${p.name}`).join('\n') : 'No projects yet.', { projects: ps });
      },
    },
    {
      id: 'board.list',
      re: /^what'?s\s+on\s+(?:the\s+)?(.+?)\s+board\??$/i,
      run: (m) => {
        const name = m[1].trim();
        const p = api.listProjects().find((x) => x.name.toLowerCase().includes(name.toLowerCase()));
        if (!p) return fail('board.list', `No project matching “${name}”.`);
        const cards = api.listCards({ projectId: p.id });
        const byCol = {};
        for (const c of cards) (byCol[c.status] = byCol[c.status] ?? []).push(c);
        const lines = Object.entries(byCol).map(([col, cs]) => `${api.COLUMN_LABEL[col]}: ${cs.map((c) => `“${c.title}”` + (c.scheduledDate ? ` (scheduled ${c.scheduledDate})` : '')).join(', ')}`);
        return ok('board.list', `${p.name} board:\n` + (lines.join('\n') || 'empty'), { cards });
      },
    },

    // ---- focus ----
    {
      id: 'now',
      re: /^what\s+(?:should\s+i\s+)?(?:be\s+doing|do|work on)\s*(?:now|right now|next)?\??$/i,
      run: (m, ctx) => {
        const n = api.now();
        setLast('task', n.current);
        return ok('now', n.label, n);
      },
    },
    {
      id: 'export',
      re: /^export\s+(?:my\s+)?calendar$/i,
      run: () => {
        const events = api.exportIcs();
        return ok('export', `Exported ${events.length} events to .ics (see Integrations → Export).`, { count: events.length });
      },
    },
    {
      id: 'help',
      re: /^(help|what can you do|commands)$/i,
      run: () => ok('help', 'I can manage tasks, events, projects and cards. Try: “add task call mom tomorrow at 6pm with a reminder”, “what am I doing today”, “new project taxes”, “project taxes add card file return, schedule it for next tuesday”, “move it to in progress”, “what’s on my calendar friday”…'),
    },
  ];

  // ------------------------------------------------------------------ runner

  function run(raw, ctx = {}) {
    const text = String(raw ?? '').trim();
    if (!text) return fail('unknown', 'Empty command.');
    const context = { day: ctx.date && /^\d{4}-\d{2}-\d{2}$/.test(ctx.date) ? ctx.date : todayStr() };

    for (const p of patterns) {
      const m = text.match(p.re);
      if (!m) continue;
      try {
        return p.run(m, context);
      } catch (e) {
        return fail(p.id, `Command failed: ${e.message ?? e}`);
      }
    }
    return fail('unknown', `I didn’t understand “${text}”. Say “help” for examples.`);
  }

  // --------------------------------------------------------------- helpers

  const DAY_TOKEN_RE = new RegExp(`(?:^|\\s)(?:on|for|to)\\s+(${DAY_TOKEN})(?=\\s|$)|(?:^|\\s)(${DAY_TOKEN})(?=\\s|$)`);
  const DAY_TOKEN_MID = new RegExp(`(?:^|\\s)(${DAY_TOKEN})(?=\\s|$)`);

  /** Pull day/time/range/duration/reminder tokens out of a phrase; returns clean text. */
  function splitTokens(text, ctxDay) {
    let rest = String(text ?? '');
    let day = null, time = null, endTime = null, dur = null, remind = null;
    const ref = ctxDay ? new Date(ctxDay + 'T12:00:00') : new Date();
    const dayM = rest.match(DAY_TOKEN_RE);
    if (dayM) {
      const tok = dayM[1] ?? dayM[2];
      day = parseDayToken(tok, ref);
      rest = rest.replace(dayM[0], ' ');
    }
    const rangeM = rest.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|until|–)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    if (rangeM) {
      const s = parseClock(rangeM[1]);
      let e = parseClock(rangeM[2]);
      if (s && e) {
        if (e <= s) e = addMinutes(e, 720);
        time = s; endTime = e;
        rest = rest.replace(rangeM[0], ' ');
      }
    }
    if (!time) {
      const timeM = rest.match(/(?:at|@)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)|[01]?\d:[0-5]\d)\b/i);
      if (timeM) {
        time = parseClock(timeM[1]);
        rest = rest.replace(timeM[0], ' ');
      }
    }
    const durM = rest.match(/(?:for\s+)?(\d+(?:\.\d+)?|an?|half)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i);
    if (durM) {
      dur = parseDurationToken(durM[1] + ' ' + durM[2]) ?? parseDurationToken(durM[1]);
      rest = rest.replace(durM[0], ' ');
    }
    if (/with\s+a\s+reminder|remind\s+me/.test(rest)) remind = api.settings.reminderDefault;
    const remM = rest.match(/remind(?:er)?\s+(?:me\s+)?(?:at|by)?\s*(\d+)\s*(minutes?|mins?)\s*before/i);
    if (remM) { remind = Number(remM[1]); rest = rest.replace(remM[0], ' '); }
    return { text: rest.replace(/\s+/g, ' ').trim(), day: day ?? ctxDay, time, endTime, dur, remind };
  }

  function extractTime(text) {
    const m = text.match(/(?:at|@)\s*([\d:apm\s]+)(?:\b|$)/i) ?? text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)|[01]?\d:[0-5]\d)\b/i);
    if (!m) return null;
    return parseClock(m[1]);
  }

  function extractDuration(text) {
    const m = text.match(/for\s+(.+?)(?:\s*(?:with|remind|and|,|$))/i) ?? text.match(/(?:for\s+)?(\d+(?:\.\d+)?|an?)\s*(hours?|hrs?|minutes?|mins?)\b/i);
    if (!m) return null;
    return parseDurationToken(m[1] + ' ' + m[2]) ?? parseDurationToken(m[1]);
  }

  function extractReminder(text) {
    if (/with\s+a\s+reminder|remind\s+me/.test(text)) return api.settings.reminderDefault;
    const m = text.match(/remind(?:er)?\s+(?:me\s+)?(?:at|by)?\s*(\d+)\s*(minutes?|mins?)\s*before/i);
    if (m) return Number(m[1]);
    return null;
  }

  function extractRange(text) {
    // "2pm-3pm" / "2-3pm" / "14:00-15:00"
    const m = text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|until|–)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    if (!m) return null;
    const start = parseClock(m[1]);
    let end = parseClock(m[2]);
    if (!start || !end) return null;
    if (end <= start && !m[2].toLowerCase().includes('pm')) end = addMinutes(end, 720); // heuristic
    if (end <= start) end = addMinutes(end, 720);
    return { start, end, minutes: diffMin(start, end) };
  }

  function addMinutes(hhmmStr, min) {
    const [h, m] = hhmmStr.split(':').map(Number);
    const d = new Date(2000, 0, 1, h, m + min);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function diffMin(a, b) {
    const [ha, ma] = a.split(':').map(Number);
    const [hb, mb] = b.split(':').map(Number);
    return (hb * 60 + mb) - (ha * 60 + ma);
  }

  function parseRecurrence(text) {
    const t = text.trim().toLowerCase();
    if (/weekly|every week/.test(t)) return 'FREQ=WEEKLY';
    if (/daily|every day/.test(t)) return 'FREQ=DAILY';
    if (/monthly|every month/.test(t)) return 'FREQ=MONTHLY';
    const m = t.match(/every\s+(.+)$/);
    if (m) {
      const days = m[1].split(/\s+and\s+|\s*,\s*|\s+/)
        .map((d) => d.replace(/s$/, '').slice(0, 2).toUpperCase())
        .filter((d) => ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].includes(d));
      if (days.length) return `FREQ=WEEKLY;BYDAY=${[...new Set(days)].join(',')}`;
    }
    return null;
  }

  function normalizeCol(text) {
    const t = text.toLowerCase().replace(/\s+/g, '');
    if (t === 'inprogress') return 'inprogress';
    return t === 'ready' ? 'ready' : t === 'backlog' ? 'backlog' : t === 'review' ? 'review' : t === 'done' ? 'done' : 'backlog';
  }

  return { run, get lastRef() { return lastRef; } };
}

// convenience export for docs parity
export { fmtDay, fmtTime, fmtDateTime };
