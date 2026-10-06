import { useState, useEffect } from 'react';

const STORAGE_KEY = 'orbit_theme';

export const PALETTES = [
  { id: 'terracotta', name: 'Terracotta', accentLight: '#B24322', accentDark: '#E0875F', previewBg: '#F4EFE6' },
  { id: 'sage', name: 'Sage', accentLight: '#3F6B4A', accentDark: '#8FBF8F', previewBg: '#EFF3EF' },
  { id: 'dusk', name: 'Dusk', accentLight: '#4A55A2', accentDark: '#9AA5F0', previewBg: '#F0F1F7' },
  { id: 'plum', name: 'Plum', accentLight: '#A3365B', accentDark: '#E58AA6', previewBg: '#F6F0F2' },
];

function getSystemMode() {
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function loadInitialTheme() {
  // First check if html attributes already exist from index.html inline script
  let initialMode = 'light';
  let initialPalette = 'terracotta';

  if (typeof document !== 'undefined') {
    const docMode = document.documentElement.getAttribute('data-mode');
    const docPalette = document.documentElement.getAttribute('data-palette');
    if (docMode) initialMode = docMode;
    if (docPalette) initialPalette = docPalette;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'paper') {
      return { mode: 'light', palette: 'terracotta' };
    }
    if (raw === 'ink') {
      return { mode: 'dark', palette: 'terracotta' };
    }
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          mode: parsed.mode === 'dark' || parsed.mode === 'light' ? parsed.mode : getSystemMode(),
          palette: ['terracotta', 'sage', 'dusk', 'plum'].includes(parsed.palette) ? parsed.palette : 'terracotta',
        };
      }
    } else {
      initialMode = getSystemMode();
    }
  } catch {
    // ignore localStorage reading error
  }

  return { mode: initialMode, palette: initialPalette };
}

/**
 * Custom React hook for managing the app theme:
 * mode: 'light' | 'dark'
 * palette: 'terracotta' | 'sage' | 'dusk' | 'plum'
 */
export function useTheme() {
  const [themeState, setThemeState] = useState(loadInitialTheme);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-mode', themeState.mode);
      document.documentElement.setAttribute('data-palette', themeState.palette);
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(themeState));
    } catch {
      // Ignore storage write errors (e.g. quota or incognito)
    }
  }, [themeState]);

  const toggleTheme = () => {
    setThemeState((prev) => ({
      ...prev,
      mode: prev.mode === 'dark' ? 'light' : 'dark',
    }));
  };

  const setMode = (mode) => {
    setThemeState((prev) => ({
      ...prev,
      mode: mode === 'dark' ? 'dark' : 'light',
    }));
  };

  const setPalette = (palette) => {
    if (['terracotta', 'sage', 'dusk', 'plum'].includes(palette)) {
      setThemeState((prev) => ({
        ...prev,
        palette,
      }));
    }
  };

  return {
    mode: themeState.mode,
    palette: themeState.palette,
    theme: themeState.mode, // backwards compatibility if any component reads theme
    isDark: themeState.mode === 'dark',
    toggleTheme,
    setMode,
    setPalette,
    setTheme: (m) => setMode(m === 'ink' || m === 'dark' ? 'dark' : 'light'),
  };
}

export default useTheme;
