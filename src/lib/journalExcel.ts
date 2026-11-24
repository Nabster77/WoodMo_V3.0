import type { Category, Transaction } from '@/types';
import { compareJournalRows, type JournalSort } from '@/lib/journalOrdering';

/**
 * Excel-Export der gewählten Journal-Auswertung (24.11.). Nutzt GENAU die im Journal
 * angezeigten, gefilterten Bons und Kennzahlen. Echte Zahlen (€-Format) und Datumswerte,
 * klare Summenzeilen, Standort und Zeitraum stehen oben in jeder Tabelle.
 */
export interface JournalExcelInput {
  title: string;            // z. B. „Monatsübersicht November 2026 · Bregenz · Warengruppen“
  location: string;         // „Bregenz“ oder „Alle Standorte“
  period: string;           // „01.11.2026 bis 24.11.2026“
  exportedBy?: string;
  transactions: Transaction[];   // gefilterte Bons inkl. Storno-Gegenbuchungen (wie Anzeige)
  itemTransactions: Transaction[]; // Bons mit Positionen wie in den Listen (Suche berücksichtigt)
  categories: Category[];
  sort: JournalSort;
  stats: { total: number; totalNet: number; totalTax: number; pfandCollected: number; pfandReturned: number; pfandSaldo: number; count: number; stornoCount: number };
  fileName: string;         // ohne Endung
}

const EURO = '#,##0.00 "€";[Red]-#,##0.00 "€"';
const round2 = (value: number) => Math.round(value * 100) / 100;

export async function exportJournalExcel(input: JournalExcelInput): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WOODMO Kassen-App';
  workbook.created = new Date();

  type Sheet = ReturnType<typeof workbook.addWorksheet>;
  const header = (sheet: Sheet, columns: { header: string; width: number; euro?: boolean; date?: string }[]) => {
    sheet.addRow([input.title]).font = { bold: true, size: 14 };
    sheet.addRow([`Standort: ${input.location}`, '', `Zeitraum: ${input.period}`]);
    sheet.addRow([`Exportiert: ${new Date().toLocaleString('de-DE')}${input.exportedBy ? ` von ${input.exportedBy}` : ''}`]);
    sheet.addRow([]);
    const head = sheet.addRow(columns.map((c) => c.header));
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } }; });
    columns.forEach((c, i) => {
      const col = sheet.getColumn(i + 1);
      col.width = c.width;
      if (c.euro) col.numFmt = EURO;
      if (c.date) col.numFmt = c.date;
    });
    sheet.views = [{ state: 'frozen', ySplit: 5 }];
  };
  const sumRow = (sheet: Sheet, values: (string | number | null)[]) => {
    const row = sheet.addRow(values);
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.border = { top: { style: 'medium' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    });
  };

  // 1) Übersicht
  const overview = workbook.addWorksheet('Übersicht');
  header(overview, [{ header: 'Kennzahl', width: 34 }, { header: 'Wert', width: 18 }, { header: '', width: 36 }]);
  const s = input.stats;
  const euroRows: [string, number][] = [
    ['Umsatz (ohne Pfand)', s.total], ['Netto-Umsatz (inkl. Pfand)', s.totalNet], ['Enthaltene MwSt (inkl. Pfand)', s.totalTax],
    ['Pfand eingenommen', s.pfandCollected], ['Pfand retourniert', s.pfandReturned], ['Pfand-Saldo', s.pfandSaldo],
  ];
  for (const [label, value] of euroRows) overview.addRow([label, round2(value)]).getCell(2).numFmt = EURO;
  overview.addRow(['Verkäufe (Bons)', s.count]);
  overview.addRow(['Stornos', s.stornoCount]);

  // 2) Artikel (wie Liste „Einzelartikel“, gewählte Sortierung)
  const articles = new Map<string, { name: string; category: string; count: number; total: number; pfand: number }>();
  const categoryName = new Map(input.categories.map((c) => [c.id, c.name]));
  for (const tx of input.itemTransactions) {
    for (const item of tx.items) {
      if (item.isPfandRetoure) continue;
      const key = `${item.productId}-${item.name}`;
      const row = articles.get(key) ?? { name: item.name, category: categoryName.get(item.categoryId) ?? '', count: 0, total: 0, pfand: 0 };
      row.count += item.quantity;
      row.total += item.price * item.quantity;
      row.pfand += item.pfand;
      articles.set(key, row);
    }
  }
  const articleSheet = workbook.addWorksheet('Artikel');
  header(articleSheet, [{ header: 'Artikel', width: 38 }, { header: 'Warengruppe', width: 20 }, { header: 'Menge', width: 10 }, { header: 'Umsatz (ohne Pfand)', width: 20, euro: true }, { header: 'Pfand', width: 14, euro: true }]);
  const articleRows = [...articles.values()].sort((a, b) => compareJournalRows(a, b, input.sort));
  for (const r of articleRows) articleSheet.addRow([r.name, r.category, r.count, round2(r.total), round2(r.pfand)]);
  sumRow(articleSheet, ['Summe', '', articleRows.reduce((n, r) => n + r.count, 0), round2(articleRows.reduce((n, r) => n + r.total, 0)), round2(articleRows.reduce((n, r) => n + r.pfand, 0))]);

  // 3) Warengruppen
  const groups = new Map<string, { name: string; count: number; total: number; pfand: number }>();
  for (const r of articleRows) {
    const g = groups.get(r.category) ?? { name: r.category || 'Ohne Warengruppe', count: 0, total: 0, pfand: 0 };
    g.count += r.count; g.total += r.total; g.pfand += r.pfand;
    groups.set(r.category, g);
  }
  const groupSheet = workbook.addWorksheet('Warengruppen');
  header(groupSheet, [{ header: 'Warengruppe', width: 30 }, { header: 'Menge', width: 10 }, { header: 'Umsatz (ohne Pfand)', width: 20, euro: true }, { header: 'Pfand', width: 14, euro: true }]);
  const groupRows = [...groups.values()].sort((a, b) => compareJournalRows(a, b, input.sort));
  for (const g of groupRows) groupSheet.addRow([g.name, g.count, round2(g.total), round2(g.pfand)]);
  sumRow(groupSheet, ['Summe', groupRows.reduce((n, g) => n + g.count, 0), round2(groupRows.reduce((n, g) => n + g.total, 0)), round2(groupRows.reduce((n, g) => n + g.pfand, 0))]);

  // 4) Bons (alle gefilterten Bons, Stornos als Gegenbuchung)
  const bonSheet = workbook.addWorksheet('Bons');
  header(bonSheet, [
    { header: 'Datum/Uhrzeit', width: 18, date: 'dd.mm.yyyy hh:mm' }, { header: 'Standort', width: 16 }, { header: 'Mitarbeiter', width: 16 },
    { header: 'Zahlart', width: 10 }, { header: 'Positionen', width: 60 }, { header: 'Umsatz (ohne Pfand)', width: 20, euro: true },
    { header: 'Pfand', width: 12, euro: true }, { header: 'Gesamt', width: 14, euro: true },
  ]);
  const bons = [...input.transactions].sort((a, b) => a.timestamp - b.timestamp);
  for (const tx of bons) {
    const at = new Date(tx.timestamp);
    // Excel-Datum in Ortszeit (ExcelJS schreibt UTC): Zeitzonenversatz ausgleichen.
    const local = new Date(at.getTime() - at.getTimezoneOffset() * 60000);
    bonSheet.addRow([local, tx.location, tx.employeeName ?? '', tx.paymentMethod === 'card' ? 'Karte' : 'Bar',
      tx.items.map((i) => `${i.quantity}× ${i.isPfandRetoure ? 'Pfand-Retoure' : i.name}`).join(', '),
      round2(tx.subtotal), round2(tx.totalPfand), round2(tx.total)]);
  }
  sumRow(bonSheet, ['Summe', '', '', '', `${bons.length} Bons`, round2(bons.reduce((n, t) => n + t.subtotal, 0)), round2(bons.reduce((n, t) => n + t.totalPfand, 0)), round2(bons.reduce((n, t) => n + t.total, 0))]);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${input.fileName.replace(/\.pdf$/i, '')}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
