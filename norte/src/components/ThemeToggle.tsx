import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';
import type { Language } from '../lib/types';
export function ThemeToggle({ language }: { language: Language }) {
  const { theme, toggleTheme } = useTheme();
  const label = language === 'pt' ? (theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro') : (theme === 'dark' ? 'Use light theme' : 'Use dark theme');
  return <button className="theme-toggle" type="button" aria-label={label} title={label} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>;
}
