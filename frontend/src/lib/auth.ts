// frontend/src/lib/auth.ts
// Access token lives only in memory. Refresh stays in an HttpOnly cookie (server-set).

let ACCESS_TOKEN: string | null = null;

export function setAccessToken(token: string | null) {
  ACCESS_TOKEN = token;
}

export function getAccessToken(): string | null {
  return ACCESS_TOKEN;
}

export function clearAuth() {
  ACCESS_TOKEN = null;
}

/** Helper for adding Authorization header when we have an access token */
export function authHeader(): Record<string, string> {
  const t = getAccessToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Optional: Call this once on app boot to hydrate ACCESS_TOKEN
 * if a valid refresh cookie exists. Safe to skip if you only set
 * the access token at login and rely on 401 -> refresh in authedFetch.
 */
export async function initAccessTokenFromRefresh(): Promise<boolean> {
  const r = await fetch("/api/auth/jwt/refresh/", {
    method: "POST",
    credentials: "include",
  });
  if (!r.ok) return false;
  const j = await r.json();
  if (j?.access) {
    setAccessToken(j.access);
    return true;
  }
  return false;
}
