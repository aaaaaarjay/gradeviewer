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

/* ─── SHARED: FETCH STUDENTS ─── */
function extractSheetId(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

function looksLikeName(str) {
  if (!str || str.length < 3) return false;
  const s = str.trim();
  const lower = s.toLowerCase();
  
  // Exclude common labels
  if (['male','female','total','average','mean','sd','remarks'].includes(lower)) return false;
  if (lower.startsWith('instructor') || lower.startsWith('teacher') || lower.endsWith(':')) return false;
  if (/^\d+$/.test(s)) return false;
  
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

function randomizeGroups() {
  if (currentStudents.length === 0) return;
  
  const count = parseInt(document.getElementById('group-count-input').value) || 5;
  const mode = document.getElementById('group-mode-select').value;
  
  // Shuffle array
  const shuffled = [...currentStudents].sort(() => Math.random() - 0.5);
  currentGroups = [];
  
  let numGroups = count;
  if (mode === 'members') {
    numGroups = Math.ceil(shuffled.length / count);
  }
  
  // Initialize groups
  for (let i = 0; i < numGroups; i++) {
    currentGroups.push({
      id: 'group_' + i,
      name: 'Group ' + (i + 1),
      students: []
    });
  }
  
  // Distribute
  shuffled.forEach((student, idx) => {
    currentGroups[idx % numGroups].students.push(student);
  });
  
  renderGroups();
}

function renderGroups() {
  const container = document.getElementById('groups-container');
  container.innerHTML = currentGroups.map((g, gidx) => `
    <div class="group-card" ondragover="allowDrop(event)" ondrop="drop(event, ${gidx})">
      <div class="group-header">
        <input type="text" class="group-name-input" value="${escapeHTML(g.name)}" 
               onchange="updateGroupName(${gidx}, this.value)" />
      </div>
      <div class="group-list">
        ${g.students.map((s, sidx) => `
          <div class="group-student" draggable="true" ondragstart="drag(event, ${gidx}, ${sidx})">
            ${escapeHTML(s)}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function updateGroupName(gidx, newName) {
  if (currentGroups[gidx]) {
    currentGroups[gidx].name = newName;
  }
}

// Drag and drop logic
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
  const studentIdx = ev.dataTransfer.getData("studentIdx");
  
  if (fromGroup !== "" && fromGroup != toGroupIdx) {
    const student = currentGroups[fromGroup].students.splice(studentIdx, 1)[0];
    currentGroups[toGroupIdx].students.push(student);
    renderGroups();
  }
}

async function saveGroups() {
  if (currentGroups.length === 0) return;
  const classId = document.getElementById('group-class-select').value;
  
  try {
    const ref = window._firestoreDoc(_db, FIRESTORE_COL, 'groups');
    // Fetch existing
    let existing = {};
    const snap = await window._firestoreGetDoc(ref);
    if (snap.exists) existing = snap.data().classes || {};
    
    existing[classId] = currentGroups;
    
    await window._firestoreSetDoc(ref, { classes: existing }, { merge: true });
    showToast("✅ Groups saved to Cloud!");
  } catch (err) {
    console.error(err);
    showToast("⚠️ Could not save to Cloud. (Are you online?)");
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
  
  try {
    const ref = window._firestoreDoc(_db, FIRESTORE_COL, 'scores');
    let existing = [];
    const snap = await window._firestoreGetDoc(ref);
    if (snap.exists) existing = snap.data().entries || [];
    
    existing.push({
      classId,
      student,
      category,
      score: parseFloat(score),
      date: new Date().toISOString()
    });
    
    await window._firestoreSetDoc(ref, { entries: existing }, { merge: true });
    showToast("✅ Score saved to Cloud!");
    
    // Clear input
    document.getElementById('picker-score-value').value = '';
    
  } catch (err) {
    console.error(err);
    showToast("⚠️ Could not save score. (Are you online?)");
  }
}
