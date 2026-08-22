// agenda — Projects & Kanban board.
// Kanboard-flavored columns with workflow-enforced moves. Scheduling a card
// for a date feeds the day planner and the daily task list (the pipeline).

import { el, icon, fmtTime, fmtDateMed, fmtDuration, fmtDayShort, todayStr, addDays, openModal, confirmDlg, field, textInput, selectInput, toast } from '../ui.js';

const COLUMN_ORDER = ['backlog', 'ready', 'inprogress', 'review', 'done'];
const PROJECT_COLORS = ['#5b8cff', '#4fd1a5', '#f6ad55', '#f472b6', '#a78bfa', '#34d399', '#f87171', '#22d3ee', '#facc15', '#fb923c'];

export function renderKanban(root, ctx, opts = {}) {
  const { api } = ctx;
  let selectedProject = opts.projectId ?? api.listProjects()[0]?.id ?? null;

  const toolbar = el('div', { class: 'view-top kanban-top' },
    el('div', { class: 'project-picker' }),
    el('div', { class: 'kanban-actions' },
      el('button', { class: 'btn btn-ghost', onclick: () => projectModal(null) }, icon('plus', 16), ' New project'),
    ),
  );

  const board = el('div', { class: 'board-scroll' });

  function render() {
    const projects = api.listProjects();
    if (!projects.length) {
      board.replaceChildren(el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, icon('board', 30)),
        el('p', {}, 'No projects yet.'),
        el('button', { class: 'btn btn-primary', onclick: () => projectModal(null) }, 'Create your first project'),
      ));
      return;
    }
    if (!selectedProject || !projects.some((p) => p.id === selectedProject)) selectedProject = projects[0].id;
    const project = api.getProject(selectedProject);
    const cards = api.listCards({ projectId: selectedProject });

    // project picker: pill buttons
    const picker = toolbar.querySelector('.project-picker');
    picker.replaceChildren(
      projects.map((p) => el('button', {
        class: 'project-pill' + (p.id === selectedProject ? ' active' : ''),
        style: p.id === selectedProject ? `--pill:${p.color}` : '',
        onclick: () => { selectedProject = p.id; render(); },
      }, el('span', { class: 'pill-dot', style: `background:${p.color}` }), p.name,
        Object.values(p.cardCounts ?? {}).reduce((a, b) => a + b, 0) ? el('span', { class: 'pill-count' }, Object.values(p.cardCounts ?? {}).reduce((a, b) => a + b, 0)) : null)),
    );

    board.replaceChildren(renderBoard(project, cards));
  }

  function renderBoard(project, cards) {
    const boardEl = el('div', { class: 'board' });
    for (const col of COLUMN_ORDER) {
      const colCards = cards.filter((c) => c.status === col).sort((a, b) => a.order - b.order);
      const column = el('div', { class: `column col-${col}` },
        el('div', { class: 'column-head' },
          el('span', { class: 'column-dot' }),
          el('span', { class: 'column-title' }, api.COLUMN_LABEL[col]),
          el('span', { class: 'column-count' }, colCards.length),
        ),
        el('div', { class: 'column-cards', dataset: { col } },
          colCards.map((c) => cardEl(c, project)),
          el('button', { class: 'add-card', onclick: () => cardModal(null, project.id, col) }, icon('plus', 14), ' Add card'),
        ),
      );
      column.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      column.addEventListener('drop', (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if (!id) return;
        try {
          api.moveCard(id, { to: col });
          toast('Card moved', { kind: 'success', icon: 'check' });
          ctx.bus.emit('ui:refresh');
        } catch (err) { toast(String(err.message ?? err), { kind: 'warn' }); }
        render();
      });
      boardEl.append(column);
    }
    return boardEl;
  }

  function cardEl(c, project) {
    const done = c.status === 'done';
    const scheduled = c.scheduledDate;
    return el('div', {
      class: 'card' + (done ? ' is-done' : ''),
      draggable: 'true',
      style: `--card-accent:${project.color}`,
      onclick: () => cardModal(c, project.id),
    },
      el('div', { class: 'card-top' },
        el('span', { class: 'card-title' }, c.title),
        el('span', { class: 'card-menu', onclick: (e) => { e.stopPropagation(); cardModal(c, project.id); } }, '⋯'),
      ),
      c.description ? el('div', { class: 'card-desc' }, c.description.slice(0, 90) + (c.description.length > 90 ? '…' : '')) : null,
      el('div', { class: 'card-meta' },
        c.labels?.length ? c.labels.map((l) => el('span', { class: 'card-label' }, l)) : null,
        c.priority >= 2 ? el('span', { class: 'card-pri', title: c.priority === 3 ? 'Critical' : 'High' }, c.priority === 3 ? '!!' : '!') : null,
        c.estimateMin ? el('span', { class: 'card-est' }, fmtDuration(c.estimateMin)) : null,
      ),
      scheduled && !done ? el('div', { class: `card-sched${c.scheduledDone ? ' is-done' : ''}` },
        icon('calendar', 12), ` ${fmtDayShort(scheduled)}${c.scheduledStart ? ' · ' + fmtTime(c.scheduledStart) : ''}${c.scheduledDone ? ' ✓' : ''}`) : null,
    );
  }

  // ------------------------------------------------------------- modal

  function cardModal(card, projectId, fromCol = null) {
    const isNew = !card;
    const project = api.getProject(projectId);
    const f = {
      title: card?.title ?? '', description: card?.description ?? '',
      labels: card?.labels?.join(', ') ?? '', priority: card?.priority ?? 1,
      estimate: card?.estimateMin ?? '',
      sdate: card?.scheduledDate ?? '', stime: card?.scheduledStart ?? '', smin: card?.scheduledMinutes ?? '',
    };
    const inputs = {};

    const scheduleSection = el('div', { class: 'schedule-box' },
      el('div', { class: 'schedule-title' }, icon('zap', 14), ' Schedule work (→ task list & planner)'),
      el('div', { class: 'schedule-row' },
        field('Date', inputs.sdate = textInput(f.sdate, { placeholder: 'e.g. ' + addDays(todayStr(), 1) })),
        field('Start', inputs.stime = textInput(f.stime, { placeholder: '10:00' })),
        field('Minutes', inputs.smin = textInput(f.smin, { placeholder: '60', type: 'number' })),
      ),
      card?.scheduledDate
        ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { api.unscheduleCard(card.id); toast('Unscheduled', { kind: 'info' }); close(); ctx.bus.emit('ui:refresh'); } }, 'Remove schedule')
        : null,
    );

    const body = el('div', { class: 'modal-form' },
      field('Title', inputs.title = textInput(f.title, { placeholder: 'Card title' })),
      field('Description', inputs.description = textInput(f.description, { placeholder: 'Details (optional)' })),
      field('Labels', inputs.labels = textInput(f.labels, { placeholder: 'comma, separated' })),
      el('div', { class: 'schedule-row' },
        field('Priority', inputs.priority = selectInput([
          { value: '0', label: 'Low' }, { value: '1', label: 'Normal' }, { value: '2', label: 'High' }, { value: '3', label: 'Critical' },
        ], String(f.priority))),
        field('Estimate (min)', inputs.estimate = textInput(f.estimate, { placeholder: 'e.g. 60', type: 'number' })),
      ),
      scheduleSection,
      card && !isNew
        ? field('Move to column', inputs.col = selectInput(COLUMN_ORDER.map((c) => ({ value: c, label: api.COLUMN_LABEL[c] })), card.status))
        : null,
    );

    const { close } = openModal({
      title: isNew ? `New card · ${project?.name}` : `Card · ${project?.name}`,
      width: 520,
      body,
      footer: el('div', { class: 'modal-actions' },
        isNew ? null : el('button', { class: 'btn btn-danger', onclick: async () => {
          if (await confirmDlg(`Delete “${card.title}”? Its scheduled tasks are removed too.`, { danger: true, okLabel: 'Delete' })) {
            api.deleteCard(card.id); close(); ctx.bus.emit('ui:refresh'); render();
          }
        } }, 'Delete'),
        el('button', { class: 'btn', onclick: close }, 'Cancel'),
        el('button', { class: 'btn btn-primary', onclick: () => {
          const v = {
            title: inputs.title.value.trim(), description: inputs.description.value.trim(),
            labels: inputs.labels.value.split(',').map((s) => s.trim()).filter(Boolean),
            priority: Number(inputs.priority.value), estimateMin: inputs.estimate.value ? Number(inputs.estimate.value) : null,
          };
          if (!v.title) { toast('Title is required', { kind: 'warn' }); return; }
          try {
            let c;
            if (isNew) {
              c = api.createCard(projectId, v);
              // initial column from the add button
              if (fromCol && fromCol !== 'backlog') api.moveCard(c.id, { to: fromCol });
            } else {
              c = api.updateCard(card.id, v);
              const col = inputs.col?.value;
              if (col && col !== card.status) api.moveCard(card.id, { to: col });
            }
            // schedule if a date was given
            if (inputs.sdate.value) {
              api.scheduleCard(c.id, {
                date: inputs.sdate.value, start: inputs.stime.value || null,
                minutes: inputs.smin.value ? Number(inputs.smin.value) : null,
              });
            }
            toast(isNew ? 'Card added' : 'Card updated', { kind: 'success', icon: 'check' });
            close(); ctx.bus.emit('ui:refresh'); render();
          } catch (e) { toast(String(e.message ?? e), { kind: 'warn' }); }
        } }, isNew ? 'Add card' : 'Save'),
      ),
    });
    if (isNew) {
      // nothing else needed — fromCol handled at create time
    }
  }

  function projectModal(project) {
    const isNew = !project;
    const inputs = {};
    const body = el('div', { class: 'modal-form' },
      field('Name', inputs.name = textInput(project?.name ?? '', { placeholder: 'Project name' })),
      field('Description', inputs.desc = textInput(project?.description ?? '', { placeholder: 'What is this project about?' })),
      field('Color', inputs.color = selectInput(PROJECT_COLORS.map((c) => ({ value: c, label: c })), project?.color ?? PROJECT_COLORS[0])),
    );
    const { close } = openModal({
      title: isNew ? 'New project' : 'Edit project',
      width: 420,
      body,
      footer: el('div', { class: 'modal-actions' },
        project && !isNew ? el('button', { class: 'btn btn-danger', onclick: async () => {
          if (await confirmDlg(`Delete project “${project.name}” and all its cards?`, { danger: true, okLabel: 'Delete' })) {
            api.deleteProject(project.id); close(); selectedProject = null; ctx.bus.emit('ui:refresh'); render();
          }
        } }, 'Delete') : null,
        el('button', { class: 'btn', onclick: close }, 'Cancel'),
        el('button', { class: 'btn btn-primary', onclick: () => {
          const name = inputs.name.value.trim();
          if (!name) { toast('Name is required', { kind: 'warn' }); return; }
          try {
            if (isNew) { const p = api.createProject({ name, description: inputs.desc.value.trim(), color: inputs.color.value }); selectedProject = p.id; }
            else api.updateProject(project.id, { name, description: inputs.desc.value.trim(), color: inputs.color.value });
            toast(isNew ? 'Project created' : 'Project updated', { kind: 'success', icon: 'check' });
            close(); ctx.bus.emit('ui:refresh'); render();
          } catch (e) { toast(String(e.message ?? e), { kind: 'warn' }); }
        } }, isNew ? 'Create' : 'Save'),
      ),
    });
  }

  root.replaceChildren(toolbar, board);
  render();
  return {
    refresh: render,
    openProject: (id) => { selectedProject = id; render(); },
    openCard: (card) => cardModal(card, card.projectId),
  };
}
