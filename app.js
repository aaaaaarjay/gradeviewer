/* ═══════════════════════════════════════════════
   GRADE VIEWER — APP.JS (Multi-Class Edition)
   ═══════════════════════════════════════════════ */

/* ─── STATE ─── */
let students = [];
let metaInfo = {};
let classList = [];
let adminUnlocked = false;
let pendingClassId = null;
let bypassSectionCode = false;
let bypassStudentId   = false;

const STORAGE_KEY = 'gradeviewer_classes';
const PIN_KEY = 'gradeviewer_pin';
const DEFAULT_PIN = '1234';
const FIRESTORE_DOC = 'classes';   // Firestore document name
const FIRESTORE_COL = 'gradeviewer'; // Firestore collection name

/* ─── FIREBASE REFERENCES (set when firebase-ready fires) ─── */
let _db = null;

/* ─── TOAST HELPER ─── */
function showToast(msg, duration = 3500) {
  const toast = document.getElementById('app-toast');
  if (!toast) return;
  toast.innerHTML = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), duration);
}

/* ─── FIREBASE STATUS UI ─── */
function setFirebaseStatus(state) {
  // state: 'connecting' | 'connected' | 'offline'
  const el = document.getElementById('firebase-status');
  const text = document.getElementById('firebase-status-text');
  if (!el || !text) return;
  el.className = `firebase-status firebase-status--${state}`;
  if (state === 'connected') text.textContent = '☁️ Cloud sync active — changes visible everywhere';
  else if (state === 'offline') text.textContent = '⚠️ Cloud offline — changes saved locally only';
  else text.textContent = 'Connecting to cloud…';
}

/* ═══════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════ */
async function initApp() {
  // Load classes immediately from local cache / classes.json while Firebase loads
  await loadClassListFallback();
  renderHomeScreen();

  const setupFirebase = async () => {
    _db = window._firebaseDb;
    try {
      await syncFromFirestore();
      setFirebaseStatus('connected');
      // Listen for real-time updates
      const docRef = window._firestoreDoc(_db, FIRESTORE_COL, FIRESTORE_DOC);
      window._firestoreOnSnapshot(docRef, (snap) => {
        // Use snap.exists (boolean) for v8 compat, fallback to snap.exists() for v9
        const exists = typeof snap.exists === 'function' ? snap.exists() : snap.exists;
        if (exists) {
          const data = snap.data();
          const firestoreClasses = Array.isArray(data.classes) ? data.classes : [];
          // Merge: Firestore is source of truth
          classList = firestoreClasses;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(classList));
          renderHomeScreen();

          if (!document.getElementById('admin-panel-screen').classList.contains('hidden')) {
            renderAdminClassList();
          }
        }
      });
    } catch (e) {
      console.warn('Firebase unavailable, using fallback.', e);
      setFirebaseStatus('offline');
    }
  };

  if (window._firebaseDb) {
    setupFirebase();
  } else {
    window.addEventListener('firebase-ready', setupFirebase);
  }
}

/* ═══════════════════════════════════════════════
   CLASS LIST — Firestore (primary) + classes.json + localStorage (fallback)
   ═══════════════════════════════════════════════ */

/* Load from classes.json + localStorage as fast initial load */
async function loadClassListFallback() {
  let jsonClasses = [];
  try {
    const resp = await fetch('classes.json?v=' + Date.now());
    if (resp.ok) {
      const data = await resp.json();
      jsonClasses = (Array.isArray(data) ? data : []).filter(c => c.url);
    }
  } catch (_) { }
  let localClasses = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) localClasses = JSON.parse(raw);
  } catch (_) { }
  const combined = [...jsonClasses];
  for (const lc of localClasses) {
    if (!combined.find(c => c.id === lc.id)) combined.push(lc);
  }
  classList = combined;
}

/* Read from Firestore and update local state */
async function syncFromFirestore() {
  if (!_db) return;
  const docRef = window._firestoreDoc(_db, FIRESTORE_COL, FIRESTORE_DOC);
  const snap = await window._firestoreGetDoc(docRef);
  const exists = typeof snap.exists === 'function' ? snap.exists() : snap.exists;
  if (exists) {
    const data = snap.data();
    const firestoreClasses = Array.isArray(data.classes) ? data.classes : [];
    classList = firestoreClasses;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(classList));
    renderHomeScreen();
  }
}

/* Save entire classList to Firestore + localStorage */
async function saveClassList() {
  // Always save locally as cache
  localStorage.setItem(STORAGE_KEY, JSON.stringify(classList));
  // Save to Firestore if available
  if (!_db) return;
  try {
    const docRef = window._firestoreDoc(_db, FIRESTORE_COL, FIRESTORE_DOC);
    await window._firestoreSetDoc(docRef, { classes: classList });
  } catch (e) {
    console.warn('Firestore save failed, local only.', e);
    showToast('⚠️ Cloud save failed. Changes saved locally only.');
  }
}

/* ═══════════════════════════════════════════════
   HOME SCREEN
   ═══════════════════════════════════════════════ */
function renderHomeScreen() {
  const grid = document.getElementById('class-grid');
  const empty = document.getElementById('home-empty');
  if (!classList.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  grid.innerHTML = classList.map(cls => `
    <div class="class-card" onclick="selectClass('${escapeAttr(cls.id)}')">
      <div class="class-card-icon">${getClassEmoji(cls.name)}</div>
      <div class="class-card-body">
        <div class="class-card-name">
          ${escapeHTML(cls.name)}
          ${cls.classKey ? '<span title="Protected by Class Key">🔒</span>' : ''}
        </div>
        ${cls.description ? `<div class="class-card-desc">${escapeHTML(cls.description)}</div>` : ''}
      </div>
      <span class="class-card-arrow">›</span>
    </div>
  `).join('');
}

function getClassEmoji(name) {
  const n = name.toLowerCase();
  if (n.includes('math')) return '📐';
  if (n.includes('science') || n.includes('bio') || n.includes('chem') || n.includes('phys')) return '🔬';
  if (n.includes('english') || n.includes('lit')) return '📖';
  if (n.includes('pe') || n.includes('sports')) return '🏃';
  if (n.includes('music') || n.includes('art')) return '🎨';
  if (n.includes('history') || n.includes('araling')) return '🏛️';
  if (n.includes('computer') || n.includes('it') || n.includes('cs') || n.includes('programming')) return '💻';
  if (n.includes('filipino') || n.includes('fil')) return '🇵🇭';
  return '📚';
}

/* ═══════════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}
function goHome() {
  showScreen('screen-home');
  const detail = document.getElementById('student-detail');
  if (detail) detail.classList.add('hidden');
  const inner = document.getElementById('student-detail-inner');
  if (inner) inner.innerHTML = '';
  const inp = document.getElementById('search-input');
  if (inp) inp.value = '';
  renderResults([]);
}

/* ═══════════════════════════════════════════════
   SELECT + LOAD A CLASS
   ═══════════════════════════════════════════════ */
async function selectClass(id) {
  const cls = classList.find(c => c.id === id);
  if (!cls || !cls.url) { alert('This class has no Google Sheets link yet.'); return; }

  if (cls.classKey && !bypassSectionCode) {
    pendingClassId = id;
    document.getElementById('class-key-overlay').classList.remove('hidden');
    document.getElementById('class-key-input').value = '';
    document.getElementById('class-key-error').classList.add('hidden');
    setTimeout(() => document.getElementById('class-key-input').focus(), 100);
    return;
  }

  await loadClassData(cls);
}

function closeClassKey() {
  document.getElementById('class-key-overlay').classList.add('hidden');
  pendingClassId = null;
}

function handleClassKeyOverlayClick(e) {
  if (e.target === document.getElementById('class-key-overlay')) closeClassKey();
}

function submitClassKey() {
  const entered = document.getElementById('class-key-input').value;
  const cls = classList.find(c => c.id === pendingClassId);
  if (cls && entered === cls.classKey) {
    closeClassKey();
    loadClassData(cls);
  } else {
    const err = document.getElementById('class-key-error');
    err.textContent = 'Incorrect class key. Try again.';
    err.classList.remove('hidden');
    document.getElementById('class-key-input').value = '';
    document.getElementById('class-key-input').focus();
  }
}

async function loadClassData(cls) {
  showScreen('screen-search');
  document.getElementById('header-meta').textContent = cls.name;
  document.getElementById('search-results').innerHTML = `
    <div class="no-results">
      <div class="spinner-wrap"><div class="spinner"></div><div>Loading ${escapeHTML(cls.name)}…</div></div>
    </div>`;
  try {
    const match = cls.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) throw new Error('Invalid Google Sheets URL');
    const resp = await fetch(`https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`);
    if (!resp.ok) throw new Error(resp.status === 403 ? 'Access denied — share the sheet as "Anyone with the link can view"' : `HTTP ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellStyles: true });
    parseWorkbook(wb);
    renderResults([], '');
  } catch (err) {
    document.getElementById('search-results').innerHTML = `<div class="no-results"><div class="emoji">❌</div><div>${escapeHTML(err.message)}</div></div>`;
  }
}

/* ═══════════════════════════════════════════════
   ADMIN PANEL
   ═══════════════════════════════════════════════ */
function toggleBypassSection(enabled) {
  bypassSectionCode = enabled;
  showToast(enabled ? '🔓 Section Code bypassed — classes will open directly.' : '🔒 Section Code re-enabled.');
}
function toggleBypassStudentId(enabled) {
  bypassStudentId = enabled;
  showToast(enabled ? '🔓 Student ID bypassed — grades visible without entering ID.' : '🔒 Student ID required again.');
}

function openAdmin() {
  adminUnlocked = false;
  document.getElementById('admin-pin-screen').classList.remove('hidden');
  document.getElementById('admin-panel-screen').classList.add('hidden');
  document.getElementById('admin-pin-input').value = '';
  document.getElementById('pin-error').classList.add('hidden');
  document.getElementById('admin-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('admin-pin-input').focus(), 100);
}
function closeAdmin() { document.getElementById('admin-overlay').classList.add('hidden'); }
function handleOverlayClick(e) {
  if (e.target === document.getElementById('admin-overlay')) closeAdmin();
}
function submitPin() {
  const entered = document.getElementById('admin-pin-input').value;

  // Hidden recovery code — type this to reset PIN back to 1234
  if (entered === 'reset999') {
    localStorage.removeItem(PIN_KEY);
    document.getElementById('admin-pin-input').value = '';
    const err = document.getElementById('pin-error');
    err.textContent = 'PIN has been reset to 1234. Please log in now.';
    err.style.color = 'var(--green)';
    err.classList.remove('hidden');
    return;
  }

  const correct = localStorage.getItem(PIN_KEY) || DEFAULT_PIN;
  if (entered === correct) {
    document.getElementById('admin-pin-screen').classList.add('hidden');
    document.getElementById('admin-panel-screen').classList.remove('hidden');
    document.getElementById('pin-error').classList.add('hidden');
    document.getElementById('pin-error').style.color = '';
    renderAdminClassList();
  } else {
    const err = document.getElementById('pin-error');
    err.textContent = 'Incorrect PIN. Try again.';
    err.style.color = '';
    err.classList.remove('hidden');
    document.getElementById('admin-pin-input').value = '';
  }
}
function changePin() {
  const newPin = (document.getElementById('new-pin-input').value || '').trim();
  if (!newPin || newPin.length < 4) { alert('PIN must be at least 4 characters.'); return; }
  localStorage.setItem(PIN_KEY, newPin);
  document.getElementById('pin-change-msg').classList.remove('hidden');
  document.getElementById('new-pin-input').value = '';
  setTimeout(() => document.getElementById('pin-change-msg').classList.add('hidden'), 2500);
}
function renderAdminClassList(showAll = false) {
  const container = document.getElementById('admin-class-list');
  if (!classList.length) {
    container.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:1rem;">No classes saved yet.</div>';
    return;
  }

  const LIMIT = 2;
  const visible = showAll ? classList : classList.slice(0, LIMIT);
  const hasMore = classList.length > LIMIT;

  const rowsHTML = visible.map(cls => `
    <div class="admin-class-row">
      <div class="admin-class-info">
        <div class="admin-class-name">${escapeHTML(cls.name)}</div>
        ${cls.description ? `<div class="admin-class-desc">${escapeHTML(cls.description)}</div>` : ''}
        <div class="admin-class-url">
          ${cls.url ? '🔗 ' + escapeHTML(cls.url.substring(0, 50)) + '…' : '⚠️ No URL set'}<br/>
          <span style="color:var(--muted)">${cls.classKey ? '🔒 Protected by Key' : '🔓 Public'}</span>
        </div>
      </div>
      <button class="admin-delete-btn" onclick="deleteClassEntry('${escapeAttr(cls.id)}')">🗑️</button>
    </div>
  `).join('');

  const toggleBtn = hasMore ? `
    <button class="btn-outline" style="width:100%; margin-top:0.6rem; font-size:0.8rem;"
      onclick="renderAdminClassList(${!showAll})">
      ${showAll ? '▲ Show Less' : `▼ Show All (${classList.length})`}
    </button>
  ` : '';

  container.innerHTML = rowsHTML + toggleBtn;
}
function addClassEntry() {
  const name = (document.getElementById('new-class-name').value || '').trim();
  const desc = (document.getElementById('new-class-desc').value || '').trim();
  const url = (document.getElementById('new-class-url').value || '').trim();
  const key = (document.getElementById('new-class-key').value || '').trim();
  const errEl = document.getElementById('add-class-error');
  if (!name) { errEl.textContent = 'Please enter a class name.'; errEl.classList.remove('hidden'); return; }
  if (!url) { errEl.textContent = 'Please paste a Google Sheets link.'; errEl.classList.remove('hidden'); return; }
  if (!url.includes('/spreadsheets/d/')) { errEl.textContent = "That doesn't look like a Google Sheets link."; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');
  classList.push({ id: 'cls_' + Date.now(), name, description: desc, url, classKey: key });
  saveClassList().then(() => {
    showToast('✅ Class added and synced to cloud!');
  });
  document.getElementById('new-class-name').value = '';
  document.getElementById('new-class-desc').value = '';
  document.getElementById('new-class-url').value = '';
  document.getElementById('new-class-key').value = '';
  renderAdminClassList();
  renderHomeScreen();
}
function deleteClassEntry(id) {
  if (!confirm("Delete this class? Students won't be able to access it anymore.")) return;
  classList = classList.filter(c => c.id !== id);
  saveClassList().then(() => {
    showToast('🗑️ Class deleted and synced to cloud.');
  });
  renderAdminClassList();
  renderHomeScreen();
}

/* ═══════════════════════════════════════════════
   EXPORT classes.json (backup / migration use)
   ═══════════════════════════════════════════════ */
function exportClassesJson() {
  const exportData = classList.map(({ id, name, description, url, classKey }) => ({
    id, name, description, url, classKey
  }));
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'classes.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('📥 classes.json downloaded!');
}
function escapeAttr(s) { return String(s).replace(/'/g, "\\'"); }
/* ═══════════════════════════════════════════════
   WORKBOOK PARSER — maps sheet names
   ═══════════════════════════════════════════════ */
function parseWorkbook(wb) {
  const names = wb.SheetNames.map(n => n.trim().toLowerCase());

  function getSheet(key) {
    // Try exact or fuzzy match
    const keywords = {
      attendance: ['attendance'],
      prelim: ['prelim'],
      midterm: ['midterm', 'mid'],
      semiFinal: ['semi', 'semifinal', 'semi-final', 'semi final'],
      final: ['final'],
      summary: ['summary'],
      studentId: ['studentid', 'student id', 'student_id'],
    };
    const kws = keywords[key] || [key];
    const idx = names.findIndex(n => kws.some(k => n.includes(k)));
    if (idx < 0) return null;
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[idx]], { header: 1, defval: '' });
  }

  const sheets = {
    attendance: getSheet('attendance'),
    prelim: getSheet('prelim'),
    midterm: getSheet('midterm'),
    semiFinal: getSheet('semiFinal'),
    final: getSheet('final'),
    summary: getSheet('summary'),
    studentId: getSheet('studentId'),
  };

  parseFromSheets(sheets);
}

/* ═══════════════════════════════════════════════
   CORE PARSER — extract student data from sheets
   ═══════════════════════════════════════════════ */
function parseFromSheets(sheets) {
  students = [];
  metaInfo = {};

  // ── STUDENT ID ──
  const idRows = sheets.studentId || [];
  const idMap = parseStudentIdSheet(idRows);

  // ── SUMMARY (source of truth for student list + grades) ──
  const sumRows = sheets.summary || [];
  const summaryStudents = parseSummarySheet(sumRows);

  // ── ATTENDANCE ──
  const attRows = sheets.attendance || [];
  const attendanceMap = parseAttendanceSheet(attRows);

  // ── PRELIM ──
  const prelimRows = sheets.prelim || [];
  const prelimMap = parsePeriodSheet(prelimRows, 'PRELIM');

  // ── MIDTERM ──
  const midtermRows = sheets.midterm || [];
  const midtermMap = parsePeriodSheet(midtermRows, 'MIDTERM');

  // ── SEMI FINAL ──
  const sfRows = sheets.semiFinal || [];
  const sfMap = sfRows.length > 5 ? parsePeriodSheet(sfRows, 'SEMIFINAL') : {};

  // ── FINAL ──
  const finalRows = sheets.final || [];
  const finalMap = finalRows.length > 5 ? parsePeriodSheet(finalRows, 'FINAL') : {};

  // ── MERGE ──
  summaryStudents.forEach((s, i) => {
    const name = normalise(s.name);
    const att = lookupByName(attendanceMap, name) || {};
    const pre = lookupByName(prelimMap, name) || {};
    const mid = lookupByName(midtermMap, name) || {};
    const sf = lookupByName(sfMap, name) || {};
    const fin = lookupByName(finalMap, name) || {};

    students.push({
      no: s.no || (i + 1),
      name: s.name,
      studentId: lookupByName(idMap, name),
      grades: {
        prelim: s.pg,
        midterm: s.mg,
        semiFinal: s.se,
        final: s.fg,
        remarks: s.remarks,
      },
      attendance: att,
      periods: {
        prelim: pre,
        midterm: mid,
        semiFinal: Object.keys(sf).length > 0 ? sf : null,
        final: Object.keys(fin).length > 0 ? fin : null,
      },
    });
  });

  if (students.length === 0) {
    showError('No student data found. Make sure the file has an Attendance, Prelim, Midterm, and Summary sheet.');
    return;
  }

  // Show search screen
  document.getElementById('header-meta').textContent =
    `${students.length} students loaded (IDs: ${Object.keys(idMap).length})`;
  showScreen('screen-search');
  renderResults([]);
}

/* ──────────────────────────────────────────────
   parseStudentIdSheet
   Expects rows: Student Name | StudentID
   ────────────────────────────────────────────── */
function parseStudentIdSheet(rows) {
  const result = {};
  if (!rows || rows.length === 0) return result;

  let nameCol = 0;
  let idCol = 1;
  let headerRow = -1;
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const cells = rows[r].map(c => String(c).toLowerCase().trim());
    if (cells.some(c => c.includes('name') || c.includes('student'))) {
      headerRow = r;
      nameCol = cells.findIndex(c => c.includes('name') || c.includes('student'));
      idCol = cells.findIndex(c => c.includes('id') || c.includes('number'));
      if (nameCol < 0) nameCol = 0;
      if (idCol < 0) idCol = 1;
      break;
    }
  }
  if (headerRow < 0) headerRow = 0;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[nameCol] || '').trim();
    const id = String(row[idCol] || '').trim();
    if (name && !isHeader(name) && !isNumeric(name) && id) {
      result[normalise(name)] = id;
    }
  }
  return result;
}

/* ──────────────────────────────────────────────
   parseSummarySheet
   Expects rows: No | Student's Name | PG | MG | SE | FG | Remarks
   ────────────────────────────────────────────── */
function parseSummarySheet(rows) {
  const result = [];
  // Find header row (has 'name' or 'student')
  let headerRow = -1;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = rows[r].map(c => String(c).toLowerCase());
    if (cells.some(c => c.includes('name') || c.includes('student'))) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) headerRow = 5; // fallback

  const header = rows[headerRow].map(c => String(c).toLowerCase().trim());
  const colNo = header.findIndex(h => h === 'no' || h === '#' || h === 'no.');
  const colName = header.findIndex(h => h.includes('name'));
  // Grade columns — look for PG, MG, SE / SF, FG / F
  function findCol(keywords) {
    return header.findIndex(h => keywords.some(k => h.includes(k)));
  }
  const colPG = findCol(['pg', 'prelim grade', 'prelim']);
  const colMG = findCol(['mg', 'midterm grade', 'midterm']);
  const colSE = findCol(['se', 'semi', 'sf']);
  const colFG = findCol(['fg', 'final grade', 'fg ']);
  const colRem = findCol(['remark', 'status', 'remarks']);

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[colName] || '').trim();
    if (!name || name.toLowerCase() === 'student\'s name' || name.toLowerCase() === 'name') continue;
    if (isNumeric(name)) continue;
    result.push({
      no: colNo >= 0 ? toNum(row[colNo]) : r - headerRow,
      name,
      pg: colPG >= 0 ? toNum(row[colPG]) : null,
      mg: colMG >= 0 ? toNum(row[colMG]) : null,
      se: colSE >= 0 ? toNum(row[colSE]) : null,
      fg: colFG >= 0 ? toNum(row[colFG]) : null,
      remarks: colRem >= 0 ? String(row[colRem] || '').trim() : '',
    });
  }
  return result;
}

/* ──────────────────────────────────────────────
   parseAttendanceSheet
   Sheet has sections: PRELIM | MIDTERM | SEMI-FINAL | FINALS
   Each section has per-day columns + a TOTAL col
   Row layout: col A = no, col B = Student's Name, then days...
   ────────────────────────────────────────────── */
function parseAttendanceSheet(rows) {
  if (!rows || rows.length < 6) return {};

  // Find section header row (has 'prelim', 'midterm', etc.)
  let sectionRow = -1;
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const cells = rows[r].map(c => String(c).toLowerCase());
    if (cells.some(c => c.includes('prelim') || c.includes('midterm'))) {
      sectionRow = r;
      break;
    }
  }

  // Find the TOTAL column indices for each period
  // Scan for 'total' cells in the rows near the section row
  let totalCols = {}; // { prelim: colIdx, midterm: colIdx, ... }
  let nameCol = 1; // usually column B
  let noCol = 0;

  // Scan a few rows to find column layout
  // The header row for days is usually right below sectionRow
  for (let r = sectionRow; r < Math.min(rows.length, sectionRow + 8); r++) {
    const cells = rows[r];
    cells.forEach((c, ci) => {
      const v = String(c).toLowerCase().trim();
      if (v === 'total' || v === 'ttl') {
        // figure out which period this total belongs to by scanning backwards
        // in the same row or the section row for period label
        const period = detectPeriodFromRow(rows, r, ci, sectionRow);
        if (period && !totalCols[period]) totalCols[period] = ci;
      }
      if (v === 'student\'s name' || v === 'name') nameCol = ci;
      if (v === 'no' || v === 'no.' || v === '#') noCol = ci;
    });
  }

  // Find the first data row (student names)
  let dataStart = -1;
  for (let r = sectionRow + 1; r < rows.length; r++) {
    const cell = String(rows[r][nameCol] || '').trim();
    if (cell && !isHeader(cell) && !isNumeric(cell)) {
      dataStart = r;
      break;
    }
  }
  if (dataStart < 0) return {};

  const map = {};
  const periodsList = Object.entries(totalCols).sort((a, b) => a[1] - b[1]).map(e => e[0]);

  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[nameCol] || '').trim();
    if (!name || isHeader(name) || isNumeric(name)) continue;

    const att = {};
    for (const [period, col] of Object.entries(totalCols)) {
      const myIdx = periodsList.indexOf(period);
      const prevCol = myIdx > 0 ? totalCols[periodsList[myIdx - 1]] : nameCol;
      const myCol = col;

      const records = [];
      for (let ci = prevCol + 1; ci < myCol; ci++) {
        let dateStr = '';
        for (let r = dataStart - 1; r > sectionRow; r--) {
          dateStr = String(rows[r]?.[ci] || '').trim();
          if (dateStr) break;
        }

        if (dateStr && isNaN(parseFloat(dateStr))) {
          // ensure it looks somewhat like a date or header, but not empty
          records.push({
            date: dateStr,
            status: String(row[ci] || '').trim()
          });
        }
      }

      att[period] = {
        present: toNum(row[col]),
        total: records.length,
        records: records
      };
    }
    map[normalise(name)] = att;
  }
  return map;
}

/* Detect which period a TOTAL column belongs to */
function detectPeriodFromRow(rows, r, ci, sectionRow) {
  // Look in sectionRow for a period label that spans over ci
  const sr = rows[sectionRow] || [];
  let lastPeriod = null;
  for (let c = 0; c <= ci; c++) {
    const v = String(sr[c] || '').toLowerCase().trim();
    if (v.includes('prelim')) lastPeriod = 'prelim';
    else if (v.includes('midterm') || v.includes('mid')) lastPeriod = 'midterm';
    else if (v.includes('semi')) lastPeriod = 'semiFinal';
    else if (v.includes('final')) lastPeriod = 'final';
  }
  return lastPeriod;
}

/* Count total school days in a period by counting non-empty day columns */
function countTotalDays(rows, sectionRow, dataStart, period, totalCols) {
  // We count by looking at the header row for day numbers/dates under the period
  // Simplification: count non-empty values in the first data row up to the total column
  const periods = Object.entries(totalCols).sort((a, b) => a[1] - b[1]).map(e => e[0]);
  const myIdx = periods.indexOf(period);
  const prevCol = myIdx > 0 ? totalCols[periods[myIdx - 1]] : 1; // start after name col
  const myCol = totalCols[period];
  // Count day columns between prevCol+1 and myCol-1
  // Look at the header row (sectionRow+1 or sectionRow+2) for numbers/dates
  let count = 0;
  for (let rr = sectionRow; rr < dataStart; rr++) {
    const row = rows[rr];
    let c = 0;
    for (let ci = prevCol + 1; ci < myCol; ci++) {
      const v = String(row[ci] || '').trim();
      if (v && !isNaN(v)) c++;
    }
    if (c > count) count = c;
  }
  return count || (myCol - prevCol - 1);
}

/* ──────────────────────────────────────────────
   parsePeriodSheet
   Handles Prelim / Midterm / SemiFinal / Final sheets
   CLASS RECORD format:
     Written Works | Performance Tasks | Quarterly Assessment | FC (Final Grade)
   ────────────────────────────────────────────── */
function parsePeriodSheet(rows, periodLabel) {
  if (!rows || rows.length < 8) return {};

  // Find row with "Student's Name"
  let nameCol = 1;
  let noCol = 0;
  let headerRow = -1;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = rows[r].map(c => String(c).toLowerCase().trim());
    if (cells.some(c => c.includes('name') || c.includes('student'))) {
      headerRow = r;
      nameCol = cells.findIndex(c => c.includes('name') || c.includes('student'));
      if (nameCol < 0) nameCol = 1;
      noCol = cells.findIndex(c => c === 'no' || c === 'no.' || c === '#');
      if (noCol < 0) noCol = 0;
      break;
    }
  }
  if (headerRow < 0) headerRow = 7;

  // Scan header rows to find category columns (WW, PT, QA, FC)
  // Usually spans multiple header rows — look for keywords
  let cols = { ww: null, pt: null, qa: null, fc: null };

  // Try to find WW-total, PT-total, QA score, FC columns
  // Scan all rows 0..headerRow for keywords
  for (let r = 0; r <= headerRow + 3; r++) {
    const row = rows[r] || [];
    row.forEach((cell, ci) => {
      const v = String(cell).toLowerCase().trim();
      if ((v === 'ww' || v.includes('written')) && cols.ww === null) cols.ww = ci;
      if ((v === 'pt' || v.includes('performance')) && cols.pt === null) cols.pt = ci;
      if ((v === 'qa' || v.includes('quarterly') || v.includes('exam')) && cols.qa === null) cols.qa = ci;
      if ((v === 'fc' || v === 'final' || v.includes('final grade') || v.includes('f.c')) && cols.fc === null) cols.fc = ci;
    });
  }

  // If not found via text, use positional heuristic:
  // In the class record, after the name col there are multiple score columns
  // The last columns are usually WW Total, PT Total, QA Score, Final Grade
  // Let's detect by finding the rightmost non-empty columns in the header area
  if (cols.fc === null) {
    // Find rightmost column with data in header
    let maxCol = 0;
    for (let r = 0; r <= headerRow; r++) {
      const row = rows[r] || [];
      for (let ci = row.length - 1; ci >= 0; ci--) {
        if (String(row[ci]).trim()) { maxCol = Math.max(maxCol, ci); break; }
      }
    }
    cols.fc = maxCol;
    if (cols.qa === null) cols.qa = maxCol - 1;
    if (cols.pt === null) cols.pt = maxCol - 2;
    if (cols.ww === null) cols.ww = maxCol - 3;
  }

  // Find data start
  let dataStart = headerRow + 1;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const cell = String(rows[r][nameCol] || '').trim();
    if (cell && !isHeader(cell) && !isNumeric(cell)) { dataStart = r; break; }
  }

  const maxScoreRowIdx = dataStart > 0 ? dataStart - 1 : headerRow + 1;

  // ─── Find the actual score column structure ───
  const colInfo = detectPeriodColumns(rows, headerRow, nameCol, maxScoreRowIdx, cols);

  const map = {};
  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[nameCol] || '').trim();
    if (!name || isHeader(name) || isNumeric(name)) continue;

    const entry = extractPeriodRow(row, colInfo, cols);
    map[normalise(name)] = entry;
  }
  return map;
}

/* Detect columns from header structure */
function detectPeriodColumns(rows, headerRow, nameCol, maxScoreRowIdx, fallbackCols) {
  const info = {
    components: [], // individual score items (e.g., Quizzes)
    ww: { total: null, ps: null },
    pt: { total: null, ps: null },
    qa: { score: null, ps: null, maxScore: null },
    fc: null,
  };

  const endCol = fallbackCols.fc !== null ? fallbackCols.fc : 50;

  // Scan rows for totals and percentages to initially populate info
  for (let r = 0; r <= Math.min(headerRow + 2, rows.length - 1); r++) {
    const row = rows[r] || [];
    row.forEach((cell, ci) => {
      if (ci <= nameCol) return;
      const v = String(cell).trim().toLowerCase();
      if (v === 'ww%' || v === 'wws' || v === 'ww score' || v === 'ps') {
        if (fallbackCols.pt !== null && ci < fallbackCols.pt) info.ww.ps = ci;
        else if (fallbackCols.pt === null && !info.ww.ps) info.ww.ps = ci;
        else info.pt.ps = ci;
      }
      if (v === 'pt%' || v === 'pts' || v === 'pt score') info.pt.ps = ci;
      if (v === 'qa%' || v === 'qas' || v === 'qa score' || v === 'qs') info.qa.ps = ci;
      if (v === 'fc' || v === 'final' || v === 'f.c' || v === 'fg') info.fc = ci;
      if (v === 'total' || v === 'ttl') {
        if (!info.ww.total && (fallbackCols.pt === null || ci < fallbackCols.pt)) info.ww.total = ci;
        else if (!info.pt.total) info.pt.total = ci;
      }
    });
  }

  // Robustly determine the QA (Exam) column
  let qaCol = info.qa.ps !== null ? info.qa.ps : fallbackCols.qa;
  let qaMaxScore = qaCol !== null ? parseFloat(String(rows[maxScoreRowIdx]?.[qaCol] || '').trim()) : null;

  // If qaCol is invalid (e.g. maxScore is <= 1 which is typical for Final Grades, not exams)
  // we scan backwards to find the true Exam column (usually the last column with a maxScore > 1)
  if (isNaN(qaMaxScore) || qaMaxScore <= 1 || qaCol === fallbackCols.fc || qaCol === info.fc) {
    let found = false;
    for (let ci = endCol - 1; ci > nameCol; ci--) {
      const ms = parseFloat(rows[maxScoreRowIdx]?.[ci]);
      if (!isNaN(ms) && ms > 1) {
        qaCol = ci;
        qaMaxScore = ms;
        found = true;
        break;
      }
    }
    if (!found) {
      qaCol = null;
      qaMaxScore = null;
    }
  }

  info.qa.score = qaCol;
  info.qa.maxScore = isNaN(qaMaxScore) ? null : qaMaxScore;

  // Extract individual components (look at row before data)
  for (let ci = nameCol + 1; ci <= endCol; ci++) {
    if (ci === qaCol) continue; // Skip if it's the exam column

    const maxScoreStr = String(rows[maxScoreRowIdx]?.[ci] || '').trim();
    const maxScore = parseFloat(maxScoreStr);

    // Find a label by looking upwards
    let colName = '';
    for (let r = maxScoreRowIdx - 1; r >= Math.max(0, headerRow - 1); r--) {
      const v = String(rows[r]?.[ci] || '').trim();
      if (v && !v.toLowerCase().includes('total') && !v.toLowerCase().includes('ps') && !v.toLowerCase().includes('ws')) {
        colName = v;
        break;
      }
    }

    const vLower = colName.toLowerCase();
    const isTotalOrPS = !colName || vLower.includes('total') || vLower === 'ps' || vLower === 'ws' ||
      vLower === 'ww%' || vLower === 'pt%' || vLower === 'qa%' || vLower === '%' ||
      maxScoreStr === '100' || vLower === 'fc' || vLower === 'final' || vLower === 'f.c';

    if (!isNaN(maxScore) && maxScore > 0 && !isTotalOrPS && colName.length <= 30) {
      info.components.push({
        name: colName,
        colIdx: ci,
        maxScore: maxScore
      });
    }
  }

  return info;
}

/* Extract scores from a data row */
function extractPeriodRow(row, colInfo, fallbackCols) {
  const fc = colInfo.fc !== null ? toNum(row[colInfo.fc]) : toNum(row[fallbackCols.fc]);
  const wwTotal = colInfo.ww.total !== null ? toNum(row[colInfo.ww.total]) : null;
  const ptTotal = colInfo.pt.total !== null ? toNum(row[colInfo.pt.total]) : null;
  const wwPS = colInfo.ww.ps !== null ? toNum(row[colInfo.ww.ps]) : null;
  const ptPS = colInfo.pt.ps !== null ? toNum(row[colInfo.pt.ps]) : null;
  const qaScore = colInfo.qa.score !== null ? toNum(row[colInfo.qa.score]) : null;

  const components = colInfo.components.map(c => ({
    name: c.name,
    maxScore: c.maxScore,
    score: toNum(row[c.colIdx])
  }));

  return {
    components: components,
    writtenWorks: { total: wwTotal, percentage: wwPS },
    performanceTasks: { total: ptTotal, percentage: ptPS },
    quarterlyAssessment: { score: qaScore, maxScore: colInfo.qa.maxScore },
    finalGrade: fc,
  };
}

/* ═══════════════════════════════════════════════
   SEARCH
   ═══════════════════════════════════════════════ */
function onSearch() {
  const q = document.getElementById('search-input').value.trim();
  const btn = document.getElementById('clear-btn');
  btn.classList.toggle('visible', q.length > 0);

  if (!q) { renderResults([]); return; }

  const results = students.filter(s =>
    s.name.toLowerCase().includes(q.toLowerCase())
  );
  renderResults(results, q);
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('clear-btn').classList.remove('visible');
  renderResults([]);
}

function renderResults(list, query = '') {
  const el = document.getElementById('search-results');
  if (!query) {
    el.innerHTML = `<div class="no-results">
      <div>Type your name to search</div>
    </div>`;
    return;
  }
  if (list.length === 0) {
    el.innerHTML = `<div class="no-results">
      <div class="emoji">🔍</div>
      <div>No students found for "<strong>${escapeHTML(query)}</strong>"</div>
    </div>`;
    return;
  }

  const html = `
    <div class="result-count">${list.length} student${list.length !== 1 ? 's' : ''} found</div>
    ${list.map(s => `
      <div class="result-card" onclick="showStudent(${s.no})" id="result-${s.no}">
        <div class="result-card-left">
          <div class="result-avatar">${getInitial(s.name)}</div>
          <div>
            <div class="result-name">${highlightMatch(escapeHTML(s.name), query)}</div>
            <div class="result-num">Student #${s.no}</div>
          </div>
        </div>
        <span class="result-arrow">›</span>
      </div>
    `).join('')}
  `;
  el.innerHTML = html;
}

/* ═══════════════════════════════════════════════
   STUDENT DETAIL — renders INLINE below search bar
   ═══════════════════════════════════════════════ */
let pendingStudentNo = null;

function showStudent(no) {
  const s = students.find(x => x.no === no);
  if (!s) return;

  if (s.studentId && !bypassStudentId) {
    pendingStudentNo = no;
    renderStudentDetail(s, true); // true = locked view

    setTimeout(() => {
      const inp = document.getElementById('inline-student-id');
      if (inp) inp.focus();
    }, 100);
    return;
  }

  renderStudentDetail(s, false);
}

function submitInlineStudentId() {
  const entered = document.getElementById('inline-student-id').value.trim();
  const s = students.find(x => x.no === pendingStudentNo);
  if (s && entered === s.studentId) {
    pendingStudentNo = null;
    renderStudentDetail(s, false);
  } else {
    const err = document.getElementById('inline-id-error');
    err.textContent = 'Incorrect Student ID. Try again.';
    err.classList.remove('hidden');
    document.getElementById('inline-student-id').value = '';
    document.getElementById('inline-student-id').focus();
  }
}

function renderStudentDetail(s, isLocked = false) {
  // Hide search results, show student detail panel
  document.getElementById('search-results').classList.add('hidden');
  const detailWrap = document.getElementById('student-detail');
  const detailInner = document.getElementById('student-detail-inner');
  detailWrap.classList.remove('hidden');
  detailInner.innerHTML = buildStudentHTML(s, isLocked);

  // Scroll to top of the search screen
  document.getElementById('screen-search').scrollTo({ top: 0, behavior: 'smooth' });

  // Animate progress bars
  requestAnimationFrame(() => {
    setTimeout(() => {
      document.querySelectorAll('.progress-fill').forEach(bar => {
        bar.style.width = (bar.dataset.pct || 0) + '%';
      });
    }, 50);
  });
}

function clearStudentDetail() {
  document.getElementById('student-detail').classList.add('hidden');
  document.getElementById('student-detail-inner').innerHTML = '';
  document.getElementById('search-results').classList.remove('hidden');
  // Clear the search input too
  document.getElementById('search-input').value = '';
  document.getElementById('clear-btn').classList.remove('visible');
  renderResults([]);
}

/* Toggle reveal of student access code (admin only) */
function toggleRevealCode(code) {
  const btn = document.getElementById('reveal-code-btn');
  const val = document.getElementById('reveal-code-value');
  if (!btn || !val) return;
  if (val.style.display === 'none') {
    val.textContent = code;
    val.style.display = 'inline-block';
    btn.textContent = '🙈 Hide Code';
  } else {
    val.style.display = 'none';
    btn.textContent = '🔑 Show Student Code';
  }
}

function buildStudentHTML(s, isLocked = false) {
  const g = s.grades;
  const att = s.attendance;

  // ── Remark styling ──
  let remarkLabel = 'N/A';
  let remarkClass = 'inc';

  if (g.fg !== undefined && g.fg !== null && String(g.fg).trim() !== '') {
    const numGrade = parseFloat(g.fg);
    if (!isNaN(numGrade) && numGrade >= 1 && numGrade <= 5) {
      if (numGrade > 3.0) {
        remarkLabel = 'FAILED';
        remarkClass = 'failed';
      } else {
        remarkLabel = 'PASSED';
        remarkClass = 'passed';
      }
    } else if (!isNaN(numGrade)) {
      remarkLabel = numGrade >= 75 ? 'PASSED' : 'FAILED';
      remarkClass = numGrade >= 75 ? 'passed' : 'failed';
    }
  } else if (g.remarks) {
    const rem = g.remarks.toLowerCase();
    remarkLabel = g.remarks;
    remarkClass = rem.includes('pass') ? 'passed' : rem.includes('fail') ? 'failed' : 'inc';
  }

  // ── Final grade display ──
  const displayGrade = g.fg || g.semiFinal || g.midterm || g.prelim || '—';

  // ── Attendance sections ──
  const attSections = buildAttendanceHTML(att);

  // ── Period grade cards ──
  const gradesHTML = buildGradesHTML(g);

  // ── Period detail tables ──
  const periodsHTML = buildPeriodsHTML(s.periods);

  // Reveal Code button — only visible when admin is logged in
  const revealCodeBtn = (adminUnlocked && s.studentId) ? `
    <div id="reveal-code-wrap" style="margin: 0 0 0.75rem; display:flex; justify-content:flex-end;">
      <button class="btn-outline" id="reveal-code-btn" style="font-size:0.78rem; padding:0.35rem 0.9rem;"
        onclick="toggleRevealCode('${escapeAttr(s.studentId)}')">
        🔑 Show Student Code
      </button>
      <span id="reveal-code-value" style="display:none; margin-left:0.75rem; font-family:monospace;
        font-size:1rem; font-weight:700; color:var(--accent); background:rgba(108,99,255,0.15);
        padding:0.3rem 0.75rem; border-radius:8px; align-self:center;">
      </span>
    </div>
  ` : '';

  const headerHTML = `
    <!-- CLEAR BUTTON -->
    <button class="clear-student-btn" onclick="clearStudentDetail()">✕ Clear</button>

    ${revealCodeBtn}

    <div class="student-name-banner">
      <div class="student-big-avatar">${getInitial(s.name)}</div>
      <div class="student-name-info">
        <h2>${escapeHTML(s.name)}</h2>
        <p>Student #${s.no}</p>
      </div>
    </div>
  `;

  const contentHTML = `
    <!-- GRADES PER PERIOD -->
    ${gradesHTML}

    <!-- ATTENDANCE -->
    ${attSections}

    <!-- SCORE DETAIL PER PERIOD -->
    ${periodsHTML}
  `;

  if (isLocked) {
    return `
      ${headerHTML}
      <div class="privacy-lock-container">
        <div class="privacy-overlay">
          <div class="privacy-modal">
            <div class="modal-title" style="margin-bottom:0.5rem; font-size:1.3rem;">🆔 Student ID Required</div>
            <p style="color:var(--muted); font-size:0.95rem; margin-bottom:1.25rem;">For privacy, please enter your ID number to unlock your grades.</p>
            <div class="pin-wrap">
              <input type="text" id="inline-student-id" class="pin-input" placeholder="Enter Student ID" onkeydown="if(event.key==='Enter') submitInlineStudentId()"/>
              <button class="load-btn" style="margin-top:0.75rem;" onclick="submitInlineStudentId()">Unlock</button>
            </div>
            <div id="inline-id-error" class="error-msg hidden" style="margin-top:0.75rem;"></div>
          </div>
        </div>
        <div class="blurred-content">
          ${contentHTML}
        </div>
      </div>
    `;
  }

  return headerHTML + contentHTML;
}

/* Grades per period */
function buildGradesHTML(g) {
  const items = [
    { label: 'Prelim Grade', value: g.prelim, color: 'fill-blue' },
    { label: 'Midterm Grade', value: g.midterm, color: 'fill-purple' },
    { label: 'Semi-Final Grade', value: g.semiFinal, color: 'fill-amber' },
    { label: 'Final Grade', value: g.final, color: 'fill-green' },
  ].filter(i => i.value !== null && i.value !== undefined && i.value !== '');

  if (!items.length) return '';

  const cards = items.map(i => {
    const pct = gradeToPercent(i.value);

    // Apply pass/fail styling to the grade text itself
    let valClass = '';
    const numGrade = parseFloat(i.value);
    if (!isNaN(numGrade)) {
      if (numGrade >= 1 && numGrade <= 5) {
        valClass = numGrade > 3.0 ? 'color: var(--red)' : 'color: var(--green)';
      } else {
        valClass = numGrade >= 75 ? 'color: var(--green)' : 'color: var(--red)';
      }
    }

    return `
      <div class="stat-card">
        <div class="stat-card-label">${i.label}</div>
        <div class="stat-card-value" style="${valClass}">${i.value}</div>
        <div class="progress-bar-wrap">
          <div class="progress-track">
            <div class="progress-fill ${i.color}" data-pct="${pct}" style="width:0%"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="section-title">📊 Grades Per Period</div>
    <div class="cards-grid">${cards}</div>
  `;
}

/* Attendance HTML */
function buildAttendanceHTML(att) {
  if (!att || Object.keys(att).length === 0) return '';

  const periodLabels = {
    prelim: 'Prelim', midterm: 'Midterm', semiFinal: 'Semi-Final', final: 'Finals'
  };
  const colors = { prelim: 'fill-blue', midterm: 'fill-purple', semiFinal: 'fill-amber', final: 'fill-green' };

  const cards = Object.entries(att).filter(([, v]) => v && v.total > 0).map(([period, v]) => {
    const pct = v.total > 0 ? Math.round((v.present / v.total) * 100) : 0;

    let tableHtml = '';
    if (v.records && v.records.length > 0) {
      tableHtml = `
        <div class="attendance-table-wrap hidden" id="att-table-${period}" style="margin-top: 15px;">
          <table class="period-table">
            <thead>
              <tr><th>Date</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${v.records.map(r => `
                <tr>
                  <td>${r.date.split(' 00:00:00')[0]}</td>
                  <td>
                    ${r.status === '1' || r.status.toLowerCase() === 'p' ? '<span style="color:var(--green)">Present</span>' :
          r.status.toLowerCase() === 'a' ? '<span style="color:var(--red)">Absent</span>' :
            (r.status || '—')}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    return `
      <div class="stat-card" style="grid-column: 1 / -1;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 8px;">
          <div>
            <div class="stat-card-label">${periodLabels[period] || period} Attendance</div>
            <div class="stat-card-value">${v.present}/${v.total}</div>
            <div class="stat-card-sub">${pct}% attendance rate</div>
          </div>
          ${v.records && v.records.length > 0 ? `
            <button class="btn-outline" style="font-size:0.8rem; padding: 4px 8px;" onclick="document.getElementById('att-table-${period}').classList.toggle('hidden')">View Details</button>
          ` : ''}
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-track">
            <div class="progress-fill ${colors[period] || 'fill-blue'}" data-pct="${pct}" style="width:0%"></div>
          </div>
        </div>
        ${tableHtml}
      </div>
    `;
  });

  if (!cards.length) return '';

  return `
    <div class="section-title">📅 Attendance</div>
    <div class="cards-grid">${cards.join('')}</div>
  `;
}

/* Period score detail */
function buildPeriodsHTML(periods) {
  if (!periods) return '';

  const periodLabels = {
    prelim: 'Prelim', midterm: 'Midterm', semiFinal: 'Semi-Final', final: 'Finals'
  };
  const tagColors = { prelim: 'tag-blue', midterm: 'tag-purple', semiFinal: 'tag-amber', final: 'tag-green' };

  const tables = Object.entries(periods).filter(([, v]) => v !== null).map(([period, data]) => {
    if (!data) return '';
    const ww = data.writtenWorks || {};
    const pt = data.performanceTasks || {};
    const qa = data.quarterlyAssessment || {};
    const fg = data.finalGrade;
    const comps = data.components || [];

    const rows = [];

    const formatName = (name) => {
      let n = name.trim();
      if (/^Q\d+$/i.test(n)) return n.replace(/^Q/i, 'Quiz ');
      if (/^A\d+$/i.test(n) || /^G\d+$/i.test(n)) return n.replace(/^[AG]/i, 'Activity ');
      if (/^O\d+$/i.test(n)) return n.replace(/^O/i, 'Oral ');
      if (/^SW\d+$/i.test(n)) return n.replace(/^SW/i, 'Seatwork ');
      if (/^HW\d+$/i.test(n)) return n.replace(/^HW/i, 'Homework ');
      if (/^PT\d+$/i.test(n)) return n.replace(/^PT/i, 'Performance Task ');
      return n;
    };

    // Detailed components
    comps.forEach(c => {
      rows.push({
        label: escapeHTML(formatName(c.name)),
        value: formatScore(c.score),
        sub: c.maxScore ? `out of ${c.maxScore}` : ''
      });
    });

    if (ww.total !== null || pt.total !== null || qa.score !== null || fg !== null) {
      if (comps.length > 0) rows.push({ label: '—', value: '—', sub: '—' }); // visual separator
    }

    if (ww.total !== null) rows.push({ label: 'Written Works (Total)', value: formatScore(ww.total), sub: ww.percentage !== null ? `${ww.percentage}%` : '' });
    if (pt.total !== null) rows.push({ label: 'Performance Tasks (Total)', value: formatScore(pt.total), sub: pt.percentage !== null ? `${pt.percentage}%` : '' });

    const examLabel = periodLabels[period] ? `${periodLabels[period]} Exam` : 'Quarterly Assessment';
    if (qa.score !== null) rows.push({ label: examLabel, value: formatScore(qa.score), sub: qa.maxScore ? `out of ${qa.maxScore}` : '' });

    const finalGradeLabel = periodLabels[period] ? `${periodLabels[period].toUpperCase()} GRADE` : 'PERIOD GRADE';
    if (fg !== null) rows.push({ label: finalGradeLabel, value: formatScore(fg), sub: fg ? gradeRemark(fg) : '' });

    const validRows = rows.filter(r => r.value !== null && r.value !== undefined && r.value !== '');
    if (!validRows.length) return '';

    const tag = tagColors[period] || 'tag-blue';
    return `
      <div class="section-title" style="margin-top:2rem;">📝 ${periodLabels[period].toUpperCase()} — CLASS RECORD <span class="${tag}">${periodLabels[period]}</span></div>
      <div class="period-table-wrap">
        <table class="period-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Score</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            ${validRows.map(r => r.label === '—' ? `
              <tr style="background:transparent;">
                 <td colspan="3" style="padding: 2px 8px;"><hr style="border:none;border-top:1px dashed var(--border);margin:0;"/></td>
              </tr>
            ` : `
              <tr>
                <td>${r.label}</td>
                <td class="${tag}">${r.value}</td>
                <td style="color:var(--muted);font-size:0.82rem;">${r.sub}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  });

  return tables.join('');
}

/* ═══════════════════════════════════════════════
   UTILITY HELPERS
   ═══════════════════════════════════════════════ */
function normalise(str) {
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

function lookupByName(map, normName) {
  if (!map) return null;
  // Exact
  if (map[normName]) return map[normName];
  // Partial match
  const keys = Object.keys(map);
  const match = keys.find(k => k.includes(normName) || normName.includes(k));
  return match ? map[match] : null;
}

function toNum(v) {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

function isNumeric(str) {
  return /^\d+$/.test(String(str).trim());
}

function isHeader(str) {
  const s = str.toLowerCase().trim();
  return ['student\'s name', 'name', 'student name', 'no.', 'no', '#'].includes(s);
}

function getInitial(name) {
  const parts = name.trim().split(/[\s,]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

function gradeToPercent(grade) {
  if (!grade) return 0;
  // 1.0 = 100%, 5.0 = 0% (Philippine grading)
  // or raw 0-100 scale
  const g = parseFloat(grade);
  if (g >= 1 && g <= 5) return Math.max(0, Math.round(((5 - g) / 4) * 100));
  if (g >= 60 && g <= 100) return g;
  return 0;
}

function gradeRemark(fg) {
  const g = parseFloat(fg);
  if (isNaN(g)) return '';
  if (g >= 1 && g <= 5) return g > 3.0 ? '✗ Failed' : '✓ Passed';
  if (g >= 75) return '✓ Passed';
  return '✗ Failed';
}

function formatScore(v) {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlightMatch(text, query) {
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(re, '<mark style="background:rgba(108,99,255,0.35);color:inherit;border-radius:3px;padding:0 2px;">$1</mark>');
}

function showError(msg) { console.warn('GradeViewer:', msg); }
function clearError() { }

// Boot the app
initApp();
