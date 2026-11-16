import type { Product } from '@/types';

/**
 * Farben der Kennzeichnung. Kurze: Likör pink, Schnaps feuerrot (Warengruppe „Kurze“
 * = Mischung daraus). Flaschen: Likör violett, Schnaps blau (Warengruppe „Flaschen“
 * = Mischung daraus). Flaschen-Gruppen erkennt man am Wort „Flasche“ im Gruppennamen.
 */
export const SPIRIT_COLORS = {
  shot: { likoer: '#d946ef', schnaps: '#dc2626' },
  bottle: { likoer: '#8b5cf6', schnaps: '#0284c7' },
} as const;

export function isBottleGroup(categoryName: string | undefined): boolean {
  return /flasche/i.test(categoryName ?? '');
}

export function spiritColor(kind: Product['spiritType'], bottle: boolean): string | undefined {
  if (!kind) return undefined;
  return SPIRIT_COLORS[bottle ? 'bottle' : 'shot'][kind];
}
