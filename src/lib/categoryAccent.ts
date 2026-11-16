import type { CSSProperties } from 'react';

/**
 * Leitfarbe einer Warengruppe für Überschrift und pulsierenden Rahmen.
 * Warengruppen-Farben sind entweder "#rrggbb", "linear-gradient(..., #rrggbb, ...)"
 * oder Tailwind-Verläufe wie "from-cyan-500 to-blue-600" (Auswahl in der Verwaltung).
 */
const TAILWIND: Record<string, string> = {
  'cyan-400': '#22d3ee', 'cyan-500': '#06b6d4', 'amber-500': '#f59e0b', 'amber-700': '#b45309',
  'emerald-500': '#10b981', 'rose-500': '#f43f5e', 'violet-500': '#8b5cf6', 'pink-500': '#ec4899',
  'teal-500': '#14b8a6', 'indigo-500': '#6366f1', 'yellow-300': '#fde047', 'lime-400': '#a3e635',
  'sky-300': '#7dd3fc', 'blue-700': '#1d4ed8', 'slate-400': '#94a3b8', 'gray-700': '#374151',
};
const FALLBACK = '#10b981';

export function categoryAccent(color: string | undefined): string {
  const value = (color ?? '').trim();
  const hex = value.match(/#[0-9a-f]{6}\b/i)?.[0];
  if (hex) return hex.toLowerCase();
  const from = value.match(/\bfrom-([a-z]+-\d{3})\b/)?.[1];
  return (from && TAILWIND[from]) || FALLBACK;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Heller gemischt (für Schrift auf dunklem Hintergrund). */
export function lighten(hex: string, amount: number): string {
  return '#' + rgb(hex).map((c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0')).join('');
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** CSS-Variablen für .woodmo-cat-pulse-ring / .woodmo-cat-pulse-text (index.css). */
export function categoryAccentStyle(color: string | undefined): CSSProperties {
  const accent = categoryAccent(color);
  return {
    ['--cat-accent' as string]: accent,
    ['--cat-accent-soft' as string]: lighten(accent, 0.38),
    ['--cat-accent-glow' as string]: alpha(lighten(accent, 0.15), 0.7),
  } as CSSProperties;
}
