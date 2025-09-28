const API_BASE = "/api";
type TokenPair = { access: string; refresh: string };

function getToken(): TokenPair | null {
  try { const s = localStorage.getItem("jwt"); return s ? JSON.parse(s) : null; } catch { return null; }
}
function setToken(tok: TokenPair | null) {
  if (tok) localStorage.setItem("jwt", JSON.stringify(tok));
  else localStorage.removeItem("jwt");
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const tok = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as any) };
  if (tok?.access) headers.Authorization = `Bearer ${tok.access}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers, credentials: "include" });
  if (res.status === 401 && tok?.refresh) {
    const r = await fetch(`${API_BASE}/auth/jwt/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: tok.refresh }),
    });
    if (r.ok) {
      const j = (await r.json()) as { access: string };
      setToken({ access: j.access, refresh: tok.refresh });
      return apiFetch(path, opts);
    }
  }
  return res;
}

export async function login(email: string, password: string) {
  // Try email, fall back to username for compatibility
  let res = await fetch(`${API_BASE}/auth/jwt/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    res = await fetch(`${API_BASE}/auth/jwt/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: email, password }),
    });
  }
  if (!res.ok) throw new Error("Login failed");
  const tok = (await res.json()) as TokenPair;
  setToken(tok);
  return tok;
}

export async function register(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Register failed");
  return res.json();
}

export async function fetchUserSettings() {
  const res = await apiFetch(`/journal/settings/`);
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

export async function saveTheme(theme: "dark" | "light") {
  try {
    await apiFetch(`/journal/settings/me/`, { method: "PATCH", body: JSON.stringify({ theme }) });
  } catch {}
}

export async function fetchOpenTrades() {
  const res = await apiFetch(`/journal/trades/?status=OPEN&ordering=-entry_time`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : data.results ?? [];
}

// export a tiny helper for gating if you want it
export function hasToken() {
  return !!localStorage.getItem("jwt");
}
export function logout() {
  localStorage.removeItem("jwt");
}
