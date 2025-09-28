export type Tokens = { access: string; refresh: string };

const KEY = "jwt_tokens";

export function saveTokens(t: Tokens) { localStorage.setItem(KEY, JSON.stringify(t)); }
export function getTokens(): Tokens | null { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
export function clearTokens() { localStorage.removeItem(KEY); }
export function authHeader() {
  const t = getTokens();
  return t ? { "Authorization": `Bearer ${t.access}` } : {};
}
