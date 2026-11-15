/**
 * Strict parsing of a price typed by an admin (e.g. "4,50", "4.5", "12 €").
 * Same limits as the Excel import: not negative, at most 99 999 €, at most two decimals.
 * Thousand separators are rejected, because "1.234,50" would otherwise silently become 1,23 €.
 */
export type PriceInputResult = { ok: true; value: number } | { ok: false; error: string };

export function parsePriceInput(input: string): PriceInputResult {
  const text = input.trim().replace(/^€\s*/, '').replace(/\s*€$/, '');
  if (!text) return { ok: false, error: 'Bitte einen Preis eingeben.' };
  if (text.startsWith('-')) return { ok: false, error: 'Der Preis darf nicht negativ sein.' };
  if (/^\d+([.,]\d{3})+([.,]\d+)?$/.test(text) && /[.,].*[.,]/.test(text)) {
    return { ok: false, error: 'Bitte ohne Tausenderpunkt eingeben, z. B. 1234,50.' };
  }
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(text);
  if (!match) return { ok: false, error: 'Bitte nur eine Zahl eingeben, z. B. 4,50.' };
  const decimals = match[2] ?? '';
  if (decimals.length > 2) return { ok: false, error: 'Höchstens zwei Nachkommastellen (Cent), z. B. 4,55.' };
  const value = Number(`${match[1]}.${decimals || '0'}`);
  if (!Number.isFinite(value) || value > 99999) return { ok: false, error: 'Der Preis ist zu hoch (höchstens 99 999 €).' };
  return { ok: true, value: Math.round(value * 100) / 100 };
}
