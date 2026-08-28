/* ═══════════════════════════════════════════════
   GRADE VIEWER — SCORE RECORDER
   ═══════════════════════════════════════════════ */

const SCORES_KEY = 'gv_scores';

let scoresStudents    = []; // full student list for current class
let scoresCurrentTab  = 'individual';
let scoresInputMap    = {}; // studentName → score input value (in-progress)

/* ─── NAV INIT ─── */
document.getElementById('nav-scores').addEventListener('click', () => {
  // Populate class dropdown
  const sel = document.getElementById('scores-class-select');
  sel.innerHTML = '<option value="">-- Select a Class --</option>' +
    classList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');

  // Populate history filter
  const hf = document.getElementById('history-class-filter');
  hf.innerHTML = '<option value="">All Classes</option>' +
    classList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');

  renderScoreHistory();
});

/* ─── LOAD CLASS STUDENTS ─── */
async function loadClassForScores() {
  const classId = document.getElementById('scores-class-select').value;
  document.getElementById('scores-workspace').classList.add('hidden');
  if (!classId) return;

  const btn = document.getElementById('scores-class-select');
  btn.disabled = true;
  showToast('Loading students…');

  scoresStudents = await fetchStudentsForClass(classId);
  btn.disabled   = false;

  if (!scoresStudents.length) {
    showToast('❌ No students found in this class sheet.');
    return;
  }

  const cls = classList.find(c => c.id === classId);
  document.getElementById('scores-class-label').textContent = cls?.name || classId;

  scoresInputMap = {};
  scoresStudents.forEach(s => { scoresInputMap[s] = ''; });

  document.getElementById('scores-workspace').classList.remove('hidden');
  updateEntryMeta();
  renderScoreTable();
  renderGroupScoring();
  showToast(`✅ ${scoresStudents.length} students loaded`);
}

function updateEntryMeta() {
  const cat  = document.getElementById('scores-category').value;
  const name = document.getElementById('scores-activity-name').value || '—';
  const max  = document.getElementById('scores-max-score').value || '100';
  document.getElementById('scores-entry-meta').textContent =
    `${cat} · ${name} · Max: ${max}`;
}

/* ─── INDIVIDUAL TAB ─── */
function renderScoreTable(filter = '') {
  const max  = parseFloat(document.getElementById('scores-max-score').value) || 100;
  const tbody = document.getElementById('scores-tbody');
  const lower = filter.toLowerCase();

  const visible = scoresStudents.filter(s =>
    !lower || s.toLowerCase().includes(lower)
  );

  tbody.innerHTML = visible.map((s, idx) => {
    const val = scoresInputMap[s] ?? '';
    const pct = val !== '' ? Math.round((parseFloat(val) / max) * 100) : '—';
    const pctColor = typeof pct === 'number'
      ? pct >= 75 ? 'var(--green)' : pct >= 60 ? 'var(--amber)' : 'var(--red)'
      : 'var(--muted)';
    const remark = typeof pct === 'number'
      ? pct >= 75 ? 'Passed' : 'Failed'
      : '—';

    return `
      <tr id="score-row-${idx}">
        <td style="color:var(--muted); font-size:0.8rem;">${idx + 1}</td>
        <td style="font-weight:500;">${escapeHTML(s)}</td>
        <td>
          <div style="display:flex; align-items:center; gap:0.4rem;">
            <input
              type="number"
              class="score-input form-input"
              style="width:90px; padding:0.35rem 0.5rem; text-align:center;"
              value="${escapeHTML(String(val))}"
              min="0"
              max="${max}"
              placeholder="—"
              oninput="onScoreInput('${escapeHTML(s)}', this.value)"
              onkeydown="scoreInputKeyNav(event, ${idx})"
              id="sinput-${idx}"
            />
            <span style="color:var(--muted); font-size:0.75rem;">/ ${max}</span>
          </div>
        </td>
        <td style="color:${pctColor}; font-weight:600;">${typeof pct === 'number' ? pct + '%' : pct}</td>
        <td style="color:${pctColor}; font-size:0.8rem;">${remark}</td>
      </tr>
    `;
  }).join('');

  // Re-focus after re-render if search is active
}

function onScoreInput(studentName, val) {
  scoresInputMap[studentName] = val;
  // Update % and remark live for this row
  const max = parseFloat(document.getElementById('scores-max-score').value) || 100;
  const idx = scoresStudents.indexOf(studentName);
  if (idx < 0) return;
  const pct = val !== '' ? Math.round((parseFloat(val) / max) * 100) : null;
  const pctCell = document.querySelector(`#score-row-${idx} td:nth-child(4)`);
  const remCell = document.querySelector(`#score-row-${idx} td:nth-child(5)`);
  if (!pctCell) return;
  if (pct === null) {
    pctCell.textContent = '—'; pctCell.style.color = 'var(--muted)';
    remCell.textContent = '—'; remCell.style.color = 'var(--muted)';
  } else {
    const color = pct >= 75 ? 'var(--green)' : pct >= 60 ? 'var(--amber)' : 'var(--red)';
    pctCell.textContent = pct + '%'; pctCell.style.color = color;
    remCell.textContent = pct >= 75 ? 'Passed' : 'Failed'; remCell.style.color = color;
  }
}

// Tab key / arrow key navigation between inputs
function scoreInputKeyNav(event, idx) {
  if (event.key === 'Enter' || event.key === 'ArrowDown') {
    event.preventDefault();
    const next = document.getElementById('sinput-' + (idx + 1));
    if (next) next.focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    const prev = document.getElementById('sinput-' + (idx - 1));
    if (prev) prev.focus();
  }
}

function filterScoresTable() {
  const q = document.getElementById('scores-search').value;
  updateEntryMeta();
  renderScoreTable(q);
}

// Set all students the same score
function setAllScores() {
  const max = document.getElementById('scores-max-score').value || '100';
  const val = prompt(`Set the same score for ALL ${scoresStudents.length} students (max ${max}):`);
  if (val === null || val.trim() === '') return;
  scoresStudents.forEach(s => { scoresInputMap[s] = val.trim(); });
  renderScoreTable(document.getElementById('scores-search').value);
  if (scoresCurrentTab === 'group') renderGroupScoring();
}

function copyScoresColumn() {
  if (scoresStudents.length === 0) {
    showToast('❌ No students loaded.');
    return;
  }
  
  // Format as a single column of scores matching the alphabetical list of students
  // Just TSV with one column
  let tsv = "";
  scoresStudents.forEach(s => {
    const val = scoresInputMap[s] ?? '';
    tsv += `${val}\n`;
  });
  
  navigator.clipboard.writeText(tsv).then(() => {
    showToast('📋 Copied! Paste directly into your Sheet column.');
  }).catch(err => {
    console.error(err);
    showToast('❌ Failed to copy to clipboard.');
  });
}

/* ─── GROUP TAB ─── */
function renderGroupScoring() {
  const classId = document.getElementById('scores-class-select').value;
  const saved = JSON.parse(localStorage.getItem('gv_groups') || '{}');
  const groups = saved[classId];
  const container = document.getElementById('scores-group-list');

  if (!groups || !groups.length) {
    container.innerHTML = `
      <div style="text-align:center; padding:2rem; color:var(--muted);">
        <div style="font-size:2rem; margin-bottom:0.5rem;">👥</div>
        No saved groups for this class yet.<br>
        Go to the <strong>Groups Manager</strong> to create groups first.
      </div>`;
    return;
  }

  const max = parseFloat(document.getElementById('scores-max-score').value) || 100;

  container.innerHTML = groups.map((g, gidx) => `
    <div class="panel" style="border:1px solid var(--border2);">
      <div class="panel-header" style="background:rgba(108,99,255,0.08);">
        <div class="panel-title">${escapeHTML(g.name)}</div>
        <div style="display:flex; align-items:center; gap:0.75rem;">
          <input
            type="number"
            class="form-input"
            style="width:100px; padding:0.35rem 0.6rem; text-align:center;"
            placeholder="Group score"
            min="0" max="${max}"
            id="group-score-input-${gidx}"
            oninput="applyGroupScore(${gidx}, this.value)"
          />
          <span style="color:var(--muted); font-size:0.8rem;">/ ${max}</span>
        </div>
      </div>
      <div style="padding:0.75rem 1.25rem; display:flex; flex-wrap:wrap; gap:0.5rem;">
        ${g.students.map(s => `
          <div class="unassigned-student" style="display:flex; align-items:center; gap:0.5rem;">
            <span>${escapeHTML(s)}</span>
            <span style="color:var(--accent); font-size:0.8rem;" id="gscore-${gidx}-${escapeAttrId(s)}">
              ${scoresInputMap[s] !== '' && scoresInputMap[s] !== undefined ? scoresInputMap[s] + '/' + max : '—'}
            </span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function applyGroupScore(gidx, val) {
  const classId = document.getElementById('scores-class-select').value;
  const saved   = JSON.parse(localStorage.getItem('gv_groups') || '{}');
  const groups  = saved[classId];
  if (!groups?.[gidx]) return;

  groups[gidx].students.forEach(s => {
    scoresInputMap[s] = val;
    // Update badge
    const max = document.getElementById('scores-max-score').value || '100';
    const el = document.getElementById('gscore-' + gidx + '-' + escapeAttrId(s));
    if (el) el.textContent = val ? val + '/' + max : '—';
  });
  // Also update individual table if visible
  if (scoresCurrentTab === 'individual') renderScoreTable(document.getElementById('scores-search').value);
}

function escapeAttrId(s) {
  return s.replace(/[^a-zA-Z0-9]/g, '_');
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ─── TABS ─── */
function switchScoresTab(tab) {
  scoresCurrentTab = tab;
  const isIndividual = tab === 'individual';
  document.getElementById('scores-individual-view').classList.toggle('hidden', !isIndividual);
  document.getElementById('scores-group-view').classList.toggle('hidden', isIndividual);
  document.getElementById('scores-tab-individual').className = isIndividual ? 'btn btn-primary' : 'btn btn-ghost';
  document.getElementById('scores-tab-group').className      = isIndividual ? 'btn btn-ghost'   : 'btn btn-primary';
  if (!isIndividual) renderGroupScoring();
}

/* ─── SAVE ─── */
async function saveAllScores() {
  const classId  = document.getElementById('scores-class-select').value;
  const category = document.getElementById('scores-category').value;
  const activity = (document.getElementById('scores-activity-name').value || '').trim() || category;
  const max      = parseFloat(document.getElementById('scores-max-score').value) || 100;
  const date     = new Date().toISOString();

  const cls = classList.find(c => c.id === classId);

  // Build entries for students who have a score entered
  const entries = [];
  scoresStudents.forEach(student => {
    const raw = scoresInputMap[student];
    if (raw === '' || raw === undefined || raw === null) return;
    const score = parseFloat(raw);
    if (isNaN(score)) return;
    entries.push({
      id:       'sc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      classId,
      className: cls?.name || classId,
      student,
      category,
      activity,
      score,
      max,
      date,
    });
  });

  if (!entries.length) {
    showToast('❌ No scores entered yet.');
    return;
  }

  // Save locally first
  try {
    const local = JSON.parse(localStorage.getItem(SCORES_KEY) || '[]');
    local.push(...entries);
    localStorage.setItem(SCORES_KEY, JSON.stringify(local));
    showToast(`💾 ${entries.length} scores saved locally.`);
  } catch(e) {
    console.error('Local save failed:', e);
  }

  // Sync to Firebase
  if (typeof _db !== 'undefined' && _db) {
    try {
      const ref  = window._firestoreDoc(_db, FIRESTORE_COL, 'scores');
      const snap = await window._firestoreGetDoc(ref);
      const exists = typeof snap.exists === 'function' ? snap.exists() : snap.exists;
      const existing = exists ? (snap.data().entries || []) : [];
      existing.push(...entries);
      await window._firestoreSetDoc(ref, { entries: existing });
      showToast(`✅ ${entries.length} scores synced to Cloud!`);
    } catch(err) {
      console.warn('Cloud sync failed:', err);
      showToast('⚠️ Saved locally — cloud sync failed.');
    }
  }

  renderScoreHistory();
}

/* ─── HISTORY ─── */
function getAllScores() {
  try {
    return JSON.parse(localStorage.getItem(SCORES_KEY) || '[]');
  } catch { return []; }
}

function renderScoreHistory() {
  const filterClassId = document.getElementById('history-class-filter')?.value || '';
  let entries = getAllScores();

  if (filterClassId) {
    entries = entries.filter(e => e.classId === filterClassId);
  }

  // Sort newest first
  entries.sort((a, b) => new Date(b.date) - new Date(a.date));

  const tbody = document.getElementById('scores-history-tbody');
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--muted); padding:2rem;">No scores recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map((e, idx) => {
    const d    = new Date(e.date);
    const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const pct  = e.max ? Math.round((e.score / e.max) * 100) : '—';
    const pctColor = typeof pct === 'number'
      ? pct >= 75 ? 'var(--green)' : pct >= 60 ? 'var(--amber)' : 'var(--red)'
      : 'var(--muted)';
    return `
      <tr>
        <td style="font-size:0.75rem; color:var(--muted); white-space:nowrap;">${dateStr}</td>
        <td style="font-size:0.8rem;">${escapeHTML(e.className || e.classId || '—')}</td>
        <td style="font-weight:500;">${escapeHTML(e.student || '—')}</td>
        <td><span class="key-badge locked" style="font-size:0.7rem;">${escapeHTML(e.category || '—')}</span></td>
        <td style="font-size:0.85rem;">${escapeHTML(e.activity || '—')}</td>
        <td style="font-weight:700; color:${pctColor};">${e.score}</td>
        <td style="color:var(--muted);">${e.max || '—'}</td>
        <td style="text-align:right;">
          <button class="btn btn-danger btn-sm" onclick="deleteScoreEntry('${escapeAttr(e.id || '')}', ${idx})">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');
}

function deleteScoreEntry(id, fallbackIdx) {
  if (!confirm('Delete this score entry?')) return;
  let entries = getAllScores();
  if (id) {
    entries = entries.filter(e => e.id !== id);
  } else {
    entries.splice(fallbackIdx, 1);
  }
  localStorage.setItem(SCORES_KEY, JSON.stringify(entries));
  showToast('🗑️ Score deleted.');
  renderScoreHistory();
}

/* ─── EXPORT CSV ─── */
function exportScoresCSV() {
  const filterClassId = document.getElementById('history-class-filter')?.value || '';
  let entries = getAllScores();
  if (filterClassId) entries = entries.filter(e => e.classId === filterClassId);

  if (!entries.length) { showToast('No scores to export.'); return; }

  const header = ['Date','Class','Student','Category','Activity','Score','Max','Percent'];
  const rows   = entries.map(e => {
    const pct = e.max ? Math.round((e.score / e.max) * 100) : '';
    return [
      new Date(e.date).toLocaleString(),
      e.className || e.classId || '',
      e.student || '',
      e.category || '',
      e.activity || '',
      e.score,
      e.max || '',
      pct,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const csv  = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'scores_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('📥 CSV downloaded!');
}
