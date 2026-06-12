import React, { createContext, useContext, useState } from 'react';

const dark = {
  mode: 'dark',
  background: '#0B1220',
  surface: '#111827',
  card: '#1A2332',
  primary: '#06B6D4',
  primaryBg: '#0C2A32',
  primaryText: '#042F2E',
  text: '#F8FAFC',
  subtext: '#94A3B8',
  border: '#1F2937',
  input: '#0F172A',
  tabBar: '#0B1220',
  tabBarBorder: '#1F2937',
  inactive: '#64748B',
  icon: '#E2E8F0',
  danger: '#EF4444',
  dangerBg: '#3B1118',
  success: '#10B981',
  successBg: '#052E1C',
  warning: '#F59E0B',
  warningBg: '#3B2506',
  statusBar: 'light-content',
  shadow: '#000000',
};

const light = {
  mode: 'light',
  background: '#F1F5F9',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  primary: '#0891B2',
  primaryBg: '#E0F7FA',
  primaryText: '#FFFFFF',
  text: '#0F172A',
  subtext: '#64748B',
  border: '#E2E8F0',
  input: '#F8FAFC',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E2E8F0',
  inactive: '#94A3B8',
  icon: '#334155',
  danger: '#DC2626',
  dangerBg: '#FEF2F2',
  success: '#059669',
  successBg: '#ECFDF5',
  warning: '#D97706',
  warningBg: '#FFFBEB',
  statusBar: 'dark-content',
  shadow: '#94A3B8',
};

export const ThemeContext = createContext();

export function useTheme() {
  return useContext(ThemeContext);
}

export default function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(dark);
  const toggleTheme = () => setTheme((t) => (t.mode === 'dark' ? light : dark));
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
