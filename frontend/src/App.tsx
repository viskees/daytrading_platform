import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import type { ReactNode, ChangeEvent, DragEvent, ClipboardEvent } from "react";
import {
  login as apiLogin,
  register as apiRegister,
  fetchUserSettings as apiFetchUserSettings,
  saveTheme as apiSaveTheme,
  fetchOpenTrades as apiFetchOpenTrades,
  hasToken,
  logout as apiLogout,
  createTrade as apiCreateTrade,
  closeTrade as apiCloseTrade,
  createAttachment as apiCreateAttachment,
} from "@/lib/api";
import JournalTab from "./components/JournalTab";
import TradeEditor from "./components/TradeEditor";
import { updateTrade } from "./lib/api";


/* =========================
   Types (match Django API)
   ========================= */
export type RiskPolicy = {
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxTradesPerDay: number;
};

export type Trade = {
  id: string | number;
  ticker: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  entryTime: string; // ISO
  stopLoss?: number;
  target?: number;
  riskR?: number; // computed server-side later
  size?: number; // shares/contracts
  notes?: string;
  strategyTags?: string[];
  status: "OPEN" | "CLOSED";
};

export type Ticker = {
  symbol: string;
  last: number;
  volume: number;
  relVol?: number; // relative volume
  changePct?: number; // % change on the day
};

export type UserSettings = { theme: "light" | "dark" };

/* =========================
   Helpers + Tests
   ========================= */
const THEME_KEY = "theme"; // 'dark' | 'light'

export function calcUsedPctOfBudget(usedDailyRiskPct: number, maxDailyLossPct: number): number {
  if (!isFinite(usedDailyRiskPct) || !isFinite(maxDailyLossPct) || maxDailyLossPct <= 0) return 0;
  const pct = (usedDailyRiskPct / maxDailyLossPct) * 100;
  return Math.min(100, Math.max(0, pct));
}

export function getInitialDark(): boolean {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark") return true;
    if (stored === "light") return false;
  } catch {}
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return false;
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms = 300) {
  let t: any;
  return (...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function runDevTests() {
  // DO NOT CHANGE existing tests
  console.assert(calcUsedPctOfBudget(1.5, 3) === 50, "calcUsedPctOfBudget 1.5/3 should be 50%");
  console.assert(calcUsedPctOfBudget(0, 3) === 0, "0 usage should be 0%");
  console.assert(calcUsedPctOfBudget(10, 3) === 100, ">100% should clamp to 100%");
  console.assert(calcUsedPctOfBudget(2, 0) === 0, "0 maxDailyLoss clamps to 0");
  console.assert(calcUsedPctOfBudget(-1, 3) === 0, "negative usage clamps to 0%");
  // @ts-expect-error intentional NaN test
  console.assert(calcUsedPctOfBudget(Number.NaN, 3) === 0, "NaN usage returns 0");

  // Added tests
  console.assert(calcUsedPctOfBudget(3, 3) === 100, "equal usage should be 100%");
  console.assert(calcUsedPctOfBudget(300, 600) === 50, "proportional large numbers");
}

function ModalShell({ title, onClose, children }:{
  title: string; onClose: ()=>void; children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-zinc-900 border shadow-lg">
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="font-semibold">{title}</h3>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function ImagePasteDrop({
  files, setFiles, label = "Click or paste screenshot (Ctrl/Cmd+V)"
}: { files: File[]; setFiles: (f: File[]) => void; label?: string }) {
  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    setFiles([...files, ...Array.from(e.target.files)]);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (dropped.length) setFiles([...files, ...dropped]);
  };
  const onPaste = (e: ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/"));
    if (imgs.length) { e.preventDefault(); setFiles([...files, ...imgs]); }
  };
  return (
    <div
      tabIndex={0}
      onDrop={onDrop}
      onDragOver={(e)=>e.preventDefault()}
      onPaste={onPaste}
      className="border border-dashed rounded-xl p-3 text-xs text-muted-foreground focus:outline-none focus:ring-2"
    >
      <div className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <Input type="file" accept="image/*" multiple onChange={onInput} className="w-auto" />
      </div>
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={i} className="relative">
              <img
                alt={f.name}
                src={URL.createObjectURL(f)}
                className="h-16 w-24 object-cover rounded-lg border"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewTradeDialog({
  onCreated, onClose
}: { onCreated: (t: Trade)=>void; onClose: ()=>void }) {
  const [ticker, setTicker] = useState("");
  const [side, setSide] = useState<"LONG"|"SHORT">("LONG");
  const [entryPrice, setEntryPrice] = useState<number | "">("");
  const [stopLoss, setStopLoss] = useState<number | "">("");
  const [target, setTarget] = useState<number | "">("");
  const [size, setSize] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [shots, setShots] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const toggleTag = (tag:string)=> setTags(t => t.includes(tag) ? t.filter(x=>x!==tag) : [...t, tag]);

  const submit = async () => {
    if (!ticker || !entryPrice) return;
    setSaving(true);
    try {
      const trade = await apiCreateTrade({
        ticker,
        side,
        entryPrice: Number(entryPrice),
        stopLoss: stopLoss ? Number(stopLoss) : undefined,
        target: target ? Number(target) : undefined,
        size: size ? Number(size) : undefined,
        notes,
        strategyTags: tags,
      });
      // optional uploads
      for (const f of shots) {
        await apiCreateAttachment(trade.id, f);
      }
      onCreated(trade);
      onClose();
    } catch (e:any) {
      console.error("Create trade failed:", e?.message, e);
      alert(`Create trade failed: ${e?.message ?? "Unknown error"}`);
    } finally { setSaving(false); }
  };

  return (
    <ModalShell title="New trade" onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs mb-1">Ticker</div>
          <Input value={ticker} onChange={e=>setTicker(e.target.value.toUpperCase())} />
        </div>
        <div>
          <div className="text-xs mb-1">Side</div>
          <div className="flex gap-2">
            <Button variant={side==="LONG"?"default":"outline"} onClick={()=>setSide("LONG")}>LONG</Button>
            <Button variant={side==="SHORT"?"default":"outline"} onClick={()=>setSide("SHORT")}>SHORT</Button>
          </div>
        </div>
        <div>
          <div className="text-xs mb-1">Entry</div>
          <Input type="number" value={entryPrice} onChange={e=>setEntryPrice(e.target.value ? Number(e.target.value) : "")}/>
        </div>
        <div>
          <div className="text-xs mb-1">Stop</div>
          <Input type="number" value={stopLoss} onChange={e=>setStopLoss(e.target.value ? Number(e.target.value) : "")}/>
        </div>
        <div>
          <div className="text-xs mb-1">Target</div>
          <Input type="number" value={target} onChange={e=>setTarget(e.target.value ? Number(e.target.value) : "")}/>
        </div>
        <div>
          <div className="text-xs mb-1">Size</div>
          <Input type="number" value={size} onChange={e=>setSize(e.target.value ? Number(e.target.value) : "")}/>
        </div>
        <div className="md:col-span-3">
          <div className="text-xs mb-1">Strategy</div>
          <div className="flex flex-wrap gap-2">
            {STRATEGY_TAGS.map(tag=>(
              <Button key={tag} size="sm" variant={tags.includes(tag)?"default":"outline"} onClick={()=>toggleTag(tag)}>
                {tags.includes(tag) ? `− ${tag}` : `+ ${tag}`}
              </Button>
            ))}
          </div>
        </div>
        <div className="md:col-span-3">
          <div className="text-xs mb-1">Notes</div>
          <Textarea value={notes} onChange={e=>setNotes(e.target.value)} className="h-24"/>
        </div>
        <div className="md:col-span-3">
          <ImagePasteDrop files={shots} setFiles={setShots} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={saving || !ticker || !entryPrice}>Create</Button>
      </div>
    </ModalShell>
  );
}

function CloseTradeDialog({
  trade, onClosed, onClose
}: { trade: Trade; onClosed: (id: string)=>void; onClose: ()=>void }) {
  const [exitPrice, setExitPrice] = useState<number | "">("");
  const [notes, setNotes] = useState(trade.notes ?? "");
  const [shots, setShots] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await apiCloseTrade(trade.id, {
        exitPrice: exitPrice ? Number(exitPrice) : undefined,
        notes,
      });
      for (const f of shots) {
        await apiCreateAttachment(trade.id, f);
      }
      onClosed(trade.id);
      onClose();
    } catch {
    } finally { setSaving(false); }
  };

  return (
    <ModalShell title={`Close ${trade.ticker}`} onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-xs mb-1">Exit price</div>
          <Input type="number" value={exitPrice} onChange={e=>setExitPrice(e.target.value ? Number(e.target.value) : "")}/>
        </div>
        <div className="md:col-span-2">
          <div className="text-xs mb-1">Notes</div>
          <Textarea value={notes} onChange={e=>setNotes(e.target.value)} className="h-24"/>
        </div>
        <div className="md:col-span-2">
          <ImagePasteDrop files={shots} setFiles={setShots} label="Click or paste exit screenshot (Ctrl/Cmd+V)"/>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={saving}>Close trade</Button>
      </div>
    </ModalShell>
  );
}

/* =========================
   Mock data (fallbacks)
   ========================= */
const MOCK_RISK: RiskPolicy = { maxRiskPerTradePct: 1, maxDailyLossPct: 3, maxTradesPerDay: 6 };
const MOCK_OPEN_TRADES: Trade[] = [
  { id: "t1", ticker: "AAPL", side: "LONG", entryPrice: 190.12, entryTime: new Date().toISOString(), stopLoss: 188.5, target: 194, riskR: 0.6, size: 100, notes: "Breakout over HOD", strategyTags: ["Breakout", "VWAP"], status: "OPEN" },
  { id: "t2", ticker: "TSLA", side: "SHORT", entryPrice: 245.2, entryTime: new Date().toISOString(), stopLoss: 248.0, target: 238, riskR: 0.4, size: 50, notes: "Rejection at premarket high", strategyTags: ["Reversal"], status: "OPEN" },
];

const MOCK_TICKERS: Ticker[] = [
  { symbol: "AAPL", last: 191.02, volume: 12_450_000, relVol: 1.8, changePct: 1.24 },
  { symbol: "TSLA", last: 243.88, volume: 9_210_000, relVol: 2.3, changePct: -0.75 },
  { symbol: "AMD", last: 128.44, volume: 6_100_000, relVol: 1.2, changePct: 0.42 },
  { symbol: "NVDA", last: 906.55, volume: 15_300_000, relVol: 1.5, changePct: -2.11 },
  { symbol: "SMCI", last: 645.11, volume: 2_400_000, relVol: 2.9, changePct: 3.34 },
  { symbol: "META", last: 504.10, volume: 7_900_000, relVol: 0.9, changePct: -0.15 },
];

const STRATEGY_TAGS = ["Breakout", "Pullback", "Reversal", "VWAP", "Trend", "Range", "News"];

/* =========================
   App
   ========================= */
export default function App() {
  const [page, setPage] = useState<"dashboard" | "stocks" | "risk" | "journal">("dashboard");
  const [risk, setRisk] = useState<RiskPolicy>(MOCK_RISK);
  const [openTrades, setOpenTrades] = useState<Trade[]>(MOCK_OPEN_TRADES);
  const [dark, setDark] = useState<boolean>(getInitialDark());
  const [authed, setAuthed] = useState<boolean>(hasToken());
  const [showNew, setShowNew] = useState(false);
  const [closing, setClosing] = useState<Trade | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<any|null>(null);

  // Mock stats for now (wire later)
  const todaysPL = useMemo(() => 0.0, []);
  const totalPL = useMemo(() => 0.0, []);
  const totalEquity = useMemo(() => 0.0, []);

  // Risk meter: replace with backend calc later
  const usedDailyRiskPct = 1.5;
  const usedPctOfBudget = calcUsedPctOfBudget(usedDailyRiskPct, risk.maxDailyLossPct);

  // theme → DOM + localStorage
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {}
  }, [dark]);

  // theme → server (debounced) after login
  const debouncedSaveTheme = debounce((theme: "dark" | "light") => {
    apiSaveTheme(theme);
  }, 800);
  useEffect(() => {
    if (authed) debouncedSaveTheme(dark ? "dark" : "light");
  }, [dark, authed]);

  // dev sanity tests
  useEffect(() => {
    runDevTests();
  }, []);

  // after login: fetch server settings + open trades
  useEffect(() => {
    if (!authed) return;
    (async () => {
      try {
        const settings = await apiFetchUserSettings();
        if (settings) setDark(!!settings.dark_mode);
      } catch {}
      try {
        const trades = await apiFetchOpenTrades();
        if (Array.isArray(trades) && trades.length) {
          setOpenTrades(trades as Trade[]);
        }
      } catch {}
    })();
  }, [authed]);

  /* ---------- Auth Landing ---------- */
  function Unauthed() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const doLogin = async () => {
      setErr(null);
      setLoading(true);
      try {
        await apiLogin(email, password);
        setAuthed(true);
      } catch {
        setErr("Login failed");
      } finally {
        setLoading(false);
      }
    };

    const doRegister = async () => {
      setErr(null); setLoading(true);
      try {
        await apiRegister(email, password);     // creates user
        await apiLogin(email, password);        // gets JWT + stores it
        setAuthed(true);
      } catch {
        setErr("Register failed");
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="max-w-2xl mx-auto py-10 space-y-6">
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold">User Settings</h1>
              <div className="flex items-center gap-2 text-sm">
                <span>Dark mode</span>
                <Switch checked={dark} onCheckedChange={setDark} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Please register or log in to access the trading app.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">Email</div>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                <div className="text-sm font-medium">Password</div>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                <div className="flex gap-2 mt-2">
                  <Button onClick={doLogin} disabled={loading}>Log in</Button>
                  <Button variant="outline" onClick={doRegister} disabled={loading}>Register</Button>
                </div>
                {err && <div className="text-red-600 text-sm mt-2">{err}</div>}
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Two-Factor Authentication</div>
                <p className="text-xs text-muted-foreground">
                  MFA is pre-setup server-side. We’ll wire the QR + verify endpoints next.
                </p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Endpoints used now: <code>/api/auth/jwt/token/</code>, <code>/api/auth/register</code>, <code>/api/journal/settings/</code>, <code>/api/journal/trades/</code>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---------- Widgets ---------- */
  const RiskSummary = () => (
    <Card>
      <CardContent className="p-4">
        <h2 className="font-bold mb-2">Risk settings & status</h2>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Max risk / trade</div>
            <div className="font-medium">{risk.maxRiskPerTradePct}%</div>
          </div>
          <div>
            <div className="text-muted-foreground">Max loss / day</div>
            <div className="font-medium">{risk.maxDailyLossPct}%</div>
          </div>
          <div>
            <div className="text-muted-foreground">Max trades / day</div>
            <div className="font-medium">{risk.maxTradesPerDay}</div>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Daily risk used</span>
            <span className="font-medium">{usedDailyRiskPct.toFixed(2)}% / {risk.maxDailyLossPct}%</span>
          </div>
          <Progress value={usedPctOfBudget} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Will sync with <code>/api/risk-policy</code> and <code>/api/pnl/daily</code>.
        </p>
      </CardContent>
    </Card>
  );

  const AccountSummary = () => (
    <Card>
      <CardContent className="p-4">
        <h2 className="font-bold mb-2">Account Summary</h2>
        <ul className="grid grid-cols-3 gap-4 text-sm">
          <li>
            <div className="text-muted-foreground">P/L (today)</div>
            <div className="font-semibold">{todaysPL.toFixed(2)}</div>
          </li>
          <li>
            <div className="text-muted-foreground">P/L (total)</div>
            <div className="font-semibold">{totalPL.toFixed(2)}</div>
          </li>
          <li>
            <div className="text-muted-foreground">Total equity</div>
            <div className="font-semibold">{totalEquity.toFixed(2)}</div>
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Endpoints: <code>/api/pnl/daily</code>, <code>/api/pnl/total</code>, <code>/api/equity</code>.
        </p>
      </CardContent>
    </Card>
  );

  const sessionStats = { trades: 3, winRate: 66.7, avgR: 0.42, bestR: 2.1, worstR: -0.8, maxDD: -1.7 };
  function Stat({ label, value }: { label: string; value: string | number }) {
    return (
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-base font-semibold">{value}</div>
      </div>
    );
  }
  const SessionStats = () => (
    <Card>
      <CardContent className="p-4">
        <h2 className="font-bold mb-2">Session Stats</h2>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
          <Stat label="Trades" value={sessionStats.trades} />
          <Stat label="Win rate" value={`${sessionStats.winRate.toFixed(1)}%`} />
          <Stat label="Avg R" value={sessionStats.avgR.toFixed(2)} />
          <Stat label="Best R" value={sessionStats.bestR.toFixed(2)} />
          <Stat label="Worst R" value={sessionStats.worstR.toFixed(2)} />
          <Stat label="Max DD" value={`${sessionStats.maxDD.toFixed(2)}%`} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Endpoint: <code>/api/stats/session</code>.</p>
      </CardContent>
    </Card>
  );

  const onEditTrade = (t: any) => {
   setEditing(t);
   setEditOpen(true);
 };

 const onSaveEdit = async (vals: any) => {
   if (!editing) return;
   const updated = await updateTrade(editing.id, vals);
   // optimistic local replace
   setOpenTrades(prev => prev.map(x => (x.id === updated.id ? updated : x)));
   // ensure normalized tags (and any server-side adjustments) are reflected
   try {
     const fresh = await apiFetchOpenTrades();
     if (Array.isArray(fresh)) setOpenTrades(fresh as Trade[]);
   } catch { /* ignore – local optimistic update already applied */ }
 };

  const OpenTrades = () => (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold">Open Trades</h2>
          <Button variant="outline" size="sm" onClick={() => setShowNew(true)}>New trade</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b">
                <th className="py-2 pr-2">Ticker</th>
                <th className="py-2 pr-2">Side</th>
                <th className="py-2 pr-2">Entry</th>
                <th className="py-2 pr-2">Stop</th>
                <th className="py-2 pr-2">Target</th>
                <th className="py-2 pr-2">Size</th>
                <th className="py-2 pr-2">Risk (R)</th>
                <th className="py-2 pr-2">Strategy</th>
                <th className="py-2 pr-2">Notes</th>
                <th className="py-2 pr-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {openTrades.map((t) => (
                <tr key={t.id} className="border-b last:border-none align-top">
                  <td className="py-2 pr-2 font-medium">{t.ticker}</td>
                  <td className="py-2 pr-2">{t.side}</td>
                  <td className="py-2 pr-2">{t.entryPrice.toFixed(2)}</td>
                  <td className="py-2 pr-2">{t.stopLoss?.toFixed(2) ?? "-"}</td>
                  <td className="py-2 pr-2">{t.target?.toFixed(2) ?? "-"}</td>
                  <td className="py-2 pr-2">{t.size ?? "-"}</td>
                  <td className="py-2 pr-2">{t.riskR?.toFixed(2) ?? "-"}</td>
                  <td className="py-2 pr-2 max-w-[200px]">
                    <div className="flex flex-wrap gap-1">
                      {(t.strategyTags ?? []).map((tag) => (
                        <Badge key={tag} variant="secondary" className="rounded-full">{tag}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 pr-2 max-w-[240px]">
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-3" title={t.notes || ""}>
                      {t.notes || ""}
                    </div>
                  </td>
                  <td className="py-2 pr-2 space-y-2">
                    <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => onEditTrade(t)}>Edit</Button>
                        <Button size="sm" variant="outline" onClick={() => setClosing(t)}>Close</Button>
                    </div>
                 </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          On close, move to journal.
        </p>
      </CardContent>
    </Card>
  );

  const Calendar = () => (
    <Card>
      <CardContent className="p-4">
        <h2 className="font-bold mb-2">Calendar</h2>
        <p className="text-sm text-muted-foreground">Summary of each day – clickable to see trades (placeholder grid).</p>
        <div className="grid grid-cols-7 gap-2 mt-4">
          {Array.from({ length: 28 }).map((_, i) => (
            <div key={i} className="border rounded-xl h-20 flex items-center justify-center text-xs hover:bg-muted cursor-pointer">{i + 1}</div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  const Stocks = () => (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Watchlist</h2>
            <div className="flex gap-2">
              <Input placeholder="Add symbol (e.g. NVDA)" className="w-40" />
              <Button>Add</Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr className="border-b">
                  <th className="py-2 pr-2">Symbol</th>
                  <th className="py-2 pr-2">Last</th>
                  <th className="py-2 pr-2">Volume</th>
                  <th className="py-2 pr-2">Rel Vol</th>
                  <th className="py-2 pr-2">Change%</th>
                  <th className="py-2 pr-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_TICKERS.map((t) => (
                  <tr key={t.symbol} className="border-b last:border-none">
                    <td className="py-2 pr-2 font-medium">{t.symbol}</td>
                    <td className="py-2 pr-2">{t.last.toFixed(2)}</td>
                    <td className="py-2 pr-2">{t.volume.toLocaleString()}</td>
                    <td className="py-2 pr-2">{t.relVol?.toFixed(2)}</td>
                    <td className={`py-2 pr-2 ${t.changePct && t.changePct >= 0 ? "text-emerald-600" : "text-red-600"}`}>{t.changePct?.toFixed(2)}%</td>
                    <td className="py-2 pr-2 space-x-2">
                      <Button size="sm" variant="outline">Chart</Button>
                      <Button size="sm" variant="outline">Track</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Later replace with <code>/api/market/movers</code>.</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <h2 className="font-bold mb-2">Realtime Chart (placeholder)</h2>
          <div className="h-64 w-full border rounded-xl flex items-center justify-center text-sm text-muted-foreground">
            Embed chart library (Recharts) and drive via WebSocket <code>/ws/prices</code>.
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const RiskSettings = () => (
    <Card>
      <CardContent className="p-4 space-y-4">
        <h2 className="font-bold">Risk Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Max risk per trade (%)</div>
            <Input
              type="number"
              step="0.1"
              value={risk.maxRiskPerTradePct}
              onChange={(e) => setRisk({ ...risk, maxRiskPerTradePct: Number(e.target.value) })}
            />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Max daily loss (%)</div>
            <Input
              type="number"
              step="0.1"
              value={risk.maxDailyLossPct}
              onChange={(e) => setRisk({ ...risk, maxDailyLossPct: Number(e.target.value) })}
            />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Max trades per day</div>
            <Input
              type="number"
              value={risk.maxTradesPerDay}
              onChange={(e) => setRisk({ ...risk, maxTradesPerDay: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="text-sm text-muted-foreground">Will POST to <code>/api/risk-policy</code>.</div>
      </CardContent>
    </Card>
  );

  /* ---------- Page router ---------- */
  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 space-y-4">
                <RiskSummary />
                <AccountSummary />
                <SessionStats />
              </div>
              <div className="space-y-4">
                <OpenTrades />
              </div>
            </div>
            <Calendar />
          </div>
        );
      case "stocks":
        return <Stocks />;
      case "risk":
        return <RiskSettings />;
      case "journal":
        return (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-bold">Trading Journal</h2>
              <JournalTab />
            </CardContent>
          </Card>
        );
    }
  };

  /* ---------- Gated render ---------- */
  if (!authed) return <Unauthed />;

  return (
    <div className="p-6 space-y-6">
      <nav className="flex items-center justify-between border-b pb-3">
        <div className="flex flex-wrap gap-2">
          {[
            { key: "dashboard", label: "Dashboard" },
            { key: "stocks", label: "Stocks" },
            { key: "risk", label: "Risk" },
            { key: "journal", label: "Journal" },
          ].map((tab) => (
            <Button
              key={tab.key}
              variant={page === (tab.key as any) ? "default" : "outline"}
              onClick={() => setPage(tab.key as any)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span>Dark mode</span>
            <Switch checked={dark} onCheckedChange={setDark} />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              apiLogout();
              setAuthed(false);
            }}
          >
            Logout
          </Button>
        </div>
      </nav>
      {renderPage()}
      {showNew && (
        <NewTradeDialog
          onClose={() => setShowNew(false)}
          onCreated={(t) => {
            // Immediately reflect real server state (normalizes strategy tags)
            (async () => {
              try {
                const fresh = await apiFetchOpenTrades();
                setOpenTrades(Array.isArray(fresh) ? (fresh as Trade[]) : []);
              } catch {
                // Fallback: if fetch fails, at least drop obvious mock ids and prepend
                setOpenTrades(prev => {
                  const nonMocks = prev.filter(x => !(typeof x.id === "string" && /^t\\d+$/.test(String(x.id))));
                  return [t, ...nonMocks];
                });
              }
            })();
          }}
        />
      )}
      {closing && (
        <CloseTradeDialog
          trade={closing}
          onClose={() => setClosing(null)}
          onClosed={(id) => setOpenTrades(prev => prev.filter(t => t.id !== id))}
        />
      )}
      {editOpen && editing && (
        <TradeEditor
          mode="edit"
          initial={{
            id: editing.id,
            ticker: editing.ticker,
            side: editing.side,
            entryPrice: editing.entryPrice,
            stopLoss: editing.stopLoss ?? null,
            target: editing.target ?? null,
            size: editing.size,
            notes: editing.notes ?? "",
            strategyTags: editing.strategyTags ?? [],
          }}
          onSubmit={onSaveEdit}
          onClose={() => { setEditOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
