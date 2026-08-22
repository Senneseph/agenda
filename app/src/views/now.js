// agenda — Now screen (the lock screen).
// Plain, dark, one thing in the middle: the current task. Slide up (or press
// Space/↑/click the handle) to unlock into the full app. Tapping the task
// opens it; the check completes it. A gentle focus timer keeps a human on-task.

import { el, icon, fmtTime, fmtDay, fmtRel, todayStr, hhmm } from '../ui.js';

export function renderNow(root, ctx) {
  const { api } = ctx;
  root.classList.add('now-screen');
  let state = null;
  let timerHandle = null;
  let tickHandle = null;
  let focus = { active: false, running: false, seconds: 0, target: ctx.api.settings.focusMinutes * 60 };

  const wrap = el('div', { class: 'now-wrap' });

  function render() {
    const n = api.now();
    state = n;
    const now = new Date();
    const dayChip = el('div', { class: 'now-daychip' },
      el('span', {}, fmtDay(n.day)),
      el('span', { class: 'now-clock' }, hhmm(now)),
    );

    // The current-task card
    const isEvent = n.current?.kind === 'event';
    const card = el('div', {
      class: 'now-card' + (n.context === 'clear' ? ' is-clear' : '') + (isEvent ? ' is-event' : ''),
      onclick: () => n.current && openTask(n.current),
    },
      el('div', { class: 'now-context' }, contextChip(n.context)),
      n.current
        ? el('div', { class: 'now-title' }, (isEvent ? '📅 ' : '') + n.current.title)
        : el('div', { class: 'now-title clear' }, n.dayOpen ? 'A quiet moment' : 'All clear ✨'),
      n.current && n.current.time
        ? el('div', { class: 'now-time' }, isEvent
            ? `${fmtTime(n.current.time)} – ${fmtTime(n.current.endTime)}`
            : `${fmtTime(n.current.time)}${n.current.durationMin ? ` · ${n.current.durationMin} min` : ''}`)
        : n.current ? el('div', { class: 'now-time' }, 'Unscheduled') : null,
      n.current ? el('div', { class: 'now-source' }, sourceLabel(n.current)) : el('div', { class: 'now-source' }, n.dayOpen ? `${n.dayOpen} open · ${n.dayDone} done today` : 'Nothing scheduled — enjoy the pause'),
    );

    // focus ring + controls
    const ring = focusRing();
    const controls = el('div', { class: 'now-controls' },
      isEvent
        ? el('button', { class: 'now-btn', title: 'Open in Planner', onclick: (e) => { e.stopPropagation(); ctx.gotoPlanner?.(n.current.date); } }, icon('calendar', 18))
        : el('button', { class: 'now-btn', title: 'Complete task', onclick: (e) => { e.stopPropagation(); if (n.current) complete(n.current); } }, icon('check', 20)),
      el('button', { class: 'now-btn', title: 'Focus timer', onclick: (e) => { e.stopPropagation(); toggleFocus(); } },
        focus.active ? icon('pause', 18) : icon('play', 18)),
      isEvent
        ? el('button', { class: 'now-btn', title: 'Open in Planner', onclick: (e) => { e.stopPropagation(); ctx.gotoPlanner?.(n.current.date); } }, icon('task', 18))
        : el('button', { class: 'now-btn', title: 'Open in Today', onclick: (e) => { e.stopPropagation(); openToday(n.current); } }, icon('task', 18)),
    );

    const nextUp = el('div', { class: 'now-nextup' },
      el('div', { class: 'now-nextup-title' }, 'Next up'),
      n.nextUp.length
        ? n.nextUp.map((t) => el('div', { class: 'now-nextup-item' },
            el('span', { class: 'dot' }),
            el('span', { class: 'txt' }, t.title),
            t.time ? el('span', { class: 'time' }, fmtTime(t.time)) : null,
          ))
        : el('div', { class: 'now-nextup-item muted' }, n.current ? 'Nothing else today' : '—'),
    );

    wrap.replaceChildren(dayChip, ring, card, controls, nextUp);

    // unlock handle
    let handle = wrap.querySelector('.now-handle');
    if (!handle) {
      handle = el('button', { class: 'now-handle', onclick: ctx.unlock },
        el('span', { class: 'handle-pill' }),
        el('span', { class: 'handle-label' }, 'slide up'),
      );
      wrap.append(handle);
    }

    // focus timer auto-updates the ring
    updateRing();
  }

  function contextChip(c) {
    const map = { focus: 'Doing now', event: 'In calendar', 'event-next': 'Coming up', next: 'Next up', carryover: 'Carried over', clear: 'Status' };
    return map[c] ?? c;
  }

  function sourceLabel(t) {
    if (t.kind === 'event') return `Calendar · ${fmtDay(t.date)}`;
    if (t.source?.startsWith('card:')) {
      const card = api.getCard(t.source.slice(5));
      const project = card ? api.getProject(card.projectId) : null;
      return `Project work · ${project?.name ?? '?'}`;
    }
    if (t.time) return `Scheduled · ${fmtDay(t.date)}`;
    return `Task · ${fmtDay(t.date)}`;
  }

  function focusRing() {
    let ring = wrap.querySelector('.now-ring');
    if (!ring) {
      ring = el('div', { class: 'now-ring' },
        el('svg', { viewBox: '0 0 120 120', width: 120, height: 120 },
          el('circle', { class: 'ring-bg', cx: 60, cy: 60, r: 54 }),
          el('circle', { class: 'ring-fg', cx: 60, cy: 60, r: 54 }),
        ),
        el('div', { class: 'ring-label' }, '0:00'),
      );
      wrap.append(ring);
    }
    return ring;
  }

  function updateRing() {
    const ring = wrap.querySelector('.now-ring');
    if (!ring) return;
    const label = ring.querySelector('.ring-label');
    const fg = ring.querySelector('.ring-fg');
    const frac = focus.target > 0 ? Math.min(1, focus.seconds / focus.target) : 0;
    const C = 2 * Math.PI * 54;
    fg.style.strokeDasharray = `${C}`;
    fg.style.strokeDashoffset = `${C * (1 - frac)}`;
    const m = Math.floor(focus.seconds / 60), s = focus.seconds % 60;
    label.textContent = `${m}:${String(s).padStart(2, '0')}`;
    label.classList.toggle('running', focus.running && focus.active);
    if (focus.seconds >= focus.target && focus.active) { focus.active = false; focus.seconds = 0; ctx.toast('Focus session complete 🎉', { kind: 'success', icon: 'check' }); }
  }

  function tick() {
    if (focus.running && focus.active) focus.seconds++;
    updateRing();
  }

  function toggleFocus() {
    if (!state?.current) { ctx.toast('No current task to focus on', { kind: 'warn' }); return; }
    focus.active = !focus.active;
    focus.running = focus.active;
    if (focus.active && focus.seconds >= focus.target) focus.seconds = 0;
    ctx.toast(focus.active ? 'Focus mode on' : 'Focus paused', { kind: 'info', icon: focus.active ? 'play' : 'pause' });
  }

  function complete(t) {
    try {
      api.completeTask(t.id);
      ctx.toast(`Done: ${t.title}`, { kind: 'success', icon: 'check' });
      ctx.bus.emit('ui:refresh');
      render();
    } catch (e) { ctx.toast(String(e.message ?? e), { kind: 'warn' }); }
  }

  function openTask(t) {
    if (t?.kind === 'event') { ctx.gotoPlanner?.(t.date); return; }
    ctx.openTaskModal(t);
  }
  function openToday(t) {
    ctx.gotoTasks(t?.date ?? todayStr());
  }

  // touch: swipe up to unlock
  let startY = null;
  function onTouchStart(e) { startY = e.touches[0].clientY; }
  function onTouchMove(e) {
    if (startY == null) return;
    const dy = startY - e.touches[0].clientY;
    if (dy > 90) { startY = null; ctx.unlock(); }
  }

  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchmove', onTouchMove, { passive: true });

  function onKey(e) {
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'Enter') { e.preventDefault(); ctx.unlock(); }
  }
  document.addEventListener('keydown', onKey);

  function start() {
    render();
    timerHandle = setInterval(() => { render(); }, 30000); // refresh now-state
    tickHandle = setInterval(tick, 1000);
  }
  function stop() {
    clearInterval(timerHandle);
    clearInterval(tickHandle);
    document.removeEventListener('keydown', onKey);
    root.removeEventListener('touchstart', onTouchStart);
    root.removeEventListener('touchmove', onTouchMove);
    root.classList.remove('now-screen');
    wrap.replaceChildren();
  }

  root.append(wrap);
  start();
  return { stop, refresh: render };
}
