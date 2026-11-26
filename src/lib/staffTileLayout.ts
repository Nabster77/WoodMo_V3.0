import { loadJSON, saveJSON } from '@/lib/storage';

/**
 * Persönliche Kacheleinstellungen je Mitarbeiter (nur Favoriten samt Reihenfolge).
 * Gespeichert lokal unter einem Schlüssel pro Mitarbeiter-ID. Das übersteht App-Neustart und Updates
 * (ein Update ändert localStorage nicht). Beim ersten Anmelden eines Mitarbeiters ohne eigenes Layout wird
 * einmalig die bisherige Geräteeinstellung übernommen (Altschlüssel bleiben unangetastet).
 */
const LAYOUT_PREFIX = 'pos_tile_layout_v1:';
const LEGACY_FAVORITES_KEY = 'pos_favorites_v1';

export interface StaffTileLayout {
  favorites: string[];
}

const layoutKey = (staffId: string | null | undefined) => `${LAYOUT_PREFIX}${staffId || 'device'}`;

function cleanFavorites(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [];
}

export function loadStaffTileLayout(staffId: string | null | undefined): StaffTileLayout {
  const stored = loadJSON<unknown>(layoutKey(staffId), null);
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const entry = stored as Record<string, unknown>;
    return { favorites: cleanFavorites(entry.favorites) };
  }
  const seeded = { favorites: cleanFavorites(loadJSON<unknown>(LEGACY_FAVORITES_KEY, [])) };
  if (staffId) saveJSON(layoutKey(staffId), seeded);
  return seeded;
}

export function saveStaffTileLayout(staffId: string | null | undefined, patch: Partial<StaffTileLayout>): void {
  const current = loadStaffTileLayout(staffId);
  saveJSON(layoutKey(staffId), { ...current, ...patch });
}
