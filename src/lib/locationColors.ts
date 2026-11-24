import type { CSSProperties } from 'react';
import type { Location } from '@/types';

/**
 * Standortfarben (24.11.): Friedrichshafen grün, Bregenz blau. Gleiche Werte in App,
 * Tagesabschluss und PDF. Weitere Standorte bekommen später eine eigene Farbe.
 */
export const LOCATION_COLORS: Record<Location, { strong: string; light: string; soft: string; border: string }> = {
  Friedrichshafen: { strong: '#16a34a', light: '#4ade80', soft: 'rgba(22,163,74,0.12)', border: 'rgba(22,163,74,0.55)' },
  Bregenz: { strong: '#2563eb', light: '#60a5fa', soft: 'rgba(37,99,235,0.14)', border: 'rgba(37,99,235,0.6)' },
};

/** CSS-Variablen für Klassen wie `text-[var(--loc-strong)]`. */
export function locationStyle(location: Location): CSSProperties {
  const c = LOCATION_COLORS[location] ?? LOCATION_COLORS.Friedrichshafen;
  return { ['--loc-strong' as string]: c.strong, ['--loc-light' as string]: c.light, ['--loc-soft' as string]: c.soft, ['--loc-border' as string]: c.border };
}
