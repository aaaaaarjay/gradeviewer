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
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
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

async function fetchStudentsForClass(classId) {
  const cls = classList.find(c => c.id === classId);
  if (!cls || !cls.url) return [];

  const sheetId = extractSheetId(cls.url);
  if (!sheetId) return [];

  try {
    const fetchUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
    const res = await fetch(fetchUrl);
    const arrayBuffer = await res.arrayBuffer();
    
    // Parse with SheetJS
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    if (!wb.SheetNames.length) return [];
    
    // Scan sheets to find names (prefer Summary or Student ID sheet)
    const names = new Set();
    
    for (let i = 0; i < Math.min(4, wb.SheetNames.length); i++) {
      const sheet = wb.Sheets[wb.SheetNames[i]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      
      let headerRow = -1;
      let nameCol = 0;
      
      // 1. Find the header row that contains "Name" or "Student"
      for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const cells = rows[r].map(c => String(c).toLowerCase().trim());
        const idx = cells.findIndex(c => c.includes('name') || c.includes('student'));
        if (idx >= 0) {
          headerRow = r;
          nameCol = idx;
          break;
        }
      }
      
      if (headerRow < 0) continue; // Skip sheet if no header found
      
      // 2. Read names from that column downwards
      for (let r = headerRow + 1; r < rows.length; r++) {
        const val = findNameInRow(rows[r], nameCol);
        if (val) {
          names.add(val);
        }
      }
      
      if (names.size > 10) break; // If we found a good list, stop searching other sheets
    }
    
    return Array.from(names).sort();

  } catch (err) {
    console.error("Error fetching students:", err);
    return [];
  }
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

  const cls = classList.find(c => c.id === classId);
  document.getElementById('groups-class-name').textContent = cls.name;
  document.getElementById('groups-student-count').textContent = `${currentStudents.length} students loaded`;
  
  document.getElementById('groups-workspace').classList.remove('hidden');
  document.getElementById('groups-container').innerHTML = `
    <div style="grid-column: 1/-1; text-align:center; padding: 2rem; color:var(--muted);">
      Ready! Choose how to divide them and click Randomize.
    </div>
  `;
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

  groupsEditMode = false;
  renderGroups();
  document.getElementById('groups-workspace').classList.remove('hidden');

  const cls = classList.find(c => c.id === document.getElementById('group-class-select').value);
  if (cls) document.getElementById('groups-class-name').textContent = cls.name;
  document.getElementById('groups-student-count').textContent =
    `${currentStudents.length} students — ${numGroups} groups`;
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
  
  groupsEditMode = false; // Start in locked mode
  renderGroups();
  renderUnassigned();
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
      <div class="group-header">
        <input type="text" class="group-name-input" value="${escapeHTML(g.name)}" 
               onchange="updateGroupName(${gidx}, this.value)" ${!groupsEditMode ? 'readonly' : ''} />
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
  
  // Save locally first for offline
  try {
    let localData = JSON.parse(localStorage.getItem('gv_groups') || '{}');
    localData[classId] = currentGroups;
    localStorage.setItem('gv_groups', JSON.stringify(localData));
    showToast("💾 Saved locally.");
  } catch(e) {}
  
  // Try online sync
  if (_db) {
    try {
      const ref = window._firestoreDoc(_db, FIRESTORE_COL, 'groups');
      let existing = {};
      const snap = await window._firestoreGetDoc(ref);
      if (snap.exists) existing = snap.data().classes || {};
      
      existing[classId] = currentGroups;
      await window._firestoreSetDoc(ref, { classes: existing }, { merge: true });
      showToast("✅ Groups synced to Cloud!");
    } catch (err) {
      console.error(err);
      showToast("⚠️ Offline: Groups saved locally only.");
    }
  }
}


/* ═══════════════════════════════════════════════
   RANDOM PICKER
   ═══════════════════════════════════════════════ */

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
      if (snap.exists) existing = snap.data().entries || [];
      
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
