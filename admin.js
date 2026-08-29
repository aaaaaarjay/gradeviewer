/* ═══════════════════════════════════════════════
   GRADE VIEWER — ADMIN.JS
   Teacher Portal Logic
   ═══════════════════════════════════════════════ */

/* ─── CONSTANTS ─── */
const STORAGE_KEY    = 'gradeviewer_classes';
const PIN_KEY        = 'gradeviewer_pin';
const DEFAULT_PIN    = '1234';
const FIRESTORE_COL  = 'gradeviewer';
const FIRESTORE_DOC  = 'classes';
const SESSION_KEY    = 'gv_admin_session'; // sessionStorage key for PIN bypass within tab

let classList = [];
let bypassSectionCode = false;
let bypassStudentId   = false;
let addFormVisible    = true;
let reorderMode       = false;
let draggedClassId    = null;

/* ─── TOAST ─── */
function showToast(msg, duration = 3500) {
  const t = document.getElementById('admin-toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

/* ═══════════════════════════════════════════════
   AUTH — PIN LOCK
   ═══════════════════════════════════════════════ */
function unlockPortal() {
  const entered = document.getElementById('lock-pin-input').value.trim();

  // Hidden reset code
  if (entered === 'reset999') {
    localStorage.removeItem(PIN_KEY);
    document.getElementById('lock-pin-input').value = '';
    document.getElementById('lock-error').textContent = 'PIN reset to 1234. Try again.';
    return;
  }

  const correct = localStorage.getItem(PIN_KEY) || DEFAULT_PIN;
  if (entered === correct) {
    sessionStorage.setItem(SESSION_KEY, '1');
    document.getElementById('lock-screen').style.display = 'none';
    document.getElementById('dashboard').classList.add('visible');
    initAdminFirebase();
  } else {
    document.getElementById('lock-error').textContent = 'Incorrect PIN. Try again.';
    document.getElementById('lock-pin-input').value = '';
    document.getElementById('lock-pin-input').focus();
  }
}

function lockPortal() {
  sessionStorage.removeItem(SESSION_KEY);
  location.reload();
}

/* ─── Auto-unlock if session still valid ─── */
window.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem(SESSION_KEY) === '1') {
    document.getElementById('lock-screen').style.display = 'none';
    document.getElementById('dashboard').classList.add('visible');
    initAdminFirebase();
  }
});

/* ═══════════════════════════════════════════════
   FIREBASE
   ═══════════════════════════════════════════════ */
function setFirebasePill(state) {
  const pill = document.getElementById('firebase-pill');
  const text = document.getElementById('firebase-pill-text');
  pill.className = 'firebase-pill ' + state;
  if (state === 'connected') text.textContent = 'Cloud synced';
  else if (state === 'offline') text.textContent = 'Offline';
  else text.textContent = 'Connecting…';
}

async function initAdminFirebase() {
  setFirebasePill('connecting');
  // Load from localStorage first for instant display
  const local = localStorage.getItem(STORAGE_KEY);
  if (local) {
    try { classList = JSON.parse(local); } catch(e) {}
  }
  renderClassTable();

  const setup = () => {
    try {
      const docRef = _db.collection(FIRESTORE_COL).doc(FIRESTORE_DOC);
      // Real-time listener
      docRef.onSnapshot((snap) => {
        const exists = typeof snap.exists === 'function' ? snap.exists() : snap.exists;
        if (exists) {
          const data = snap.data();
          classList = Array.isArray(data.classes) ? data.classes : [];
          localStorage.setItem(STORAGE_KEY, JSON.stringify(classList));
          renderClassTable();
          setFirebasePill('connected');
        } else {
          setFirebasePill('connected');
        }
      }, (err) => {
        console.warn('Snapshot error:', err);
        setFirebasePill('offline');
      });
    } catch(e) {
      console.warn('Firebase unavailable:', e);
      setFirebasePill('offline');
    }
  };

  if (typeof _db !== 'undefined') {
    setup();
  } else {
    window.addEventListener('firebase-ready', setup);
  }
}

async function saveClassList() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(classList));
  try {
    const docRef = _db.collection(FIRESTORE_COL).doc(FIRESTORE_DOC);
    await docRef.set({ classes: classList });
  } catch(e) {
    console.warn('Firestore save failed:', e);
    showToast('⚠️ Saved locally — cloud sync failed.');
  }
}

/* ═══════════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════════ */
const PAGE_TITLES = {
  classes:    'Classes',
  scores:     'Score Recorder',
  students:   'Students',
  grades:     'Grades',
  attendance: 'Attendance',
  settings:   'Settings',
  groups:     'Groups',
  'saved-groups': 'Saved Groups',
  picker:     'Random Picker',
};

function showPage(id) {
  // Hide all pages
  document.querySelectorAll('.admin-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  // Show target
  document.getElementById('page-' + id).classList.add('active');
  document.getElementById('nav-' + id)?.classList.add('active');
  document.getElementById('topbar-title').textContent = PAGE_TITLES[id] || id;
  if (id === 'attendance' && typeof initAttendancePage === 'function') initAttendancePage();
}

/* ═══════════════════════════════════════════════
   CLASSES PAGE
   ═══════════════════════════════════════════════ */
function renderClassTable() {
  const wrap = document.getElementById('class-table-wrap');
  const countEl = document.getElementById('class-count');
  countEl.textContent = classList.length + ' class' + (classList.length !== 1 ? 'es' : '');

  if (!classList.length) {
    wrap.innerHTML = `
      <div class="empty-table">
        <div class="empty-icon">📭</div>
        <p>No classes added yet.<br/>Use the form above to connect your first Google Sheet.</p>
      </div>`;
    return;
  }

  const rows = classList.map(cls => `
    <tr id="row-${cls.id}" class="${reorderMode ? 'reorder-row' : ''}"
        ${reorderMode ? `draggable="true" ondragstart="startClassDrag(event, '${escapeAttr(cls.id)}')" ondragover="allowClassDrop(event)" ondragleave="clearClassDropIndicator(event)" ondrop="dropClass(event, '${escapeAttr(cls.id)}')" ondragend="endClassDrag()"` : ''}>
      ${reorderMode ? '<td class="class-reorder-handle" title="Drag to reorder">⠿</td>' : ''}
      <td>
        <div class="class-name-cell">${escapeHTML(cls.name)}</div>
        ${cls.description ? `<div class="class-desc-cell">${escapeHTML(cls.description)}</div>` : ''}
        ${cls.classKey ? `<div class="class-key-display">🔐 Section code: <strong>${escapeHTML(cls.classKey)}</strong></div>` : '<div class="class-key-display missing">No section code</div>'}
      </td>
      <td class="class-url-cell">
        ${cls.url
          ? `<a href="${escapeHTML(cls.url)}" target="_blank" title="${escapeHTML(cls.url)}">🔗 Open Sheet</a>`
          : '<span style="color:var(--red)">⚠️ No link</span>'}
      </td>
      <td>
        <span class="key-badge ${cls.classKey ? 'locked' : 'unlocked'}">
          ${cls.classKey ? '🔒 Protected' : '🔓 Public'}
        </span>
      </td>
      <td>
        <div class="table-actions">
          ${reorderMode
            ? '<span class="reorder-hint">Drag to move</span>'
            : ''}
          ${reorderMode ? '' : `
            <button class="btn btn-ghost btn-sm" onclick="startEdit('${escapeAttr(cls.id)}')">✏️ Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteClassEntry('${escapeAttr(cls.id)}')">🗑️</button>`}
        </div>
      </td>
    </tr>
  `).join('');

  wrap.innerHTML = `
    <table class="class-table">
      <thead>
        <tr>
          ${reorderMode ? '<th class="class-reorder-heading"></th>' : ''}
          <th>Class Name</th>
          <th>Google Sheet</th>
          <th>Access</th>
          <th style="text-align:right;">Actions / Order</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function toggleReorderMode() {
  reorderMode = !reorderMode;
  const button = document.getElementById('reorder-classes-btn');
  if (button) button.textContent = reorderMode ? '✅ Done Reordering' : '↕ Reorder Classes';
  renderClassTable();
}

function startClassDrag(event, id) {
  draggedClassId = id;
  event.dataTransfer.effectAllowed = 'move';
  event.currentTarget.classList.add('dragging-class');
}

function allowClassDrop(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.drop-target-class').forEach(row => row.classList.remove('drop-target-class'));
  if (event.currentTarget.id !== `row-${draggedClassId}`) {
    event.currentTarget.classList.add('drop-target-class');
  }
}

function clearClassDropIndicator(event) {
  event.currentTarget.classList.remove('drop-target-class');
}

function dropClass(event, targetId) {
  event.preventDefault();
  if (!draggedClassId || draggedClassId === targetId) return;

  const fromIndex = classList.findIndex(cls => cls.id === draggedClassId);
  const targetIndex = classList.findIndex(cls => cls.id === targetId);
  if (fromIndex < 0 || targetIndex < 0) return;

  const [moved] = classList.splice(fromIndex, 1);
  classList.splice(targetIndex, 0, moved);
  draggedClassId = null;
  renderClassTable();
  saveClassList().then(() => showToast('✅ Class order saved.'));
}

function endClassDrag() {
  draggedClassId = null;
  document.querySelectorAll('.dragging-class, .drop-target-class').forEach(row => {
    row.classList.remove('dragging-class', 'drop-target-class');
  });
}

function toggleAddForm() {
  const panel = document.getElementById('add-class-panel');
  const label = document.getElementById('add-form-toggle-label');
  addFormVisible = !addFormVisible;
  panel.classList.toggle('hidden', !addFormVisible);
  label.textContent = addFormVisible ? 'Hide Form' : 'Show Form';
}

function clearAddForm() {
  ['new-class-name','new-class-desc','new-class-url','new-class-key'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('add-class-error').classList.add('hidden');
}

function addClassEntry() {
  const name = (document.getElementById('new-class-name').value || '').trim();
  const desc = (document.getElementById('new-class-desc').value || '').trim();
  const url  = (document.getElementById('new-class-url').value || '').trim();
  const key  = (document.getElementById('new-class-key').value || '').trim();
  const errEl = document.getElementById('add-class-error');

  if (!name) { errEl.textContent = 'Please enter a class name.'; errEl.classList.remove('hidden'); return; }
  if (!url)  { errEl.textContent = 'Please paste a Google Sheets link.'; errEl.classList.remove('hidden'); return; }
  if (!url.includes('/spreadsheets/d/')) {
    errEl.textContent = "That doesn't look like a valid Google Sheets link.";
    errEl.classList.remove('hidden');
    return;
  }
  errEl.classList.add('hidden');

  classList.push({ id: 'cls_' + Date.now(), name, description: desc, url, classKey: key });
  saveClassList().then(() => showToast('✅ Class added and synced!'));
  clearAddForm();
  renderClassTable();
}

function deleteClassEntry(id) {
  if (!confirm("Delete this class? Students won't be able to access it anymore.")) return;
  classList = classList.filter(c => c.id !== id);
  saveClassList().then(() => showToast('🗑️ Class deleted.'));
  renderClassTable();
}

/* ─── INLINE EDIT ─── */
let editingId = null;

function startEdit(id) {
  // Cancel any previous edit
  if (editingId) cancelEdit();
  editingId = id;

  const cls = classList.find(c => c.id === id);
  if (!cls) return;

  const row = document.getElementById('row-' + id);
  row.classList.add('edit-row');
  row.innerHTML = `
    <td colspan="3">
      <div class="edit-inputs">
        <input class="form-input" id="edit-name" value="${escapeHTML(cls.name)}" placeholder="Class name" />
        <input class="form-input" id="edit-desc" value="${escapeHTML(cls.description || '')}" placeholder="Description (optional)" />
        <input class="form-input" id="edit-url"  value="${escapeHTML(cls.url || '')}"  placeholder="Google Sheets link" />
        <input class="form-input" id="edit-key"  value="${escapeHTML(cls.classKey || '')}" placeholder="Section code (optional)" />
      </div>
    </td>
    <td>
      <div class="table-actions">
        <button class="btn btn-primary btn-sm" onclick="saveEdit('${escapeAttr(id)}')">💾 Save</button>
        <button class="btn btn-ghost btn-sm"   onclick="cancelEdit()">Cancel</button>
      </div>
    </td>`;
}

function saveEdit(id) {
  const cls = classList.find(c => c.id === id);
  if (!cls) return;
  const name = (document.getElementById('edit-name').value || '').trim();
  const url  = (document.getElementById('edit-url').value || '').trim();
  if (!name || !url) { showToast('❌ Name and URL are required.'); return; }

  cls.name        = name;
  cls.description = (document.getElementById('edit-desc').value || '').trim();
  cls.url         = url;
  cls.classKey    = (document.getElementById('edit-key').value || '').trim();
  editingId = null;

  saveClassList().then(() => showToast('✅ Class updated!'));
  renderClassTable();
}

function cancelEdit() {
  editingId = null;
  renderClassTable();
}

/* ═══════════════════════════════════════════════
   SETTINGS PAGE
   ═══════════════════════════════════════════════ */
function toggleBypassSection(enabled) {
  bypassSectionCode = enabled;
  // Store in sessionStorage so student portal picks it up if opened in same tab
  sessionStorage.setItem('gv_bypass_section', enabled ? '1' : '0');
  showToast(enabled ? '🔓 Section code bypassed' : '🔒 Section code re-enabled');
}

function toggleBypassStudentId(enabled) {
  bypassStudentId = enabled;
  sessionStorage.setItem('gv_bypass_studentid', enabled ? '1' : '0');
  showToast(enabled ? '🔓 Student ID bypassed' : '🔒 Student ID re-enabled');
}

function changePin() {
  const current = (document.getElementById('current-pin-input').value || '').trim();
  const newPin  = (document.getElementById('new-pin-input').value || '').trim();
  const errEl   = document.getElementById('pin-change-error');
  const sucEl   = document.getElementById('pin-change-success');

  errEl.classList.add('hidden');
  sucEl.classList.add('hidden');

  const correct = localStorage.getItem(PIN_KEY) || DEFAULT_PIN;
  if (current !== correct) {
    errEl.textContent = 'Current PIN is incorrect.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!newPin || newPin.length < 4) {
    errEl.textContent = 'New PIN must be at least 4 characters.';
    errEl.classList.remove('hidden');
    return;
  }

  localStorage.setItem(PIN_KEY, newPin);
  document.getElementById('current-pin-input').value = '';
  document.getElementById('new-pin-input').value = '';
  sucEl.classList.remove('hidden');
  setTimeout(() => sucEl.classList.add('hidden'), 3000);
}

function exportClassesJson() {
  const data = classList.map(({ id, name, description, url, classKey }) =>
    ({ id, name, description, url, classKey }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'classes.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('📥 classes.json downloaded!');
}

/* ─── HELPERS ─── */
function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return String(s).replace(/'/g, "\\'"); }
