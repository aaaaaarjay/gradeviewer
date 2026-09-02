/* ═══════════════════════════════════════════════
   GRADE VIEWER — SCORE RECORDER v2 (Gradebook Grid)
   ═══════════════════════════════════════════════ */

const SCORES_KEY     = 'gv_scores';
const GRADEBOOK_KEY  = 'gv_gradebook';
const PERIOD_DATA_KEY = 'gv_gradebook_by_period';
const SCRIPT_URL_KEY = 'gv_gsheets_script_url';
const SHEET_MAP_KEY  = 'gv_sheet_mapping';

/* ─── CATEGORY DEFINITIONS ─── */
const CATEGORIES = [
  { id: 'Quiz',     label: 'QUIZ',     emoji: '📄' },
  { id: 'Oral',     label: 'ORAL',     emoji: '🗣️' },
  { id: 'Activity', label: 'ACTIVITY', emoji: '✏️' },
  { id: 'Exam',     label: 'EXAM',     emoji: '📋' },
];

const MAX_COLS = 4;
const DEFAULT_COLS = 4; // Four scores per category
const PERIODS = ['Prelim', 'Midterm', 'Semifinal', 'Final'];
const DEFAULT_PERIOD = 'Prelim';

/* ─── STATE ─── */
let scoresStudents   = [];
let currentCat       = 'Quiz';
let currentClassId   = '';
let currentSheetTabName = '';
const savedPeriod = localStorage.getItem('gv_current_period');
let currentPeriod    = PERIODS.includes(savedPeriod) ? savedPeriod : DEFAULT_PERIOD;
// gradebookData[classId][category] = { cols: [{name, max}], rows: {studentName: [val, val, ...]} }
let gradebookData    = {};

/* ─── NAV INIT ─── */
document.getElementById('nav-scores').addEventListener('click', () => {
  const sel = document.getElementById('scores-class-select');
  sel.innerHTML = '<option value="">-- Select a Class --</option>' +
    classList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
  sel.value = currentClassId || '';
  const periodSelect = document.getElementById('scores-period-select');
  if (periodSelect) periodSelect.value = currentPeriod;

  // Set origin display in settings (not needed anymore for apps script but keep if used elsewhere)
  const od = document.getElementById('settings-origin-display');
  if (od) od.textContent = window.location.origin;

  // Load saved script URL
  const scriptUrl = localStorage.getItem(SCRIPT_URL_KEY) || '';
  const urlInput = document.getElementById('gsheets-script-url-input');
  if (urlInput && scriptUrl) urlInput.value = scriptUrl;

  updateGSheetsUI();
  renderScoreHistory();
});

/* ─── LOAD CLASS ─── */
async function loadClassForScores() {
  currentClassId = document.getElementById('scores-class-select').value;
  document.getElementById('scores-workspace').classList.add('hidden');
  if (!currentClassId) {
    renderScoreHistory();
    return;
  }

  document.getElementById('scores-class-select').disabled = true;
  showToast('Loading students…');

  const sheetGradebook = await fetchGradebookForClass(currentClassId, currentPeriod);
  currentSheetTabName = sheetGradebook?.sheetName || currentPeriod;
  scoresStudents = sheetGradebook?.students || await fetchStudentsForClass(currentClassId);
  document.getElementById('scores-class-select').disabled = false;

  if (!scoresStudents.length) {
    showToast(`❌ ${lastSpreadsheetLoadError || 'No student names found in any spreadsheet tab.'}`);
    return;
  }

  // Load saved gradebook data for this class and grading period.
  const allData = JSON.parse(localStorage.getItem(GRADEBOOK_KEY) || '{}');
  const periodData = JSON.parse(localStorage.getItem(PERIOD_DATA_KEY) || '{}');
  const classPeriods = periodData[currentClassId] || {};
  if (Object.prototype.hasOwnProperty.call(classPeriods, currentPeriod)) {
    gradebookData = classPeriods[currentPeriod] || {};
  } else if (currentPeriod === DEFAULT_PERIOD) {
    // Use existing gradebooks as the default Prelim data.
    gradebookData = allData[currentClassId] || {};
  } else {
    gradebookData = {};
  }

  // Ensure each category has exactly four available score columns.
  CATEGORIES.forEach(cat => {
    const saved = gradebookData[cat.id] || {};
    const cols = Array.isArray(saved.cols) ? saved.cols.slice(0, MAX_COLS) : [];
    while (cols.length < DEFAULT_COLS) {
      const i = cols.length + 1;
      cols.push({ name: cat.id + ' ' + i, max: '' });
    }
    const rows = saved.rows && typeof saved.rows === 'object' ? saved.rows : {};
    gradebookData[cat.id] = { cols, rows };

    // Ensure all students have rows
    scoresStudents.forEach(s => {
      const row = Array.isArray(rows[s]) ? rows[s].slice(0, MAX_COLS) : [];
      while (row.length < cols.length) row.push('');
      rows[s] = row;
    });
  });

  // Existing values in the selected period sheet are the starting values for
  // the gradebook. Keep locally saved values when the sheet cell is blank.
  if (sheetGradebook?.scores) {
    CATEGORIES.forEach(cat => {
      const sheetMaxScores = sheetGradebook.maxScores?.[cat.id] || [];
      sheetMaxScores.slice(0, MAX_COLS).forEach((value, index) => {
        // The spreadsheet is the source of truth for perfect scores.
        if (value !== '') {
          gradebookData[cat.id].cols[index].max = value;
        }
      });

      const sheetRows = sheetGradebook.scores[cat.id] || {};
      scoresStudents.forEach(student => {
        const sheetRow = sheetRows[normalizeStudentName(student)];
        if (!Array.isArray(sheetRow)) return;
        const localRow = gradebookData[cat.id].rows[student];
        sheetRow.slice(0, MAX_COLS).forEach((value, index) => {
          if (value !== '') localRow[index] = value;
        });
      });
    });
  }

  const cls = classList.find(c => c.id === currentClassId);
  const infoEl = document.getElementById('scores-class-info');
  if (infoEl) {
    infoEl.textContent = `${scoresStudents.length} students loaded`;
    infoEl.classList.remove('hidden');
  }

  // Show GSheets map button if script URL is saved
  const mapBtn = document.getElementById('scores-gsheets-map-btn');
  const scriptUrl = localStorage.getItem(SCRIPT_URL_KEY);
  if (mapBtn && scriptUrl) mapBtn.style.display = 'inline-flex';

  document.getElementById('scores-workspace').classList.remove('hidden');
  currentCat = 'Quiz';
  renderCategoryTabs();
  renderGradebookGrid();
  renderScoreHistory();
  showToast(`✅ ${scoresStudents.length} students loaded`);
}

function changeScorePeriod() {
  const select = document.getElementById('scores-period-select');
  currentPeriod = PERIODS.includes(select?.value) ? select.value : DEFAULT_PERIOD;
  localStorage.setItem('gv_current_period', currentPeriod);

  if (currentClassId) loadClassForScores();
}

/* ─── CATEGORY TABS ─── */
function renderCategoryTabs() {
  const container = document.getElementById('gradebook-cat-tabs');
  container.innerHTML = CATEGORIES.map(cat => `
    <button
      class="gradebook-cat-btn ${currentCat === cat.id ? 'active' : ''}"
      onclick="switchCategory('${cat.id}')"
    >${cat.label}</button>
  `).join('');
}

function switchCategory(catId) {
  currentCat = catId;
  renderCategoryTabs();
  renderGradebookGrid();
  const cat = CATEGORIES.find(c => c.id === catId);
  document.getElementById('gradebook-cat-title').textContent = (cat?.emoji || '') + ' ' + (cat?.label || catId);
}

function closeGradebookWorkspace() {
  currentClassId = '';
  currentSheetTabName = '';
  scoresStudents = [];
  document.getElementById('scores-workspace').classList.add('hidden');
  const classSelect = document.getElementById('scores-class-select');
  if (classSelect) classSelect.value = '';
  renderScoreHistory();
}

/* ─── GRADEBOOK GRID ─── */
function renderGradebookGrid() {
  const data  = gradebookData[currentCat];
  if (!data) return;
  const cols  = data.cols;
  const table = document.getElementById('gradebook-table');
  const addColumnBtn = document.getElementById('add-gradebook-column-btn');
  if (addColumnBtn) {
    addColumnBtn.disabled = cols.length >= MAX_COLS;
    addColumnBtn.title = cols.length >= MAX_COLS
      ? 'Maximum of 4 scores per category'
      : 'Add score column';
  }

  let html = '<thead>';

  // Header row: student names plus four maximum-score inputs.
  html += '<tr>';
  html += `<th class="gb-name-col">NAMES</th>`;
  cols.forEach((col, ci) => {
    html += `
      <th class="gb-col-header">
        <div class="gb-column-label">Score ${ci + 1}</div>
        <input class="gb-max-input" type="number" value="${escapeHTML(String(col.max))}"
          placeholder="Max score" min="0"
          aria-label="Maximum score for ${escapeHTML(col.name)}"
          oninput="updateColMax(${ci}, this.value)" />
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
  if (data.cols.length >= MAX_COLS) {
    showToast('⚠️ Maximum of 4 scores per category.');
    return;
  }
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
  const selectedCategory = CATEGORIES.find(cat => cat.id === currentCat);
  const categoryLabel = selectedCategory?.label || currentCat;
  showToast(`Saving ${currentPeriod} ${categoryLabel} scores...`);

  // Save to localStorage, separated by class and grading period.
  let allData = JSON.parse(localStorage.getItem(GRADEBOOK_KEY) || '{}');
  let periodData = JSON.parse(localStorage.getItem(PERIOD_DATA_KEY) || '{}');
  if (!periodData[currentClassId]) periodData[currentClassId] = {};
  periodData[currentClassId][currentPeriod] = gradebookData;
  localStorage.setItem(PERIOD_DATA_KEY, JSON.stringify(periodData));
  // Keep the original key updated for legacy Prelim data.
  if (currentPeriod === DEFAULT_PERIOD) {
    allData[currentClassId] = gradebookData;
    localStorage.setItem(GRADEBOOK_KEY, JSON.stringify(allData));
  }
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
      await window._firestoreSetDoc(ref, { data: allData, periods: periodData }, { merge: true });
      showToast('✅ Synced to Cloud!');
    } catch(e) {
      console.warn('Cloud sync failed:', e);
      showToast('⚠️ Saved locally — cloud sync failed.');
    }
  }

  // Write the selected category to the selected grading-period sheet tab.
  let sheetResult = null;
  if (localStorage.getItem(SCRIPT_URL_KEY)) {
    sheetResult = await writeGradebookToSheet();
  }

  if (sheetResult?.success) {
    showToast(`✅ ${currentPeriod} ${categoryLabel} scores saved and synced to Google Sheets.`);
  } else if (sheetResult) {
    const detail = sheetResult.errors?.[0] ? ` ${sheetResult.errors[0]}` : '';
    showToast(`⚠️ Saved in the portal, but Google Sheets sync failed.${detail}`);
  } else {
    showToast(`✅ ${currentPeriod} ${categoryLabel} scores saved locally.`);
  }

  renderScoreHistory();
}

/* ════════════════════════════════════════════════
   GOOGLE SHEETS APPS SCRIPT
   ════════════════════════════════════════════════ */

function saveGSheetsScriptUrl() {
  const val = document.getElementById('gsheets-script-url-input').value.trim();
  if (!val) { showToast('❌ Please enter a Web App URL.'); return; }
  localStorage.setItem(SCRIPT_URL_KEY, val);
  showToast('✅ Web App URL saved!');
  document.getElementById('gsheets-settings-status').innerHTML =
    '<span style="color:var(--green);">✅ Saved. Auto-sync is active.</span>';
}

function initGSheetsSettings() {
  const input = document.getElementById('gsheets-script-url-input');
  const status = document.getElementById('gsheets-settings-status');
  const savedUrl = localStorage.getItem(SCRIPT_URL_KEY) || '';
  if (input) input.value = savedUrl;
  if (status) {
    status.innerHTML = savedUrl
      ? '<span style="color:var(--green);">✅ Saved. Auto-sync is active.</span>'
      : '';
  }
}

function updateGSheetsUI() {
  const scriptUrl = localStorage.getItem(SCRIPT_URL_KEY);
  const pill       = document.getElementById('gsheets-status-pill');
  const connectBtn = document.getElementById('gsheets-connect-btn'); // reusing button ID

  if (scriptUrl) {
    if (pill) { pill.classList.remove('hidden'); pill.style.display = 'flex'; }
    if (connectBtn) connectBtn.style.display = 'none'; // No connect needed for Apps Script
  } else {
    if (pill) pill.classList.add('hidden');
    if (connectBtn) {
      connectBtn.style.display = 'inline-flex';
      connectBtn.textContent = '❌ Sheets not configured';
      connectBtn.onclick = () => showPage('settings');
    }
  }
}

// Remove old OAuth functions
function connectGoogleSheets() {
  showPage('settings');
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

/* ─── WRITE TO GOOGLE SHEETS VIA APPS SCRIPT ─── */
function getSheetScoreHeaders(categoryId) {
  const prefixes = { Quiz: 'Q', Oral: 'O', Activity: 'G', Exam: 'E' };
  const prefix = prefixes[categoryId] || categoryId;
  return [1, 2, 3, 4].map(number => prefix + number);
}

async function writeGradebookToSheet() {
  const scriptUrl = localStorage.getItem(SCRIPT_URL_KEY);
  if (!scriptUrl) return { success: false, errors: ['Apps Script URL is not configured.'] };

  const cls = classList.find(c => c.id === currentClassId);
  if (!cls) return { success: false, errors: ['No class is selected.'] };

  const sheetId = extractSheetId(cls.url);
  if (!sheetId) return { success: false, errors: ['Could not extract the Google Sheet ID.'] };

  let writeCount = 0;
  const errors = [];
  const categoriesToWrite = CATEGORIES.filter(cat => cat.id === currentCat);

  for (const cat of categoriesToWrite) {
    // Preserve the exact capitalization/spelling from the workbook, such as
    // "SemiFinal", because Apps Script sheet lookup is case-sensitive.
    const tabName = currentSheetTabName || currentPeriod;

    const catData = gradebookData[cat.id];
    if (!catData) continue;

    // Use the actual labels in the class-record template so Apps Script can
    // update Q1-Q4/O1-O4/G1-G4/E1-E4 instead of creating new columns.
    const sheetHeaders = getSheetScoreHeaders(cat.id);
    const studentScores = {};
    scoresStudents.forEach(student => {
      studentScores[normalizeStudentName(student)] = catData.rows[student] || Array(catData.cols.length).fill('');
    });

    // Prepare payload for Apps Script
    const payload = {
      sheetId: sheetId,
      tabName: tabName,
      sheetName: tabName,
      period: currentPeriod,
      category: cat.id,
      categoryId: cat.id,
      headers: sheetHeaders,
      scoreHeaders: sheetHeaders,
      columnHeaders: sheetHeaders,
      maxScores: catData.cols.map(c => c.max || ''),
      perfectScores: catData.cols.map(c => c.max || ''),
      studentNames: scoresStudents,
      studentScores,
      scores: studentScores,
      scoresByStudent: studentScores
    };

    try {
      // Send as plain text to avoid CORS OPTIONS preflight block in Apps Script
      const fetchResp = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });

      if (!fetchResp.ok) {
        errors.push(`The ${currentPeriod} sheet tab returned an HTTP error.`);
        continue;
      }
      
      const responseText = await fetchResp.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch {
        errors.push('Apps Script returned an invalid response instead of JSON.');
        continue;
      }

      const reportedWrites = [result.writeCount, result.updated, result.updatedRows, result.updatedCells]
        .find(value => value !== undefined && value !== null);
      const hasConfirmedWrite = reportedWrites !== undefined && Number(reportedWrites) > 0;

      if (hasConfirmedWrite) {
        writeCount++;
      } else {
        console.warn('Apps Script error:', result.error);
        const detail = typeof result.error === 'string'
          ? result.error
          : result.error ? JSON.stringify(result.error) : '';
        errors.push(detail || 'The Apps Script did not confirm any changed cells. Redeploy the matching Code.gs handler.');
      }
    } catch (err) {
      console.error('Fetch error:', err);
      errors.push('Could not connect to the Apps Script deployment.');
    }
  }

  return {
    success: writeCount === categoriesToWrite.length && writeCount > 0,
    writeCount,
    errors
  };
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
  const tbody = document.getElementById('scores-history-tbody');

  // Do not expose any student's score history until a class is selected.
  if (!currentClassId) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--muted); padding:2rem;">Select a class above to view score history.</td></tr>`;
    return;
  }

  let entries = getAllScores().filter(e => e.classId === currentClassId);
  entries.sort((a, b) => new Date(b.date) - new Date(a.date));

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
  if (!currentClassId) {
    showToast('Select a class first.');
    return;
  }

  const cls = classList.find(c => c.id === currentClassId);
  const msg = `Delete all score history for ${cls?.name || 'this class'}?`;
  if (!confirm(msg)) return;

  let entries = getAllScores().filter(e => e.classId !== currentClassId);

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
  if (!currentClassId) { showToast('Select a class first.'); return; }
  const entries = getAllScores().filter(e => e.classId === currentClassId);
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
