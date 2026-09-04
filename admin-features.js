/* ═══════════════════════════════════════════════
   ADMIN FEATURES — Students, Attendance, Schedule
   All code runs after the window fully loads.
   ═══════════════════════════════════════════════ */

window.addEventListener('load', function () {

/* ─── STUDENTS DIRECTORY (GLOBAL SEARCH & LEADERBOARD) ─── */

let studentsDirectoryData = [];
let studentsDirectoryLoaded = false;
let currentStudentProfile = null;

document.getElementById('nav-students').addEventListener('click', () => {
  const sel = document.getElementById('students-class-select');
  sel.innerHTML = '<option value="">All Classes</option>' +
    classList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
    
  if (!studentsDirectoryLoaded) {
    loadAllStudentsGlobal();
  }
});

async function loadAllStudentsGlobal() {
  if (!classList || classList.length === 0) return;
  
  const tbody = document.getElementById('students-directory-tbody');
  const loadingBar = document.getElementById('students-loading-bar');
  const progress = document.getElementById('students-loading-progress');
  const text = document.getElementById('students-loading-text');
  
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted); padding:2rem;">Fetching data...</td></tr>';
  loadingBar.classList.remove('hidden');
  
  studentsDirectoryData = [];
  
  for (let i = 0; i < classList.length; i++) {
    const cls = classList[i];
    progress.style.width = `${Math.round(((i) / classList.length) * 100)}%`;
    text.textContent = `Loading data from ${cls.name}... (${i + 1}/${classList.length})`;
    
    try {
      const wb = await fetchWorkbookForClass(cls.id);
      if (!wb) continue;
      
      // Try to find Summary sheet, fallback to whatever seems to have grades
      const summarySheetName = (wb.SheetNames || []).find(n => n.toLowerCase().includes('summary')) || wb.SheetNames[0];
      const rows = getSheetRows(wb, summarySheetName) || [];
      
      // Basic heuristic to parse FG and Name similar to app.js
      let headerRow = -1;
      for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const cells = rows[r].map(c => String(c).toLowerCase());
        if (cells.some(c => c.includes('name') || c.includes('student'))) { headerRow = r; break; }
      }
      
      if (headerRow >= 0) {
        const header = rows[headerRow].map(c => String(c).toLowerCase().trim());
        const colName = header.findIndex(h => h.includes('name') || h === 'student');
        const colFG = header.findIndex(h => h === 'fg' || h.includes('final grade') || h === 'fg ' || h === 'fc');
        
        for (let r = headerRow + 1; r < rows.length; r++) {
          const row = rows[r];
          // Try exact column or scan nearby columns
          let nameVal = '';
          if (colName >= 0) nameVal = String(row[colName] || '').trim();
          if (!nameVal || nameVal.toLowerCase() === 'student\'s name' || nameVal.length < 5) {
             // Fallback to scanning the row for a valid roster name
             nameVal = row.map(v => String(v || '').trim()).find(v => v.includes(',') && v.length > 5 && !/\d/.test(v)) || '';
          }
          if (!nameVal) continue;
          
          let fgVal = colFG >= 0 ? parseFloat(row[colFG]) : null;
          if (isNaN(fgVal)) fgVal = null;
          
          studentsDirectoryData.push({
            name: nameVal,
            normName: normalizeStudentName(nameVal),
            classId: cls.id,
            className: cls.name,
            fg: fgVal
          });
        }
      } 
      
      // If we couldn't parse the summary sheet well, fallback to the robust roster scanner for this class
      // We only do this if no students were added for this class
      if (!studentsDirectoryData.some(s => s.classId === cls.id)) {
        console.log("Fallback parsing names for", cls.name);
        const names = collectNamesFromWorkbook(wb);
        names.forEach(nameVal => {
          studentsDirectoryData.push({
            name: nameVal,
            normName: normalizeStudentName(nameVal),
            classId: cls.id,
            className: cls.name,
            fg: null
          });
        });
      }
      
    } catch (err) {
      console.warn("Failed to load class for directory:", cls.name, err);
    }
  }
  
  progress.style.width = '100%';
  text.textContent = 'Processing and sorting...';
  
  // Sort by highest grade (1.00 is best in PH grading, so ascending order)
  studentsDirectoryData.sort((a, b) => {
    // Put nulls at the bottom
    if (a.fg === null && b.fg === null) return a.name.localeCompare(b.name);
    if (a.fg === null) return 1;
    if (b.fg === null) return -1;
    return a.fg - b.fg;
  });
  
  // Remove exact duplicates (same name, same class)
  const unique = [];
  const seen = new Set();
  studentsDirectoryData.forEach(s => {
    const key = `${s.normName}_${s.classId}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(s);
    }
  });
  studentsDirectoryData = unique;
  
  setTimeout(() => {
    loadingBar.classList.add('hidden');
    studentsDirectoryLoaded = true;
    filterStudentsDirectory();
  }, 500);
}

function filterStudentsDirectory() {
  const tbody = document.getElementById('students-directory-tbody');
  const classFilter = document.getElementById('students-class-select').value;
  const query = document.getElementById('students-search-input').value.toLowerCase().trim();

  let filtered = studentsDirectoryData;
  if (classFilter) {
    filtered = filtered.filter(s => s.classId === classFilter);
  }
  if (query) {
    filtered = filtered.filter(s => s.name.toLowerCase().includes(query));
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted); padding:2rem;">No students found matching filters.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((s, idx) => {
    const photo = getGlobalPhoto(s.normName);
    const avatar = photo 
      ? `<img src="${photo}" style="width:36px; height:36px; border-radius:50%; object-fit:cover; border:2px solid var(--surface);" />`
      : `<div style="width:36px; height:36px; border-radius:50%; background:var(--primary); color:white; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:0.8rem;">${getInitialsFrom(s.name)}</div>`;
      
    let fgDisplay = s.fg !== null ? s.fg.toFixed(2) : '—';
    let fgColor = 'var(--muted)';
    if (s.fg !== null) {
      if (s.fg <= 3.0) fgColor = 'var(--success)';
      else fgColor = 'var(--danger)';
    }

    return `
    <tr style="cursor:pointer; transition: background 0.2s;" onclick="openStudentSidePanel('${escapeHTML(s.normName)}', '${escapeHTML(s.name)}', '${escapeHTML(s.classId)}', '${escapeHTML(s.className)}', ${s.fg})" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
      <td style="color:var(--muted); font-size:0.85rem; font-weight:bold; text-align:center;">${idx + 1}</td>
      <td style="text-align:center;">${avatar}</td>
      <td style="font-weight:600; font-size:0.95rem;">${escapeHTML(s.name)}</td>
      <td style="font-size:0.85rem; color:var(--muted);">${escapeHTML(s.className)}</td>
      <td style="font-size:1rem; font-weight:bold; color:${fgColor}; text-align:center;">${fgDisplay}</td>
    </tr>
  `}).join('');
}

function getInitialsFrom(name) {
  const parts = name.trim().split(/[\s,]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

function openStudentSidePanel(normName, name, classId, className, fg) {
  currentStudentProfile = { normName, name, classId, className, fg };
  document.getElementById('students-detail-name').textContent = name;
  document.getElementById('students-detail-class').textContent = className;
  
  const gradeEl = document.getElementById('students-detail-grade');
  if (fg !== null && fg !== undefined) {
    gradeEl.textContent = Number(fg).toFixed(2);
    gradeEl.style.color = Number(fg) <= 3.0 ? 'var(--success)' : 'var(--danger)';
  } else {
    gradeEl.textContent = 'N/A';
    gradeEl.style.color = 'var(--text)';
  }
  
  refreshStudentSidePanelPhoto();
  
  document.getElementById('students-side-panel').classList.remove('hidden');
}

function closeStudentSidePanel() {
  document.getElementById('students-side-panel').classList.add('hidden');
  stopStudentsCamera();
}

function refreshStudentSidePanelPhoto() {
  if (!currentStudentProfile) return;
  const photo = getGlobalPhoto(currentStudentProfile.normName);
  const preview = document.getElementById('students-photo-preview');
  const empty = document.getElementById('students-photo-empty');
  
  const removeBtn = document.getElementById('students-photo-remove-btn');
  
  if (photo) {
    preview.src = photo;
    preview.classList.remove('hidden');
    empty.classList.add('hidden');
    if (removeBtn) removeBtn.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
    empty.classList.remove('hidden');
    if (removeBtn) removeBtn.classList.add('hidden');
  }
}

// Side Panel Camera Logic
let studentsMediaStream = null;

async function startStudentsCamera() {
  try {
    studentsMediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    const video = document.getElementById('students-camera-preview');
    video.srcObject = studentsMediaStream;
    
    document.getElementById('students-photo-preview').classList.add('hidden');
    document.getElementById('students-photo-empty').classList.add('hidden');
    video.classList.remove('hidden');
    
    document.getElementById('students-photo-actions-default').classList.add('hidden');
    document.getElementById('students-photo-actions-camera').classList.remove('hidden');
  } catch (err) {
    alert("Camera access denied or unavailable.");
  }
}

function stopStudentsCamera() {
  if (studentsMediaStream) {
    studentsMediaStream.getTracks().forEach(track => track.stop());
    studentsMediaStream = null;
  }
  document.getElementById('students-camera-preview').classList.add('hidden');
  document.getElementById('students-photo-actions-camera').classList.add('hidden');
  document.getElementById('students-photo-actions-default').classList.remove('hidden');
  refreshStudentSidePanelPhoto();
}

function captureStudentsPhoto() {
  const video = document.getElementById('students-camera-preview');
  if (!video.videoWidth || !currentStudentProfile) return;
  
  const canvas = document.getElementById('students-camera-canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  setGlobalPhoto(currentStudentProfile.normName, dataUrl);
  
  stopStudentsCamera();
  filterStudentsDirectory(); // update list thumbnail
}

function handleStudentsPhoto(event) {
  const file = event.target.files?.[0];
  if (!file || !currentStudentProfile) return;
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
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
      setGlobalPhoto(currentStudentProfile.normName, dataUrl);
      refreshStudentSidePanelPhoto();
      filterStudentsDirectory(); // update list thumbnail
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function removeStudentsPhoto() {
  if (!currentStudentProfile) return;
  if (!confirm(`Are you sure you want to remove the photo for ${currentStudentProfile.name}?`)) return;
  
  setGlobalPhoto(currentStudentProfile.normName, null);
  refreshStudentSidePanelPhoto();
  filterStudentsDirectory(); // update list thumbnail
}

window.loadAllStudentsGlobal = loadAllStudentsGlobal;
window.filterStudentsDirectory = filterStudentsDirectory;
window.openStudentSidePanel = openStudentSidePanel;
window.closeStudentSidePanel = closeStudentSidePanel;
window.startStudentsCamera = startStudentsCamera;
window.stopStudentsCamera = stopStudentsCamera;
window.captureStudentsPhoto = captureStudentsPhoto;
window.handleStudentsPhoto = handleStudentsPhoto;
window.removeStudentsPhoto = removeStudentsPhoto;


/* ─── ATTENDANCE TRACKER ─── */

let attendanceStudents = [];
let attendanceData = {};
let currentAttendanceClassId = '';
let currentAttendanceDate = '';

document.getElementById('nav-attendance').addEventListener('click', () => {
  const sel = document.getElementById('attendance-class-select');
  sel.innerHTML = '<option value="">-- Select a Class --</option>' +
    classList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');

  if (!document.getElementById('attendance-date').value) {
    document.getElementById('attendance-date').valueAsDate = new Date();
  }
});

async function loadClassForAttendance() {
  currentAttendanceClassId = document.getElementById('attendance-class-select').value;
  currentAttendanceDate = document.getElementById('attendance-date').value;
  const tbody = document.getElementById('attendance-tbody');

  if (!currentAttendanceClassId || !currentAttendanceDate) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--muted); padding:2rem;">Select a class and date to mark attendance.</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--muted); padding:2rem;">Loading students...</td></tr>';

  attendanceStudents = await fetchStudentsForClass(currentAttendanceClassId);

  if (attendanceStudents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--muted); padding:2rem;">No students found in this class.</td></tr>';
    return;
  }

  const stored = JSON.parse(localStorage.getItem('gv_attendance') || '{}');
  const classStored = stored[currentAttendanceClassId] || {};
  attendanceData = classStored[currentAttendanceDate] || {};

  attendanceStudents.forEach(s => {
    if (!attendanceData[s]) attendanceData[s] = 'Present';
  });

  renderAttendanceGrid();
}

function renderAttendanceGrid() {
  const tbody = document.getElementById('attendance-tbody');
  let presentCount = 0;

  tbody.innerHTML = attendanceStudents.map((s, idx) => {
    const status = attendanceData[s] || 'Present';
    if (status === 'Present') presentCount++;

    return `
      <tr>
        <td style="color:var(--muted); font-size:0.8rem;">${idx + 1}</td>
        <td style="font-weight:600; font-size:0.9rem;">${escapeHTML(s)}</td>
        <td style="text-align:center;">
          <div class="attendance-btn-group">
            <button class="att-btn ${status === 'Present' ? 'att-present active' : ''}" onclick="setAttendanceStatus('${escapeAttr(s)}', 'Present')">P</button>
            <button class="att-btn ${status === 'Late' ? 'att-late active' : ''}" onclick="setAttendanceStatus('${escapeAttr(s)}', 'Late')">L</button>
            <button class="att-btn ${status === 'Absent' ? 'att-absent active' : ''}" onclick="setAttendanceStatus('${escapeAttr(s)}', 'Absent')">A</button>
            <button class="att-btn ${status === 'Excused' ? 'att-excused active' : ''}" onclick="setAttendanceStatus('${escapeAttr(s)}', 'Excused')">E</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById('attendance-stats').textContent = `${presentCount} Present / ${attendanceStudents.length} Total`;
}

window.setAttendanceStatus = function (student, status) {
  attendanceData[student] = status;
  renderAttendanceGrid();
};

window.markAllPresent = function () {
  if (attendanceStudents.length === 0) return;
  attendanceStudents.forEach(s => attendanceData[s] = 'Present');
  renderAttendanceGrid();
  showToast('✅ All marked Present');
};

window.loadClassForAttendance = loadClassForAttendance;

window.saveAttendance = async function () {
  if (!currentAttendanceClassId || !currentAttendanceDate) return;

  let stored = JSON.parse(localStorage.getItem('gv_attendance') || '{}');
  if (!stored[currentAttendanceClassId]) stored[currentAttendanceClassId] = {};
  stored[currentAttendanceClassId][currentAttendanceDate] = attendanceData;
  localStorage.setItem('gv_attendance', JSON.stringify(stored));

  showToast('💾 Attendance saved!');

  const scriptUrl = localStorage.getItem('gv_gsheets_script_url');
  if (scriptUrl) {
    const cls = classList.find(c => c.id === currentAttendanceClassId);
    if (cls) {
      const sheetId = typeof extractSheetId === 'function' ? extractSheetId(cls.url) : null;
      if (sheetId) {
        const payload = {
          action: 'attendance',
          sheetId,
          tabName: 'Attendance',
          date: currentAttendanceDate,
          attendanceData,
        };
        try {
          fetch(scriptUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) })
            .then(r => r.json())
            .then(res => { if (res.success) showToast('✅ Attendance synced to Sheets!'); })
            .catch(() => {});
        } catch (e) {}
      }
    }
  }
};

/* ─── CLASS SCHEDULE (auto-built from classList) ─── */

const SCHEDULE_TIME_SLOTS = [
  { label: "7:30 AM\nTO\n9:00 AM",   start: "7:30",  period: "AM" },
  { label: "9:00 AM\nTO\n10:30 AM",  start: "9:00",  period: "AM" },
  { label: "10:30 AM\nTO\n12:00 PM", start: "10:30", period: "AM" },
  { label: "12:00 PM\nTO\n1:30 PM",  start: "12:00", period: "PM" },
  { label: "1:30 PM\nTO\n3:00 PM",   start: "1:30",  period: "PM" },
  { label: "3:00 PM\nTO\n4:30 PM",   start: "3:00",  period: "PM" },
  { label: "4:30 PM\nTO\n6:00 PM",   start: "4:30",  period: "PM" },
  { label: "6:00 PM\nTO\n7:30 PM",   start: "6:00",  period: "PM" },
  { label: "7:30 PM\nTO\n9:00 PM",   start: "7:30",  period: "PM" },
];

const SCHEDULE_DAY_COLS = ["MW", "TTH", "FS"];

function parseSchedule(scheduleStr) {
  if (!scheduleStr) return null;
  const str = scheduleStr.trim().toUpperCase();

  // Detect day column
  let col = -1;
  if (str.startsWith("MW"))       col = 0;
  else if (str.startsWith("TTH") || str.startsWith("TH")) col = 1;
  else if (str.startsWith("FS")  || str.startsWith("F"))  col = 2;
  if (col < 0) return null;

  // Extract time part after the day identifier
  const timePart = str.replace(/^(TTH|MW|FS|TH|F)\s*/, '');
  // Get the start time e.g. "9:00" from "9:00-10:30 AM"
  const timeMatch = timePart.match(/(\d{1,2}):(\d{2})/);
  if (!timeMatch) return null;
  const startHHMM = timeMatch[1] + ':' + timeMatch[2]; // e.g. "9:00"

  // Determine AM/PM
  const isPM = timePart.includes('PM');
  const startH = parseInt(timeMatch[1]);
  // Normalize: if no AM/PM, guess by hour (< 7 → PM, >= 7 → AM unless hour < 12 with PM label)
  const period = isPM ? 'PM' : 'AM';

  // Find matching row
  let row = -1;
  // First pass: exact match including AM/PM
  for (let i = 0; i < SCHEDULE_TIME_SLOTS.length; i++) {
    const slot = SCHEDULE_TIME_SLOTS[i];
    if (slot.start === startHHMM && slot.period === period) { row = i; break; }
  }
  
  // Second pass: if no exact match (e.g. they didn't write AM/PM), match by time only
  if (row < 0) {
    for (let i = 0; i < SCHEDULE_TIME_SLOTS.length; i++) {
      if (SCHEDULE_TIME_SLOTS[i].start === startHHMM) { row = i; break; }
    }
  }
  
  if (row < 0) return null;

  return { row, col };
}

function parseClassName(name) {
  // Format: "IT WST21 - Section 9" → { subject: "IT WST21", section: "Section 9" }
  const parts = name.split(' - ');
  if (parts.length >= 2) {
    return { subject: parts[0].trim(), section: parts.slice(1).join(' - ').trim() };
  }
  return { subject: name, section: '' };
}

window.renderScheduleTable = function () {
  const tbody = document.getElementById('schedule-tbody');
  if (!tbody) return;

  // Build grid: 9 rows × 3 cols
  const grid = Array.from({ length: 9 }, () => ['', '', '']);

  // Populate grid from classList
  const allClasses = (typeof classList !== 'undefined') ? classList : [];
  allClasses.forEach(cls => {
    const parsed = parseSchedule(cls.schedule);
    if (!parsed) return;
    const { subject, section } = parseClassName(cls.name);
    const room = cls.room || '';
    const cell = `<strong>${escapeHTML(subject)}</strong><br>${escapeHTML(section)}<br><span style="opacity:0.7">${escapeHTML(room)}</span>`;
    grid[parsed.row][parsed.col] = cell;
  });

  let html = '';
  SCHEDULE_TIME_SLOTS.forEach((slot, rIdx) => {
    html += `<tr>
      <td class="schedule-time-col">${slot.label.replace(/\n/g, '<br>')}</td>`;
    for (let c = 0; c < 3; c++) {
      html += `<td class="schedule-cell"><div class="schedule-cell-content">${grid[rIdx][c]}</div></td>`;
    }
    html += `</tr>`;
  });

  tbody.innerHTML = html;
};

window.printSchedule = function () {
  window.print();
};

// Render on load if schedule page is active
if (document.getElementById('page-schedule')?.classList.contains('active')) {
  window.renderScheduleTable();
}

}); // end window load

