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

/* ─── CLASS SCHEDULE ─── */

const SCHEDULE_TIMES = [
  "7:30 AM\nto\n9:00 AM",
  "9:00 AM\nto\n10:30 AM",
  "10:30 AM\nto\n12:00 PM",
  "12:00 PM\nto\n1:30 PM",
  "1:30 PM\nto\n3:00 PM",
  "3:00 PM\nto\n4:30 PM",
  "4:30 PM\nto\n6:00 PM",
  "6:00 PM\nto\n7:30 PM",
  "7:30 PM\nto\n9:00 PM"
];

const SCHEDULE_DAYS = ["MW", "TTH", "FS"];

window.renderScheduleTable = function () {
  const tbody = document.getElementById('schedule-tbody');
  if (!tbody) return;
  const storedSchedule = JSON.parse(localStorage.getItem('gv_schedule') || '{}');

  let html = '';
  SCHEDULE_TIMES.forEach((timeStr, rIdx) => {
    html += `<tr><td class="schedule-time-col">${timeStr.replace(/\n/g, '<br>')}</td>`;
    SCHEDULE_DAYS.forEach((dayStr, cIdx) => {
      const cellId = `cell-${rIdx}-${cIdx}`;
      const cellContent = storedSchedule[cellId] || '';
      html += `
        <td class="schedule-cell">
          <div class="schedule-cell-content" contenteditable="true" data-cell-id="${cellId}" onblur="saveScheduleCell(this)">${cellContent}</div>
        </td>`;
    });
    html += `</tr>`;
  });

  tbody.innerHTML = html;
};

window.saveScheduleCell = function (element) {
  const cellId = element.getAttribute('data-cell-id');
  const content = element.innerHTML;
  const storedSchedule = JSON.parse(localStorage.getItem('gv_schedule') || '{}');
  storedSchedule[cellId] = content;
  localStorage.setItem('gv_schedule', JSON.stringify(storedSchedule));
};

window.printSchedule = function () {
  window.print();
};

// Initial render if schedule page is already active on load
if (document.getElementById('page-schedule')?.classList.contains('active')) {
  window.renderScheduleTable();
}

}); // end window load
