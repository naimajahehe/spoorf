/**
 * Theme Manager for NetCut Sentinel
 * Supports 'dark' (default cyber/sentinel dark) and 'light' (clean white/day mode)
 */

export type ThemeMode = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'sentinel_theme';

/**
 * Get current theme preference from localStorage or fallback to 'dark'
 */
export function getInitialTheme(): ThemeMode {
    if (typeof window === 'undefined') return 'dark';
    try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark') {
            return stored;
        }
    } catch {
        // ignore
    }
    return 'dark';
}

/**
 * Apply theme to document root (html) and save to localStorage
 */
export function applyTheme(theme: ThemeMode): void {
    if (typeof window === 'undefined') return;
    try {
        const root = document.documentElement;
        if (theme === 'light') {
            root.classList.remove('dark');
            root.classList.add('light');
            root.setAttribute('data-theme', 'light');
            root.style.colorScheme = 'light';
        } else {
            root.classList.remove('light');
            root.classList.add('dark');
            root.setAttribute('data-theme', 'dark');
            root.style.colorScheme = 'dark';
        }
        localStorage.setItem(THEME_STORAGE_KEY, theme);
        window.dispatchEvent(new CustomEvent('sentinel-theme-changed', { detail: { theme } }));
    } catch {
        // ignore
    }
}

/**
 * Toggle between light and dark themes
 */
export function toggleTheme(current: ThemeMode): ThemeMode {
    const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    return next;
}
