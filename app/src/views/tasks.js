// agenda — Today / Task List view.
// Browse any day's task list, add notes, schedule tasks with time + reminder.

import { el, icon, fmtTime, fmtDay, fmtDuration, addDays, todayStr, openModal, confirmDlg, field, textInput, selectInput, toast } from '../ui.js';

export function renderTasks(root, ctx, day = todayStr()) {
  const { api } = ctx;
  let currentDay = day;
  let quickDraft = '';

  const top = el('div', { class: 'view-top' },
    el('div', { class: 'day-nav' },
      el('button', { class: 'icon-btn', title: 'Previous day', onclick: () => setDay(addDays(currentDay, -1)) }, icon('arrowLeft', 18)),
      el('div', { class: 'day-label' },
        el('div', { class: 'day-name' }, ''),
        el('div', { class: 'day-rel' }, ''),
      ),
      el('button', { class: 'icon-btn', title: 'Next day', onclick: () => setDay(addDays(currentDay, 1)) }, icon('arrowRight', 18)),
      el('button', { class: 'btn btn-ghost btn-today', onclick: () => setDay(todayStr()) }, 'Today'),
    ),
    el('div', { class: 'view-progress' }),
  );

  const quickAdd = el('div', { class: 'quick-add' },
    el('input', {
      class: 'quick-input', placeholder: 'Add a task or note…  (time + reminder via edit)', value: quickDraft,
      onkeydown: (e) => { if (e.key === 'Enter') addQuick(e.target.value); },
    }),
    el('button', { class: 'btn btn-primary', onclick: () => { const v = quickAdd.querySelector('input').value; addQuick(v); } }, 'Add'),
    el('button', { class: 'btn btn-ghost', title: 'Add with time & reminder', onclick: () => openTaskModal(null) }, icon('clock', 16)),
  );

  const list = el('div', { class: 'task-list' });

  function setDay(d) {
    currentDay = d;
    render();
  }

  function render() {
    const open = api.listTasks({ date: currentDay, status: 'open' });
    const done = api.listTasks({ date: currentDay, status: 'done' });
    const scheduled = open.filter((t) => t.time).sort((a, b) => a.time.localeCompare(b.time));
    const notes = open.filter((t) => !t.time);

    const rel = (() => {
      const diff = Math.round((new Date(`${currentDay}T00:00:00`) - new Date(`${todayStr()}T00:00:00`)) / 86400000);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff === -1) return 'Yesterday';
      return '';
    })();

    top.querySelector('.day-name').textContent = fmtDay(currentDay);
    top.querySelector('.day-rel').textContent = rel;
    top.querySelector('.view-progress').replaceChildren(
      el('div', { class: 'progress-bar' },
        el('div', { class: 'progress-fill', style: `width:${open.length + done.length ? (done.length / (open.length + done.length)) * 100 : 0}%` }),
      ),
      el('span', { class: 'progress-txt' }, `${done.length}/${open.length + done.length} done`),
    );

    list.replaceChildren();
    if (!scheduled.length && !notes.length && !done.length) {
      list.append(el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, icon('task', 30)),
        el('p', {}, 'Nothing on this day yet.'),
        el('p', { class: 'muted' }, 'Type above to add a note, or schedule work from the Projects board.'),
      ));
      return;
    }

    const groups = [];
    if (scheduled.length) groups.push(['Scheduled', scheduled.map(taskRow)]);
    if (notes.length) groups.push(['Notes', notes.map(taskRow)]);
    if (done.length) groups.push([`Completed (${done.length})`, done.map(taskRow)]);

    for (const [label, rows] of groups) {
      list.append(el('div', { class: 'task-group' }, el('div', { class: 'task-group-label' }, label), ...rows));
    }
  }

  function taskRow(t) {
    const cardSrc = t.source?.startsWith('card:') ? api.getCard(t.source.slice(5)) : null;
    const project = cardSrc ? api.getProject(cardSrc.projectId) : null;
    const chips = [];
    if (t.time) chips.push(el('span', { class: 'chip' }, icon('clock', 12), ` ${fmtTime(t.time)}`));
    if (t.durationMin) chips.push(el('span', { class: 'chip' }, fmtDuration(t.durationMin)));
    if (t.reminderMin != null) chips.push(el('span', { class: 'chip chip-bell' }, icon('bell', 12), ` ${t.reminderMin}m`));
    if (cardSrc && project) chips.push(el('span', { class: 'chip', style: `border-color:${project.color}55;color:${project.color}` }, `● ${project.name}`));
    if (t.notes) chips.push(el('span', { class: 'chip chip-note', title: t.notes }, 'note'));

    return el('div', { class: `task-row ${t.status === 'done' ? 'is-done' : ''}` },
      el('button', { class: 'task-check', title: t.status === 'done' ? 'Reopen' : 'Complete', onclick: () => toggle(t) },
        icon(t.status === 'done' ? 'x' : 'check', 15)),
      el('div', { class: 'task-main' },
        el('div', { class: 'task-title' }, t.title),
        el('div', { class: 'task-chips' }, chips),
      ),
      el('div', { class: 'task-actions' },
        el('button', { class: 'icon-btn', title: 'Edit', onclick: () => openTaskModal(t) }, icon('edit', 15)),
        el('button', { class: 'icon-btn', title: 'Move to another day', onclick: () => moveDialog(t) }, icon('arrowRight', 15)),
        el('button', { class: 'icon-btn danger', title: 'Delete', onclick: async () => {
          if (await confirmDlg(`Delete “${t.title}”?`, { danger: true, okLabel: 'Delete' })) { api.deleteTask(t.id); render(); }
        } }, icon('trash', 15)),
      ),
    );
  }

  function toggle(t) {
    try {
      if (t.status === 'open') api.completeTask(t.id);
      else api.reopenTask(t.id);
      ctx.bus.emit('ui:refresh');
      render();
    } catch (e) { toast(String(e.message ?? e), { kind: 'warn' }); }
  }

  function addQuick(text) {
    const v = (text ?? '').trim();
    if (!v) return;
    try {
      const task = api.createTask({ title: v, date: currentDay, reminderMin: null });
      toast(`Added “${task.title}”`, { kind: 'success', icon: 'check' });
      quickAdd.querySelector('input').value = '';
      ctx.bus.emit('ui:refresh');
      render();
    } catch (e) { toast(String(e.message ?? e), { kind: 'warn' }); }
  }

  function moveDialog(t) {
    openModal({
      title: `Move “${t.title}”`,
      width: 380,
      body: el('div', { class: 'modal-form' },
        field('Day', textInput(t.date, { placeholder: 'YYYY-MM-DD or e.g. tomorrow' })),
        field('Time (optional)', textInput(t.time ?? '', { placeholder: 'e.g. 18:00' })),
      ),
      footer: el('div', { class: 'modal-actions' },
        el('button', { class: 'btn btn-primary', onclick: (e) => {
          const modal = e.target.closest('.modal-card');
          const [d, tm] = modal.querySelectorAll('input');
          api.rescheduleTask(t.id, { date: d.value || undefined, time: tm.value || null });
          toast('Task moved', { kind: 'success', icon: 'check' });
          ctx.bus.emit('ui:refresh');
          modal.closest('.modal-wrap')?.remove();
          render();
        } }, 'Move'),
      ),
    });
  }

  function openTaskModal(t) {
    const isNew = !t;
    const f = {
      title: t?.title ?? '',
      notes: t?.notes ?? '',
      date: t?.date ?? currentDay,
      time: t?.time ?? '',
      duration: t?.durationMin ?? '',
      reminder: t?.reminderMin ?? '',
      priority: t?.priority ?? 1,
    };
    const inputs = {};
    const body = el('div', { class: 'modal-form' },
      field('Task', inputs.title = textInput(f.title, { placeholder: 'What needs doing?' })),
      field('Notes', inputs.notes = textInput(f.notes, { placeholder: 'Details (optional)' })),
      field('Day', inputs.date = textInput(f.date, { placeholder: 'YYYY-MM-DD' })),
      field('Time', inputs.time = textInput(f.time, { placeholder: '18:00 — leave empty for a note' })),
      field('Duration (min)', inputs.duration = textInput(String(f.duration ?? ''), { placeholder: 'e.g. 30', type: 'number' })),
      field('Reminder (min before)', inputs.reminder = textInput(String(f.reminder ?? ''), { placeholder: `default ${api.settings.reminderDefault}` , type: 'number' })),
      field('Priority', inputs.priority = selectInput([{ value: '0', label: 'Low' }, { value: '1', label: 'Normal' }, { value: '2', label: 'High' }, { value: '3', label: 'Critical' }], String(f.priority))),
    );
    const { close } = openModal({
      title: isNew ? 'New task' : 'Edit task',
      width: 440,
      body,
      footer: el('div', { class: 'modal-actions' },
        el('button', { class: 'btn', onclick: close }, 'Cancel'),
        el('button', { class: 'btn btn-primary', onclick: () => {
          const v = {
            title: inputs.title.value.trim(), notes: inputs.notes.value.trim(),
            date: inputs.date.value, time: inputs.time.value || null,
            durationMin: inputs.duration.value ? Number(inputs.duration.value) : null,
            reminderMin: inputs.reminder.value !== '' ? Number(inputs.reminder.value) : (inputs.time.value && isNew ? api.settings.reminderDefault : null),
            priority: Number(inputs.priority.value),
          };
          if (!v.title) { toast('Title is required', { kind: 'warn' }); return; }
          try {
            if (isNew) api.createTask(v);
            else api.updateTask(t.id, v);
            toast(isNew ? 'Task added' : 'Task updated', { kind: 'success', icon: 'check' });
            close(); ctx.bus.emit('ui:refresh'); render();
          } catch (e) { toast(String(e.message ?? e), { kind: 'warn' }); }
        } }, isNew ? 'Add task' : 'Save'),
      ),
    });
  }

  root.replaceChildren(top, quickAdd, list);
  ctx.onTaskEdit = openTaskModal;
  render(); // initial render of the day
  return {
    refresh: render,
    setDay,
    openTask: (t) => { if (currentDay !== t.date) setDay(t.date); openTaskModal(t); },
    get day() { return currentDay; },
  };
}
