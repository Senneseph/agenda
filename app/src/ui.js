// agenda — shared UI + date helpers.
// Small, dependency-free utilities used by every view.

export function uid() {
  return (crypto?.randomUUID?.() ?? 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36));
}

// ---------- DOM ----------

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'onclick') node.addEventListener('click', v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : String(c));
  }
  return node;
}

export function clear(node) { node.replaceChildren(); return node; }

// ---------- Icons (inline SVG) ----------

const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  task: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>',
  plug: '<path d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0Z"/><path d="M12 17v5"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  play: '<path d="M6 4l14 8-14 8Z"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z"/><path d="M4 22v-7"/>',
};

export function icon(name, size = 18, stroke = 2) {
  return el('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': stroke, 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true',
  }, el('g', { html: ICONS[name] ?? '' }));
}

// ---------- Dates (local time, YYYY-MM-DD) ----------

export function dateToStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function strToDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function todayStr() { return dateToStr(new Date()); }
export function addDays(s, n) {
  const d = strToDate(s); d.setDate(d.getDate() + n); return dateToStr(d);
}
export function diffDays(a, b) { // a - b in days
  return Math.round((strToDate(a) - strToDate(b)) / 86400000);
}
export function weekdayIndex(s) { // 0=Mon … 6=Sun
  const d = strToDate(s);
  return (d.getDay() + 6) % 7;
}
export function mondayOf(s) {
  return addDays(s, -weekdayIndex(s));
}
export function monthStrOf(s) { return s.slice(0, 7); }
export function fmtDay(s) {
  return strToDate(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
export function fmtDayShort(s) {
  return strToDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
export function fmtDateMed(s) {
  return strToDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function fmtTime(hhmm) { // "18:00" → "6:00 pm"
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${ampm}` : `${h12} ${ampm}`;
}
export function isoLocal(d) {
  return `${dateToStr(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
}
export function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function fmtRel(iso) {
  const diff = new Date(iso) - new Date();
  const min = Math.round(diff / 60000);
  if (Math.abs(min) < 1) return 'now';
  if (min < 0) { const a = -min; return a < 60 ? `${a}m ago` : `${Math.round(a / 60)}h ago`; }
  if (min < 60) return `in ${min}m`;
  if (min < 60 * 24) return `in ${Math.round(min / 60)}h`;
  return `in ${Math.round(min / 1440)}d`;
}
export function hhmm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
export function minutesToHhmm(total) {
  const h = Math.floor(total / 60), m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function fmtDuration(min) {
  if (min == null) return '';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ---------- Natural-language time/date tokens ----------

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function parseClock(text) { // "6pm" "6:30 pm" "14:00" "noon" "midnight" → "HH:MM" | null
  if (!text) return null;
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  if (t === 'noon') return '12:00';
  if (t === 'midnight') return '00:00';
  let m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]), mm = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (!ap && h > 23) return null;
  if (h > 23 || mm > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function parseDayToken(text, now = new Date()) { // → YYYY-MM-DD | null
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const today = dateToStr(now);
  if (t === 'today' || t === 'tonight') return today;
  if (t === 'tomorrow') return addDays(today, 1);
  if (t === 'yesterday') return addDays(today, -1);
  let m = t.match(/^(next|this|coming)?\s*(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (m) {
    const name = m[2];
    const long = DAY_NAMES.find((d) => d.startsWith(name.length <= 3 ? name : name.slice(0, 3))) ?? name;
    const idx = DAY_NAMES.indexOf(long);
    let target = strToDate(today);
    let delta = (idx - weekdayIndex(today) + 7) % 7;
    if (delta === 0) delta = 7; // next occurrence
    if (m[1] === 'next') delta += 7;
    if (m[1] === 'this' && delta === 7) delta = 0; // this friday = today if today is friday
    target.setDate(target.getDate() + delta);
    return dateToStr(target);
  }
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:ember|uary|ch|il|e|y|ly|ust|tember|ober|ember)?\s*(\d{4})?$/);
  if (m) {
    const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mo = monthMap[m[2].slice(0, 3)];
    const yr = m[3] ? Number(m[3]) : now.getFullYear();
    return dateToStr(new Date(yr, mo, Number(m[1])));
  }
  m = t.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:ember|uary|ch|il|e|y|ly|ust|tember|ober|ember)?\s+(\d{1,2})(?:st|nd|rd|th)?\s*(\d{4})?$/);
  if (m) {
    const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mo = monthMap[m[1].slice(0, 3)];
    const yr = m[3] ? Number(m[3]) : now.getFullYear();
    return dateToStr(new Date(yr, mo, Number(m[2])));
  }
  return null;
}

export function parseDurationToken(text) { // "30 minutes" "an hour" "1.5 hours" "90 min" → minutes | null
  if (!text) return null;
  const t = text.trim().toLowerCase();
  const m = t.match(/^(\d+(?:\.\d+)?|an?|half)\s*(hours?|hrs?|h|minutes?|mins?|m)$/);
  if (!m) return null;
  const n = m[1] === 'an' || m[1] === 'a' ? 1 : m[1] === 'half' ? 0.5 : Number(m[1]);
  const unit = m[2][0];
  return Math.round(n * (unit === 'h' ? 60 : 1));
}

// ---------- Modal / toast / confirm ----------

let toastHost = null;
export function toast(msg, opts = {}) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host' });
    document.body.append(toastHost);
  }
  const t = el('div', { class: `toast ${opts.kind ?? 'info'}` },
    opts.icon ? el('span', { class: 'toast-icon' }, icon(opts.icon, 16)) : null,
    el('span', {}, msg),
  );
  toastHost.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, opts.sticky ? 6000 : 3400);
}

let modalHost = null;
export function openModal({ title, body, footer, width = 460, onClose }) {
  if (!modalHost) {
    modalHost = el('div', { class: 'modal-host' });
    document.body.append(modalHost);
  }
  const modal = el('div', { class: 'modal-card', style: `--mw:${width}px` },
    el('div', { class: 'modal-head' },
      el('h3', {}, title),
      el('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, icon('x', 18)),
    ),
    el('div', { class: 'modal-body' }, body),
    footer ? el('div', { class: 'modal-foot' }, footer) : null,
  );
  const wrap = el('div', { class: 'modal-wrap' }, modal);
  modalHost.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));

  function close() {
    wrap.classList.remove('show');
    setTimeout(() => { wrap.remove(); onClose?.(); }, 180);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  return { close, el: modal };
}

export function confirmDlg(message, { danger = false, okLabel = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    const { close } = openModal({
      title: 'Are you sure?',
      body: el('p', { class: 'muted' }, message),
      width: 380,
      footer: el('div', { class: 'modal-actions' },
        el('button', { class: 'btn', onclick: () => { close(); resolve(false); } }, 'Cancel'),
        el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => { close(); resolve(true); } }, okLabel),
      ),
    });
  });
}

// ---------- Form helpers ----------

export function field(labelText, control, hint) {
  return el('label', { class: 'field' },
    el('span', { class: 'field-label' }, labelText),
    control,
    hint ? el('span', { class: 'field-hint' }, hint) : null,
  );
}

export function textInput(value = '', { placeholder = '', type = 'text' } = {}) {
  const input = el('input', { class: 'txt', type, placeholder, value });
  return input;
}

export function selectInput(options, value = '') {
  const sel = el('select', { class: 'txt' },
    options.map((o) => el('option', { value: o.value, selected: o.value === value ? '' : null }, o.label)),
  );
  return sel;
}
