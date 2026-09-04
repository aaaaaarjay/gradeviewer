/* ═══════════════════════════════════════════════
   ADMIN FEATURES — Students, Attendance, Schedule
   All code runs after the window fully loads.
   ═══════════════════════════════════════════════ */

window.addEventListener('load', function () {

/* ─── STUDENTS DIRECTORY ─── */

let studentsDirectoryData = [];

document.getElementById('nav-students').addEventListener('click', () => {
  const sel = document.getElementById('students-class-select');
  sel.innerHTML = '<option value="">-- Select a Class --</option>' +
    classList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
});

async function loadStudentsDirectory() {
  const classId = document.getElementById('students-class-select').value;
  const tbody = document.getElementById('students-directory-tbody');

  if (!classId) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--muted); padding:2rem;">Select a class to view students.</td></tr>';
    studentsDirectoryData = [];
    return;
  }

  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--muted); padding:2rem;">Loading students...</td></tr>';

  const students = await fetchStudentsForClass(classId);
  const cls = classList.find(c => c.id === classId);

  const allGroups = JSON.parse(localStorage.getItem('gv_groups') || '{}');
  const classGroups = allGroups[classId] || [];

  studentsDirectoryData = students.map(student => {
    let groupName = '—';
    for (let i = 0; i < classGroups.length; i++) {
      if (classGroups[i].members.includes(student)) {
        groupName = `Group ${i + 1}`;
        break;
      }
    }
    return { name: student, className: cls?.name || 'Unknown', groupName };
  });

  renderStudentsDirectory();
}

function renderStudentsDirectory() {
  const tbody = document.getElementById('students-directory-tbody');
  const query = document.getElementById('students-search-input').value.toLowerCase().trim();

  let filtered = studentsDirectoryData;
  if (query) {
    filtered = filtered.filter(s => s.name.toLowerCase().includes(query));
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--muted); padding:2rem;">No students found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((s, idx) => `
    <tr>
      <td style="color:var(--muted); font-size:0.8rem;">${idx + 1}</td>
      <td style="font-weight:600; font-size:0.9rem;">${escapeHTML(s.name)}</td>
      <td style="font-size:0.85rem;">${escapeHTML(s.className)}</td>
      <td><span class="key-badge ${s.groupName !== '—' ? 'unlocked' : ''}" style="font-size:0.75rem;">${escapeHTML(s.groupName)}</span></td>
    </tr>
  `).join('');
}

window.filterStudentsDirectory = function () {
  if (studentsDirectoryData.length > 0) renderStudentsDirectory();
};

window.loadStudentsDirectory = loadStudentsDirectory;

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

