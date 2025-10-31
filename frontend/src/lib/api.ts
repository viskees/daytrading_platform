const API_BASE = "/api";
type TokenPair = { access: string; refresh?: string };
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
  strategy_tag_ids?: number[];                    // <-- when backend returns only ids
  entry_time?: string;  // ISO
  created_at?: string;  // if entry_time not present
};

import { emitTradeClosed } from "@/lib/events";


// helper to normalize any "maybe-array" to a real array
function toArray<T>(x: unknown): T[] {
  return Array.isArray(x) ? (x as T[]) : [];
}

function normalizeTrade(x: any) {
  const rawTags = toArray<any>(x?.strategy_tags ?? x?.strategyTags);
  const tagNames = rawTags
    .map((t: any) => (t && typeof t === "object" ? t.name : t))
    .filter(Boolean);
  return {
    id: x.id,
    journal_day: x.journal_day,
    ticker: x.ticker,
    side: x.side,
    entryPrice: x.entry_price,
    stopLoss: x.stop_price ?? undefined,
    target: x.target_price ?? undefined,
    exitPrice: x.exit_price ?? undefined,
    exitTime: x.exit_time || undefined,
    entryTime: x.entry_time || x.created_at || new Date().toISOString(),
    size: x.quantity || undefined,
    notes: x.notes || "",
    status: x.status,
    // pass through backend-calculated fields when present
    realizedPnl: typeof x.realized_pnl === "number" ? x.realized_pnl : undefined,
    rMultiple: typeof x.r_multiple === "number" ? x.r_multiple : undefined,
    strategyTags: Array.from(
      new Set(
        rawTags
          .map((t: any) => (t && typeof t === "object" ? t.name : t))
          .filter(Boolean)
      )
    ),
    riskR: undefined,
  } as const;
}

// Legacy helpers (kept for temporary compatibility with any leftover callers)
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

// Delegate all API calls through authedFetch (handles JWT auto-refresh + cookies)
export async function apiFetch(path: string, opts: RequestInit = {}) {
  return authedFetch(`${API_BASE}${path}`, opts);
}

export async function login(email: string, password: string) {
  // Backend sets the refresh as HttpOnly cookie; body returns { access }
  const res = await fetch(`${API_BASE}/auth/jwt/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });
  if (!res.ok) {
    let msg = ""; try { msg = await res.text(); } catch {}
    throw new Error(`Login failed: ${msg || res.statusText}`);
  }
  const j = (await res.json()) as { access?: string; refresh?: string };
  if (!j?.access) throw new Error("Login failed: no access token returned");
  // In-memory access for the app, keep localStorage only as a temporary bridge
  setAccessToken(j.access);
  setToken({ access: j.access }); // TODO: remove once all code paths use getAccessToken()
  return { access: j.access };
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
  return Promise.all(list.map((x: any) => normalizeTradeAsync(x)));
}

export async function fetchClosedTrades(params?: { from?: string; to?: string; page?: number }) {
  const build = (ordering: "-exit_time" | "-entry_time") => {
    const q: string[] = ["status=CLOSED", `ordering=${ordering}`];
    if (params?.from) q.push(`journal_day__date__gte=${encodeURIComponent(params.from)}`);
    if (params?.to)   q.push(`journal_day__date__lte=${encodeURIComponent(params.to)}`);
    if (params?.page) q.push(`page=${params.page}`);
    return `/journal/trades/?${q.join("&")}`;
  };
  try {
    const res = await apiFetch(build("-exit_time"));
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.results ?? []);
    return {
      results: await Promise.all(list.map((x: any) => normalizeTradeAsync(x))),
      next: data.next ?? null,
      prev: data.previous ?? null,
      count: data.count ?? list.length,
    };
  } catch {
    // fallback for backends without exit_time
    const res = await apiFetch(build("-entry_time"));
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.results ?? []);
    return {
      results: list.map((x: any) => normalizeTrade(x)),
      next: data.next ?? null,
      prev: data.previous ?? null,
      count: data.count ?? list.length,
    };
  }
}

// Gating helpers
export function hasToken() {
  // Prefer in-memory access; fall back to legacy localStorage for now
  return !!getAccessToken() || !!localStorage.getItem("jwt");
}

export async function logout() {
  try {
    await authedFetch(`${API_BASE}/auth/logout/`, { method: "POST" }); // adds CSRF + Authorization + credentials
  } catch (e) {
    // even if backend is unreachable, still clear client auth
  } finally {
    setAccessToken(null);
    try { localStorage.removeItem("jwt"); } catch {}
  }
}

export async function fetchSessionStatusToday() {
  const res = await apiFetch(`/journal/trades/status/today/`);
  return res.json(); // { trades, win_rate, avg_r, best_r, worst_r, daily_loss_pct, used_daily_risk_pct }
}

export async function fetchAccountSummary() {
  const res = await apiFetch(`/journal/trades/account/summary/`);
  return res.json() as Promise<{
    pl_today: number;
    pl_total: number;
    equity_today: number | null;
    equity_last_close: number | null;
  }>;
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
      ...(payload.strategyTags !== undefined ? { strategy_tag_ids } : {}),
    }),
  });
  const json = await res.json();
  return normalizeTradeAsync(json);
}

export async function updateTrade(
  id: number | string,
  payload: {
    ticker?: string;
    side?: "LONG" | "SHORT";
    entryPrice?: number;
    stopLoss?: number | null;
    target?: number | null;
    size?: number;
    notes?: string;
    strategyTags?: string[];
  }
) {
  const hasStrategy = Array.isArray(payload.strategyTags);
  const strategy_tag_ids = await mapTagNamesToIds(payload.strategyTags);
  const res = await apiFetch(`/journal/trades/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(payload.ticker ? { ticker: payload.ticker } : {}),
      ...(payload.side ? { side: payload.side } : {}),
      ...(payload.entryPrice !== undefined ? { entry_price: payload.entryPrice } : {}),
      ...(payload.stopLoss !== undefined ? { stop_price: payload.stopLoss } : {}),
      ...(payload.target !== undefined ? { target_price: payload.target } : {}),
      ...(payload.size !== undefined ? { quantity: payload.size } : {}),
      ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
      ...(payload.strategyTags !== undefined ? { strategy_tag_ids } : {}),
    }),
  });
  const json = await res.json();
  return normalizeTradeAsync(json);
}

export async function closeTrade(id: number | string, payload: { exitPrice?: number; notes?: string; strategyTags?: string[] }) {
  // Guard: prevent closing without an exit price (to avoid 0 P&L + broken coloring)
  if (payload.exitPrice === undefined || payload.exitPrice === null || !Number.isFinite(Number(payload.exitPrice))) {
    throw new Error("Please provide an exit price to close the trade.");
  }
  const hasStrategy = Array.isArray(payload.strategyTags);
  const strategy_tag_ids = hasStrategy ? await mapTagNamesToIds(payload.strategyTags) : undefined;
  const res = await apiFetch(`/journal/trades/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "CLOSED",
      exit_price: payload.exitPrice ?? null,
      notes: payload.notes ?? "",
      // allow clearing tags when closing
      ...(hasStrategy ? { strategy_tag_ids: strategy_tag_ids ?? [] } : {}),
    }),
  });
  const json = await res.json();
  // If backend doesn't compute these, keep them raw; Calendar can still compute fallback.
  // Emit live event so Calendar refreshes immediately. Include a date hint so the Calendar can
  // decide whether the closed trade falls inside the currently visible month.
  try {
    // Prefer exit_time (date of realization); fall back to entry_time/created_at if absent.
    const iso = (json?.exit_time || json?.entry_time || json?.created_at || "").slice(0, 10);
    const dateISO = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : undefined;
    console.log("[api] closeTrade PATCH ok", { id, exitPrice: payload.exitPrice });
    emitTradeClosed({ tradeId: json?.id, dateISO: (json?.exit_time || json?.entry_time || "").slice(0,10) });
    console.log("[api] emitted trade:closed", { id: json?.id, exit_time: json?.exit_time });
  } catch {}
  return normalizeTradeAsync(json);
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

// -------- strategy-tag id→name helper (with cache) ----------
let tagCache: Map<number, string> | null = null;
async function getTagDict(): Promise<Map<number, string>> {
  if (tagCache) return tagCache;
  const all = await fetchTags();
  tagCache = new Map(all.map(t => [t.id, t.name]));
  return tagCache;
}

async function normalizeTradeAsync(x: any) {
  const base = normalizeTrade(x);
  // If no names came through but we have ids, map ids -> names via cache
  if ((!base.strategyTags || base.strategyTags.length === 0) && Array.isArray(x?.strategy_tag_ids)) {
    const dict = await getTagDict();
    const names = x.strategy_tag_ids.map((id: number) => dict.get(id)).filter(Boolean) as string[];
    return { ...base, strategyTags: Array.from(new Set(names)) };
  }
  return base;
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
    const r = await apiFetch(`/journal/days/`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ date: d }) });
    const j = await r.json();
    //if (j.existing) toast.info("Using today's journal day");
  return j.id;
  })();
  try {
    return await inflightDayPromise;
  } finally {
    inflightDayPromise = null;
  }
}

// --- Equity & Adjustments API (single source of truth) ---
export type AdjustmentReason = 'DEPOSIT' | 'WITHDRAWAL' | 'FEE' | 'CORRECTION';

import { getAccessToken, setAccessToken } from "./auth";

// optional helper
function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]) : null;
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) { onUnauthorized = fn; }

export async function authedFetch(
  url: string,
  init: RequestInit = {},
  _retried = false
): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as any) };

  // Bearer access (in-memory)
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  // CSRF on non-GET/HEAD
  const method = (init.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    headers["X-CSRFToken"] = headers["X-CSRFToken"] || getCookie("csrftoken") || "";
    if (!headers["Content-Type"] && init.body && !isFormData(init.body)) {
      headers["Content-Type"] = "application/json";
    }
  }

  // IMPORTANT: include cookies so the HttpOnly refresh cookie is sent
  let res = await fetch(url, { ...init, headers, credentials: "include" });

  // ---- 401 auto-refresh
  if (res.status === 401 && !_retried) {
    const rr = await fetch("/api/auth/jwt/refresh/", {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRFToken": getCookie("csrftoken") || "" }, // harmless if not needed
    });

    if (rr.ok) {
      const j = await rr.json(); // { access }
      if (j?.access) {
        setAccessToken(j.access);
        headers.Authorization = `Bearer ${j.access}`;
        // retry original once
        res = await fetch(url, { ...init, headers, credentials: "include" });
      }
    } else {
      // refresh failed: clear and bubble up so UI can redirect to login
      setAccessToken(null);
      try { localStorage.removeItem("jwt"); } catch {}
      if (onUnauthorized) onUnauthorized();
      throw new Error("Unauthorized; please log in again.");
    }
  }
  // ---------------------------------------------------------------

  if (!res.ok) {
    // surface server error text to callers
    const text = await res.text().catch(() => `${res.status}`);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res;
}

// ---- Journal Day helpers ----
export type JournalDay = {
  id: number;
  date: string;
  day_start_equity?: number | string;
  effective_equity?: number | string;
  adjustments_total?: number | string;
};

export async function getJournalDayByDate(date: string): Promise<JournalDay | null> {
  const r = await authedFetch(`/api/journal/days/?date=${encodeURIComponent(date)}`);
  if (!r.ok) return null;
  const j = await r.json();
  // Your API might return a single object or an array; normalize:
  return Array.isArray(j) ? (j[0] ?? null) : (j ?? null);
}

export async function createJournalDay(date: string): Promise<JournalDay> {
  const r = await authedFetch(`/api/journal/days/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getOrCreateJournalDay(date: string): Promise<JournalDay> {
  const found = await getJournalDayByDate(date);
  if (found?.id) return found;
  return await createJournalDay(date);
}

// ---- Adjustments helpers (with guard) ----
export async function listAdjustments(journalDayId?: number | null) {
  if (!Number.isInteger(journalDayId as number) || (journalDayId as number) <= 0) return [];
  const res = await authedFetch(`/api/journal/account/adjustments/?journal_day=${journalDayId}`);
  return res.json();
}

export async function getTodayJournalDay(dateISO?: string) {
 const date = dateISO ?? new Date().toISOString().slice(0, 10);
 const res = await authedFetch(`/api/journal/days/?date=${encodeURIComponent(date)}`);
 const data = await res.json();
 return Array.isArray(data) ? data[0] : data;
}

export async function patchDayStartEquity(id: number, dayStartEquity: number) {
  const res = await authedFetch(`/api/journal/days/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify({ day_start_equity: dayStartEquity }),
  });
  return res.json();
}

export async function createAdjustment(input: {
  journal_day: number;
  amount: number;
  reason: AdjustmentReason;
  note?: string;
}) {
  if (!Number.isInteger(input?.journal_day) || input.journal_day <= 0) {
    throw new Error("journal_day is required");
  }
  const res = await authedFetch(`/api/journal/account/adjustments/`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function deleteAdjustment(id: number) {
  const res = await authedFetch(`/api/journal/account/adjustments/${id}/`, { method: 'DELETE' });
}
