
 // frontend/src/lib/theme.ts
 // Single source of truth for light/dark preference on the public screens.
 
 const THEME_KEY = "theme"; // 'dark' | 'light'
 
export function getStoredTheme(): "dark" | "light" | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {}
  return null;
}

export function hasStoredTheme(): boolean {
  return getStoredTheme() !== null;
}

export function getInitialDark(): boolean {
  const stored = getStoredTheme();
  if (stored === "dark") return true;
  if (stored === "light") return false;

  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return false;
}

 export function persistTheme(dark: boolean) {
   try {
     localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
   } catch {}
 }
 
 export function applyThemeToDom(dark: boolean) {
   const root = document.documentElement;
   if (dark) root.classList.add("dark");
   else root.classList.remove("dark");
 }
 
 export function setTheme(dark: boolean) {
   applyThemeToDom(dark);
   persistTheme(dark);
 }