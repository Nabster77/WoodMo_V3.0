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

/** Einzelne Schüsse einer Zeile; „2× Rum + Whiskey“ ergibt Rum, Rum, Whiskey. Alte Namen „Rum + Whiskey“ bleiben lesbar. */
export function shotParts(shot: ShotOption | null | undefined): string[] {
  if (!shot || shot.id === NO_SHOT_ID) return [];
  return shot.name.split(' + ').filter(Boolean).flatMap((part) => {
    const grouped = /^(\d+)× (.+)$/.exec(part);
    return grouped ? Array<string>(Number(grouped[1])).fill(grouped[2]) : [part];
  });
}

/** Gleiche Schüsse zusammenfassen: Rum, Rum, Whiskey -> „2× Rum + Whiskey“ (Reihenfolge nach erstem Auftreten). */
function shotLabel(parts: string[]): string {
  const counts = new Map<string, number>();
  for (const name of parts) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 ? `${n}× ${name}` : name)).join(' + ');
}

/** Wie oft ein Schuss (nach Name) schon in der Zeile steckt. */
export function shotCount(shot: ShotOption | null | undefined, name: string): number {
  return shotParts(shot).filter((part) => part === name).length;
}

/**
 * Neuer Schuss-Stand nach einer Auswahl im Fenster.
 * - „Ohne Schuss“: nichts ändern (kein Aufpreis, kein Text).
 * - „Alle Schüsse entfernen“: kein Schuss mehr.
 * - sonst: `count` Schüsse zum bisherigen Stand dazu (Name „2× Rum + Whiskey“, Preis = Summe).
 *   Gespeichert wird weiterhin EIN Schuss-Feld je Zeile (kein neues Feld, keine SQL-Änderung).
 */
export function applyShotChoice(current: ShotOption | null | undefined, choice: ShotOption, count = 1): ShotOption | null {
  const existing = current && current.id !== NO_SHOT_ID ? current : null;
  if (choice.id === NO_SHOT_ID) return existing;
  if (choice.id === REMOVE_ALL_SHOTS_ID) return null;
  const n = Math.floor(count);
  if (!Number.isFinite(n) || n < 1) return existing;
  const added = Array<string>(n).fill(choice.id).join('+');
  return {
    id: existing ? `${existing.id}+${added}` : added,
    name: shotLabel([...shotParts(existing), ...Array<string>(n).fill(choice.name)]),
    price: round2((existing?.price ?? 0) + choice.price * n),
  };
}
