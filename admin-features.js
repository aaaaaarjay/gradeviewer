/* ═══════════════════════════════════════════════
   STUDENTS DIRECTORY LOGIC
   ═══════════════════════════════════════════════ */

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
  
  // Load groups data to show which group they belong to
  const allGroups = JSON.parse(localStorage.getItem('gv_groups') || '{}');
  const classGroups = allGroups[classId] || [];

  studentsDirectoryData = students.map(student => {
    // Find which group they are in
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

function filterStudentsDirectory() {
  if (studentsDirectoryData.length > 0) {
    renderStudentsDirectory();
  }
}


/* ═══════════════════════════════════════════════
   ATTENDANCE TRACKER LOGIC
   ═══════════════════════════════════════════════ */

let attendanceStudents = [];
let attendanceData = {};
let currentAttendanceClassId = '';
let currentAttendanceDate = '';

document.getElementById('nav-attendance').addEventListener('click', () => {
  const sel = document.getElementById('attendance-class-select');
  sel.innerHTML = '<option value="">-- Select a Class --</option>' +
    classList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
  
  if (!document.getElementById('attendance-date').value) {
    // Set to today locally
    const today = new Date();
    document.getElementById('attendance-date').valueAsDate = today;
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

  // Try loading saved attendance for this date
  const stored = JSON.parse(localStorage.getItem('gv_attendance') || '{}');
  const classStored = stored[currentAttendanceClassId] || {};
  attendanceData = classStored[currentAttendanceDate] || {};

  // If no attendance data yet, default everyone to "Present" or null
  attendanceStudents.forEach(s => {
    if (!attendanceData[s]) attendanceData[s] = 'Present'; // default to present to make marking faster
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

function setAttendanceStatus(student, status) {
  attendanceData[student] = status;
  renderAttendanceGrid();
}

function markAllPresent() {
  if (attendanceStudents.length === 0) return;
  attendanceStudents.forEach(s => attendanceData[s] = 'Present');
  renderAttendanceGrid();
  showToast('✅ All marked Present');
}

async function saveAttendance() {
  if (!currentAttendanceClassId || !currentAttendanceDate) return;
  
  // Save locally
  let stored = JSON.parse(localStorage.getItem('gv_attendance') || '{}');
  if (!stored[currentAttendanceClassId]) stored[currentAttendanceClassId] = {};
  stored[currentAttendanceClassId][currentAttendanceDate] = attendanceData;
  localStorage.setItem('gv_attendance', JSON.stringify(stored));
  
  showToast('💾 Attendance saved locally!');
  
  // Sync to Cloud
  if (typeof _db !== 'undefined' && _db) {
    try {
      const ref = window._firestoreDoc(_db, 'gradeviewer', 'attendance');
      await window._firestoreSetDoc(ref, { data: stored }, { merge: true });
      showToast('✅ Attendance synced to Cloud!');
    } catch(e) {
      console.warn('Cloud sync failed:', e);
    }
  }

  // Setup to sync to Google Sheets via Apps Script (Optional)
  const scriptUrl = localStorage.getItem('gv_gsheets_script_url');
  if (scriptUrl) {
    const cls = classList.find(c => c.id === currentAttendanceClassId);
    if (cls) {
      const sheetId = extractSheetId(cls.url);
      if (sheetId) {
        // Send a specific payload for attendance
        const payload = {
          action: 'attendance',
          sheetId: sheetId,
          tabName: 'Attendance', // We assume there's a tab named "Attendance"
          date: currentAttendanceDate,
          attendanceData: attendanceData, // { "Student A": "Present", "Student B": "Absent" }
        };
        
        try {
          fetch(scriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
          }).then(res => res.json()).then(result => {
             if (result.success) {
               showToast('✅ Attendance automatically written to Google Sheets!');
             }
          }).catch(err => {
             console.log("Apps script sync (attendance) failed silently or doesn't support it yet.");
          });
        } catch (e) {
          // ignore
        }
      }
    }
  }
}

/* ═══════════════════════════════════════════════
   CLASS SCHEDULE LOGIC
   ═══════════════════════════════════════════════ */

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

function renderScheduleTable() {
  const tbody = document.getElementById('schedule-tbody');
  const storedSchedule = JSON.parse(localStorage.getItem('gv_schedule') || '{}');
  
  let html = '';
  SCHEDULE_TIMES.forEach((timeStr, rIdx) => {
    html += `<tr>
      <td class="schedule-time-col">${timeStr.replace(/\n/g, '<br>')}</td>`;
    
    SCHEDULE_DAYS.forEach((dayStr, cIdx) => {
      const cellId = `cell-${rIdx}-${cIdx}`;
      const cellContent = storedSchedule[cellId] || '';
      html += `
        <td class="schedule-cell">
          <div class="schedule-cell-content" contenteditable="true" data-cell-id="${cellId}" onblur="saveScheduleCell(this)" oninput="markScheduleUnsaved(this)">${cellContent}</div>
        </td>
      `;
    });
    
    html += `</tr>`;
  });
  
  tbody.innerHTML = html;
}

function saveScheduleCell(element) {
  const cellId = element.getAttribute('data-cell-id');
  const content = element.innerHTML;
  
  const storedSchedule = JSON.parse(localStorage.getItem('gv_schedule') || '{}');
  storedSchedule[cellId] = content;
  localStorage.setItem('gv_schedule', JSON.stringify(storedSchedule));
  
  // Optional: Sync to Cloud if needed
  if (typeof _db !== 'undefined' && _db) {
    try {
      const ref = window._firestoreDoc(_db, 'gradeviewer', 'schedule');
      window._firestoreSetDoc(ref, { data: storedSchedule }, { merge: true });
    } catch(e) {}
  }
}

function markScheduleUnsaved(element) {
  // Can be used to show a saving indicator if desired
}

function printSchedule() {
  window.print();
}
