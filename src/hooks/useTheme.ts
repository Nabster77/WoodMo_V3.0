import { useEffect, useState } from 'react';
import { loadJSON, saveJSON, STORAGE_KEYS } from '@/lib/storage';

type Theme = 'light' | 'dark';

/**
 * Standard ist immer der dunkle Modus (Wunsch 18.11.2026). Hell bleibt nur, wenn jemand
 * auf diesem Gerät selbst umgeschaltet hat (Merker pos_theme_user_choice_v1).
 * Eine früher automatisch (nach Systemeinstellung) gespeicherte helle Ansicht zählt nicht als Wahl.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const userChose = loadJSON<boolean>(STORAGE_KEYS.themeUserChoice, false) === true;
    const stored = loadJSON<Theme | null>(STORAGE_KEYS.theme, null);
    if (userChose && (stored === 'light' || stored === 'dark')) return stored;
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    saveJSON(STORAGE_KEYS.theme, theme);
  }, [theme]);

  return {
    theme,
    setTheme,
    toggle: () => {
      saveJSON(STORAGE_KEYS.themeUserChoice, true);
      setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
    },
  };
}
