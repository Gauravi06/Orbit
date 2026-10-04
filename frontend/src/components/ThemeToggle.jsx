import { useTheme } from '../theme/useTheme';

/**
 * Accessible button to toggle between Paper (light) and Ink (dark) themes.
 * Uses clean 1.5px stroke line icons and supports full keyboard navigation.
 */
export function ThemeToggle({ showLabel = true, className = '' }) {
  const { theme, toggleTheme, isDark } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`btn btn-secondary ${className}`.trim()}
      aria-label={isDark ? 'Switch to Paper light theme' : 'Switch to Ink dark theme'}
      title={isDark ? 'Switch to Paper' : 'Switch to Ink'}
    >
      {isDark ? (
        /* Sun Icon (1.5px stroke) */
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      ) : (
        /* Moon Icon (1.5px stroke) */
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )}
      {showLabel && (
        <span style={{ fontSize: 'var(--text-xs)', textTransform: 'capitalize' }}>
          {theme}
        </span>
      )}
    </button>
  );
}

export default ThemeToggle;
