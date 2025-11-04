// frontend/src/lib/api.ts
/* ========================================================================
   API client for Daytrading Platform
   - JWT access via in-memory token + HttpOnly refresh cookie
   - DRF-compatible helpers + normalization for UI
   - Emotions + Attachments + Journal Day + Adjustments
   ======================================================================== */

const API_BASE = "/api";

/* ----------------------------- Types ---------------------------------- */
type TokenPair = { access: string; refresh?: string };

export type AdjustmentReason = "DEPOSIT" | "WITHDRAWAL" | "FEE" | "CORRECTION";

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
  // Either of these may appear, depending on serializer/output
  strategy_tags?: { id: number; name: string }[];
  strategy_tag_ids?: number[];
  // time fields (server may omit exit_time for OPEN)
  entry_time?: string;
  created_at?: string;
  exit_time?: string | null;

  // optional server-calculated fields
  realized_pnl?: number;
  r_multiple?: number | null;

  // emotion fields (server optional)
  entry_emotion?: "NEUTRAL" | "BIASED" | null;
  entry_emotion_note?: string | null;
  exit_emotion?: "NEUTRAL" | "BIASED" | null;
  exit_emotion_note?: string | null;
};

export type NormalizedTrade = {
  id: number;
  journal_day: number;
  ticker: string;
  side: "LONG" | "SHORT";
  size?: number;
  entryPrice: number;
  stopLoss?: number | null;
  target?: number | null;
  exitPrice?: number | null;
  status: "OPEN" | "CLOSED";
  notes: string;
  strategyTags: string[];
  entryTime: string; // ISO (falls back to created_at if missing)
  exitTime?: string | null;
  realizedPnl?: number;
  rMultiple?: number | null;

  entryEmotion?: "NEUTRAL" | "BIASED" | null;
  entryEmotionNote?: string | null;
  exitEmotion?: "NEUTRAL" | "BIASED" | null;
  exitEmotionNote?: string | null;

  // reserved for future risk calc
  riskR?: number;
};

/* ----------------------- Small utilities ------------------------------ */
function toArray<T>(x: unknown): T[] {
  return Array.isArray(x) ? (x as T[]) : [];
}

function todayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* ----------------------- Auth token bridge ---------------------------- */
import { getAccessToken, setAccessToken } from "./auth";
import { emitTradeClosed } from "./events";

/* Legacy helpers kept for any older callers; safe to remove later */
function getToken(): TokenPair | null {
  try {
    const s = localStorage.getItem("jwt");
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
function setToken(tok: TokenPair | null) {
  if (tok) localStorage.setItem("jwt", JSON.stringify(tok));
  else localStorage.removeItem("jwt");
}
export function hasToken() {
  // Prefer in-memory access; fall back to legacy localStorage bridge
  return !!getAccessToken() || !!localStorage.getItem("jwt");
}

/* ------------------------- CSRF helper -------------------------------- */
function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]) : null;
}

/* ---------------------- Unauthorized hook ----------------------------- */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

/* ------------------------- authedFetch ------------------------------- */
export async function authedFetch(
  url: string,
  init: RequestInit = {},
  _retried = false
): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as any) };

  // attach Bearer token if present (in-memory)
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  // CSRF for mutating requests (non-GET/HEAD)
  const method = (init.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    headers["X-CSRFToken"] = headers["X-CSRFToken"] || getCookie("csrftoken") || "";
    if (!headers["Content-Type"] && init.body && !(init.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
  }

  // always include cookies so the HttpOnly refresh cookie is sent
  let res = await fetch(url, { ...init, headers, credentials: "include" });

  // Auto-refresh on 401 once
  if (res.status === 401 && !_retried) {
    const rr = await fetch("/api/auth/jwt/refresh/", {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRFToken": getCookie("csrftoken") || "" },
    });
    if (rr.ok) {
      const j = await rr.json(); // { access }
      if (j?.access) {
        setAccessToken(j.access);
        headers.Authorization = `Bearer ${j.access}`;
        res = await fetch(url, { ...init, headers, credentials: "include" });
      }
    } else {
      // refresh failed → clear and bubble up
      setAccessToken(null);
      try {
        localStorage.removeItem("jwt");
      } catch {}
      if (onUnauthorized) onUnauthorized();
      throw new Error("Unauthorized; please log in again.");
    }
  }

  if (!res.ok) {
    // Surface server error body to callers
    const text = await res.text().catch(() => `${res.status}`);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res;
}

/* --------------- Single entry for all API calls ----------------------- */
export async function apiFetch(path: string, opts: RequestInit = {}) {
  return authedFetch(`${API_BASE}${path}`, opts);
}

/* -------------------------- Auth endpoints ---------------------------- */
export async function login(email: string, password: string) {
  // Backend sets refresh as HttpOnly cookie; body returns { access }
  const res = await fetch(`${API_BASE}/auth/jwt/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });
  if (!res.ok) {
    let msg = "";
    try {
      msg = await res.text();
    } catch {}
    throw new Error(`Login failed: ${msg || res.statusText}`);
  }
  const j = (await res.json()) as { access?: string; refresh?: string };
  if (!j?.access) throw new Error("Login failed: no access token returned");
  setAccessToken(j.access);
  // temporary bridge for any old code path
  setToken({ access: j.access });
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

export async function logout() {
  try {
    await authedFetch(`${API_BASE}/auth/logout/`, { method: "POST" });
  } catch {
    // even if backend is unreachable, still clear client-side
  } finally {
    setAccessToken(null);
    try {
      localStorage.removeItem("jwt");
    } catch {}
  }
}

/* ----------------------- User settings / theme ------------------------ */
export async function fetchUserSettings() {
  const res = await apiFetch(`/journal/settings/`);
  if (!res.ok) return null;
  const data = await res.json();
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

/* -------------------------- Tags (cached) ----------------------------- */
async function fetchTags(): Promise<{ id: number; name: string }[]> {
  const res = await apiFetch(`/journal/tags/`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : data?.results ?? [];
}

let tagCache: Map<number, string> | null = null;
async function getTagDict(): Promise<Map<number, string>> {
  if (tagCache) return tagCache;
  const all = await fetchTags();
  tagCache = new Map(all.map((t) => [t.id, t.name]));
  return tagCache;
}

async function mapTagNamesToIds(names?: string[]) {
  if (!names || !names.length) return [];
  const all = await fetchTags();
  const list = Array.isArray(all) ? all : (all as any)?.results ?? [];
  const map = new Map(list.map((t: any) => [String(t.name).toLowerCase(), t.id]));
  return names.map((n) => map.get(n.toLowerCase())).filter(Boolean) as number[];
}

/* --------------------- Trade normalization ---------------------------- */
function normalizeTrade(x: ApiTrade): NormalizedTrade {
  const rawTags = toArray<any>(x?.strategy_tags ?? (x as any)?.strategyTags);
  const tagNames = rawTags
    .map((t) => (t && typeof t === "object" ? t.name : t))
    .filter(Boolean);

  // ---- Fallbacks for computed fields (handles older API responses) ----
  const qtyNum = Number(x.quantity || 0);
  const entryNum = Number(x.entry_price);
  const exitNum  = x.exit_price != null ? Number(x.exit_price) : null;
  const stopNum  = x.stop_price != null ? Number(x.stop_price) : null;

  // realized P/L fallback if server didn't send realized_pnl
  let realizedPnlVal: number | undefined =
    typeof x.realized_pnl === "number" ? x.realized_pnl : undefined;
  if (realizedPnlVal === undefined && exitNum !== null && Number.isFinite(entryNum) && Number.isFinite(qtyNum)) {
    const move = exitNum - entryNum;
    realizedPnlVal = (x.side === "SHORT" ? -move : move) * qtyNum;
  }

  // R multiple fallback if server didn't send r_multiple
  let rMultipleVal: number | null =
    typeof x.r_multiple === "number" ? x.r_multiple : null;
  if (rMultipleVal == null && exitNum !== null && stopNum !== null && Number.isFinite(entryNum)) {
    const rps = Math.abs(entryNum - stopNum);
    if (rps > 0) {
      const move = exitNum - entryNum;
      rMultipleVal = (x.side === "SHORT" ? -move : move) / rps;
    }
  }


  return {
    id: x.id,
    journal_day: x.journal_day,
    ticker: x.ticker,
    side: x.side,
    size: x.quantity || undefined,
    entryPrice: x.entry_price,
    stopLoss: x.stop_price ?? null,
    target: x.target_price ?? null,
    exitPrice: x.exit_price ?? null,
    status: x.status,
    notes: x.notes || "",
    strategyTags: Array.from(new Set(tagNames)),
    entryTime: x.entry_time || x.created_at || new Date().toISOString(),
    exitTime: x.exit_time ?? undefined,
    realizedPnl: realizedPnlVal,
    rMultiple: rMultipleVal,
    entryEmotion: x.entry_emotion ?? null,
    entryEmotionNote: x.entry_emotion_note ?? "",
    exitEmotion: x.exit_emotion ?? null,
    exitEmotionNote: x.exit_emotion_note ?? "",
    riskR: undefined,
  };
}
async function normalizeTradeAsync(x: ApiTrade): Promise<NormalizedTrade> {
  const base = normalizeTrade(x);
  if ((!base.strategyTags || base.strategyTags.length === 0) && Array.isArray(x?.strategy_tag_ids)) {
    const dict = await getTagDict();
    const names = x.strategy_tag_ids.map((id: number) => dict.get(id)).filter(Boolean) as string[];
    return { ...base, strategyTags: Array.from(new Set(names)) };
  }
  return base;
}

/* ---------------------------- Trades ---------------------------------- */
export async function fetchOpenTrades(): Promise<NormalizedTrade[]> {
  const res = await apiFetch(`/journal/trades/?status=OPEN&ordering=-entry_time`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.results ?? [];
  return Promise.all(list.map((x: ApiTrade) => normalizeTradeAsync(x)));
}

export async function fetchClosedTrades(params?: {
  from?: string;
  to?: string;
  page?: number;
  ts?: number; // optional cache-bust stamp
}) {
  const build = (ordering: "-exit_time" | "-entry_time") => {
    const q: string[] = ["status=CLOSED", `ordering=${ordering}`];
    if (params?.from) q.push(`journal_day__date__gte=${encodeURIComponent(params.from)}`);
    if (params?.to) q.push(`journal_day__date__lte=${encodeURIComponent(params.to)}`);
    if (params?.page) q.push(`page=${params.page}`);
    if (params?.ts) q.push(`_=${params.ts}`);
    return `/journal/trades/?${q.join("&")}`;
  };
  try {
    const res = await apiFetch(build("-exit_time"));
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.results ?? [];
    return {
      results: await Promise.all(list.map((x: ApiTrade) => normalizeTradeAsync(x))),
      next: data.next ?? null,
      prev: data.previous ?? null,
      count: data.count ?? list.length,
    };
  } catch {
    // fallback for backends without exit_time
    const res = await apiFetch(build("-entry_time"));
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.results ?? [];
    return {
      results: await Promise.all(list.map((x: ApiTrade) => normalizeTradeAsync(x))),
      next: data.next ?? null,
      prev: data.previous ?? null,
      count: data.count ?? list.length,
    };
  }
}

export async function fetchTradeDetail(tradeId: number): Promise<NormalizedTrade> {
  const res = await apiFetch(`/journal/trades/${tradeId}/`);
  const t: ApiTrade = await res.json();
  return normalizeTradeAsync(t);
}

let inflightDayPromise: Promise<number> | null = null;
async function getOrCreateTodayDayId(): Promise<number> {
  if (inflightDayPromise) return inflightDayPromise;
  inflightDayPromise = (async () => {
    const d = todayISO();
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

export async function createTrade(payload: {
  ticker: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss?: number | null;
  target?: number | null;
  size?: number;
  notes?: string;
  strategyTags?: string[];
  // emotions on open
  entryEmotion?: "NEUTRAL" | "BIASED" | null;
  entryEmotionNote?: string;
}): Promise<NormalizedTrade> {
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
      // emotion fields
      entry_emotion: payload.entryEmotion ?? null,
      entry_emotion_note: payload.entryEmotionNote ?? "",
    }),
  });
  const json: ApiTrade = await res.json();
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
    // allow editing emotions if needed
    entryEmotion?: "NEUTRAL" | "BIASED" | null;
    entryEmotionNote?: string | null;
    exitEmotion?: "NEUTRAL" | "BIASED" | null;
    exitEmotionNote?: string | null;
  }
): Promise<NormalizedTrade> {
  const hasStrategy = Array.isArray(payload.strategyTags);
  const strategy_tag_ids = hasStrategy ? await mapTagNamesToIds(payload.strategyTags) : undefined;

  const res = await apiFetch(`/journal/trades/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(payload.ticker !== undefined ? { ticker: payload.ticker } : {}),
      ...(payload.side !== undefined ? { side: payload.side } : {}),
      ...(payload.entryPrice !== undefined ? { entry_price: payload.entryPrice } : {}),
      ...(payload.stopLoss !== undefined ? { stop_price: payload.stopLoss } : {}),
      ...(payload.target !== undefined ? { target_price: payload.target } : {}),
      ...(payload.size !== undefined ? { quantity: payload.size } : {}),
      ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
      ...(hasStrategy ? { strategy_tag_ids } : {}),
      ...(payload.entryEmotion !== undefined ? { entry_emotion: payload.entryEmotion } : {}),
      ...(payload.entryEmotionNote !== undefined ? { entry_emotion_note: payload.entryEmotionNote } : {}),
      ...(payload.exitEmotion !== undefined ? { exit_emotion: payload.exitEmotion } : {}),
      ...(payload.exitEmotionNote !== undefined ? { exit_emotion_note: payload.exitEmotionNote } : {}),
    }),
  });
  const json: ApiTrade = await res.json();
  return normalizeTradeAsync(json);
}

export async function closeTrade(
  id: number | string,
  payload: {
    exitPrice: number; // required (guard below)
    notes?: string;
    strategyTags?: string[];
    // emotions on close
    exitEmotion?: "NEUTRAL" | "BIASED" | null;
    exitEmotionNote?: string;
    // optionally allow client to set explicit exit_time
    exitTime?: string | null;
  }
): Promise<NormalizedTrade> {
  if (
    payload.exitPrice === undefined ||
    payload.exitPrice === null ||
    !Number.isFinite(Number(payload.exitPrice))
  ) {
    throw new Error("Please provide an exit price to close the trade.");
  }
  const hasStrategy = Array.isArray(payload.strategyTags);
  const strategy_tag_ids = hasStrategy ? await mapTagNamesToIds(payload.strategyTags) : undefined;

  const res = await apiFetch(`/journal/trades/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "CLOSED",
      exit_price: payload.exitPrice,
      notes: payload.notes ?? "",
      ...(hasStrategy ? { strategy_tag_ids: strategy_tag_ids ?? [] } : {}),
      // emotions
      exit_emotion: payload.exitEmotion ?? null,
      exit_emotion_note: payload.exitEmotionNote ?? "",
      // Ensure exit_time is stamped: use caller's value when provided, otherwise "now".
      // (If the backend also stamps/validates, it will simply overwrite or accept.)
      exit_time: payload.exitTime ?? new Date().toISOString(),
    }),
  });
  const json: ApiTrade = await res.json();

  // Emit live event so Calendar / Dashboard can refresh immediately
  try {
    emitTradeClosed({
      tradeId: json?.id,
      dateISO: (json?.exit_time || json?.entry_time || "").slice(0, 10) || undefined,
    });
  } catch {}

  return normalizeTradeAsync(json);
}

/* -------------------------- Attachments ------------------------------- */
export async function createAttachment(tradeId: number | string, file: File, caption = "") {
  const fd = new FormData();
  fd.append("trade", String(tradeId));
  fd.append("image", file, file.name);
  if (caption) fd.append("caption", caption);
  const res = await apiFetch(`/journal/attachments/`, { method: "POST", body: fd });
  return res.json();
}

export async function listAttachments(tradeId: number | string): Promise<
  Array<{ id: number; image: string; caption?: string; created_at?: string }>
> {
  // Keep the same prefix style as the rest of the journal API.
  const res = await apiFetch(`/journal/attachments/?trade=${tradeId}`);
  if (!res.ok) return [];
  const raw = await res.json();
  const rows = Array.isArray(raw) ? raw : raw?.results ?? [];

  // Be tolerant to different backend field names:
  // image | image_url | file | url  (and caption/note variants)
  const norm = rows
    .map((r: any) => {
      const img =
        r.image ??
        r.image_url ??
        r.file ??
        r.url ??
        "";
      return img
        ? { id: r.id, image: img, caption: r.caption ?? r.note ?? "", created_at: r.created_at ?? r.createdAt ?? undefined }
        : null;
    })
    .filter(Boolean) as Array<{ id: number; image: string; caption?: string; created_at?: string }>;
  return norm;
};

/* ----------------------- Account / Session KPIs ---------------------- */
export async function fetchSessionStatusToday() {
  const res = await apiFetch(`/journal/trades/status/today/`);
  return res.json(); // { trades, win_rate, avg_r, best_r, worst_r, daily_loss_pct, used_daily_risk_pct, ... }
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

/* -------------------- Journal Day & Equity/Adjustments ---------------- */
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
  return Array.isArray(j) ? (j[0] ?? null) : j ?? null;
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
    method: "PATCH",
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
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function deleteAdjustment(id: number) {
  await authedFetch(`/api/journal/account/adjustments/${id}/`, { method: "DELETE" });
}