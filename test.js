function normalise(str) {
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}
function isNumeric(str) {
  return /^\d+$/.test(String(str).trim());
}
function isHeader(str) {
  const s = str.toLowerCase().trim();
  return ['student\'s name', 'name', 'student name', 'no.', 'no', '#'].includes(s);
}
function parseStudentIdSheet(rows) {
  const result = {};
  if (!rows || rows.length === 0) return result;
  let nameCol = 0;
  let idCol = 1;
  let headerRow = -1;
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const cells = rows[r].map(c => String(c).toLowerCase().trim());
    if (cells.some(c => c.includes('name') || c.includes('student'))) {
      headerRow = r;
      nameCol = cells.findIndex(c => c.includes('name') || c.includes('student'));
      idCol = cells.findIndex(c => c.includes('id') || c.includes('number'));
      if (nameCol < 0) nameCol = 0;
      if (idCol < 0) idCol = 1;
      break;
    }
  }
  if (headerRow < 0) headerRow = 0;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[nameCol] || '').trim();
    const id = String(row[idCol] || '').trim();
    if (name && !isHeader(name) && !isNumeric(name) && id) {
      result[normalise(name)] = id;
    }
  }
  return result;
}

const rows = [
  [],
  ['Student Name', 'StudentID'],
  ['ABAD, JUVIE ANN C.', '2517107'],
  ['ABELLA, JAMES ANDREW L.', '2517113'],
  ['ALFEREZ, HANNAH MAY REY', '2211355'],
  ['ALLERA, MIKE DAVE R.', '2414302']
];

console.log('Result:', parseStudentIdSheet(rows));