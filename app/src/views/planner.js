// agenda — Day Planner / Calendar.
// Day (timeline), Week (columns), Month (grid). Events use RFC 5545 recurrence;
// kanban work blocks (scheduled cards) render alongside events so the board,
// the planner and the task list all agree. Drag a block to reschedule it.

import { el, icon, fmtTime, fmtDay, fmtDayShort, fmtDateMed, fmtDuration, fmtDateTime,
  addDays, todayStr, strToDate, dateToStr, mondayOf, weekdayIndex, monthStrOf, diffDays,
  openModal, confirmDlg, field, textInput, selectInput, toast, hhmm } from '../ui.js';
import { expandEvent, parseRrule, serializeRrule } from '../ical.js';

const DAY_START = 6;   // first hour shown
const DAY_END = 22;    // last hour shown
const HOUR_PX = 52;    // px per hour
const COLORS = ['#5b8cff', '#4fd1a5', '#f6ad55', '#f472b6', '#a78bfa', '#34d399', '#f87171', '#22d3ee', '#facc15', '#fb923c'];

function yToTime(y) {
  const mins = DAY_START * 60 + (y / HOUR_PX) * 60;
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function timeToY(t) {
  const [h, m] = t.split(':').map(Number);
  return ((h * 60 + m) - DAY_START * 60) / 60 * HOUR_PX;
}

export function renderPlanner(root, ctx, opts = {}) {
  const { api } = ctx;
  let mode = opts.mode ?? 'day';
  let anchor = opts.anchor ?? todayStr(); // day view: this day; week: any day in week; month: any day in month

  const toolbar = el('div', { class: 'view-top' },
    el('div', { class: 'day-nav' },
      el('button', { class: 'icon-btn', onclick: () => move(-1) }, icon('arrowLeft', 18)),
      el('div', { class: 'day-label' }, el('div', { class: 'day-name' }), el('div', { class: 'day-rel' })),
      el('button', { class: 'icon-btn', onclick: () => move(1) }, icon('arrowRight', 18)),
      el('button', { class: 'btn btn-ghost btn-today', onclick: () => { anchor = todayStr(); render(); } }, 'Today'),
    ),
    el('div', { class: 'seg' },
      [['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([v, l]) =>
        el('button', { class: `seg-btn ${mode === v ? 'active' : ''}`, onclick: () => { mode = v; render(); } }, l)),
    ),
  );

  const body = el('div', { class: 'planner-body' });

  function move(dir) {
    if (mode === 'day') anchor = addDays(anchor, dir);
    else if (mode === 'week') anchor = addDays(anchor, 7 * dir);
    else {
      const d = strToDate(anchor); d.setMonth(d.getMonth() + dir); anchor = dateToStr(d);
    }
    render();
  }

  function render() {
    toolbar.querySelector('.day-name').textContent =
      mode === 'day' ? fmtDay(anchor)
      : mode === 'week' ? `${fmtDateMed(mondayOf(anchor))} – ${fmtDateMed(addDays(mondayOf(anchor), 6))}`
      : strToDate(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const rel = diffDays(anchor, todayStr());
    toolbar.querySelector('.day-rel').textContent =
      mode === 'day' ? (rel === 0 ? 'Today' : rel === 1 ? 'Tomorrow' : rel === -1 ? 'Yesterday' : '') : '';
    body.replaceChildren(mode === 'day' ? dayView(anchor) : mode === 'week' ? weekView(anchor) : monthView(anchor));
  }

  // ------------------------------------------------------------- data

  function dayData(day) {
    const evs = api.listEvents({ start: `${day}T00:00:00`, end: addDays(day, 1) + 'T00:00:00' });
    const blocks = api.workBlocksForDate(day).map((b) => ({
      ...b, isWork: true, startIso: `${day}T${b.start ?? '09:00'}:00`,
      endIso: `${day}T${yToTime(timeToY(b.start ?? '09:00') + (b.minutes ?? 60) / 60 * HOUR_PX)}:00`,
    }));
    return { evs, blocks };
  }

  // ---------------------------------------------------------------- day

  function dayView(day) {
    const wrap = el('div', { class: 'planner-day' });
    const { evs, blocks } = dayData(day);
    const timeline = el('div', { class: 'timeline' });
    const lane = el('div', { class: 'day-lane' });

    // hour grid
    for (let h = DAY_START; h <= DAY_END; h++) {
      const t = `${String(h).padStart(2, '0')}:00`;
      timeline.append(el('div', { class: 'hour-row', style: `top:${timeToY(t)}px` },
        el('span', { class: 'hour-label' }, h === 12 ? '12 pm' : h === 0 ? '12 am' : h < 12 ? `${h} am` : `${h - 12} pm`)));
    }
    // now line
    const now = new Date();
    if (dateToStr(now) === day) {
      const ny = timeToY(hhmm(now));
      if (ny >= 0 && ny <= (DAY_END - DAY_START) * HOUR_PX) {
        lane.append(el('div', { class: 'now-line', style: `top:${ny}px` }));
      }
    }

    // click empty lane → create event
    lane.addEventListener('pointerdown', (e) => {
      if (e.target !== lane) return;
      const t = yToTime(e.offsetY);
      newEventModal(day, t);
    });
    // drag an event/work block to a new time within the day
    lane.addEventListener('dragover', (e) => e.preventDefault());
    lane.addEventListener('drop', (e) => handleDrop(e, day));

    const items = [
      ...evs.map((ev) => eventBlock(day, ev)),
      ...blocks.map((b) => workBlock(day, b)),
    ].filter(Boolean);
    lane.append(...items);

    wrap.append(timeline, lane);
    return wrap;
  }

  function blockEl(day, startIso, endIso, { title, color, sub, cls = '', onClick, onDragStart }) {
    const s = new Date(startIso), e = new Date(endIso);
    const top = timeToY(hhmm(s));
    const h = Math.max(14, (e - s) / 3600000 * HOUR_PX - 2);
    if (top + h < 0 || top > (DAY_END - DAY_START) * HOUR_PX) return null;
    const elm = el('div', {
      class: `evt ${cls}`, style: `top:${top}px;height:${h}px;--evt:${color}`,
      draggable: 'true',
      onclick: (e) => { e.stopPropagation(); onClick?.(); },
    },
      el('span', { class: 'evt-time' }, `${fmtTime(hhmm(s))} – ${fmtTime(hhmm(e))}`),
      el('span', { class: 'evt-title' }, title),
      sub ? el('span', { class: 'evt-sub' }, sub) : null,
    );
    if (onDragStart) {
      elm.addEventListener('dragstart', onDragStart);
    }
    return elm;
  }

  function eventBlock(day, ev) {
    const isAllDay = ev.allDay;
    return blockEl(day, isAllDay ? `${day}T09:00:00` : ev.start, isAllDay ? `${day}T09:30:00` : ev.end, {
      title: ev.title + (ev.isException ? ' ⚡' : ''),
      color: ev.color || '#5b8cff',
      sub: isAllDay ? 'all day' : null,
      cls: (isAllDay ? 'evt-allday ' : '') + (ev.rrule ? 'evt-recur' : ''),
      onClick: () => eventModal(ev),
      onDragStart: (e) => dragBlock(e, ev, day),
    });
  }

  function workBlock(day, b) {
    return blockEl(day, b.startIso, b.endIso, {
      title: b.title,
      color: b.color,
      sub: `${b.projectName} work${b.done ? ' ✓' : ''}`,
      cls: 'evt-work' + (b.done ? ' is-done' : ''),
      onClick: () => ctx.openCardModal(api.getCard(b.cardId)),
      onDragStart: (e) => dragWork(e, b, day),
    });
  }

  // drag reschedule (event or work block) within the day lane
  function dragBlock(e, ev, day) {
    e.dataTransfer.setData('text/plain', `evt:${ev.eventId}:${ev.instanceStart ?? ''}`);
    e.dataTransfer.effectAllowed = 'move';
  }
  function dragWork(e, b, day) {
    e.dataTransfer.setData('text/plain', `work:${b.cardId}`);
    e.dataTransfer.effectAllowed = 'move';
  }

  // --------------------------------------------------------------- week

  function weekView(anchorDay) {
    const start = mondayOf(anchorDay);
    const wrap = el('div', { class: 'planner-week' });
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const grid = el('div', { class: 'week-grid' });

    // header row
    const headRow = el('div', { class: 'week-head' }, el('div', { class: 'week-gutter' }));
    for (const d of days) {
      const isToday = d === todayStr();
      const [wd, md] = fmtDayShort(d).split(', ');
      headRow.append(el('div', { class: 'week-dayhead' + (isToday ? ' is-today' : '') },
        el('div', { class: 'wd' }, wd), el('div', { class: 'md' }, md)));
    }
    grid.append(headRow);

    // body
    const bodyRow = el('div', { class: 'week-body' });
    const gutter = el('div', { class: 'week-gutter' });
    for (let h = DAY_START; h < DAY_END; h++) {
      gutter.append(el('div', { class: 'hour-label', style: `height:${HOUR_PX}px` },
        h === 12 ? '12 pm' : h < 12 ? `${h} am` : `${h - 12} pm`));
    }
    bodyRow.append(gutter);

    for (const d of days) {
      const col = el('div', { class: 'week-col' + (d === todayStr() ? ' is-today' : '') });
      for (let h = DAY_START; h < DAY_END; h++) col.append(el('div', { class: 'hour-cell', style: `height:${HOUR_PX}px` }));
      const { evs, blocks } = dayData(d);
      const items = [
        ...evs.map((ev) => eventBlock(d, ev)),
        ...blocks.map((b) => workBlock(d, b)),
      ].filter(Boolean);
      col.append(...items);
      col.addEventListener('click', (e) => {
        if (e.target.classList.contains('hour-cell')) {
          const rect = col.getBoundingClientRect();
          const t = yToTime(e.clientY - rect.top);
          newEventModal(d, t);
        }
      });
      col.addEventListener('dragover', (e) => e.preventDefault());
      col.addEventListener('drop', (e) => handleDrop(e, d));
      bodyRow.append(col);
    }
    grid.append(bodyRow);
    wrap.append(grid);
    return wrap;
  }

  function handleDrop(e, day) {
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    const rect = e.currentTarget.getBoundingClientRect();
    const t = yToTime(e.clientY - rect.top);
    if (data.startsWith('evt:')) {
      const [, id, inst] = data.split(':');
      const ev = api.getEvent(id);
      if (!ev) return;
      const dur = new Date(ev.end) - new Date(ev.start);
      const start = `${day}T${t}:00`;
      const end = new Date(new Date(start).getTime() + dur);
      const endStr = `${dateToStr(end)}T${hhmm(end)}:00`;
      try {
        if (inst) api.updateEvent(id, { start, end }, { instance: inst });
        else api.updateEvent(id, { start, end });
        toast('Event moved', { kind: 'success', icon: 'check' });
        ctx.bus.emit('ui:refresh');
      } catch (err) { toast(String(err.message ?? err), { kind: 'warn' }); }
    } else if (data.startsWith('work:')) {
      const cardId = data.split(':')[1];
      const card = api.getCard(cardId);
      if (!card) return;
      api.scheduleCard(cardId, { date: day, start: t, minutes: card.scheduledMinutes ?? 60 });
      toast(`“${card.title}” scheduled ${fmtDayShort(day)} at ${fmtTime(t)}`, { kind: 'success', icon: 'check' });
      ctx.bus.emit('ui:refresh');
    }
    render();
  }

  // -------------------------------------------------------------- month

  function monthView(anchorDay) {
    const wrap = el('div', { class: 'planner-month' });
    const [y, m] = anchorDay.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = mondayOf(dateToStr(first));
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const rangeStart = `${days[0]}T00:00:00`;
    const rangeEnd = `${addDays(days[41], 1)}T00:00:00`;
    const evs = api.listEvents({ start: rangeStart, end: rangeEnd });
    const allByDay = {};
    const timedByDay = {};
    for (const ev of evs) {
      const key = ev.start.slice(0, 10);
      if (ev.allDay) (allByDay[key] = allByDay[key] ?? []).push(ev);
      else (timedByDay[key] = timedByDay[key] ?? []).push(ev);
    }
    const blocksByDay = {};
    for (const day of days) {
      const bs = api.workBlocksForDate(day);
      if (bs.length) blocksByDay[day] = bs;
    }

    const head = el('div', { class: 'month-head' },
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => el('div', { class: 'month-headcell' }, d)));
    const grid = el('div', { class: 'month-grid' });
    for (const day of days) {
      const inMonth = monthStrOf(day) === `${y}-${String(m).padStart(2, '0')}`;
      const cell = el('div', { class: 'month-cell' + (inMonth ? '' : ' out') + (day === todayStr() ? ' is-today' : '') });
      cell.append(el('div', { class: 'month-daynum' }, Number(day.slice(8))));
      for (const ev of (allByDay[day] ?? []).slice(0, 2)) {
        cell.append(el('div', { class: 'mini-item mini-allday', style: `--evt:${ev.color}`, onclick: () => eventModal(ev) }, ev.title));
      }
      for (const ev of (timedByDay[day] ?? []).slice(0, 2)) {
        cell.append(el('div', { class: 'mini-item', style: `--evt:${ev.color}`, onclick: () => eventModal(ev) },
          el('span', { class: 'mini-time' }, fmtTime(ev.start.slice(11, 16))), ev.title));
      }
      for (const b of (blocksByDay[day] ?? []).slice(0, 1)) {
        cell.append(el('div', { class: 'mini-item mini-work', style: `--evt:${b.color}`, onclick: () => ctx.openCardModal(api.getCard(b.cardId)) },
          el('span', { class: 'mini-time' }, b.start ? fmtTime(b.start) : ''), '▦ ' + b.title));
      }
      const total = (allByDay[day]?.length ?? 0) + (timedByDay[day]?.length ?? 0) + (blocksByDay[day]?.length ?? 0);
      if (total > 5) cell.append(el('div', { class: 'mini-more', onclick: () => { anchor = day; mode = 'day'; render(); } }, `+${total - 5} more`));
      cell.addEventListener('click', (e) => {
        if (!e.target.classList.contains('mini-item') && !e.target.classList.contains('mini-more') && !e.target.classList.contains('mini-time')) {
          anchor = day; mode = 'day'; render();
        }
      });
      grid.append(cell);
    }
    wrap.append(head, grid);
    return wrap;
  }

  // -------------------------------------------------------------- modals

  function eventModal(ev) {
    const isRecur = !!ev.rrule;
    const master = api.getEvent(ev.eventId ?? ev.id);
    const title = ev.title;
    const body = el('div', { class: 'event-detail' },
      el('div', { class: 'evd-title' }, title),
      el('div', { class: 'evd-meta' },
        el('span', {}, icon('calendar', 14), ` ${fmtDateTime(ev.start)} – ${fmtTime(ev.end.slice(11, 16))}`),
        ev.location ? el('span', {}, icon('plug', 14), ` ${ev.location}`) : null,
        ev.isException ? el('span', { class: 'chip' }, 'this instance only') : isRecur ? el('span', { class: 'chip chip-recur' }, icon('repeat', 12), ' recurring') : null,
      ),
      ev.description ? el('p', { class: 'evd-desc' }, ev.description) : null,
    );
    openModal({
      title: 'Event',
      width: 440,
      body,
      footer: el('div', { class: 'modal-actions' },
        el('button', { class: 'btn', onclick: () => editEventModal(master, ev) }, 'Edit'),
        el('button', { class: 'btn btn-danger', onclick: () => deleteEventModal(master, ev) }, 'Delete'),
      ),
    });
  }

  function editEventModal(ev, inst) {
    const isRecur = !!ev.rrule || inst?.isException;
    const edit = (target) => {
      const inputs = {};
      const body = el('div', { class: 'modal-form' },
        field('Title', inputs.title = textInput(target.title, { placeholder: 'Event title' })),
        field('Location', inputs.location = textInput(target.location ?? '', { placeholder: 'Where' })),
        field('Start', inputs.start = textInput(target.start.slice(0, 16), { type: 'datetime-local' })),
        field('End', inputs.end = textInput(target.end.slice(0, 16), { type: 'datetime-local' })),
        field('Repeat', inputs.rrule = selectInput([
          { value: '', label: 'Does not repeat' },
          { value: 'FREQ=DAILY', label: 'Daily' },
          { value: 'FREQ=WEEKLY', label: 'Weekly' },
          { value: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', label: 'Mon · Wed · Fri' },
          { value: 'FREQ=WEEKLY;BYDAY=TU,TH', label: 'Tue · Thu' },
          { value: 'FREQ=MONTHLY', label: 'Monthly' },
        ], target.rrule ?? '')),
        field('Reminder', inputs.rem = textInput(String(target.reminders?.[0]?.minutes ?? ''), { type: 'number', placeholder: 'minutes before' })),
        field('Color', inputs.color = textInput(target.color ?? '#5b8cff')),
      );
      const { close } = openModal({
        title: 'Edit event',
        width: 440,
        body,
        footer: el('div', { class: 'modal-actions' },
          el('button', { class: 'btn', onclick: close }, 'Cancel'),
          el('button', { class: 'btn btn-primary', onclick: () => {
            const v = {
              title: inputs.title.value.trim(), location: inputs.location.value.trim(),
              start: inputs.start.value + ':00', end: inputs.end.value + ':00',
              rrule: inputs.rrule.value || null,
              reminders: inputs.rem.value !== '' ? [{ minutes: Number(inputs.rem.value) }] : [],
              color: inputs.color.value || '#5b8cff',
            };
            if (!v.title || !v.start || !v.end) { toast('Title, start and end required', { kind: 'warn' }); return; }
            try {
              api.updateEvent(target.id, v, { instance: inst?.isException ? undefined : (inst ? inst.instanceStart : undefined) });
              toast('Event saved', { kind: 'success', icon: 'check' });
              close(); ctx.bus.emit('ui:refresh');
            } catch (e) { toast(String(e.message ?? e), { kind: 'warn' }); }
          } }, 'Save'),
        ),
      });
    };
    if (isRecur && !inst?.isException) {
      openModal({
        title: 'Edit recurring event',
        width: 400,
        body: el('p', { class: 'muted' }, 'This event repeats. What would you like to edit?'),
        footer: el('div', { class: 'modal-actions' },
          el('button', { class: 'btn', onclick: (e) => { e.target.closest('.modal-wrap')?.remove(); edit(ev); } }, 'This instance only'),
          el('button', { class: 'btn btn-primary', onclick: (e) => { e.target.closest('.modal-wrap')?.remove(); edit(ev); } }, 'All events'),
        ),
      });
    } else edit(ev);
  }

  function deleteEventModal(ev, inst) {
    const del = async (instance) => {
      if (!(await confirmDlg(`Delete “${ev.title}”?`, { danger: true, okLabel: 'Delete' }))) return;
      api.deleteEvent(ev.eventId ?? ev.id, { instance });
      toast('Event deleted', { kind: 'info' });
      ctx.bus.emit('ui:refresh');
    };
    if (ev.rrule && !inst?.isException) {
      openModal({
        title: 'Delete recurring event',
        width: 400,
        body: el('p', { class: 'muted' }, 'This event repeats. Delete just this one, or the whole series?'),
        footer: el('div', { class: 'modal-actions' },
          el('button', { class: 'btn', onclick: (e) => { e.target.closest('.modal-wrap')?.remove(); del(ev.instanceStart); } }, 'This instance'),
          el('button', { class: 'btn btn-danger', onclick: (e) => { e.target.closest('.modal-wrap')?.remove(); del(undefined); } }, 'All events'),
        ),
      });
    } else del(inst?.isException ? ev.instanceStart : undefined);
  }

  function newEventModal(day, startTime) {
    const endDefault = new Date(new Date(`${day}T${startTime}:00`).getTime() + 60 * 60000);
    const inputs = {};
    const body = el('div', { class: 'modal-form' },
      field('Title', inputs.title = textInput('', { placeholder: 'Event title' })),
      field('Start', inputs.start = textInput(`${day}T${startTime}`, { type: 'datetime-local' })),
      field('End', inputs.end = textInput(`${dateToStr(endDefault)}T${hhmm(endDefault)}`, { type: 'datetime-local' })),
      field('Repeat', inputs.rrule = selectInput([
        { value: '', label: 'Does not repeat' },
        { value: 'FREQ=DAILY', label: 'Daily' },
        { value: 'FREQ=WEEKLY', label: 'Weekly' },
        { value: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', label: 'Mon · Wed · Fri' },
        { value: 'FREQ=WEEKLY;BYDAY=TU,TH', label: 'Tue · Thu' },
        { value: 'FREQ=MONTHLY', label: 'Monthly' },
      ], '')),
      field('Reminder', inputs.rem = textInput(String(api.settings.reminderDefault), { type: 'number', placeholder: 'minutes before' })),
    );
    const { close } = openModal({
      title: 'New event',
      width: 440,
      body,
      footer: el('div', { class: 'modal-actions' },
        el('button', { class: 'btn', onclick: close }, 'Cancel'),
        el('button', { class: 'btn btn-primary', onclick: () => {
          const v = {
            title: inputs.title.value.trim(), start: inputs.start.value + ':00', end: inputs.end.value + ':00',
            rrule: inputs.rrule.value || null,
            reminders: [{ minutes: Number(inputs.rem.value || api.settings.reminderDefault) }],
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
          };
          if (!v.title || !v.start || !v.end) { toast('Title, start and end required', { kind: 'warn' }); return; }
          try {
            api.createEvent(v);
            toast('Event scheduled', { kind: 'success', icon: 'check' });
            close(); ctx.bus.emit('ui:refresh');
          } catch (e) { toast(String(e.message ?? e), { kind: 'warn' }); }
        } }, 'Create'),
      ),
    });
  }

  root.replaceChildren(toolbar, body);
  render();
  return { refresh: render, setDay: (d) => { anchor = d; mode = 'day'; render(); } };
}
