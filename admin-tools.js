/* ═══════════════════════════════════════════════
   GRADE VIEWER — ADMIN TOOLS (Groups & Picker)
   ═══════════════════════════════════════════════ */

let currentStudents = [];
let currentGroups = [];
let pickerPool = [];
let pickerMode = 'normal';
let wheelAngle = 0;
let wheelSpinning = false;
let wheelReqFrame;
let groupsEditMode = false;
let unassignedPool = [];

/* ─── FULLSCREEN ─── */
function toggleFullscreen(pageId) {
  const page = document.getElementById(pageId);
  if (page) page.classList.toggle('fullscreen-mode');
}

/* ─── SHARED: FETCH STUDENTS ─── */
function extractSheetId(url) {
  const match = String(url || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

function isHeader(str) {
  const s = str.toLowerCase().trim();
  if (['student\'s name', 'name', 'student name', 'no.', 'no', '#'].includes(s)) return true;
  if (s.startsWith('instructor') || s.startsWith('average') || s.startsWith('total')
    || s.startsWith('subject') || s.startsWith('section') || s.startsWith('class')
    || s.startsWith('school') || s.startsWith('teacher') || s.startsWith('semester')
    || s.startsWith('grade level') || s.startsWith('quarter') || s.endsWith(':')
    || s.includes('percentage distribution') || s.includes('score entry')
    || s === 'remarks' || s === 'status') return true;
  if (s.length < 3) return true;
  return false;
}

function isNumeric(str) {
  return /^\d+$/.test(String(str).trim());
}

function looksLikeName(str) {
  if (!str || str.length < 3) return false;
  const s = str.trim();
  const lower = s.toLowerCase();

  // Do not treat class-record metadata as students.
  if (/\b\d{1,2}:\d{2}\s*(am|pm)?\b/i.test(s)) return false;
  if (/\b(am|pm)\b/i.test(s) && /\d/.test(s)) return false;
  if (/^(room|days?|teacher|subject|time|code)\s*:/i.test(s)) return false;
  if (/^\d[\d\s:./-]*$/.test(s)) return false;
  
  if (isHeader(s) || isNumeric(s)) return false;
  
  // Exclude common labels
  if (['male','female','total','average','mean','sd','remarks'].includes(lower)) return false;
  
  // Must be mostly uppercase (Filipino class record format)
  const alpha = s.replace(/[^a-zA-Z]/g, '');
  if (alpha.length === 0) return false;
  const upperRatio = (s.replace(/[^A-Z]/g, '').length) / alpha.length;
  if (upperRatio < 0.5) return false;
  
  // Must have space or comma
  if (!s.includes(' ') && !s.includes(',')) return false;
  
  return true;
}

/* Scans a row for the best student-name candidate near a fixed column */
function findNameInRow(row, fixedCol) {
  if (fixedCol >= 0 && fixedCol < row.length) {
    const v = String(row[fixedCol] || '').trim();
    if (looksLikeName(v)) return v;
  }
  const start = Math.max(0, (fixedCol >= 0 ? fixedCol : 1) - 1);
  const end   = Math.min(row.length - 1, (fixedCol >= 0 ? fixedCol : 1) + 3);
  for (let ci = start; ci <= end; ci++) {
    if (ci === fixedCol) continue;
    const v = String(row[ci] || '').trim();
    if (looksLikeName(v)) return v;
  }
  return '';
}

function findAnyNameInRow(row) {
  return row.map(value => String(value || '').trim()).find(looksLikeName) || '';
}

function looksLikeRosterName(value) {
  const text = String(value || '').trim();
  // The class-record roster uses LAST NAME, FIRST NAME formatting. Requiring
  // the comma prevents codes, schedules, subjects, and attendance labels from
  // being treated as students.
  return looksLikeName(text) && text.includes(',') && !/\d/.test(text);
}

function findRosterNameInRow(row, nameCol) {
  const value = String(row[nameCol] || '').trim();
  return looksLikeRosterName(value) ? value : '';
}

function normalizeStudentName(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

const workbookCache = new Map();
let lastSpreadsheetLoadError = '';

async function fetchWorkbookForClass(classId) {
  lastSpreadsheetLoadError = '';
  const cls = classList.find(c => c.id === classId);
  if (!cls || !cls.url) {
    lastSpreadsheetLoadError = 'This class does not have a Google Sheets link yet.';
    return null;
  }

  const sheetId = extractSheetId(cls.url);
  if (!sheetId) {
    lastSpreadsheetLoadError = 'The class link is not a Google Sheets URL. Open the class settings and paste the spreadsheet link, not the Apps Script deployment link.';
    return null;
  }
  if (workbookCache.has(sheetId)) return workbookCache.get(sheetId);

  try {
    const fetchUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
    const res = await fetch(fetchUrl);
    if (!res.ok) {
      lastSpreadsheetLoadError = `The Google Sheet could not be read (HTTP ${res.status}). Check that the class link is a Google Sheets link and that the sheet is shared for viewing.`;
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    if (!wb.SheetNames.length) return null;
    workbookCache.set(sheetId, wb);
    return wb;
  } catch (err) {
    console.error('Error fetching spreadsheet:', err);
    lastSpreadsheetLoadError = 'The Google Sheet could not be read. Check the class link, sharing permission, and internet connection.';
    return null;
  }
}

function getSheetRows(wb, sheetName) {
  const sheet = wb?.Sheets?.[sheetName];
  return sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) : [];
}

function findNameHeader(rows) {
  let fallback = null;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const cells = rows[r].map(c => String(c).toLowerCase().trim());
    const exact = cells.findIndex(c =>
      c === 'name' || c === 'names' || c === 'student' || c === 'students'
      || (c.includes('student') && c.includes('name'))
      || (c.includes('learner') && c.includes('name'))
    );
    if (exact >= 0) return { row: r, col: exact };

    // Keep a weaker match as a fallback for differently formatted templates,
    // but prefer an actual name header when one exists later in the sheet.
    if (!fallback) {
      const idx = cells.findIndex(c => c.includes('name') || c.includes('student'));
      if (idx >= 0) fallback = { row: r, col: idx };
    }
  }
  return fallback || { row: -1, col: 0 };
}

function collectNamesFromWorkbook(wb) {
  const names = new Map();

  (wb?.SheetNames || []).forEach(sheetName => {
    const rows = getSheetRows(wb, sheetName);
    const header = findNameHeader(rows);
    if (header.row < 0) return;

    const firstDataRow = header.row >= 0 ? header.row + 1 : 0;
    for (let r = firstDataRow; r < rows.length; r++) {
      const name = findRosterNameInRow(rows[r], header.col);
      if (name) names.set(normalizeStudentName(name), name);
    }
  });

  return Array.from(names.values()).sort();
}

async function fetchStudentsForClass(classId) {
  const wb = await fetchWorkbookForClass(classId);
  return collectNamesFromWorkbook(wb);
}

function normalizeSheetName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findGradingPeriodSheet(wb, period) {
  const aliases = {
    Prelim: ['prelim', 'preliminary'],
    Midterm: ['midterm', 'mid'],
    Semifinal: ['semifinal', 'semifinals', 'semi'],
    Final: ['final', 'finals']
  };
  const wanted = (aliases[period] || [period]).map(normalizeSheetName);
  const names = (wb?.SheetNames || []).map(name => ({
    name,
    normalized: normalizeSheetName(name)
  }));
  return names.find(item => wanted.includes(item.normalized))?.name || '';
}

function scoreValueFromCell(value) {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  const text = String(value).trim();
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

function findScoreColumns(rows, preferredRow) {
  const prefixes = { Quiz: 'Q', Oral: 'O', Activity: 'G', Exam: 'E' };
  const result = {};

  const rowOrder = [];
  const center = Number.isInteger(preferredRow) ? preferredRow : 0;
  for (let distance = 0; distance < 20; distance++) {
    const before = center - distance;
    const after = center + distance;
    if (before >= 0 && !rowOrder.includes(before)) rowOrder.push(before);
    if (after < rows.length && !rowOrder.includes(after)) rowOrder.push(after);
  }

  Object.entries(prefixes).forEach(([category, prefix]) => {
    result[category] = [1, 2, 3, 4].map(number => {
      const wanted = prefix + number;
      for (const r of rowOrder) {
        if (r >= Math.min(rows.length, 20)) continue;
        for (let c = 0; c < rows[r].length; c++) {
          const cell = String(rows[r][c] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (cell === wanted) return c;
        }
      }
      return -1;
    });
  });

  return result;
}

function findLegacyExamColumn(rows, preferredRow, period) {
  const aliases = period === 'Final'
    ? ['F35', 'FINAL', 'EXAM']
    : period === 'Midterm'
      ? ['M35', 'MIDTERM', 'EXAM']
      : ['EXAM', 'E35'];
  const rowOrder = [];
  const center = Number.isInteger(preferredRow) ? preferredRow : 0;
  for (let distance = 0; distance < 20; distance++) {
    const before = center - distance;
    const after = center + distance;
    if (before >= 0 && !rowOrder.includes(before)) rowOrder.push(before);
    if (after < rows.length && !rowOrder.includes(after)) rowOrder.push(after);
  }
  for (const r of rowOrder) {
    if (r >= Math.min(rows.length, 20)) continue;
    for (let c = 0; c < rows[r].length; c++) {
      const cell = String(rows[r][c] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (aliases.includes(cell)) return c;
    }
  }
  return -1;
}

/* Read the selected period tab so existing spreadsheet scores appear in the gradebook. */
async function fetchGradebookForClass(classId, period) {
  const wb = await fetchWorkbookForClass(classId);
  if (!wb) return null;

  const students = collectNamesFromWorkbook(wb);
  const sheetName = findGradingPeriodSheet(wb, period);
  const scores = {};
  const maxScores = {};
  if (!sheetName) return { students, sheetName: '', scores, maxScores };

  const rows = getSheetRows(wb, sheetName);
  const header = findNameHeader(rows);
  const columns = findScoreColumns(rows, header.row);
  if (columns.Exam.every(column => column < 0)) {
    const legacyExamColumn = findLegacyExamColumn(rows, header.row, period);
    if (legacyExamColumn >= 0) columns.Exam[0] = legacyExamColumn;
  }
  Object.keys(columns).forEach(category => {
    scores[category] = {};
    maxScores[category] = ['', '', '', ''];
  });

  if (header.row < 0) return { students, sheetName, scores, maxScores };

  // Class-record templates place perfect scores on one or more non-student
  // rows below the activity labels. Read every non-student row so a metadata
  // row cannot prevent the max scores from being found.
  for (let r = header.row; r < rows.length; r++) {
    // Only the detected student-name column decides whether this is a student
    // row. Other cells may contain time, room, percentage, or header text.
    const nameCell = String(rows[r][header.col] || '').trim();
    if (looksLikeName(nameCell)) continue;
    Object.entries(columns).forEach(([category, categoryColumns]) => {
      categoryColumns.forEach((column, index) => {
        if (column < 0 || maxScores[category][index] !== '') return;
        const value = scoreValueFromCell(rows[r][column]);
        if (typeof value === 'number') maxScores[category][index] = value;
      });
    });
  }

  for (let r = header.row + 1; r < rows.length; r++) {
    const name = findRosterNameInRow(rows[r], header.col);
    if (!name) continue;
    const key = normalizeStudentName(name);

    Object.entries(columns).forEach(([category, categoryColumns]) => {
      const values = categoryColumns.map(column =>
        column >= 0 ? scoreValueFromCell(rows[r][column]) : ''
      );
      if (values.some(value => value !== '')) scores[category][key] = values;
    });
  }

  return { students, sheetName, scores, maxScores };
}

/* ═══════════════════════════════════════════════
   GROUPS MANAGER
   ═══════════════════════════════════════════════ */

// Initialize dropdown on tab load
document.getElementById('nav-groups').addEventListener('click', () => {
  const select = document.getElementById('group-class-select');
  select.innerHTML = '<option value="">-- Select a Class --</option>' + 
    classList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
});

let savedGroupsPageGroups = [];
let savedGroupsPageStudents = [];
let savedGroupsPageSheet = null;
let savedGroupsPageWorkbook = null;
const GROUP_SCORE_STORAGE_PERIOD = 'Groups';
const GROUP_SCORE_STORAGE_CATEGORY = 'Group';

function openSavedGroupsPage() {
  const source = document.getElementById('group-class-select');
  const select = document.getElementById('saved-groups-class-select');
  select.innerHTML = '<option value="">-- Select a Class --</option>' +
    classList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
  select.value = source.value || '';
  showPage('saved-groups');
  if (select.value) {
    loadSavedGroupsPage();
  } else {
    document.getElementById('saved-groups-workspace').classList.add('hidden');
    showToast('Select a class in Groups Manager first.');
  }
}

async function loadClassForGroups() {
  const classId = document.getElementById('group-class-select').value;
  if (!classId) return;

  const btn = document.getElementById('btn-load-groups');
  btn.textContent = 'Loading...';
  btn.disabled = true;

  currentStudents = await fetchStudentsForClass(classId);
  
  btn.textContent = 'Load Students';
  btn.disabled = false;

  if (currentStudents.length === 0) {
    showToast("❌ Could not find students in this class sheet.");
    document.getElementById('groups-workspace').classList.add('hidden');
    return;
  }

  // Show UI
  document.getElementById('groups-workspace').classList.remove('hidden');
  
  // Update labels
  const cls = classList.find(c => c.id === classId);
  if (cls) {
    document.getElementById('groups-class-name').textContent = cls.name;
  }
  document.getElementById('groups-student-count').textContent = currentStudents.length + ' students';
  
  // Try loading existing saved groups first
  const saved = JSON.parse(localStorage.getItem('gv_groups') || '{}');
  if (saved[classId] && saved[classId].length > 0) {
    const validNames = new Set(currentStudents.map(normalizeStudentName));
    currentGroups = saved[classId].map(group => ({
      ...group,
      students: (Array.isArray(group.students) ? group.students : [])
        .filter(student => validNames.has(normalizeStudentName(student)))
    }));
    
    // Find unassigned students (those in currentStudents but not in any group)
    const assignedSet = new Set();
    currentGroups.forEach(g => g.students.forEach(s => assignedSet.add(s)));
    unassignedPool = currentStudents.filter(s => !assignedSet.has(s));
    
    document.getElementById('unassigned-pool').classList.remove('hidden');
    document.getElementById('btn-spin-group').style.display = unassignedPool.length ? 'inline-flex' : 'none';
    document.getElementById('btn-add-group').style.display = 'inline-flex';
    document.getElementById('btn-reset-group').style.display = 'inline-flex';
    
    groupsEditMode = false;
    renderUnassigned();
    renderGroups();
    showToast(`✅ Loaded saved groups for ${cls?.name || 'class'}`);
  } else {
    // No saved groups, initialize empty
    currentGroups = [];
    unassignedPool = [...currentStudents];
    document.getElementById('unassigned-pool').classList.add('hidden'); // Hide pool until Set Up is clicked
    document.getElementById('btn-spin-group').style.display = 'none';
    document.getElementById('btn-add-group').style.display = 'none';
    document.getElementById('btn-reset-group').style.display = 'none';
    document.getElementById('groups-container').innerHTML = `
    <div style="grid-column: 1/-1; text-align:center; padding: 2rem; color:var(--muted);">
      Ready! Choose how to divide them and click Randomize.
    </div>
  `;
  }
}

// Instant auto-randomize (original behaviour) — no spin
function randomizeGroupsAuto() {
  if (currentStudents.length === 0) {
    showToast('❌ Load students first.');
    return;
  }

  const count = parseInt(document.getElementById('group-count-input').value) || 5;
  const mode  = document.getElementById('group-mode-select').value;

  const shuffled = [...currentStudents].sort(() => Math.random() - 0.5);
  currentGroups  = [];
  unassignedPool = [];

  let numGroups = count;
  if (mode === 'members') numGroups = Math.ceil(shuffled.length / count);

  for (let i = 0; i < numGroups; i++) {
    currentGroups.push({ id: 'group_' + i, name: 'Group ' + (i + 1), students: [] });
  }

  shuffled.forEach((student, idx) => {
    currentGroups[idx % numGroups].students.push(student);
  });

  // Show group action buttons
  document.getElementById('unassigned-pool').classList.add('hidden');
  document.getElementById('btn-spin-group').style.display = 'none';
  document.getElementById('btn-add-group').style.display  = 'inline-flex';
  document.getElementById('btn-reset-group').style.display = 'inline-flex';

  groupsEditMode = false;
  renderGroups();
  document.getElementById('groups-workspace').classList.remove('hidden');

  const cls = classList.find(c => c.id === document.getElementById('group-class-select').value);
  if (cls) document.getElementById('groups-class-name').textContent = cls.name;
  document.getElementById('groups-student-count').textContent =
    `${currentStudents.length} students — ${numGroups} groups`;
}

function resetGroups() {
  if (!confirm("Are you sure you want to reset all groups? This cannot be undone unless you reload.")) return;
  currentGroups = [];
  unassignedPool = [...currentStudents];
  document.getElementById('unassigned-pool').classList.add('hidden');
  document.getElementById('btn-spin-group').style.display = 'none';
  document.getElementById('btn-add-group').style.display = 'none';
  document.getElementById('btn-reset-group').style.display = 'none';
  document.getElementById('groups-container').innerHTML = '';
  showToast("🔄 Groups reset. Click 'Set Up' or 'Randomize' to start over.");
}

// Sets up empty group cards and puts everyone in unassigned pool
function initGroups() {
  if (currentStudents.length === 0) return;
  
  const count = parseInt(document.getElementById('group-count-input').value) || 5;
  const mode = document.getElementById('group-mode-select').value;
  
  let numGroups = count;
  if (mode === 'members') {
    numGroups = Math.ceil(currentStudents.length / count);
  }
  
  currentGroups = [];
  for (let i = 0; i < numGroups; i++) {
    currentGroups.push({ id: 'group_' + i, name: 'Group ' + (i + 1), students: [] });
  }
  
  unassignedPool = [...currentStudents];
  document.getElementById('unassigned-pool').classList.remove('hidden');
  document.getElementById('btn-spin-group').style.display = 'inline-flex';
  document.getElementById('btn-add-group').style.display = 'inline-flex';
  document.getElementById('btn-reset-group').style.display = 'inline-flex';
  
  groupsEditMode = false; // Start in locked mode
  renderGroups();
  renderUnassigned();
}

// Copy groups to clipboard in TSV format (Spreadsheet ready)
function copyGroupsForSheets() {
  if (currentGroups.length === 0) {
    showToast("❌ No groups to copy.");
    return;
  }
  
  // Format: Student Name \t Group Name
  // Or Group Name \t Student Names (comma separated)
  // Let's do a flat list matching the user's screenshot: All Students | Group Number | Group Members (implied by row)
  // Better format: Group Name \t Student Name (one per row)
  let tsv = "Group Name\tStudent Name\n";
  currentGroups.forEach(g => {
    if (g.students.length === 0) return;
    g.students.forEach(s => {
      tsv += `${g.name}\t${s}\n`;
    });
  });
  
  navigator.clipboard.writeText(tsv).then(() => {
    showToast("📋 Copied! Paste it directly into Google Sheets.");
  }).catch(err => {
    console.error(err);
    showToast("❌ Failed to copy to clipboard.");
  });
}

function addGroupBox() {
  const idx = currentGroups.length;
  currentGroups.push({ id: 'group_' + idx, name: 'Group ' + (idx + 1), students: [] });
  renderGroups();
}

function renderUnassigned() {
  document.getElementById('unassigned-count').textContent = unassignedPool.length;
  document.getElementById('unassigned-list').innerHTML = unassignedPool.map((s, idx) => `
    <div class="unassigned-student" draggable="true" ondragstart="dragUnassigned(event, ${idx})">
      ${escapeHTML(s)}
    </div>
  `).join('');
  
  if (unassignedPool.length === 0) {
    document.getElementById('btn-spin-group').style.display = 'none';
  }
}

function randomizeRemaining() {
  if (unassignedPool.length === 0 || currentGroups.length === 0) return;
  
  // Shuffle unassigned
  const shuffled = [...unassignedPool].sort(() => Math.random() - 0.5);
  
  // Sort groups by size so we add to smallest groups first
  let targetGroupIdx = 0;
  
  shuffled.forEach(student => {
    // Find index of group with fewest students
    let minStudents = 9999;
    let minIdx = 0;
    for (let i = 0; i < currentGroups.length; i++) {
      if (currentGroups[i].students.length < minStudents) {
        minStudents = currentGroups[i].students.length;
        minIdx = i;
      }
    }
    currentGroups[minIdx].students.push(student);
  });
  
  unassignedPool = [];
  renderUnassigned();
  renderGroups();
}

// Intense Spin for Groups
function spinToAssignGroup() {
  if (unassignedPool.length === 0) {
    showToast("No students left to assign!");
    return;
  }
  
  // Reuse Picker logic but for Groups
  pickerPool = [...unassignedPool];
  
  // Set up UI for wheel popup
  document.getElementById('picker-normal-view').classList.add('hidden');
  document.getElementById('picker-wheel-view').classList.remove('hidden');
  document.getElementById('picker-workspace').classList.remove('hidden');
  
  // Scroll to workspace
  document.getElementById('groups-workspace').scrollIntoView({ behavior: 'smooth' });
  
  // Hide normal wheel button, use programmatic spin
  wheelSpinning = true;
  document.getElementById('picker-winner-panel').classList.add('hidden');
  
  const spinTarget = (Math.random() * 3 + 3) * 2 * Math.PI; 
  let currentVelocity = 0.4;
  let deceleration = currentVelocity / 150; 
  
  function animate() {
    wheelAngle += currentVelocity;
    currentVelocity -= deceleration;
    drawWheel();
    
    if (currentVelocity > 0) {
      wheelReqFrame = requestAnimationFrame(animate);
    } else {
      wheelSpinning = false;
      const sliceAngle = (2 * Math.PI) / pickerPool.length;
      const normalizedAngle = (wheelAngle % (2 * Math.PI)); 
      
      let topAngle = (1.5 * Math.PI - normalizedAngle) % (2 * Math.PI);
      if (topAngle < 0) topAngle += 2 * Math.PI;
      const winnerIdx = Math.floor(topAngle / sliceAngle);
      
      const winnerName = pickerPool[winnerIdx];
      showWinnerGroup(winnerName, winnerIdx);
    }
  }
  
  // Inject a temporary canvas overlay over groups
  if (!document.getElementById('groups-spin-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'groups-spin-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:99999; display:flex; flex-direction:column; align-items:center; justify-content:center;';
    overlay.innerHTML = `
      <div style="color:#fff; font-size:2rem; font-family:'Outfit', sans-serif; font-weight:700; margin-bottom:1rem; letter-spacing:2px;">SPINNING...</div>
      <div style="position:relative; width:500px; height:500px;">
        <div style="position:absolute; top:-20px; left:50%; transform:translateX(-50%); width:0; height:0; border-left:25px solid transparent; border-right:25px solid transparent; border-top:40px solid var(--red); z-index:10;"></div>
        <canvas id="groups-wheel-canvas" width="500" height="500"></canvas>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  
  // Custom drawWheel for the overlay
  function drawWheel() {
    const canvas = document.getElementById('groups-wheel-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = cx - 10;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sliceAngle = (2 * Math.PI) / pickerPool.length;
    
    for (let i = 0; i < pickerPool.length; i++) {
      const startAngle = wheelAngle + (i * sliceAngle);
      const endAngle = startAngle + sliceAngle;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
      ctx.fill();
      ctx.stroke();
      
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(startAngle + sliceAngle / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#fff";
      ctx.font = pickerPool.length > 30 ? "12px sans-serif" : "16px sans-serif";
      let text = pickerPool[i];
      if (text.length > 20) text = text.substring(0, 18) + "...";
      ctx.fillText(text, radius - 15, 5);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, 2*Math.PI);
    ctx.fillStyle = "#222";
    ctx.fill();
  }
  
  animate();
}

function showWinnerGroup(winnerName, winnerIdx) {
  const overlay = document.getElementById('groups-spin-overlay');
  
  // Find smallest group
  let minStudents = 9999;
  let minIdx = 0;
  for (let i = 0; i < currentGroups.length; i++) {
    if (currentGroups[i].students.length < minStudents) {
      minStudents = currentGroups[i].students.length;
      minIdx = i;
    }
  }
  
  overlay.innerHTML = `
    <div style="background:var(--surface); padding:3rem; border-radius:1rem; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,0.8); border:2px solid var(--accent);">
      <div style="color:var(--accent); font-weight:700; letter-spacing:2px; margin-bottom:0.5rem;">STUDENT DRAWN</div>
      <div style="font-size:3rem; font-weight:800; margin-bottom:1.5rem; color:#fff; font-family:'Outfit', sans-serif;">${escapeHTML(winnerName)}</div>
      <div style="color:var(--muted); font-size:1.1rem; margin-bottom:2rem;">Assigned to <strong style="color:var(--text);">${escapeHTML(currentGroups[minIdx].name)}</strong></div>
      <button class="btn btn-primary" onclick="acceptGroupWinner(${winnerIdx}, ${minIdx})" style="font-size:1.2rem; padding:1rem 3rem; border-radius:50px;">✔ Continue</button>
    </div>
  `;
}

window.acceptGroupWinner = function(studentIdx, groupIdx) {
  const overlay = document.getElementById('groups-spin-overlay');
  if (overlay) overlay.remove();
  
  const student = unassignedPool.splice(studentIdx, 1)[0];
  currentGroups[groupIdx].students.push(student);
  
  renderUnassigned();
  renderGroups();
  
  if (unassignedPool.length > 0) {
    // Optionally trigger another spin automatically? 
    // Wait for user to click Spin again for better UX.
  }
}

function toggleEditGroups() {
  groupsEditMode = !groupsEditMode;
  renderGroups();
  showToast(groupsEditMode ? "✏️ Edit Mode ON" : "🔒 Edit Mode OFF");
}

function renderGroups() {
  const container = document.getElementById('groups-container');
  container.innerHTML = currentGroups.map((g, gidx) => `
    <div class="group-card ${groupsEditMode ? 'edit-mode' : ''}" ondragover="allowDrop(event)" ondrop="drop(event, ${gidx})">
      <div class="group-header" style="display:flex; align-items:center; gap:0.5rem;">
        <input type="text" class="group-name-input" value="${escapeHTML(g.name)}" 
               onchange="updateGroupName(${gidx}, this.value)" ${!groupsEditMode ? 'readonly' : ''} style="flex:1;" />
        ${groupsEditMode ? `<button class="remove-btn" style="opacity:1; font-size:1rem; padding:0.2rem 0.5rem; color:var(--red);" onclick="deleteGroup(${gidx})" title="Delete group">🗑️</button>` : ''}
      </div>
      <div class="group-list">
        ${g.students.map((s, sidx) => `
          <div class="group-student" draggable="${groupsEditMode ? 'true' : 'false'}" ondragstart="drag(event, ${gidx}, ${sidx})">
            ${escapeHTML(s)}
            ${groupsEditMode ? `<button class="remove-btn" onclick="removeStudentFromGroup(${gidx}, ${sidx})" title="Remove">✕</button>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

window.removeStudentFromGroup = function(gidx, sidx) {
  const student = currentGroups[gidx].students.splice(sidx, 1)[0];
  unassignedPool.push(student);
  renderGroups();
  renderUnassigned();
}

window.deleteGroup = function(gidx) {
  // Move all students in this group back to unassigned pool
  const removed = currentGroups.splice(gidx, 1)[0];
  unassignedPool.push(...removed.students);
  // Re-number groups
  currentGroups.forEach((g, i) => {
    if (g.name === `Group ${gidx + 1}` || g.name.match(/^Group \d+$/)) {
      g.name = 'Group ' + (i + 1);
    }
  });
  renderGroups();
  renderUnassigned();
  showToast(`🗑️ ${removed.name} deleted — students moved to pool`);
}

function updateGroupName(gidx, newName) {
  if (currentGroups[gidx]) currentGroups[gidx].name = newName;
}

// Drag and drop logic
function dragUnassigned(ev, studentIdx) {
  ev.dataTransfer.setData("fromUnassigned", "1");
  ev.dataTransfer.setData("studentIdx", studentIdx);
}

function allowDrop(ev) {
  ev.preventDefault();
}

function drag(ev, fromGroupIdx, studentIdx) {
  ev.dataTransfer.setData("fromGroup", fromGroupIdx);
  ev.dataTransfer.setData("studentIdx", studentIdx);
}

function drop(ev, toGroupIdx) {
  ev.preventDefault();
  const fromGroup = ev.dataTransfer.getData("fromGroup");
  const fromUnassigned = ev.dataTransfer.getData("fromUnassigned");
  const studentIdx = ev.dataTransfer.getData("studentIdx");
  
  if (fromUnassigned === "1") {
    const student = unassignedPool.splice(studentIdx, 1)[0];
    currentGroups[toGroupIdx].students.push(student);
    renderUnassigned();
    renderGroups();
  } else if (fromGroup !== "" && fromGroup != toGroupIdx) {
    const student = currentGroups[fromGroup].students.splice(studentIdx, 1)[0];
    currentGroups[toGroupIdx].students.push(student);
    renderGroups();
  }
}

async function saveGroups() {
  if (currentGroups.length === 0) return;
  const classId = document.getElementById('group-class-select').value;
  const assignedStudentCount = currentGroups.reduce((total, group) => total + group.students.length, 0);
  if (assignedStudentCount === 0) {
    showToast('No students are assigned to a group yet.');
    return;
  }
  
  // Save locally first for offline
  try {
    let localData = JSON.parse(localStorage.getItem('gv_groups') || '{}');
    localData[classId] = currentGroups;
    localStorage.setItem('gv_groups', JSON.stringify(localData));
    showToast("💾 Saved locally.");
  } catch(e) {}
  
  // Try online sync
  if (false && _db) {
    try {
      const ref = window._firestoreDoc(_db, FIRESTORE_COL, 'groups');
      let existing = {};
      const snap = await window._firestoreGetDoc(ref);
      const exists = typeof snap.exists === 'function' ? snap.exists() : snap.exists;
      if (exists) existing = snap.data().classes || {};
      
      existing[classId] = currentGroups;
      await window._firestoreSetDoc(ref, { classes: existing }, { merge: true });
      showToast("✅ Groups synced to Cloud!");
    } catch (err) {
      console.error(err);
      showToast("⚠️ Offline: Groups saved locally only.");
    }
  }

  await syncGroupsToSheets(classId);
}

async function syncGroupsToSheets(classId) {
  const scriptUrl = localStorage.getItem('gv_gsheets_script_url');
  const cls = classList.find(item => item.id === classId);
  const sheetId = cls ? extractSheetId(cls.url) : '';
  if (!scriptUrl) {
    showToast('Groups saved locally only. Add the Apps Script Web App URL in Settings.');
    return;
  }
  if (!sheetId) {
    showToast('Groups saved locally only. This class has no valid Google Sheets link.');
    return;
  }

  showToast('Saving groups to the Groups sheet...');
  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'saveGroups',
        sheetId,
        tabName: 'Groups',
        sheetName: 'Groups',
        studentNames: currentStudents,
        groups: currentGroups.map(group => ({
          id: group.id,
          name: group.name,
          students: group.students
        }))
      })
    });
    const result = JSON.parse(await response.text());
    const writes = Number(result.writeCount || result.updatedCells || 0);
    const assigned = Number(result.assignedStudentCount || 0);
    if (!response.ok || writes <= 0 || assigned <= 0) {
      throw new Error(result.error || 'No student group assignments were written. Deploy the latest Apps Script version.');
    }

    const sheetIdForCache = extractSheetId(cls.url);
    if (sheetIdForCache) workbookCache.delete(sheetIdForCache);
    showToast('✅ Groups saved online in the Groups sheet.');
  } catch (error) {
    showToast(`⚠️ Groups saved locally, but online sync failed: ${error.message}`);
  }
}


/* ═══════════════════════════════════════════════
   RANDOM PICKER
   ═══════════════════════════════════════════════ */

function parseGroupsSheet(wb, validStudents) {
  const sheetName = (wb?.SheetNames || []).find(name => normalizeSheetName(name) === 'groups');
  if (!sheetName) return [];

  const rows = getSheetRows(wb, sheetName);
  if (!rows.length) return [];
  const header = rows[0].map(value => normalizeSheetName(value));
  const studentCol = header.findIndex(value => ['allstudents', 'student', 'students', 'name', 'names'].includes(value));
  const groupCol = header.findIndex(value => value === 'groupnumber' || value === 'group' || value === 'groupname');
  const membersCol = header.findIndex(value => value === 'groupmembers' || value === 'members');
  if (studentCol < 0 || groupCol < 0) return [];

  // The Groups tab is the source of truth for group membership. Use its
  // All students column first so formatting differences in other tabs cannot
  // make valid group members appear as zero members.
  const sheetRoster = new Map(rows.slice(1)
    .map(row => String(row[studentCol] || '').trim())
    .filter(Boolean)
    .map(name => [normalizeStudentName(name), name]));
  const valid = sheetRoster.size
    ? new Set(sheetRoster.keys())
    : new Set((validStudents || []).map(normalizeStudentName));
  const byGroup = new Map();
  for (let r = 1; r < rows.length; r++) {
    const student = String(rows[r][studentCol] || '').trim();
    const groupName = String(rows[r][groupCol] || '').trim();
    if (!student || !groupName) continue;

    const members = membersCol >= 0
      ? String(rows[r][membersCol] || '').split(',').map(value => value.trim()).filter(Boolean)
      : [];
    const key = normalizeStudentName(groupName);
    const displayName = /^\d+$/.test(groupName) ? `Group ${groupName}` : groupName;
    if (!byGroup.has(key)) byGroup.set(key, { id: `group_${byGroup.size}`, name: displayName, students: [] });
    const group = byGroup.get(key);
    // The Groups tab stores one student per row in column A. Use that row as
    // the member source; column F is kept as a readable copy of the same name.
    // Fallback to F only for older group-sheet layouts without an A-row name.
    const candidates = student ? [student] : members;
    candidates.forEach(member => {
      const memberKey = normalizeStudentName(member);
      if (valid.has(memberKey) && !group.students.some(existing => normalizeStudentName(existing) === memberKey)) {
        group.students.push(sheetRoster.get(memberKey) || member);
      }
    });
  }
  return Array.from(byGroup.values()).sort((left, right) => {
    const leftNumber = Number((left.name.match(/\d+/) || [0])[0]);
    const rightNumber = Number((right.name.match(/\d+/) || [0])[0]);
    return leftNumber - rightNumber || left.name.localeCompare(right.name);
  });
}

function getNextGroupScoreColumn(wb, group) {
  const sheetName = (wb?.SheetNames || []).find(name => normalizeSheetName(name) === 'groups');
  if (!sheetName) return 2;
  const rows = getSheetRows(wb, sheetName);
  if (!rows.length) return 2;
  const header = rows[0].map(value => normalizeSheetName(value));
  const studentCol = header.findIndex(value => ['allstudents', 'student', 'students', 'name', 'names'].includes(value));
  const scoreCols = [
    header.findIndex(value => value === 'score1'),
    header.findIndex(value => value === 'score2')
  ];
  if (studentCol < 0) return 2;

  for (let i = 0; i < scoreCols.length; i++) {
    const col = scoreCols[i];
    if (col < 0) return i + 2;
    const used = group.students.some(student => rows.slice(1).some(row =>
      normalizeStudentName(row[studentCol]) === normalizeStudentName(student)
      && String(row[col] ?? '').trim() !== ''
    ));
    if (!used) return col + 1;
  }
  return 2;
}

function getSavedGroupsForClass(classId, validStudents, wb) {
  const saved = JSON.parse(localStorage.getItem('gv_groups') || '{}');
  const valid = new Set((validStudents || []).map(normalizeStudentName));
  const onlineGroups = parseGroupsSheet(wb, validStudents);
  const groups = onlineGroups.length
    ? onlineGroups
    : (Array.isArray(saved[classId]) ? saved[classId] : []);
  return groups.map((group, index) => ({
    id: group.id || `group_${index}`,
    name: group.name || `Group ${index + 1}`,
    students: (Array.isArray(group.students) ? group.students : [])
      .filter(student => valid.has(normalizeStudentName(student)))
  }));
}

function getSavedGroupScoreData(classId, period, category) {
  try {
    const data = JSON.parse(localStorage.getItem('gv_group_scores') || '{}');
    return data[classId]?.[period]?.[category] || {};
  } catch {
    return {};
  }
}

async function loadSavedGroupsPage() {
  const classId = document.getElementById('saved-groups-class-select').value;
  const workspace = document.getElementById('saved-groups-workspace');
  if (!classId) {
    workspace.classList.add('hidden');
    return;
  }

  const period = GROUP_SCORE_STORAGE_PERIOD;
  const category = GROUP_SCORE_STORAGE_CATEGORY;
  const classSelect = document.getElementById('saved-groups-class-select');
  classSelect.disabled = true;

  savedGroupsPageStudents = await fetchStudentsForClass(classId);
  savedGroupsPageWorkbook = await fetchWorkbookForClass(classId);
  savedGroupsPageGroups = getSavedGroupsForClass(classId, savedGroupsPageStudents, savedGroupsPageWorkbook);
  savedGroupsPageSheet = null;
  classSelect.disabled = false;

  const scoreData = getSavedGroupScoreData(classId, period, category);

  const cls = classList.find(item => item.id === classId);
  document.getElementById('saved-groups-title').textContent =
    `${cls?.name || 'Class'} — Saved Groups`;
  workspace.classList.remove('hidden');
  renderSavedGroupsPage(scoreData);
}

function renderSavedGroupsPage(scoreData = {}) {
  const list = document.getElementById('saved-groups-list');
  if (!savedGroupsPageGroups.length) {
    list.innerHTML = '<div class="saved-groups-empty">No saved groups found for this class. Create and save groups first.</div>';
    return;
  }

  list.innerHTML = savedGroupsPageGroups.map((group, index) => {
    const saved = scoreData.groups?.[group.id];
    const hasScore = saved && typeof saved === 'object'
      ? saved.groupScore !== '' || Object.values(saved.members || {}).some(value => String(value).trim() !== '')
      : String(saved ?? '').trim() !== '';
    return `
      <article class="saved-group-card">
        <div class="saved-group-card-header">
          <div>
            <div class="saved-group-name">${escapeHTML(group.name)}</div>
            <div class="saved-group-count">${group.students.length} members</div>
          </div>
          <div class="saved-group-card-actions">
            <button class="btn btn-primary btn-sm" onclick="openSavedGroupScoreModal(${index})">⭐ Score</button>
            <button class="btn btn-danger btn-sm" onclick="deleteSavedGroup(${index})">🗑 Delete</button>
          </div>
        </div>
        <div class="saved-group-members">
          ${group.students.length
            ? group.students.map(student => `<span>${escapeHTML(student)}</span>`).join('')
            : '<span class="saved-group-no-members">No valid roster members</span>'}
        </div>
        <div class="saved-group-status ${hasScore ? 'has-score' : ''}">${hasScore ? '✅ Score saved' : 'No score recorded yet'}</div>
      </article>`;
  }).join('');
}

async function deleteSavedGroup(groupIndex) {
  const classId = document.getElementById('saved-groups-class-select').value;
  const group = savedGroupsPageGroups[groupIndex];
  if (!classId || !group) return;
  if (!confirm(`Delete ${group.name} and its saved group scores?`)) return;

  const scriptUrl = localStorage.getItem('gv_gsheets_script_url');
  const cls = classList.find(item => item.id === classId);
  const sheetId = cls ? extractSheetId(cls.url) : '';
  if (scriptUrl && sheetId) {
    try {
      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'deleteGroup',
          sheetId,
          tabName: 'Groups',
          sheetName: 'Groups',
          studentNames: group.students
        })
      });
      const result = JSON.parse(await response.text());
      const writes = Number(result.writeCount || result.updatedCells || 0);
      if (!response.ok || writes <= 0) throw new Error(result.error || 'No group rows were cleared.');
      workbookCache.delete(sheetId);
      showToast(`✅ ${group.name} deleted from the Groups sheet.`);
    } catch (error) {
      showToast(`⚠️ Could not delete ${group.name} online: ${error.message}`);
      return;
    }
  } else {
    showToast('⚠️ Apps Script is not configured. The group was removed only from this browser.');
  }

  const saved = JSON.parse(localStorage.getItem('gv_groups') || '{}');
  if (Array.isArray(saved[classId])) {
    saved[classId] = saved[classId].filter(item => item.id !== group.id);
    localStorage.setItem('gv_groups', JSON.stringify(saved));
  }
  try {
    const scoreData = JSON.parse(localStorage.getItem('gv_group_scores') || '{}');
    Object.values(scoreData[classId] || {}).forEach(categoryData => {
      if (categoryData?.groups) delete categoryData.groups[group.id];
    });
    localStorage.setItem('gv_group_scores', JSON.stringify(scoreData));
  } catch (error) {
    console.warn('Could not remove local group score history:', error);
  }

  savedGroupsPageGroups.splice(groupIndex, 1);
  renderSavedGroupsPage(getSavedGroupScoreData(
    classId,
    GROUP_SCORE_STORAGE_PERIOD,
    GROUP_SCORE_STORAGE_CATEGORY
  ));
}

async function deleteAllSavedGroups() {
  const classId = document.getElementById('saved-groups-class-select').value;
  if (!classId) {
    showToast('Select a class first.');
    return;
  }
  if (!savedGroupsPageGroups.length) {
    showToast('There are no saved groups to delete.');
    return;
  }
  if (!confirm('Delete all saved groups and their Score 1/Score 2 values for this class?')) return;

  const scriptUrl = localStorage.getItem('gv_gsheets_script_url');
  const cls = classList.find(item => item.id === classId);
  const sheetId = cls ? extractSheetId(cls.url) : '';
  if (scriptUrl && sheetId) {
    try {
      const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'deleteAllGroups',
          sheetId,
          tabName: 'Groups',
          sheetName: 'Groups'
        })
      });
      const result = JSON.parse(await response.text());
      if (!response.ok || result.success !== true) throw new Error(result.error || 'Groups could not be cleared.');
      workbookCache.delete(sheetId);
    } catch (error) {
      showToast(`⚠️ Could not delete groups online: ${error.message}`);
      return;
    }
  }

  const saved = JSON.parse(localStorage.getItem('gv_groups') || '{}');
  delete saved[classId];
  localStorage.setItem('gv_groups', JSON.stringify(saved));
  try {
    const scoreData = JSON.parse(localStorage.getItem('gv_group_scores') || '{}');
    delete scoreData[classId];
    localStorage.setItem('gv_group_scores', JSON.stringify(scoreData));
  } catch (error) {
    console.warn('Could not remove local group scores:', error);
  }

  savedGroupsPageGroups = [];
  renderSavedGroupsPage({});
  showToast('✅ All saved groups were deleted.');
}

function storeSavedGroupScoreData(classId, period, category, data) {
  const all = JSON.parse(localStorage.getItem('gv_group_scores') || '{}');
  if (!all[classId]) all[classId] = {};
  if (!all[classId][period]) all[classId][period] = {};
  all[classId][period][category] = data;
  localStorage.setItem('gv_group_scores', JSON.stringify(all));
}

let savedGroupScoreModalIndex = -1;
let savedGroupScoreMode = 'group';

function getSavedGroupScoreEntry(scoreData, group) {
  const saved = scoreData?.groups?.[group.id];
  if (saved && typeof saved === 'object') {
    return {
      mode: saved.mode === 'individual' ? 'individual' : 'group',
      groupScore: saved.groupScore ?? '',
      members: saved.members || {}
    };
  }
  // Keep scores saved by the previous inline version compatible.
  return { mode: 'group', groupScore: saved ?? '', members: {} };
}

function openSavedGroupScoreModal(groupIndex) {
  const group = savedGroupsPageGroups[groupIndex];
  if (!group) return;

  savedGroupScoreModalIndex = groupIndex;
  const period = GROUP_SCORE_STORAGE_PERIOD;
  const category = GROUP_SCORE_STORAGE_CATEGORY;
  const activity = 'Groups sheet score';
  const scoreData = getSavedGroupScoreData(
    document.getElementById('saved-groups-class-select').value,
    period,
    category
  );
  const saved = getSavedGroupScoreEntry(scoreData, group);

  document.getElementById('saved-group-score-title').textContent = `Score ${group.name}`;
  document.getElementById('saved-group-score-context').textContent = `${period} • ${category} • ${activity}`;
  document.getElementById('saved-group-group-score').value = saved.groupScore ?? '';
  document.getElementById('saved-group-score-column').value = String(getNextGroupScoreColumn(savedGroupsPageWorkbook, group));
  savedGroupScoreMode = saved.mode;
  renderSavedGroupMemberScores(group, saved.members);
  setSavedGroupScoreMode(savedGroupScoreMode);
  document.getElementById('saved-group-score-modal').classList.remove('hidden');
}

function closeSavedGroupScoreModal() {
  savedGroupScoreModalIndex = -1;
  document.getElementById('saved-group-score-modal').classList.add('hidden');
}

function setSavedGroupScoreMode(mode) {
  savedGroupScoreMode = mode === 'individual' ? 'individual' : 'group';
  document.getElementById('saved-group-score-group-panel').classList.toggle('hidden', savedGroupScoreMode !== 'group');
  document.getElementById('saved-group-score-individual-panel').classList.toggle('hidden', savedGroupScoreMode !== 'individual');
  document.getElementById('saved-group-mode-group').className = savedGroupScoreMode === 'group' ? 'btn btn-primary' : 'btn btn-ghost';
  document.getElementById('saved-group-mode-individual').className = savedGroupScoreMode === 'individual' ? 'btn btn-primary' : 'btn btn-ghost';
}

function renderSavedGroupMemberScores(group, members = {}) {
  const list = document.getElementById('saved-group-member-score-list');
  list.innerHTML = group.students.map((student, index) => {
    const value = members[normalizeStudentName(student)] ?? '';
    return `
      <label class="saved-group-member-score-row">
        <span>${escapeHTML(student)}</span>
        <input class="form-input" id="saved-group-member-score-${index}" type="number" min="0"
          value="${escapeHTML(String(value))}" placeholder="Score" />
      </label>`;
  }).join('');
}

function collectSavedGroupMemberScores(group) {
  const members = {};
  group.students.forEach((student, index) => {
    members[normalizeStudentName(student)] = document.getElementById(`saved-group-member-score-${index}`)?.value?.trim() || '';
  });
  return members;
}

async function saveCurrentSavedGroupScore() {
  const classId = document.getElementById('saved-groups-class-select').value;
  const group = savedGroupsPageGroups[savedGroupScoreModalIndex];
  if (!classId || !group) return;

  const period = GROUP_SCORE_STORAGE_PERIOD;
  const category = GROUP_SCORE_STORAGE_CATEGORY;
  const activity = 'Groups sheet score';
  const max = '';
  const groupSheetScoreColumn = Number(document.getElementById('saved-group-score-column').value) || 2;
  const groupScore = document.getElementById('saved-group-group-score').value.trim();
  const members = savedGroupScoreMode === 'individual' ? collectSavedGroupMemberScores(group) : {};
  const scoreForMembers = savedGroupScoreMode === 'group'
    ? Object.fromEntries(group.students.map(student => [normalizeStudentName(student), groupScore]))
    : members;

  if (savedGroupScoreMode === 'group' && groupScore === '') {
    showToast('Enter a group score first.');
    return;
  }
  if (savedGroupScoreMode === 'individual' && !Object.values(members).some(value => value !== '')) {
    showToast('Enter at least one student score first.');
    return;
  }

  const scoreData = getSavedGroupScoreData(classId, period, category);
  const groups = { ...(scoreData.groups || {}) };
  groups[group.id] = {
    mode: savedGroupScoreMode,
    groupScore: savedGroupScoreMode === 'group' ? groupScore : '',
    members,
    activity,
    max,
    savedAt: new Date().toISOString()
  };
  storeSavedGroupScoreData(classId, period, category, { activity, max, groups });

  closeSavedGroupScoreModal();
  renderSavedGroupsPage(getSavedGroupScoreData(classId, period, category));
  const selectedClass = classList.find(item => item.id === classId);
  const canSyncGroupsSheet = Boolean(
    localStorage.getItem('gv_gsheets_script_url') && selectedClass && extractSheetId(selectedClass.url)
  );
  await syncSavedGroupScoreToGroupsSheet(classId, group, scoreForMembers, groupSheetScoreColumn);
  if (!canSyncGroupsSheet) showToast('Score saved locally. Configure Apps Script to sync it to the Groups sheet.');
  return;

  const scriptUrl = localStorage.getItem('gv_gsheets_script_url');
  const cls = classList.find(item => item.id === classId);
  const sheetId = cls ? extractSheetId(cls.url) : '';
  closeSavedGroupScoreModal();
  renderSavedGroupsPage(getSavedGroupScoreData(classId, period, category));

  if (!scriptUrl || !sheetId) {
    showToast('Score saved locally. Configure Apps Script to sync it to Sheets.');
    return;
  }

  const sheetTabName = savedGroupsPageSheet?.sheetName || period;
  const prefixes = { Quiz: 'Q', Oral: 'O', Activity: 'G', Exam: 'E' };
  const headers = [1, 2, 3, 4].map(number => `${prefixes[category] || category}${number}`);
  const studentNames = group.students;
  const studentScores = Object.fromEntries(studentNames.map(student => [
    normalizeStudentName(student), [scoreForMembers[normalizeStudentName(student)] || '', '', '', '']
  ]));
  showToast(`Saving ${group.name} scores...`);

  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        sheetId,
        tabName: sheetTabName,
        sheetName: sheetTabName,
        period,
        category,
        categoryId: category,
        headers,
        scoreHeaders: headers,
        maxScores: [max, '', '', ''],
        perfectScores: [max, '', '', ''],
        scoreIndexes: [0],
        activity,
        studentNames,
        studentScores,
        scores: studentScores,
        scoresByStudent: studentScores
      })
    });
    const result = JSON.parse(await response.text());
    const writes = Number(result.writeCount || result.updatedCells || 0);
    if (!response.ok || writes <= 0) throw new Error(result.error || 'No cells were updated.');
    showToast(`✅ ${group.name} scores saved to Google Sheets.`);
  } catch (error) {
    showToast(`⚠️ Saved locally, but Sheets sync failed: ${error.message}`);
  }
  await syncSavedGroupScoreToGroupsSheet(classId, group, scoreForMembers, groupSheetScoreColumn);
}

async function syncSavedGroupScoreToGroupsSheet(classId, group, scoreForMembers, scoreColumn) {
  const scriptUrl = localStorage.getItem('gv_gsheets_script_url');
  const cls = classList.find(item => item.id === classId);
  const sheetId = cls ? extractSheetId(cls.url) : '';
  if (!scriptUrl || !sheetId) return;

  const studentNames = group.students;
  const studentScores = Object.fromEntries(studentNames.map(student => [
    normalizeStudentName(student), scoreForMembers[normalizeStudentName(student)] ?? ''
  ]));

  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'saveGroupScore',
        sheetId,
        tabName: 'Groups',
        sheetName: 'Groups',
        scoreColumn,
        studentNames,
        studentScores,
        scores: studentScores
      })
    });
    const result = JSON.parse(await response.text());
    const writes = Number(result.writeCount || result.updatedCells || 0);
    if (!response.ok || writes <= 0) throw new Error(result.error || 'No score cells were updated in Groups.');
    showToast(`✅ ${group.name} score copied to Groups sheet Score ${scoreColumn - 1}.`);
  } catch (error) {
    showToast(`⚠️ Gradebook saved, but Groups sheet score sync failed: ${error.message}`);
  }
}

/* ── ATTENDANCE ─────────────────────────────────────────────────────────────
   Attendance uses the existing Attendance tab. The browser reads the roster
   and existing date values from that tab; Apps Script performs the write so
   the workbook's four period blocks remain intact. */
let attendanceState = {
  classId: '', period: 'Prelim', date: '', students: [], records: {},
  photos: {}, showPhotos: false, editIndex: -1, requestId: 0
};
let attendanceNotesTimer = null;

const ATTENDANCE_PERIOD_ALIASES = {
  Prelim: ['prelim', 'preliminary'],
  Midterm: ['midterm', 'mid'],
  Semifinal: ['semifinal', 'semi-final', 'semi finals', 'semi-finals'],
  Final: ['final', 'finals']
};

function attendanceKey(classId, period, date) {
  return `gv_attendance_${classId}_${period}_${date}`;
}

function attendanceNormalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return attendanceNormalizeDate(date);
  }
  const text = String(value || '').trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return attendanceNormalizeDate(parsed);
}

function attendancePeriodMatch(value) {
  const text = normalizeSheetName(value);
  return Object.entries(ATTENDANCE_PERIOD_ALIASES).find(([, aliases]) =>
    aliases.some(alias => normalizeSheetName(alias) === text || text.includes(normalizeSheetName(alias)))
  )?.[0] || '';
}

function findAttendanceLayout(rows, period) {
  if (!rows?.length) return null;
  const sectionCells = [];
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    rows[r].forEach((value, col) => {
      const found = attendancePeriodMatch(value);
      if (found) sectionCells.push({ row: r, col, period: found });
    });
  }
  const sections = sectionCells.filter(item => ['Prelim', 'Midterm', 'Semifinal', 'Final'].includes(item.period));
  const selected = sections.find(item => item.period === period);
  if (!selected) return null;
  const starts = sections.filter(item => item.row === selected.row && item.col > selected.col).sort((a, b) => a.col - b.col);
  const next = starts[0];
  const blockEnd = next ? next.col : Math.max(...rows.map(row => row.length), selected.col + 1);

  let nameHeader = null;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const col = rows[r].findIndex(value => {
      const text = String(value || '').toLowerCase().trim();
      return text === 'name' || text === 'names' || text === "student's name" || (text.includes('student') && text.includes('name'));
    });
    if (col >= 0) { nameHeader = { row: r, col }; break; }
  }
  if (!nameHeader) return null;

  let totalCol = -1;
  for (let r = selected.row; r <= Math.min(rows.length - 1, nameHeader.row + 1); r++) {
    for (let c = selected.col; c < blockEnd; c++) {
      const value = String(rows[r]?.[c] || '').toLowerCase().trim();
      if ((value === 'total' || value === 'ttl') && totalCol < 0) totalCol = c;
    }
  }
  if (totalCol < 0) totalCol = blockEnd;

  let dateRow = selected.row + 1;
  let bestDateCount = -1;
  for (let r = selected.row + 1; r < nameHeader.row; r++) {
    let count = 0;
    for (let c = selected.col; c < totalCol; c++) if (attendanceNormalizeDate(rows[r]?.[c])) count++;
    if (count > bestDateCount) { bestDateCount = count; dateRow = r; }
  }

  const dateColumns = [];
  for (let c = selected.col; c < totalCol; c++) {
    const date = attendanceNormalizeDate(rows[dateRow]?.[c]);
    if (date) dateColumns.push({ col: c, date });
  }

  const students = [];
  for (let r = nameHeader.row + 1; r < rows.length; r++) {
    const name = findRosterNameInRow(rows[r], nameHeader.col);
    if (name) students.push({ name, row: r });
  }
  return { period, sectionRow: selected.row, blockStart: selected.col, blockEnd, totalCol, dateRow, nameCol: nameHeader.col, headerRow: nameHeader.row, dateColumns, students };
}

function attendanceReadLocal(key, fallback = {}) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch (_) { return fallback; }
}

function populateAttendanceClassSelect() {
  const select = document.getElementById('attendance-class-select');
  if (!select) return;
  const current = attendanceState.classId || select.value;
  select.innerHTML = '<option value="">-- Select a Class --</option>' + classList.map(cls => `<option value="${escapeAttr(cls.id)}">${escapeHTML(cls.name)}</option>`).join('');
  if (classList.some(cls => cls.id === current)) select.value = current;
}

function attendanceScheduleDays(cls, rows = []) {
  let source = `${cls?.name || ''} ${cls?.description || ''}`.toUpperCase();
  for (const row of rows.slice(0, 8)) {
    row.forEach((value, index) => {
      if (/^days?:?$/i.test(String(value || '').trim())) {
        source += ` ${row.slice(index + 1, index + 7).join(' ')}`.toUpperCase();
      }
    });
  }
  if (/\bTTH\b|TUE(?:SDAY)?\s*[/,&-]\s*THU(?:RSDAY)?/.test(source)) return [2, 4];
  if (/\bMW\b|MON(?:DAY)?\s*[/,&-]\s*WED(?:NESDAY)?/.test(source)) return [1, 3];
  if (/\bFS\b|FRI(?:DAY)?\s*[/,&-]\s*SAT(?:URDAY)?/.test(source)) return [5, 6];
  return [0, 1, 2, 3, 4, 5, 6];
}

function localAttendanceDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function populateAttendanceDateOptions(layout = null, rows = []) {
  const select = document.getElementById('attendance-date-select');
  const help = document.getElementById('attendance-date-help');
  if (!select || !attendanceState.classId) return;
  const cls = classList.find(item => item.id === attendanceState.classId);
  const allowedDays = attendanceScheduleDays(cls, rows);
  const isKnownSchedule = allowedDays.length < 7;
  const options = new Map();
  const addDate = date => {
    if (allowedDays.includes(date.getDay())) options.set(localAttendanceDateKey(date), date);
  };
  const today = new Date();
  const start = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const end = new Date(today.getFullYear() + 1, 11, 31);
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) addDate(new Date(date));
  (layout?.dateColumns || []).forEach(item => {
    const date = new Date(`${item.date}T00:00:00`);
    if (!Number.isNaN(date.getTime())) addDate(date);
  });
  const todayKey = localAttendanceDateKey(today);
  const latestKey = Array.from(options.keys()).filter(key => key <= todayKey).sort().pop() || Array.from(options.keys()).sort()[0] || '';
  // Show the latest valid date plus upcoming scheduled dates through the end
  // of next year. Older historical sheet dates are intentionally hidden.
  const displayKeys = Array.from(options.keys()).filter(key => key === latestKey || key > todayKey).sort();
  select.innerHTML = '<option value="">-- Select a date --</option>' + displayKeys.map(key => {
    const date = options.get(key);
    const label = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(date);
    return `<option value="${key}">${label}</option>`;
  }).join('');
  // Start on the latest valid scheduled date.
  attendanceState.date = latestKey;
  select.value = latestKey;
  if (help) {
    const schedule = isKnownSchedule ? ({ '1,3': 'MW (Monday and Wednesday)', '2,4': 'TTH (Tuesday and Thursday)', '5,6': 'FS (Friday and Saturday)' }[allowedDays.join(',')] || '') : '';
    help.textContent = schedule ? `Showing ${schedule} dates only.` : 'No MW, TTH, or FS schedule was found, so all dates are available.';
  }
}

function initAttendancePage() {
  populateAttendanceClassSelect();
  attendanceState.showPhotos = localStorage.getItem('gv_attendance_show_photos') === '1';
  const period = document.getElementById('attendance-period-select');
  if (period && attendanceState.period) period.value = attendanceState.period;
  const photos = document.getElementById('attendance-show-photos');
  if (photos) photos.checked = Boolean(attendanceState.showPhotos);
  if (attendanceState.classId) loadAttendanceRoster();
}

async function loadAttendanceRoster() {
  const classSelect = document.getElementById('attendance-class-select');
  const periodSelect = document.getElementById('attendance-period-select');
  const classId = classSelect?.value || '';
  const period = periodSelect?.value || 'Prelim';
  attendanceState.classId = classId;
  attendanceState.period = period;
  attendanceState.records = {};
  attendanceState.students = [];
  renderAttendanceStudents();
  if (!classId) return;

  const requestId = ++attendanceState.requestId;
  const workspace = document.getElementById('attendance-workspace');
  const grid = document.getElementById('attendance-student-grid');
  if (grid) grid.innerHTML = '<div class="attendance-loading">Loading students from the Attendance sheet...</div>';
  const wb = await fetchWorkbookForClass(classId);
  if (requestId !== attendanceState.requestId) return;
  const rows = getSheetRows(wb, 'Attendance');
  const settingsRows = getSheetRows(wb, wb?.SheetNames?.[0] || 'Settings');
  const layout = findAttendanceLayout(rows, period);
  populateAttendanceDateOptions(layout, settingsRows.length ? settingsRows : rows);
  const names = layout?.students?.map(item => item.name) || await fetchStudentsForClass(classId);
  const overrides = attendanceReadLocal(`gv_attendance_names_${classId}`, {});
  const photos = attendanceReadLocal(`gv_attendance_photos_${classId}`, {});
  attendanceState.students = names.map(name => ({ originalName: name, displayName: overrides[normalizeStudentName(name)] || name, removed: false }));
  attendanceState.photos = photos;
  if (workspace) workspace.classList.toggle('hidden', !attendanceState.students.length);
  const title = document.getElementById('attendance-class-title');
  const cls = classList.find(item => item.id === classId);
  if (title) title.textContent = `${cls?.name || 'Class'} — ${period}`;
  loadAttendanceNote();
  await loadAttendanceDateValues(layout);
  renderAttendanceStudents();
}

async function loadAttendanceDateValues(layout = null) {
  const date = attendanceState.date || document.getElementById('attendance-date-select')?.value || '';
  attendanceState.date = date;
  if (!date || !attendanceState.classId) { renderAttendanceStudents(); return; }
  const local = attendanceReadLocal(attendanceKey(attendanceState.classId, attendanceState.period, date), {});
  attendanceState.records = { ...(local.records || {}) };
  if (!layout) {
    const wb = await fetchWorkbookForClass(attendanceState.classId);
    layout = findAttendanceLayout(getSheetRows(wb, 'Attendance'), attendanceState.period);
  }
  if (!layout) return;
  const dateColumn = layout.dateColumns.find(item => item.date === date)?.col;
  if (dateColumn == null) return;
  layout.students.forEach(student => {
    const row = getSheetRows(workbookCache.get(extractSheetId(classList.find(item => item.id === attendanceState.classId)?.url)), 'Attendance')[student.row];
    const value = String(row?.[dateColumn] ?? '').trim().toLowerCase();
    if (value === '1' || value === 'p' || value === 'present') attendanceState.records[normalizeStudentName(student.name)] = true;
  });
}

function setAttendanceDate(date) {
  attendanceState.date = date || '';
  loadAttendanceDateValues().then(renderAttendanceStudents);
}

function renderAttendanceStudents() {
  const grid = document.getElementById('attendance-student-grid');
  if (!grid) return;
  if (!attendanceState.classId) { grid.innerHTML = '<div class="attendance-empty">Select a class to load students.</div>'; return; }
  if (!attendanceState.students.length) { grid.innerHTML = '<div class="attendance-empty">No students were found in the Attendance sheet.</div>'; return; }
  const disabled = !attendanceState.date;
  const visible = attendanceState.students.filter(student => !student.removed);
  grid.innerHTML = visible.map((student) => {
    const index = attendanceState.students.indexOf(student);
    const present = Boolean(attendanceState.records[normalizeStudentName(student.originalName)]);
    const photo = attendanceState.photos[normalizeStudentName(student.originalName)];
    return `<button class="attendance-student-card ${present ? 'present' : ''}" ${disabled ? 'disabled' : ''} onclick="toggleAttendanceStudent(${index})" ${disabled ? 'disabled' : ''}>
      ${attendanceState.showPhotos && photo ? `<img class="attendance-student-photo" src="${photo}" alt="" />` : '<div class="attendance-student-avatar">👤</div>'}
      <span class="attendance-student-name">${escapeHTML(student.displayName)}</span><span class="attendance-status">${present ? 'Present' : 'Tap to mark present'}</span>
    </button>`;
  }).join('');
  const presentCount = visible.filter(student => attendanceState.records[normalizeStudentName(student.originalName)]).length;
  const summary = document.getElementById('attendance-summary');
  if (summary) summary.textContent = `${presentCount} present · ${visible.length - presentCount} unmarked${disabled ? ' · choose a date to enable' : ''}`;
  const notes = document.getElementById('attendance-section-notes');
  if (notes && document.activeElement !== notes) loadAttendanceNote();
}

function toggleAttendanceStudent(index) {
  if (!attendanceState.date || !attendanceState.students[index]) return;
  const key = normalizeStudentName(attendanceState.students[index].originalName);
  attendanceState.records[key] = !attendanceState.records[key];
  renderAttendanceStudents();
}

function toggleAttendancePhotos(checked) {
  attendanceState.showPhotos = Boolean(checked);
  localStorage.setItem('gv_attendance_show_photos', attendanceState.showPhotos ? '1' : '0');
  renderAttendanceStudents();
}

function loadAttendanceNote() {
  const notes = document.getElementById('attendance-section-notes');
  if (!notes || !attendanceState.classId) return;
  const all = attendanceReadLocal('gv_attendance_notes', {});
  const value = all[attendanceState.classId] || '';
  if (document.activeElement !== notes) notes.value = value;
  notes.oninput = () => {
    clearTimeout(attendanceNotesTimer);
    attendanceNotesTimer = setTimeout(() => {
      const current = attendanceReadLocal('gv_attendance_notes', {});
      current[attendanceState.classId] = notes.value;
      localStorage.setItem('gv_attendance_notes', JSON.stringify(current));
    }, 350);
  };
}

async function saveAttendance() {
  if (!attendanceState.classId || !attendanceState.date) { showToast('Select a class and date before saving attendance.'); return; }
  const cls = classList.find(item => item.id === attendanceState.classId);
  const sheetId = cls ? extractSheetId(cls.url) : '';
  const scriptUrl = localStorage.getItem('gv_gsheets_script_url');
  if (!scriptUrl || !sheetId) { showToast('Attendance saved locally only. Configure the Apps Script URL and class Google Sheet first.'); return; }
  const activeStudents = attendanceState.students.filter(student => !student.removed);
  const statuses = {};
  activeStudents.forEach(student => { statuses[normalizeStudentName(student.originalName)] = Boolean(attendanceState.records[normalizeStudentName(student.originalName)]); });
  const localKey = attendanceKey(attendanceState.classId, attendanceState.period, attendanceState.date);
  localStorage.setItem(localKey, JSON.stringify({ records: statuses, savedAt: new Date().toISOString() }));
  showToast('Saving attendance to the Attendance sheet...');
  try {
    const response = await fetch(scriptUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({
      action: 'saveAttendance', sheetId, tabName: 'Attendance', sheetName: 'Attendance', period: attendanceState.period,
      date: attendanceState.date, studentNames: activeStudents.map(student => student.originalName), attendance: statuses
    }) });
    const result = JSON.parse(await response.text());
    const writes = Number(result.writeCount || result.updatedCells || 0);
    if (!response.ok || !result.success || writes <= 0) throw new Error(result.error || 'No attendance cells were updated.');
    workbookCache.delete(sheetId);
    showToast(`✅ ${attendanceState.period} attendance for ${attendanceState.date} saved to Google Sheets.`);
  } catch (error) { showToast(`⚠️ Attendance saved locally, but Sheets sync failed: ${error.message}`); }
}

function openAttendanceStudentEditor() {
  if (!attendanceState.students.length) { showToast('Load a class first.'); return; }
  const modal = document.getElementById('attendance-student-modal');
  const select = document.getElementById('attendance-edit-student-select');
  select.innerHTML = attendanceState.students.map((student, index) => `<option value="${index}">${escapeHTML(student.displayName)}</option>`).join('');
  attendanceState.editIndex = Math.max(0, attendanceState.editIndex);
  select.value = String(attendanceState.editIndex);
  selectAttendanceStudentForEdit(select.value);
  modal.classList.remove('hidden');
}

function closeAttendanceStudentEditor() { document.getElementById('attendance-student-modal')?.classList.add('hidden'); }

function selectAttendanceStudentForEdit(value) {
  attendanceState.editIndex = Number(value);
  const student = attendanceState.students[attendanceState.editIndex];
  if (!student) return;
  document.getElementById('attendance-edit-name').value = student.displayName;
  document.getElementById('attendance-edit-context').textContent = student.originalName;
  const photo = attendanceState.photos[normalizeStudentName(student.originalName)];
  const image = document.getElementById('attendance-photo-preview');
  const empty = document.getElementById('attendance-photo-empty');
  image.src = photo || '';
  image.classList.toggle('hidden', !photo); empty.classList.toggle('hidden', Boolean(photo));
}

function handleAttendancePhoto(event) {
  const file = event.target.files?.[0];
  if (!file || !attendanceState.students[attendanceState.editIndex]) return;
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const maxSide = 600;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      attendanceState.photos[normalizeStudentName(attendanceState.students[attendanceState.editIndex].originalName)] = canvas.toDataURL('image/jpeg', 0.78);
      selectAttendanceStudentForEdit(attendanceState.editIndex);
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function saveAttendanceStudent() {
  const student = attendanceState.students[attendanceState.editIndex];
  if (!student) return;
  const name = document.getElementById('attendance-edit-name').value.trim();
  if (!name) { showToast('Enter a student name.'); return; }
  student.displayName = name;
  const overrides = attendanceReadLocal(`gv_attendance_names_${attendanceState.classId}`, {});
  overrides[normalizeStudentName(student.originalName)] = name;
  localStorage.setItem(`gv_attendance_names_${attendanceState.classId}`, JSON.stringify(overrides));
  localStorage.setItem(`gv_attendance_photos_${attendanceState.classId}`, JSON.stringify(attendanceState.photos));
  closeAttendanceStudentEditor(); renderAttendanceStudents(); showToast('Student details saved for this class.');
}

function removeAttendanceStudent() {
  const student = attendanceState.students[attendanceState.editIndex];
  if (!student) return;
  student.removed = true; closeAttendanceStudentEditor(); renderAttendanceStudents(); showToast('Student removed from this attendance view.');
}

document.getElementById('nav-picker').addEventListener('click', () => {
  const select = document.getElementById('picker-class-select');
  select.innerHTML = '<option value="">-- Select a Class --</option>' + 
    classList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
});

async function loadClassForPicker() {
  const classId = document.getElementById('picker-class-select').value;
  if (!classId) {
    document.getElementById('picker-workspace').classList.add('hidden');
    return;
  }

  showToast("Loading students...");
  currentStudents = await fetchStudentsForClass(classId);
  pickerPool = [...currentStudents];

  if (currentStudents.length === 0) {
    showToast("❌ Could not find students.");
    return;
  }

  document.getElementById('picker-workspace').classList.remove('hidden');
  document.getElementById('picker-winner-panel').classList.add('hidden');
  document.getElementById('picker-normal-name').textContent = "READY";
  
  if (pickerMode === 'wheel') drawWheel();
  
  showToast(`✅ ${pickerPool.length} students loaded`);
}

function togglePickerMode() {
  pickerMode = document.getElementById('picker-mode-select').value;
  if (pickerMode === 'wheel') {
    document.getElementById('picker-normal-view').classList.add('hidden');
    document.getElementById('picker-wheel-view').classList.remove('hidden');
    drawWheel();
  } else {
    document.getElementById('picker-normal-view').classList.remove('hidden');
    document.getElementById('picker-wheel-view').classList.add('hidden');
  }
}

// ── NORMAL MODE ──
function pickRandomStudentNormal() {
  if (pickerPool.length === 0) {
    showToast("No students left in pool!");
    return;
  }

  const display = document.getElementById('picker-normal-name');
  document.getElementById('picker-winner-panel').classList.add('hidden');
  
  let cycles = 0;
  const maxCycles = 20;
  
  const roll = setInterval(() => {
    const randomName = pickerPool[Math.floor(Math.random() * pickerPool.length)];
    display.textContent = randomName;
    cycles++;
    
    if (cycles >= maxCycles) {
      clearInterval(roll);
      const winnerIdx = Math.floor(Math.random() * pickerPool.length);
      const winnerName = pickerPool[winnerIdx];
      
      display.textContent = winnerName;
      showWinner(winnerName, winnerIdx);
    }
  }, 100);
}

// ── WHEEL MODE ──
const WHEEL_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e'];

function drawWheel() {
  if (pickerPool.length === 0) return;
  
  const canvas = document.getElementById('picker-wheel-canvas');
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = cx - 10;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const sliceAngle = (2 * Math.PI) / pickerPool.length;
  
  for (let i = 0; i < pickerPool.length; i++) {
    const startAngle = wheelAngle + (i * sliceAngle);
    const endAngle = startAngle + sliceAngle;
    
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.fill();
    ctx.stroke();
    
    // Draw text
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(startAngle + sliceAngle / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff";
    ctx.font = pickerPool.length > 30 ? "10px sans-serif" : "14px sans-serif";
    
    let text = pickerPool[i];
    if (text.length > 20) text = text.substring(0, 18) + "...";
    
    ctx.fillText(text, radius - 15, 4);
    ctx.restore();
  }
  
  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, 2*Math.PI);
  ctx.fillStyle = "#222";
  ctx.fill();
}

function spinWheel() {
  if (pickerPool.length === 0) return;
  if (wheelSpinning) return;
  
  wheelSpinning = true;
  document.getElementById('picker-winner-panel').classList.add('hidden');
  
  // Random spins between 3 to 6 full rotations + random offset
  const spinTarget = (Math.random() * 3 + 3) * 2 * Math.PI; 
  let currentVelocity = 0.4;
  let deceleration = currentVelocity / 150; // frames
  
  function animate() {
    wheelAngle += currentVelocity;
    currentVelocity -= deceleration;
    
    drawWheel();
    
    if (currentVelocity > 0) {
      wheelReqFrame = requestAnimationFrame(animate);
    } else {
      wheelSpinning = false;
      // Calculate winner (top is at -90 degrees / 270 degrees)
      // The pointer is at 12 o'clock (-Math.PI/2)
      
      const sliceAngle = (2 * Math.PI) / pickerPool.length;
      // Normalize wheel angle
      const normalizedAngle = (wheelAngle % (2 * Math.PI)); 
      
      // We need to find which slice is at -PI/2
      // Angle of slice i is: normalizedAngle + i*sliceAngle
      // We want to find i such that: 
      // start <= 1.5 * PI < end   OR   start <= -0.5 * PI < end
      
      let winnerIdx = 0;
      for (let i = 0; i < pickerPool.length; i++) {
        let start = normalizedAngle + i * sliceAngle;
        let end = start + sliceAngle;
        
        // Normalize start to 0-2PI
        start = start % (2 * Math.PI);
        if (start < 0) start += 2 * Math.PI;
        end = start + sliceAngle;
        
        // Target is top (3*PI/2)
        const target = 1.5 * Math.PI;
        
        if (start <= target && target < end) {
          winnerIdx = i;
          break;
        }
        // Handle wrap around case
        if (end > 2*Math.PI && (target >= start || target < (end - 2*Math.PI))) {
          winnerIdx = i;
          break;
        }
      }
      
      // Sometimes math is off by 1 depending on rotation direction, let's reverse finding:
      // It's actually easier to reverse map the angle:
      let topAngle = (1.5 * Math.PI - normalizedAngle) % (2 * Math.PI);
      if (topAngle < 0) topAngle += 2 * Math.PI;
      winnerIdx = Math.floor(topAngle / sliceAngle);
      
      const winnerName = pickerPool[winnerIdx];
      showWinner(winnerName, winnerIdx);
    }
  }
  
  animate();
}

// ── WINNER & SCORES ──
function showWinner(winnerName, winnerIdx) {
  document.getElementById('picker-winner-name').textContent = winnerName;
  document.getElementById('picker-winner-panel').classList.remove('hidden');
  
  // Scroll to winner panel
  document.getElementById('picker-winner-panel').scrollIntoView({ behavior: 'smooth' });
  
  if (document.getElementById('picker-remove-picked').checked) {
    pickerPool.splice(winnerIdx, 1);
    if (pickerMode === 'wheel') drawWheel();
  }
}

async function savePickerScore() {
  const category = document.getElementById('picker-score-category').value.trim();
  const score = document.getElementById('picker-score-value').value.trim();
  const student = document.getElementById('picker-winner-name').textContent;
  const classId = document.getElementById('picker-class-select').value;
  
  if (!category || !score) {
    showToast("❌ Please enter both category and score.");
    return;
  }
  
  const entry = {
    classId,
    student,
    category,
    score: parseFloat(score),
    date: new Date().toISOString()
  };
  
  // Save locally first
  try {
    let localScores = JSON.parse(localStorage.getItem('gv_scores') || '[]');
    localScores.push(entry);
    localStorage.setItem('gv_scores', JSON.stringify(localScores));
    showToast("💾 Score saved locally.");
  } catch(e) {}
  
  if (_db) {
    try {
      const ref = window._firestoreDoc(_db, FIRESTORE_COL, 'scores');
      let existing = [];
      const snap = await window._firestoreGetDoc(ref);
      const exists = typeof snap.exists === 'function' ? snap.exists() : snap.exists;
      if (exists) existing = snap.data().entries || [];
      
      existing.push(entry);
      
      await window._firestoreSetDoc(ref, { entries: existing }, { merge: true });
      showToast("✅ Score synced to Cloud!");
      
      // Clear input
      document.getElementById('picker-score-value').value = '';
      
    } catch (err) {
      console.error(err);
      showToast("⚠️ Offline: Score saved locally only.");
    }
  }
}
