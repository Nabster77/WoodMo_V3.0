import assert from 'node:assert/strict';
import { archiveSubfolders, batchArchiveLocation, safeArchiveFileName } from '../src/lib/archivePaths.ts';

const priorYear = new Date(2025, 11, 31, 10).getTime();
const currentYear = new Date(2026, 10, 12, 9).getTime();

assert.deepEqual(archiveSubfolders({
  fileName: 'Friedrichshafen_Tagesjournal_31-12-2025.pdf',
  location: 'Friedrichshafen',
  reportPeriodStart: priorYear,
}), ['Friedrichshafen', 'Tagesjournal']);
assert.deepEqual(archiveSubfolders({
  fileName: 'Bregenz_Tagesabschluss_2026-11-12_TA-BR-2026-000001.pdf',
  location: 'Bregenz',
  documentTitle: 'Tagesabschluss',
  reportPeriodStart: currentYear,
}), ['Bregenz', 'Tagesabschluss', 'November']);
assert.deepEqual(archiveSubfolders({
  fileName: 'Alle-Standorte_Wochenjournal_KW46.pdf',
  location: 'Alle Standorte',
  reportPeriodStart: currentYear,
}), ['Alle-Standorte', 'Wochenjournal']);
assert.throws(() => archiveSubfolders({
  fileName: 'Journal.pdf',
  location: 'unbekannter Ort',
  reportPeriodStart: currentYear,
}), /Unbekannter Standort/);
assert.equal(safeArchiveFileName('Friedrichshafen_12:30/Beleg?'), 'Friedrichshafen_12_30_Beleg_.pdf');
assert.throws(() => safeArchiveFileName(''), /Ungültiger Dateiname/);

assert.equal(batchArchiveLocation(['Friedrichshafen', 'Bregenz'], 'Tagesabschluesse_2026.pdf'), 'Alle Standorte');
assert.equal(batchArchiveLocation(['Friedrichshafen'], 'Tagesabschluesse_Alle-Standorte_2026.pdf'), 'Alle Standorte');
assert.equal(batchArchiveLocation(['Bregenz'], 'Tagesabschluesse_Bregenz_2026.pdf'), 'Bregenz');
assert.throws(() => batchArchiveLocation([], 'Tagesabschluesse.pdf'), /Leerer PDF-Sammelbericht/);

assert.deepEqual(archiveSubfolders({
  fileName:'Bregenz_Tagesabschluss_2027-01-01.pdf',
  location:'Bregenz',
  reportPeriodStart:Date.parse('2026-12-31T23:30:00Z'),
}), ['Bregenz','Tagesabschluss','Januar'], 'Berlin/Bregenz bereits im neuen Jahr');
assert.deepEqual(archiveSubfolders({
  fileName:'Bregenz_Tagesjournal_2026-12-31.pdf',
  location:'Bregenz',
  reportPeriodStart:Date.parse('2026-12-31T22:30:00Z'),
}), ['Bregenz','Tagesjournal'], 'Historischer Dezember bleibt im alten Jahr');
assert.deepEqual(archiveSubfolders({fileName:'Bregenz_Journal_01-11-2026_bis_15-11-2026.pdf',location:'Bregenz',reportPeriodStart:currentYear}), ['Bregenz','Individuell']);
assert.deepEqual(archiveSubfolders({fileName:'Bregenz_Monatsjournal_Nov-2026.pdf',location:'Bregenz',reportPeriodStart:currentYear}), ['Bregenz','Monatsjournal']);
assert.deepEqual(archiveSubfolders({fileName:'Friedrichshafen_Jahresjournal_2026.pdf',location:'Friedrichshafen',reportPeriodStart:currentYear}), ['Friedrichshafen','Jahresjournal']);
// Tagesabschluss: Monat des Abschlusses, nicht der Eröffnung.
assert.deepEqual(archiveSubfolders({fileName:'Friedrichshafen_Tagesabschluss_2026-10-31_TA-FN-2026-000009.pdf',location:'Friedrichshafen',documentTitle:'Tagesabschluss',
  reportPeriodStart:new Date(2026,9,31,0).getTime(),cashSessionPeriod:{closedAt:Date.parse('2026-11-01T01:30:00+01:00')}}), ['Friedrichshafen','Tagesabschluss','November']);
assert.deepEqual(archiveSubfolders({fileName:'Bregenz_Tagesabschluss_2026-10-03.pdf',location:'Bregenz',documentTitle:'Tagesabschluss',
  reportPeriodStart:new Date(2026,9,3).getTime(),cashSessionPeriod:{closedAt:new Date(2026,9,3,22).getTime()}}), ['Bregenz','Tagesabschluss','Oktober']);
console.log('PDF-Archivpfade bestanden: Zeitbezug, Standorte, Berichtsarten, Monats- und Jahreswechsel.');
