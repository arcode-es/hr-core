import { create } from 'zustand';

export type ThemeMode = 'system' | 'light' | 'dark' | 'contrast';
const KEY = 'hr.theme';
const META: Record<string, string> = { light: '#f2f5fa', dark: '#000409', contrast: '#ffffff' };

const systemDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches;

function apply(mode: ThemeMode): void {
  const resolved = mode === 'system' ? (systemDark() ? 'dark' : 'light') : mode;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[resolved]!);
}

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    // Sin preferencia guardada, el tema es el oscuro del sistema de diseño.
    return v === 'light' || v === 'dark' || v === 'contrast' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  mode: read(),
  setMode: (mode) => {
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* sin almacenamiento: el tema dura lo que la sesión */
    }
    apply(mode);
    set({ mode });
  },
}));

apply(useTheme.getState().mode);
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => apply(useTheme.getState().mode));
