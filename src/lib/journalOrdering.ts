export type JournalSort = 'newest' | 'oldest' | 'nameAsc' | 'nameDesc' | 'amountHigh' | 'amountLow' | 'quantityHigh' | 'quantityLow' | 'receiptAsc' | 'receiptDesc';

export function compareJournalTransactions(
  a: { timestamp: number; total: number },
  b: { timestamp: number; total: number },
  sort: JournalSort,
): number {
  if (sort === 'oldest') return a.timestamp - b.timestamp;
  if (sort === 'amountHigh') return b.total - a.total;
  if (sort === 'amountLow') return a.total - b.total;
  return b.timestamp - a.timestamp;
}

export function compareJournalRows(
  a: { name?: string; label?: string; total: number; count: number },
  b: { name?: string; label?: string; total: number; count: number },
  sort: JournalSort,
) {
  const nameA = a.name ?? a.label ?? '';
  const nameB = b.name ?? b.label ?? '';
  if (sort === 'nameAsc') return nameA.localeCompare(nameB, 'de-DE');
  if (sort === 'nameDesc') return nameB.localeCompare(nameA, 'de-DE');
  if (sort === 'quantityHigh') return b.count - a.count || b.total - a.total;
  if (sort === 'quantityLow') return a.count - b.count || a.total - b.total;
  if (sort === 'amountLow') return a.total - b.total || nameA.localeCompare(nameB, 'de-DE');
  return b.total - a.total || nameA.localeCompare(nameB, 'de-DE');
}

