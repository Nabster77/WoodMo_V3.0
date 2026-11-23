import type { ShotOption } from '../types';

/**
 * Mehrere Schüsse in einem Getränk (Wunsch 18.11.2026): „Glühwein + Rum + Whiskey“.
 * Gespeichert wird wie bisher EIN Schuss-Feld je Warenkorbzeile: Name „Rum + Whiskey“,
 * Preis = Summe der Schüsse. So bleiben Bon, Backup, Excel und Datenbank unverändert.
 * „Ohne Schuss“ fügt nichts hinzu und berechnet nichts.
 */
export const NO_SHOT_ID = 'none';
export const REMOVE_ALL_SHOTS_ID = '__alle_entfernen__';

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Einzelne Schüsse EINES Getränks. „2× Rum + Whiskey“ -> Rum, Rum, Whiskey.
 * Alte Bons („Rum + Rum“) bleiben lesbar.
 */
export function shotParts(shot: ShotOption | null | undefined): string[] {
  if (!shot || shot.id === NO_SHOT_ID) return [];
  return shot.name.split(' + ').filter(Boolean).flatMap((part) => {
    const grouped = /^(\d+)× (.+)$/.exec(part);
    return grouped ? Array<string>(Number(grouped[1])).fill(grouped[2]) : [part];
  });
}

/** Rum, Rum, Whiskey -> „2× Rum + Whiskey“ (Sorte und Anzahl stehen damit auf Bon und Journal). */
function shotLabel(parts: string[]): string {
  const counts = new Map<string, number>();
  for (const name of parts) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 ? `${n}× ${name}` : name)).join(' + ');
}

/**
 * Kurzanzeige für den Warenkorb: Schüsse der ganzen Zeile (Menge × Schüsse je Getränk).
 * 3× Glühwein + Rum -> { total: 3, label: 'Rum' }; 2× Glühwein + Rum + Whiskey -> { total: 4, label: '2× Rum, 2× Whiskey' }.
 */
export function shotSummary(shot: ShotOption | null | undefined, quantity: number): { total: number; label: string } | null {
  const parts = shotParts(shot);
  if (!parts.length) return null;
  const counts = new Map<string, number>();
  for (const name of parts) counts.set(name, (counts.get(name) ?? 0) + quantity);
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const label = counts.size === 1 ? [...counts.keys()][0] : [...counts].map(([name, n]) => `${n}× ${name}`).join(', ');
  return { total, label };
}

/**
 * Neuer Schuss-Stand nach einer Auswahl im Fenster.
 * - „Alle Schüsse entfernen“: kein Schuss mehr.
 * - sonst: zum bisherigen Schuss dazu (Name „2× Rum + Whiskey“, Preis = Summe wie bisher).
 * Gespeichert wird weiterhin EIN Schuss-Feld je Warenkorbzeile (keine SQL-Änderung).
 */
export function applyShotChoice(current: ShotOption | null | undefined, choice: ShotOption): ShotOption | null {
  const existing = current && current.id !== NO_SHOT_ID ? current : null;
  if (choice.id === NO_SHOT_ID) return existing;
  if (choice.id === REMOVE_ALL_SHOTS_ID) return null;
  if (!existing) return { id: choice.id, name: choice.name, price: round2(choice.price) };
  return {
    id: `${existing.id}+${choice.id}`,
    name: shotLabel([...shotParts(existing), choice.name]),
    price: round2(existing.price + choice.price),
  };
}
