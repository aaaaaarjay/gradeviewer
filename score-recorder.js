/* ═══════════════════════════════════════════════
   GRADE VIEWER — SCORE RECORDER v2 (Gradebook Grid)
   ═══════════════════════════════════════════════ */

const SCORES_KEY     = 'gv_scores';
const GRADEBOOK_KEY  = 'gv_gradebook';
const GSHEETS_ID_KEY = 'gv_gsheets_client_id';
const SHEET_MAP_KEY  = 'gv_sheet_mapping';

/* ─── CATEGORY DEFINITIONS ─── */
const CATEGORIES = [
  { id: 'Quiz',     label: 'QUIZ',     emoji: '📄' },
  { id: 'Oral',     label: 'ORAL',     emoji: '🗣️' },
  { id: 'Activity', label: 'ACTIVITY', emoji: '✏️' },
  { id: 'PT',       label: 'PERF. TASK',emoji: '🎭' },
  { id: 'HW',       label: 'HOMEWORK', emoji: '📚' },
  { id: 'Exam',     label: 'EXAM',     emoji: '📋' },
  { id: 'Seatwork', label: 'SEATWORK', emoji: '💺' },
  { id: 'Project',  label: 'PROJECT',  emoji: '🏗️' },
];

const DEFAULT_COLS = 5; // Default columns per category

/* ─── STATE ─── */
let scoresStudents   = [];
let currentCat       = 'Quiz';
let currentClassId   = '';
// gradebookData[classId][category] = { cols: [{name, max}], rows: {studentName: [val, val, ...]} }
let gradebookData    = {};

/* ─── NAV INIT ─── */
document.getElementById('nav-scores').addEventListener('click', () => {
  const sel = document.getElementById('scores-class-select');
  sel.innerHTML = '<option value="">-- Select a Class --</option>' +
    classList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');

  const hf = document.getElementById('history-class-filter');
  hf.innerHTML = '<option value="">All Classes</option>' +
    classList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');

  // Set origin display in settings
  const od = document.getElementById('settings-origin-display');
  if (od) od.textContent = window.location.origin;

  // Load saved client ID
  const cid = localStorage.getItem(GSHEETS_ID_KEY) || '';
  const cidInput = document.getElementById('gsheets-client-id-input');
  if (cidInput && cid) cidInput.value = cid;

  // Update GSheets connect button state
  updateGSheetsUI();
  renderScoreHistory();
});

/* ─── LOAD CLASS ─── */
async function loadClassForScores() {
  currentClassId = document.getElementById('scores-class-select').value;
  document.getElementById('scores-workspace').classList.add('hidden');
  if (!currentClassId) return;

  document.getElementById('scores-class-select').disabled = true;
  showToast('Loading students…');

  scoresStudents = await fetchStudentsForClass(currentClassId);
  document.getElementById('scores-class-select').disabled = false;

  if (!scoresStudents.length) {
    showToast('❌ No students found in this class sheet.');
    return;
  }

  // Load saved gradebook data for this class
  const allData = JSON.parse(localStorage.getItem(GRADEBOOK_KEY) || '{}');
  gradebookData = allData[currentClassId] || {};

  // Ensure each category has default structure
  CATEGORIES.forEach(cat => {
    if (!gradebookData[cat.id]) {
      gradebookData[cat.id] = {
        cols: Array.from({ length: DEFAULT_COLS }, (_, i) => ({ name: cat.id + ' ' + (i + 1), max: '' })),
        rows: {}
      };
    }
    // Ensure all students have rows
    scoresStudents.forEach(s => {
      if (!gradebookData[cat.id].rows[s]) {
        gradebookData[cat.id].rows[s] = Array(gradebookData[cat.id].cols.length).fill('');
      }
    });
  });

  const cls = classList.find(c => c.id === currentClassId);
  const infoEl = document.getElementById('scores-class-info');
  if (infoEl) {
    infoEl.textContent = `${scoresStudents.length} students loaded`;
    infoEl.classList.remove('hidden');
  }

  // Show GSheets map button if connected
  const mapBtn = document.getElementById('scores-gsheets-map-btn');
  if (mapBtn && gsheetsToken) mapBtn.style.display = 'inline-flex';

  document.getElementById('scores-workspace').classList.remove('hidden');
  currentCat = 'Quiz';
  renderCategoryTabs();
  renderGradebookGrid();
  showToast(`✅ ${scoresStudents.length} students loaded`);
}

/* ─── CATEGORY TABS ─── */
function renderCategoryTabs() {
  const container = document.getElementById('gradebook-cat-tabs');
  container.innerHTML = CATEGORIES.map(cat => `
    <button
      class="gradebook-cat-btn ${currentCat === cat.id ? 'active' : ''}"
      onclick="switchCategory('${cat.id}')"
    >${cat.emoji} ${cat.label}</button>
  `).join('');
}

function switchCategory(catId) {
  currentCat = catId;
  renderCategoryTabs();
  renderGradebookGrid();
  const cat = CATEGORIES.find(c => c.id === catId);
  document.getElementById('gradebook-cat-title').textContent = (cat?.emoji || '') + ' ' + (cat?.label || catId);
}

/* ─── GRADEBOOK GRID ─── */
function renderGradebookGrid() {
  const data  = gradebookData[currentCat];
  if (!data) return;
  const cols  = data.cols;
  const table = document.getElementById('gradebook-table');

  let html = '<thead>';

  // Row 1: "NAMES" + editable column name headers
  html += '<tr>';
  html += `<th class="gb-name-col">NAMES</th>`;
  cols.forEach((col, ci) => {
    html += `
      <th class="gb-col-header">
        <input
          class="gb-col-name"
          type="text"
          value="${escapeHTML(col.name)}"
          placeholder="Activity name"
          oninput="updateColName(${ci}, this.value)"
        />
      </th>`;
  });
  html += '</tr>';

  // Row 2: blank name cell + max score inputs
  html += '<tr>';
  html += `<th class="gb-max-label">/ MAX SCORE</th>`;
  cols.forEach((col, ci) => {
    html += `
      <th class="gb-col-header">
        <input
          class="gb-max-input"
          type="number"
          value="${escapeHTML(String(col.max))}"
          placeholder="Max"
          min="0"
          oninput="updateColMax(${ci}, this.value)"
        />
      </th>`;
  });
  html += '</tr>';

  html += '</thead><tbody>';

  // Student rows
  scoresStudents.forEach((student, si) => {
    const rowVals = data.rows[student] || Array(cols.length).fill('');
    html += `<tr>`;
    html += `<td class="gb-name-cell">${escapeHTML(student)}</td>`;
    cols.forEach((col, ci) => {
      const val = rowVals[ci] ?? '';
      html += `
        <td class="gb-score-cell">
          <input
            class="gb-score-input"
            type="number"
            value="${escapeHTML(String(val))}"
            min="0"
            max="${col.max || ''}"
            placeholder="—"
            oninput="updateScore(${si}, ${ci}, this.value)"
            onkeydown="gbKeyNav(event, ${si}, ${ci})"
            id="gb-${si}-${ci}"
          />
        </td>`;
    });
    html += '</tr>';
  });

  html += '</tbody>';
  table.innerHTML = html;
}

/* ─── STATE UPDATES ─── */
function updateColName(ci, val) {
  gradebookData[currentCat].cols[ci].name = val;
}

function updateColMax(ci, val) {
  gradebookData[currentCat].cols[ci].max = val;
}

function updateScore(si, ci, val) {
  const student = scoresStudents[si];
  if (!gradebookData[currentCat].rows[student]) {
    gradebookData[currentCat].rows[student] = Array(gradebookData[currentCat].cols.length).fill('');
  }
  gradebookData[currentCat].rows[student][ci] = val;
}

// Tab/Enter key navigation through the grid
function gbKeyNav(e, si, ci) {
  if (e.key === 'Enter' || e.key === 'ArrowDown') {
    e.preventDefault();
    const next = document.getElementById(`gb-${si + 1}-${ci}`);
    if (next) next.focus();
    else {
      // Move to next column, first student
      const nextCol = document.getElementById(`gb-0-${ci + 1}`);
      if (nextCol) nextCol.focus();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prev = document.getElementById(`gb-${si - 1}-${ci}`);
    if (prev) prev.focus();
  } else if (e.key === 'Tab') {
    // Default tab behavior moves across columns already
  }
}

/* ─── ADD COLUMN ─── */
function addGradebookColumn() {
  const data = gradebookData[currentCat];
  const ci   = data.cols.length + 1;
  const cat  = CATEGORIES.find(c => c.id === currentCat);
  data.cols.push({ name: (cat?.id || currentCat) + ' ' + ci, max: '' });
  scoresStudents.forEach(s => {
    if (!data.rows[s]) data.rows[s] = [];
    data.rows[s].push('');
  });
  renderGradebookGrid();
}

/* ─── SET ALL ─── */
function setAllGradebook() {
  const data = gradebookData[currentCat];
  const colNames = data.cols.map(c => c.name).join(', ');
  const ci = parseInt(prompt(`Which column number to set all? (1 - ${data.cols.length})\nColumns: ${colNames}`));
  if (isNaN(ci) || ci < 1 || ci > data.cols.length) return;
  const max = data.cols[ci - 1].max;
  const val = prompt(`Set the same score for ALL ${scoresStudents.length} students in "${data.cols[ci-1].name}" (max: ${max || '?'}):`);
  if (val === null || val.trim() === '') return;

  scoresStudents.forEach(s => {
    if (!data.rows[s]) data.rows[s] = Array(data.cols.length).fill('');
    data.rows[s][ci - 1] = val.trim();
  });
  renderGradebookGrid();
}

/* ─── COPY FOR SHEETS ─── */
function copyGradebookForSheets() {
  const data = gradebookData[currentCat];
  // Copy only score values (no names) — student order preserved
  // Each column = one column in Sheets
  const colCount = data.cols.length;

  // Build TSV: header row of col names, then one row per student
  let tsv = data.cols.map(c => c.name).join('\t') + '\n';
  scoresStudents.forEach(s => {
    const row = data.rows[s] || Array(colCount).fill('');
    tsv += row.join('\t') + '\n';
  });

  navigator.clipboard.writeText(tsv).then(() => {
    showToast('📋 Copied! Paste it into your Google Sheet.');
  }).catch(() => {
    showToast('❌ Copy failed. Try again.');
  });
}

/* ─── SAVE ─── */
async function saveGradebook() {
  if (!currentClassId) { showToast('❌ Select a class first.'); return; }

  // Save to localStorage
  let allData = JSON.parse(localStorage.getItem(GRADEBOOK_KEY) || '{}');
  allData[currentClassId] = gradebookData;
  localStorage.setItem(GRADEBOOK_KEY, JSON.stringify(allData));
  showToast('💾 Gradebook saved locally.');

  // Also build flat score entries for history/Firebase
  const date = new Date().toISOString();
  const cls  = classList.find(c => c.id === currentClassId);
  const entries = [];

  CATEGORIES.forEach(cat => {
    const catData = gradebookData[cat.id];
    if (!catData) return;
    catData.cols.forEach((col, ci) => {
      scoresStudents.forEach(student => {
        const val = catData.rows[student]?.[ci];
        if (val === '' || val === undefined || val === null) return;
        const score = parseFloat(val);
        if (isNaN(score)) return;
        entries.push({
          id:        'sc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          classId:   currentClassId,
          className: cls?.name || currentClassId,
          student,
          category:  cat.id,
          activity:  col.name,
          score,
          max:       parseFloat(col.max) || null,
          date,
        });
      });
    });
  });

  // Firebase sync
  if (typeof _db !== 'undefined' && _db) {
    try {
      const ref  = window._firestoreDoc(_db, FIRESTORE_COL, 'gradebook');
      await window._firestoreSetDoc(ref, { data: allData }, { merge: true });
      showToast('✅ Synced to Cloud!');
    } catch(e) {
      console.warn('Cloud sync failed:', e);
      showToast('⚠️ Saved locally — cloud sync failed.');
    }
  }

  // Write to Google Sheets if connected
  if (gsheetsToken) {
    writeGradebookToSheet();
  }

  renderScoreHistory();
}

/* ════════════════════════════════════════════════
   GOOGLE SHEETS OAUTH
   ════════════════════════════════════════════════ */

let gsheetsToken    = null; // Access token
let gsheetsClient   = null; // Google OAuth client instance

function saveGSheetsClientId() {
  const val = document.getElementById('gsheets-client-id-input').value.trim();
  if (!val) { showToast('❌ Please enter a Client ID.'); return; }
  localStorage.setItem(GSHEETS_ID_KEY, val);
  showToast('✅ Client ID saved. Click "Test Connection" to connect.');
  document.getElementById('gsheets-settings-status').innerHTML =
    '<span style="color:var(--green);">✅ Client ID saved.</span>';
}

function updateGSheetsUI() {
  const pill       = document.getElementById('gsheets-status-pill');
  const connectBtn = document.getElementById('gsheets-connect-btn');

  if (gsheetsToken) {
    if (pill) { pill.classList.remove('hidden'); pill.style.display = 'flex'; }
    if (connectBtn) connectBtn.textContent = '🔓 Disconnect Sheets';
  } else {
    if (pill) pill.classList.add('hidden');
    if (connectBtn) connectBtn.textContent = '🔗 Connect Sheets';
  }
}

function connectGoogleSheets() {
  if (gsheetsToken) {
    // Disconnect
    gsheetsToken  = null;
    gsheetsClient = null;
    updateGSheetsUI();
    showToast('🔌 Disconnected from Google Sheets.');
    return;
  }
  const clientId = localStorage.getItem(GSHEETS_ID_KEY);
  if (!clientId) {
    showToast('❌ No Client ID found. Go to Settings → Google Sheets Integration first.');
    return;
  }
  initGSheetsOAuth(clientId);
}

function testGoogleSheetsConnection() {
  const clientId = document.getElementById('gsheets-client-id-input').value.trim();
  if (!clientId) { showToast('❌ Enter a Client ID first.'); return; }
  localStorage.setItem(GSHEETS_ID_KEY, clientId);
  initGSheetsOAuth(clientId);
}

function initGSheetsOAuth(clientId) {
  if (typeof google === 'undefined' || !google.accounts) {
    showToast('❌ Google Identity Services not loaded yet. Try again in a moment.');
    return;
  }

  gsheetsClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    callback: (tokenResponse) => {
      if (tokenResponse.error) {
        console.error(tokenResponse);
        showToast('❌ OAuth failed: ' + tokenResponse.error);
        const statusEl = document.getElementById('gsheets-settings-status');
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--red);">❌ Error: ${tokenResponse.error}</span>`;
        return;
      }
      gsheetsToken = tokenResponse.access_token;
      updateGSheetsUI();
      showToast('✅ Connected to Google Sheets!');

      const statusEl = document.getElementById('gsheets-settings-status');
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--green);">✅ Connected successfully!</span>';

      // Show map button if class is loaded
      const mapBtn = document.getElementById('scores-gsheets-map-btn');
      if (mapBtn && currentClassId) mapBtn.style.display = 'inline-flex';
    },
  });

  gsheetsClient.requestAccessToken();
}

/* ─── SHEET MAPPING ─── */
function openSheetMapper() {
  const cls = classList.find(c => c.id === currentClassId);
  if (!cls) { showToast('❌ Select a class first.'); return; }

  const mapping = JSON.parse(localStorage.getItem(SHEET_MAP_KEY) || '{}');
  const classMapping = mapping[currentClassId] || {};

  document.getElementById('sheet-mapper-body').innerHTML = `
    <p style="color:var(--muted); font-size:0.85rem; margin-bottom:1rem;">
      For each category, enter the exact tab/sheet name in your Google Sheet where scores should be written.
      The sheet URL is pulled from your class URL (Sheet ID: <code>${extractSheetId(cls.url) || '?'}</code>).
    </p>
    ${CATEGORIES.map(cat => `
      <div class="form-group" style="display:grid; grid-template-columns:150px 1fr; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">
        <label class="form-label" style="margin:0;">${cat.emoji} ${cat.label}</label>
        <input type="text" class="form-input" id="map-${cat.id}"
          value="${escapeHTML(classMapping[cat.id] || '')}"
          placeholder="e.g. Prelim" />
      </div>
    `).join('')}
    <div style="margin-top:1rem; background:rgba(108,99,255,0.07); border-radius:8px; padding:0.75rem; font-size:0.8rem; color:var(--muted);">
      <strong style="color:var(--text);">Tip:</strong> You can map multiple categories to the same tab (e.g., both Quiz and Oral → Prelim).
      The system will find the student's row and append score columns automatically.
    </div>
  `;

  document.getElementById('sheet-mapper-modal').classList.remove('hidden');
}

function saveSheetMapping() {
  const mapping = JSON.parse(localStorage.getItem(SHEET_MAP_KEY) || '{}');
  const classMapping = {};
  CATEGORIES.forEach(cat => {
    const val = document.getElementById('map-' + cat.id)?.value?.trim();
    if (val) classMapping[cat.id] = val;
  });
  mapping[currentClassId] = classMapping;
  localStorage.setItem(SHEET_MAP_KEY, JSON.stringify(mapping));
  document.getElementById('sheet-mapper-modal').classList.add('hidden');
  showToast('✅ Sheet mapping saved!');
}

/* ─── WRITE TO GOOGLE SHEETS ─── */
async function writeGradebookToSheet() {
  if (!gsheetsToken) { showToast('❌ Not connected to Google Sheets.'); return; }

  const cls = classList.find(c => c.id === currentClassId);
  if (!cls) return;

  const sheetId = extractSheetId(cls.url);
  if (!sheetId) { showToast('❌ Could not extract Sheet ID from class URL.'); return; }

  const mapping = JSON.parse(localStorage.getItem(SHEET_MAP_KEY) || '{}');
  const classMapping = mapping[currentClassId] || {};

  // For each category that has a mapped tab
  let writeCount = 0;

  for (const cat of CATEGORIES) {
    const tabName = classMapping[cat.id];
    if (!tabName) continue;

    const catData = gradebookData[cat.id];
    if (!catData) continue;

    // Fetch existing sheet data to find student rows
    try {
      const rangeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tabName)}`;
      const fetchResp = await fetch(rangeUrl, {
        headers: { Authorization: `Bearer ${gsheetsToken}` }
      });

      if (!fetchResp.ok) {
        const err = await fetchResp.json();
        console.warn('Sheet fetch error:', err);
        continue;
      }

      const sheetData = await fetchResp.json();
      const rows = sheetData.values || [];

      // Find header row — look for a row containing student names
      // Find the column with student names and the last used column
      // Strategy: find the name column by looking for our students
      let nameCol = -1;
      let headerRow = -1;

      for (let ri = 0; ri < rows.length && ri < 5; ri++) {
        const row = rows[ri] || [];
        for (let ci = 0; ci < row.length; ci++) {
          const cell = String(row[ci] || '').trim().toLowerCase();
          if (cell === 'name' || cell === "student's name" || cell === 'student name') {
            nameCol = ci;
            headerRow = ri;
            break;
          }
        }
        if (nameCol >= 0) break;
      }

      if (nameCol < 0) {
        // Fallback: first column with student names
        nameCol = 0;
        headerRow = 0;
      }

      // Find which row each student is on
      const studentRowMap = {};
      rows.forEach((row, ri) => {
        const name = String(row[nameCol] || '').trim().toUpperCase();
        if (name && ri > headerRow) {
          studentRowMap[name] = ri;
        }
      });

      // Determine the next empty column after the current data
      const headerRowData = rows[headerRow] || [];
      const startColIdx = headerRowData.length; // append after last column

      // Build batch update requests
      const valueRanges = [];

      // Write column headers (activity names)
      const headerValues = catData.cols.map(c => c.name);
      const headerRange  = `${tabName}!${colIndexToLetter(startColIdx)}${headerRow + 1}:${colIndexToLetter(startColIdx + catData.cols.length - 1)}${headerRow + 1}`;
      valueRanges.push({ range: headerRange, values: [headerValues] });

      // Write max scores row (row after header)
      const maxValues = catData.cols.map(c => c.max || '');
      const maxRange  = `${tabName}!${colIndexToLetter(startColIdx)}${headerRow + 2}:${colIndexToLetter(startColIdx + catData.cols.length - 1)}${headerRow + 2}`;
      valueRanges.push({ range: maxRange, values: [maxValues] });

      // Write each student's scores
      scoresStudents.forEach(student => {
        const normStudent = student.trim().toUpperCase();
        const ri = studentRowMap[normStudent];
        if (ri === undefined) return; // Student not found in sheet

        const scores = catData.rows[student] || Array(catData.cols.length).fill('');
        const scoreRange = `${tabName}!${colIndexToLetter(startColIdx)}${ri + 1}:${colIndexToLetter(startColIdx + catData.cols.length - 1)}${ri + 1}`;
        valueRanges.push({ range: scoreRange, values: [scores] });
      });

      // Batch update
      const updateResp = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${gsheetsToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            valueInputOption: 'RAW',
            data: valueRanges,
          }),
        }
      );

      if (updateResp.ok) {
        writeCount++;
      } else {
        const err = await updateResp.json();
        console.warn('Sheet write error for', cat.id, ':', err);
        // Token may have expired
        if (err?.error?.code === 401) {
          gsheetsToken = null;
          updateGSheetsUI();
          showToast('⚠️ Google Sheets session expired. Please reconnect.');
          return;
        }
      }

    } catch (err) {
      console.error('Sheets write error:', err);
    }
  }

  if (writeCount > 0) {
    showToast(`✅ Written to ${writeCount} sheet tab(s) automatically!`);
  } else {
    showToast('⚠️ Saved locally. No sheet tabs were mapped or reachable.');
  }
}

// Convert 0-indexed column number to A1 notation letter(s)
function colIndexToLetter(n) {
  let s = '';
  n++;
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

/* ════════════════════════════════════════════════
   SCORE HISTORY
   ════════════════════════════════════════════════ */

function getAllScores() {
  try { return JSON.parse(localStorage.getItem(SCORES_KEY) || '[]'); } catch { return []; }
}

function renderScoreHistory() {
  const filterClassId = document.getElementById('history-class-filter')?.value || '';
  let entries = getAllScores();
  if (filterClassId) entries = entries.filter(e => e.classId === filterClassId);
  entries.sort((a, b) => new Date(b.date) - new Date(a.date));

  const tbody = document.getElementById('scores-history-tbody');
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--muted); padding:2rem;">No scores recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map((e, idx) => {
    const d      = new Date(e.date);
    const ds     = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const pct    = e.max ? Math.round((e.score / e.max) * 100) : null;
    const pctColor = pct !== null
      ? pct >= 75 ? 'var(--green)' : pct >= 60 ? 'var(--amber)' : 'var(--red)'
      : 'var(--muted)';
    return `
      <tr>
        <td style="font-size:0.75rem; color:var(--muted); white-space:nowrap;">${ds}</td>
        <td style="font-size:0.8rem;">${escapeHTML(e.className || e.classId || '—')}</td>
        <td style="font-weight:500;">${escapeHTML(e.student || '—')}</td>
        <td><span class="key-badge locked" style="font-size:0.7rem;">${escapeHTML(e.category || '—')}</span></td>
        <td style="font-size:0.85rem;">${escapeHTML(e.activity || '—')}</td>
        <td style="font-weight:700; color:${pctColor};">${e.score}</td>
        <td style="color:var(--muted);">${e.max || '—'}</td>
        <td style="text-align:right;">
          <button class="btn btn-danger btn-sm" onclick="deleteScoreEntry('${escapeHTML(e.id || '')}', ${idx})">🗑️</button>
        </td>
      </tr>`;
  }).join('');
}

function deleteScoreEntry(id, fallbackIdx) {
  if (!confirm('Delete this score entry?')) return;
  let entries = getAllScores();
  entries = id ? entries.filter(e => e.id !== id) : (entries.splice(fallbackIdx, 1), entries);
  localStorage.setItem(SCORES_KEY, JSON.stringify(entries));
  if (typeof _db !== 'undefined' && _db) {
    try {
      const ref = window._firestoreDoc(_db, FIRESTORE_COL, 'scores');
      window._firestoreSetDoc(ref, { entries });
    } catch(e) {}
  }
  showToast('🗑️ Score deleted.');
  renderScoreHistory();
}

async function deleteAllScores() {
  const filterClassId = document.getElementById('history-class-filter')?.value || '';
  const cls = classList.find(c => c.id === filterClassId);
  const msg = filterClassId
    ? `Delete all score history for ${cls?.name || 'this class'}?`
    : 'Delete ALL score history? This cannot be undone.';
  if (!confirm(msg)) return;

  let entries = filterClassId
    ? getAllScores().filter(e => e.classId !== filterClassId)
    : [];

  localStorage.setItem(SCORES_KEY, JSON.stringify(entries));
  if (typeof _db !== 'undefined' && _db) {
    try {
      const ref = window._firestoreDoc(_db, FIRESTORE_COL, 'scores');
      await window._firestoreSetDoc(ref, { entries });
    } catch(e) {}
  }
  showToast('🗑️ History deleted.');
  renderScoreHistory();
}

function exportScoresCSV() {
  const filterClassId = document.getElementById('history-class-filter')?.value || '';
  let entries = getAllScores();
  if (filterClassId) entries = entries.filter(e => e.classId === filterClassId);
  if (!entries.length) { showToast('No scores to export.'); return; }

  const header = ['Date','Class','Student','Category','Activity','Score','Max','Percent'];
  const rows = entries.map(e => {
    const pct = e.max ? Math.round((e.score / e.max) * 100) : '';
    return [new Date(e.date).toLocaleString(), e.className || e.classId || '', e.student || '',
      e.category || '', e.activity || '', e.score, e.max || '', pct]
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const csv  = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'scores_' + new Date().toISOString().slice(0, 10) + '.csv'
  });
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('📥 CSV downloaded!');
}
