const API_BASE = "/api";
type TokenPair = { access: string; refresh: string };
type ApiTrade = {
  id: number;
  journal_day: number;
  ticker: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entry_price: number;
  stop_price: number | null;
  target_price?: number | null;
  exit_price?: number | null;
  status: "OPEN" | "CLOSED";
  notes: string;
  strategy_tags?: { id: number; name: string }[]; // if your serializer includes nested names
  entry_time?: string;  // ISO
  created_at?: string;  // if entry_time not present
};

// helper to normalize any "maybe-array" to a real array
function toArray<T>(x: unknown): T[] {
  return Array.isArray(x) ? (x as T[]) : [];
}

function normalizeTrade(x: any) {
  const rawTags = toArray<any>(x?.strategy_tags ?? x?.strategyTags);
  return {
    id: x.id,
    journal_day: x.journal_day,
    ticker: x.ticker,
    side: x.side,
    entryPrice: x.entry_price,
    stopLoss: x.stop_price ?? undefined,
    target: x.target_price ?? undefined,
    exitPrice: x.exit_price ?? undefined,
    entryTime: x.entry_time || x.created_at || new Date().toISOString(),
    size: x.quantity || undefined,
    notes: x.notes || "",
    status: x.status,
    strategyTags: rawTags
      .map((t: any) => (t && typeof t === "object" ? t.name : t))
      .filter(Boolean),
    riskR: undefined,
  } as const;
}

function getToken(): TokenPair | null {
  try { const s = localStorage.getItem("jwt"); return s ? JSON.parse(s) : null; } catch { return null; }
}
function setToken(tok: TokenPair | null) {
  if (tok) localStorage.setItem("jwt", JSON.stringify(tok));
  else localStorage.removeItem("jwt");
}

function isFormData(x: any): x is FormData {
  return typeof FormData !== "undefined" && x instanceof FormData;
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const isForm = opts.body instanceof FormData;
  const tok = getToken(); // your existing helper

  const headers: Record<string, string> = {
    ...(tok ? { Authorization: `Bearer ${tok.access}` } : {}),
    // IMPORTANT: don't set Content-Type for FormData; the browser will set boundary
    ...(!isForm ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers as any),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    let details = "";
    try { details = await res.text(); } catch {}
    throw new Error(`${res.status} ${res.statusText}${details ? ` — ${details}` : ""}`);
  }
  return res;
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/jwt/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    let msg = ""; try { msg = await res.text(); } catch {}
    throw new Error(`Login failed: ${msg || res.statusText}`);
  }
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
  const data = await res.json(); // could be list or object depending on view
  const obj = Array.isArray(data) ? data[0] : data;
  if (!obj) return null;
  return {
    dark_mode: !!obj.dark_mode,
    max_risk_per_trade_pct: Number(obj.max_risk_per_trade_pct ?? 0),
    max_daily_loss_pct: Number(obj.max_daily_loss_pct ?? 0),
    max_trades_per_day: Number(obj.max_trades_per_day ?? 0),
  };
}

export async function saveTheme(theme: "dark" | "light") {
  try {
    await apiFetch(`/journal/settings/me/`, {
      method: "PATCH",
      body: JSON.stringify({ dark_mode: theme === "dark" }),
    });
  } catch {}
}

export async function fetchOpenTrades() {
  const res = await apiFetch(`/journal/trades/?status=OPEN&ordering=-entry_time`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : (data.results ?? []);
  return list.map((x: any) => normalizeTrade(x));
}

// export a tiny helper for gating if you want it
export function hasToken() {
  return !!localStorage.getItem("jwt");
}
export function logout() {
  localStorage.removeItem("jwt");
}

export async function createTrade(payload: {
  ticker: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss?: number;
  target?: number;
  size?: number;
  notes?: string;
  strategyTags?: string[];
}) {
  const journalDay = await getOrCreateTodayDayId();
  const strategy_tag_ids = await mapTagNamesToIds(payload.strategyTags);
  const res = await apiFetch(`/journal/trades/`, {
    method: "POST",
    body: JSON.stringify({
      journal_day: journalDay,
      ticker: payload.ticker,
      side: payload.side,
      quantity: payload.size ?? 1,
      entry_price: payload.entryPrice,
      stop_price: payload.stopLoss ?? null,
      target_price: payload.target ?? null,
      notes: payload.notes ?? "",
      ...(strategy_tag_ids.length ? { strategy_tag_ids } : {}),
    }),
  });
  const json = await res.json();
  return normalizeTrade(json);
}

export async function closeTrade(id: number | string, payload: { exitPrice?: number; notes?: string; strategyTags?: string[] }) {
  const strategy_tag_ids = await mapTagNamesToIds(payload.strategyTags);
  const res = await apiFetch(`/journal/trades/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "CLOSED",
      exit_price: payload.exitPrice ?? null,
      notes: payload.notes ?? "",
      ...(strategy_tag_ids.length ? { strategy_tag_ids } : {}),
    }),
  });
  const json = await res.json();
  return normalizeTrade(json);
}

export async function createAttachment(tradeId: number | string, file: File, caption = "") {
  const fd = new FormData();
  fd.append("trade", String(tradeId));
  fd.append("image", file, file.name);
  if (caption) fd.append("caption", caption);

  const res = await apiFetch(`/journal/attachments/`, { method: "POST", body: fd });
  return res.json();
}

async function fetchTags(): Promise<{id:number; name:string}[]> {
  const res = await apiFetch(`/journal/tags/`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : (data?.results ?? []);
}

async function mapTagNamesToIds(names?: string[]) {
  if (!names || !names.length) return [];
  const all = await fetchTags();
  const list = Array.isArray(all) ? all : (all as any)?.results ?? [];
  const map = new Map(list.map((t: any) => [String(t.name).toLowerCase(), t.id]));
  return names.map((n) => map.get(n.toLowerCase())).filter(Boolean) as number[];
}

let inflightDayPromise: Promise<number> | null = null;

function today() {
  const d = new Date();
  const mm = String(d.getMonth()+1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

async function getOrCreateTodayDayId(): Promise<number> {
  if (inflightDayPromise) return inflightDayPromise;
  inflightDayPromise = (async () => {
    const d = today();
    // Single POST: backend returns 201 (created) or 200 (existing)
    const r = await apiFetch(`/journal/days/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: d }),
    });
    const j = await r.json();
    return j.id;
  })();
  try {
    return await inflightDayPromise;
  } finally {
    inflightDayPromise = null;
  }
}
