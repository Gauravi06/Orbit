import { useState, useEffect } from 'react';

const STORAGE_KEY = 'orbit_theme';

/**
 * Custom React hook for managing the app theme (Paper vs. Ink).
 * 
 * Synchronizes with the html[data-theme] attribute and localStorage,
 * with graceful fallbacks and try/catch error handling.
 */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof document !== 'undefined') {
      const active = document.documentElement.getAttribute('data-theme');
      if (active) return active;
    }

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return saved;
      if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'ink';
      }
    } catch {
      // Ignore storage access errors
    }

    return 'paper';
  });

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore storage write errors (e.g., storage quota or private browsing restrictions)
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((currentTheme) => (currentTheme === 'ink' ? 'paper' : 'ink'));
  };

  return {
    theme,
    setTheme,
    toggleTheme,
    isDark: theme === 'ink',
  };
}
