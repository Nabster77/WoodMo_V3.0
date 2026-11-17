import type { Product } from '@/types';

/**
 * Einheitliche, kontrastreiche Farben der Kennzeichnung (überall gleich, Kurze und Flaschen):
 * Schnaps feuerrot, Likör violett.
 */
export const SPIRIT_COLORS = { likoer: '#8b5cf6', schnaps: '#ef4444' } as const;

export function spiritColor(kind: Product['spiritType']): string | undefined {
  return kind ? SPIRIT_COLORS[kind] : undefined;
}
