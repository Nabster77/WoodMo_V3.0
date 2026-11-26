import { loadJSON, saveJSON } from '@/lib/storage';

/**
 * Persönliche Kacheleinstellungen je Mitarbeiter (Favoriten samt Reihenfolge, Bilder an/aus je Warengruppe).
 * Gespeichert lokal unter einem Schlüssel pro Mitarbeiter-ID. Das übersteht App-Neustart und Updates
 * (ein Update ändert localStorage nicht). Beim ersten Anmelden eines Mitarbeiters ohne eigenes Layout wird
 * einmalig die bisherige Geräteeinstellung übernommen (Altschlüssel bleiben unangetastet).
 */
const LAYOUT_PREFIX = 'pos_tile_layout_v1:';
const LEGACY_FAVORITES_KEY = 'pos_favorites_v1';
const LEGACY_IMAGES_BY_GROUP_KEY = 'pos_tile_images_by_group_v1';

export interface StaffTileLayout {
  favorites: string[];
  imagesByGroup: Record<string, boolean>;
}

const layoutKey = (staffId: string | null | undefined) => `${LAYOUT_PREFIX}${staffId || 'device'}`;

function cleanFavorites(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [];
}

function cleanImages(value: unknown): Record<string, boolean> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>
    : {};
}

export function loadStaffTileLayout(staffId: string | null | undefined): StaffTileLayout {
  const stored = loadJSON<unknown>(layoutKey(staffId), null);
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const entry = stored as Record<string, unknown>;
    return { favorites: cleanFavorites(entry.favorites), imagesByGroup: cleanImages(entry.imagesByGroup) };
  }
  const seeded = {
    favorites: cleanFavorites(loadJSON<unknown>(LEGACY_FAVORITES_KEY, [])),
    imagesByGroup: cleanImages(loadJSON<unknown>(LEGACY_IMAGES_BY_GROUP_KEY, {})),
  };
  if (staffId) saveJSON(layoutKey(staffId), seeded);
  return seeded;
}

export function saveStaffTileLayout(staffId: string | null | undefined, patch: Partial<StaffTileLayout>): void {
  const current = loadStaffTileLayout(staffId);
  saveJSON(layoutKey(staffId), { ...current, ...patch });
}
