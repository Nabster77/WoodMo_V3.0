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

/** Einzelne Schuss-Namen einer Zeile (für Anzeige/Anzahl). */
export function shotParts(shot: ShotOption | null | undefined): string[] {
  if (!shot || shot.id === NO_SHOT_ID) return [];
  return shot.name.split(' + ').filter(Boolean);
}

/**
 * Neuer Schuss-Stand nach einer Auswahl im Fenster.
 * - „Ohne Schuss“: nichts ändern (kein Aufpreis, kein Text).
 * - „Alle Schüsse entfernen“: kein Schuss mehr.
 * - sonst: zum bisherigen Schuss dazu (Name „A + B“, Preis A + B).
 */
export function applyShotChoice(current: ShotOption | null | undefined, choice: ShotOption): ShotOption | null {
  const existing = current && current.id !== NO_SHOT_ID ? current : null;
  if (choice.id === NO_SHOT_ID) return existing;
  if (choice.id === REMOVE_ALL_SHOTS_ID) return null;
  if (!existing) return { id: choice.id, name: choice.name, price: round2(choice.price) };
  return {
    id: `${existing.id}+${choice.id}`,
    name: `${existing.name} + ${choice.name}`,
    price: round2(existing.price + choice.price),
  };
}
