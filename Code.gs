/**
 * Grade Viewer score synchronizer.
 *
 * Deploy this file as a Web app:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * The portal sends one category at a time. The handler updates the existing
 * Q1-Q4, O1-O4, G1-G4, or E1-E4 columns in the selected grading-period tab.
 */
function doPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var sheetId = String(payload.sheetId || '').trim();
    var tabName = String(payload.tabName || payload.sheetName || '').trim();
    if (!sheetId || !tabName) {
      return jsonResponse({ success: false, error: 'Missing sheetId or tabName.' });
    }

    var spreadsheet = SpreadsheetApp.openById(sheetId);
    if (String(payload.action || '').toLowerCase() === 'savegroups') {
      return saveGroupsSheet(spreadsheet, payload);
    }
    if (String(payload.action || '').toLowerCase() === 'savegroupscore') {
      return saveGroupScoreSheet(spreadsheet, payload);
    }
    if (String(payload.action || '').toLowerCase() === 'deletegroup') {
      return deleteGroupFromSheet(spreadsheet, payload);
    }
    if (String(payload.action || '').toLowerCase() === 'deleteallgroups') {
      return deleteAllGroupsFromSheet(spreadsheet);
    }
    var sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet) {
      return jsonResponse({ success: false, error: 'Sheet tab not found: ' + tabName });
    }

    var values = sheet.getDataRange().getValues();
    var header = findStudentHeader(values);
    if (header.row < 0) {
      return jsonResponse({ success: false, error: 'Student name header was not found in ' + tabName + '.' });
    }

    var headers = Array.isArray(payload.headers) && payload.headers.length
      ? payload.headers
      : headersForCategory(payload.category || payload.categoryId);
    var columns = findScoreColumns(values, headers, header.row);
    if (columns.every(function(column) { return column < 0; })
        && String(payload.category || payload.categoryId || '').toLowerCase() === 'exam') {
      var legacyExamColumn = findLegacyExamColumn(values, header.row, payload.period);
      if (legacyExamColumn >= 0) columns[0] = legacyExamColumn;
    }
    if (!columns.some(function(column) { return column >= 0; })) {
      return jsonResponse({ success: false, error: 'Score columns were not found in ' + tabName + '.' });
    }

    var studentScores = payload.studentScores || payload.scores || payload.scoresByStudent || {};
    var studentNames = Array.isArray(payload.studentNames)
      ? payload.studentNames
      : Object.keys(studentScores);
    var maxScores = Array.isArray(payload.maxScores)
      ? payload.maxScores
      : (Array.isArray(payload.perfectScores) ? payload.perfectScores : []);
    var scoreIndexes = Array.isArray(payload.scoreIndexes)
      ? payload.scoreIndexes
      : columns.map(function(_column, index) { return index; });
    var changedCells = 0;
    var matchedStudents = 0;

    // In this class-record template, perfect scores are on the same row as
    // "Student's Name" (the Q1/O1/G1 labels are on the row above). Support
    // templates that put the perfect-score row immediately below as well.
    var headerHasNumber = columns.some(function(column) {
      if (column < 0) return false;
      var value = values[header.row] && values[header.row][column];
      return value !== '' && value != null && isFinite(Number(value));
    });
    var maxRow = header.row;
    if (!headerHasNumber) {
      var nextNameCell = String(values[header.row + 1] && values[header.row + 1][header.nameCol] || '').trim();
      if (!looksLikeStudent(nextNameCell)) maxRow = header.row + 1;
    }

    if (maxRow >= 0 && maxRow < values.length) {
      for (var mi = 0; mi < columns.length; mi++) {
        if (columns[mi] < 0 || maxScores[mi] === '' || maxScores[mi] == null) continue;
        sheet.getRange(maxRow + 1, columns[mi] + 1).setValue(maxScores[mi]);
        changedCells++;
      }
    }

    for (var si = 0; si < studentNames.length; si++) {
      var studentName = String(studentNames[si] || '').trim();
      var studentKey = normalizeName(studentName);
      if (!studentKey) continue;

      var row = findStudentRow(values, header, studentKey);
      if (row < 0) continue;
      matchedStudents++;

      var rowScores = studentScores[studentKey] || studentScores[studentName.toUpperCase()] || [];
      for (var ci = 0; ci < columns.length; ci++) {
        if (columns[ci] < 0 || scoreIndexes.indexOf(ci) < 0) continue;
        var score = rowScores[ci] == null ? '' : rowScores[ci];
        sheet.getRange(row + 1, columns[ci] + 1).setValue(score);
        changedCells++;
      }
    }

    SpreadsheetApp.flush();
    return jsonResponse({
      success: changedCells > 0,
      writeCount: changedCells,
      matchedStudents: matchedStudents,
      tabName: tabName
    });
  } catch (error) {
    return jsonResponse({ success: false, error: String(error && error.message || error) });
  }
}

function saveGroupsSheet(spreadsheet, payload) {
  var sheet = spreadsheet.getSheetByName('Groups');
  if (!sheet) sheet = spreadsheet.insertSheet('Groups');

  var rawNames = Array.isArray(payload.studentNames) ? payload.studentNames : [];
  var names = [];
  var seenNames = {};
  rawNames.forEach(function(value) {
    var name = String(value || '').trim();
    var key = normalizeName(name);
    if (!key || seenNames[key] || name.indexOf(',') < 0 || /\d/.test(name)) return;
    seenNames[key] = true;
    names.push(name);
  });
  if (!names.length) {
    return jsonResponse({ success: false, error: 'No student names were provided for the Groups sheet.' });
  }

  var groups = Array.isArray(payload.groups) ? payload.groups : [];
  var groupByStudent = {};
  groups.forEach(function(group, groupIndex) {
    var groupName = String(group && group.name || ('Group ' + (groupIndex + 1))).trim();
    var groupNumberMatch = groupName.match(/(\d+)/);
    var groupNumber = groupNumberMatch ? groupNumberMatch[1] : String(groupIndex + 1);
    var members = Array.isArray(group && group.students) ? group.students : [];
    var validMembers = [];
    members.forEach(function(member) {
      var name = String(member || '').trim();
      var key = normalizeName(name);
      if (!seenNames[key] || validMembers.some(function(existing) { return normalizeName(existing) === key; })) return;
      validMembers.push(name);
      groupByStudent[key] = { number: groupNumber, member: name };
    });
  });

  var rowsToClear = Math.max(0, sheet.getLastRow() - 1, names.length);
  if (sheet.getMaxRows() < names.length + 1) {
    sheet.insertRowsAfter(sheet.getMaxRows(), names.length + 1 - sheet.getMaxRows());
  }
  if (rowsToClear > 0) {
    sheet.getRange(2, 1, rowsToClear, 1).clearContent();
    sheet.getRange(2, 5, rowsToClear, 2).clearContent();
  }

  sheet.getRange(1, 1).setValue('All students');
  sheet.getRange(1, 2).setValue('Score 1');
  sheet.getRange(1, 3).setValue('Score 2');
  sheet.getRange(1, 5).setValue('Group Number');
  sheet.getRange(1, 6).setValue('Group Members');

  var studentRows = names.map(function(name) { return [name]; });
  var groupRows = names.map(function(name) {
    var group = groupByStudent[normalizeName(name)];
    return [group ? group.number : '', group ? group.member : ''];
  });
  sheet.getRange(2, 1, studentRows.length, 1).setValues(studentRows);
  sheet.getRange(2, 5, groupRows.length, 2).setValues(groupRows);
  SpreadsheetApp.flush();

  return jsonResponse({
    success: true,
    action: 'saveGroups',
    writeCount: 3 + names.length * 3,
    groupCount: groups.length,
    assignedStudentCount: Object.keys(groupByStudent).length,
    studentCount: names.length,
    tabName: 'Groups'
  });
}

function saveGroupScoreSheet(spreadsheet, payload) {
  var sheet = spreadsheet.getSheetByName('Groups');
  if (!sheet) return jsonResponse({ success: false, error: 'Groups sheet was not found. Save the groups first.' });

  var scoreColumn = Number(payload.scoreColumn);
  if (scoreColumn !== 2 && scoreColumn !== 3) {
    return jsonResponse({ success: false, error: 'Group score column must be Score 1 or Score 2.' });
  }

  var studentScores = payload.studentScores || payload.scores || {};
  var studentNames = Array.isArray(payload.studentNames) ? payload.studentNames : Object.keys(studentScores);
  var values = sheet.getDataRange().getValues();
  var rowsByStudent = {};
  for (var r = 1; r < values.length; r++) {
    var key = normalizeName(values[r][0]);
    if (key) rowsByStudent[key] = r;
  }

  var changedCells = 0;
  var matchedStudents = 0;
  studentNames.forEach(function(student) {
    var key = normalizeName(student);
    if (!key || rowsByStudent[key] == null) return;
    var row = rowsByStudent[key];
    var score = studentScores[key];
    if (Array.isArray(score)) score = score[0];
    sheet.getRange(row + 1, scoreColumn).setValue(score == null ? '' : score);
    changedCells++;
    matchedStudents++;
  });

  SpreadsheetApp.flush();
  return jsonResponse({
    success: changedCells > 0,
    action: 'saveGroupScore',
    writeCount: changedCells,
    matchedStudents: matchedStudents,
    scoreColumn: scoreColumn,
    tabName: 'Groups'
  });
}

function deleteGroupFromSheet(spreadsheet, payload) {
  var sheet = spreadsheet.getSheetByName('Groups');
  if (!sheet) return jsonResponse({ success: false, error: 'Groups sheet was not found.' });

  var names = Array.isArray(payload.studentNames) ? payload.studentNames : [];
  var wanted = {};
  names.forEach(function(name) { wanted[normalizeName(name)] = true; });
  var values = sheet.getDataRange().getValues();
  var changedCells = 0;
  var matchedStudents = 0;
  for (var r = 1; r < values.length; r++) {
    if (!wanted[normalizeName(values[r][0])]) continue;
    // Clear Score 1, Score 2, Group Number, and Group Members for this group.
    sheet.getRange(r + 1, 2, 1, 2).clearContent();
    sheet.getRange(r + 1, 5, 1, 2).clearContent();
    changedCells += 4;
    matchedStudents++;
  }

  SpreadsheetApp.flush();
  return jsonResponse({
    success: changedCells > 0,
    action: 'deleteGroup',
    writeCount: changedCells,
    matchedStudents: matchedStudents,
    tabName: 'Groups'
  });
}

function deleteAllGroupsFromSheet(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('Groups');
  if (!sheet) return jsonResponse({ success: true, action: 'deleteAllGroups', writeCount: 0, tabName: 'Groups' });

  var rowCount = Math.max(0, sheet.getLastRow() - 1);
  if (rowCount > 0) {
    // Preserve All students in column A and the headers. Clear helper scores
    // and group assignment columns only.
    sheet.getRange(2, 2, rowCount, 2).clearContent();
    sheet.getRange(2, 5, rowCount, 2).clearContent();
  }
  SpreadsheetApp.flush();
  return jsonResponse({
    success: true,
    action: 'deleteAllGroups',
    writeCount: rowCount * 4,
    tabName: 'Groups'
  });
}

function headersForCategory(category) {
  var prefixes = { Quiz: 'Q', Oral: 'O', Activity: 'G', Exam: 'E' };
  var prefix = prefixes[category] || String(category || '');
  return [1, 2, 3, 4].map(function(number) { return prefix + number; });
}

function normalizeName(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizeHeader(value) {
  return String(value == null ? '' : value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function looksLikeStudent(value) {
  var text = String(value || '').trim();
  if (text.length < 3 || /^\d/.test(text)) return false;
  if (/\b\d{1,2}:\d{2}\s*(AM|PM)?\b/i.test(text)) return false;
  if (/^(ROOM|DAYS?|TEACHER|SUBJECT|TIME|CODE)\s*:/i.test(text)) return false;
  if (/^(STUDENT'?S? NAME|NAME|NAMES|STUDENT|STUDENTS)$/i.test(text)) return false;
  return text.indexOf(' ') >= 0 || text.indexOf(',') >= 0;
}

function findStudentHeader(values) {
  for (var r = 0; r < Math.min(values.length, 20); r++) {
    for (var c = 0; c < values[r].length; c++) {
      var cell = String(values[r][c] == null ? '' : values[r][c]).trim().toLowerCase();
      if (cell === 'name' || cell === 'names' || cell === 'student' || cell === 'students'
          || (cell.indexOf('student') >= 0 && cell.indexOf('name') >= 0)) {
        return { row: r, nameCol: c };
      }
    }
  }
  return { row: -1, nameCol: 0 };
}

function findScoreColumns(values, headers, preferredRow) {
  var rowOrder = [];
  var center = Number.isInteger(preferredRow) ? preferredRow : 0;
  for (var distance = 0; distance < 20; distance++) {
    var before = center - distance;
    var after = center + distance;
    if (before >= 0 && rowOrder.indexOf(before) < 0) rowOrder.push(before);
    if (after < values.length && rowOrder.indexOf(after) < 0) rowOrder.push(after);
  }

  return headers.map(function(header) {
    var wanted = normalizeHeader(header);
    for (var oi = 0; oi < rowOrder.length; oi++) {
      var r = rowOrder[oi];
      if (r >= Math.min(values.length, 20)) continue;
      for (var c = 0; c < values[r].length; c++) {
        if (normalizeHeader(values[r][c]) === wanted) return c;
      }
    }
    return -1;
  });
}

function findLegacyExamColumn(values, preferredRow, period) {
  var aliases = String(period || '').toLowerCase() === 'final'
    ? ['F35', 'FINAL', 'EXAM']
    : String(period || '').toLowerCase() === 'midterm'
      ? ['M35', 'MIDTERM', 'EXAM']
      : ['EXAM', 'E35'];
  var rowOrder = [];
  var center = Number.isInteger(preferredRow) ? preferredRow : 0;
  for (var distance = 0; distance < 20; distance++) {
    var before = center - distance;
    var after = center + distance;
    if (before >= 0 && rowOrder.indexOf(before) < 0) rowOrder.push(before);
    if (after < values.length && rowOrder.indexOf(after) < 0) rowOrder.push(after);
  }
  for (var oi = 0; oi < rowOrder.length; oi++) {
    var r = rowOrder[oi];
    if (r >= Math.min(values.length, 20)) continue;
    for (var c = 0; c < values[r].length; c++) {
      if (aliases.indexOf(normalizeHeader(values[r][c])) >= 0) return c;
    }
  }
  return -1;
}

function findStudentRow(values, header, wantedName) {
  for (var r = header.row + 1; r < values.length; r++) {
    if (normalizeName(values[r][header.nameCol]) === wantedName) return r;
    for (var c = Math.max(0, header.nameCol - 1); c <= Math.min(values[r].length - 1, header.nameCol + 3); c++) {
      if (normalizeName(values[r][c]) === wantedName) return r;
    }
  }
  return -1;
}

function jsonResponse(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
