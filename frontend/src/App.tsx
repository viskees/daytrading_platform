import React, { useEffect, useMemo, useRef, useState, createContext, useContext } from "react";
import { Upload, Plus, Trash2, TrendingUp, ShieldCheck, CalendarIcon, Settings, PlugZap, Save, Bug, Sun, Moon, Activity, NotebookPen } from "lucide-react";

// ---- Minimal UI primitives (tailwind-based) ----
export function Card({children, className=""}:{children: React.ReactNode; className?: string}) {
  return <div className={`card ${className}`}>{children}</div>;
}
export function CardHeader({children, className=""}:{children: React.ReactNode; className?: string}) {
  return <div className={`card-header ${className}`}>{children}</div>;
}
export function CardTitle({children, className=""}:{children: React.ReactNode; className?: string}) {
  return <div className={`card-title ${className}`}>{children}</div>;
}
export function CardContent({children, className=""}:{children: React.ReactNode; className?: string}) {
  return <div className={`card-content ${className}`}>{children}</div>;
}

export function Button({children, className="", variant="default", size="md", ...props}:{children: React.ReactNode; className?: string; variant?: "default"|"ghost"; size?: "sm"|"md"|"icon"} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = `btn ${variant==="ghost"?"btn-ghost":""} ${size==="icon"?"p-2":""} ${className}`;
  return <button className={classes} {...props}>{children}</button>;
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className||""}`} />;
}
export function Label({children, htmlFor, className=""}:{children: React.ReactNode; htmlFor?: string; className?: string}) {
  return <label htmlFor={htmlFor} className={`label ${className}`}>{children}</label>;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`textarea ${props.className||""}`} />;
}
export function Switch({checked, onCheckedChange}:{checked?: boolean; onCheckedChange?: (v:boolean)=>void}) {
  return <label className="inline-flex items-center gap-2 cursor-pointer">
    <input type="checkbox" className="sr-only" checked={!!checked} onChange={e=>onCheckedChange?.(e.target.checked)} />
    <span className={`w-10 h-6 rounded-full transition-colors ${checked? "bg-emerald-500":"bg-zinc-400"}`}></span>
  </label>;
}

// Tabs (not heavily used here, but present for future)
const TabsCtx = createContext<{value:string,setValue:(v:string)=>void}|null>(null);
export function Tabs({value:initial, defaultValue, onValueChange, children}:{value?:string; defaultValue?:string; onValueChange?:(v:string)=>void; children:React.ReactNode}) {
  const [value,setValue] = useState(initial ?? defaultValue ?? "");
  useEffect(()=>{ if(initial!==undefined) setValue(initial); },[initial]);
  const api={value, setValue:(v:string)=>{ setValue(v); onValueChange?.(v);} };
  return <TabsCtx.Provider value={api}>{children}</TabsCtx.Provider>;
}
export function TabsList({children,className=""}:{children:React.ReactNode; className?:string}) {
  return <div className={`tabs-list ${className}`}>{children}</div>;
}
export function TabsTrigger({value,children}:{value:string; children:React.ReactNode}) {
  const ctx = useContext(TabsCtx)!;
  const active = ctx.value===value;
  return <button className={`tab-trigger ${active?"tab-trigger-active":""}`} onClick={()=>ctx.setValue(value)}>{children}</button>;
}
export function TabsContent({value, children}:{value:string; children:React.ReactNode}) {
  const ctx = useContext(TabsCtx)!;
  if (ctx.value!==value) return null;
  return <div className="mt-4">{children}</div>;
}

// ---- Helpers from mockup ----
const THEME_KEY = "dtp.theme" as const;
type Theme = "light" | "dark";
function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return "dark";
}
function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.setAttribute("data-theme", theme);
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  return { theme, toggle: ()=> setTheme(p => p==="dark"?"light":"dark") };
}

const formatCurrency = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
const todayISO = () => new Date().toISOString().slice(0,10);

// --- Types (subset) ---
interface WatchedTicker { symbol: string; notes?: string; }
interface JournalEntry { id: string; date: string; symbol: string; direction: "LONG"|"SHORT"; size: number; entryPrice: number; exitPrice?: number|null; open: boolean; tags: string[]; images: string[]; notes?: string; }

// position sizing
function positionSize(dollarsRisk:number, entry:number, stop:number) {
  const r = Math.abs(entry - stop);
  if (!isFinite(r) || r <= 0) return 0;
  return Math.floor(dollarsRisk / r);
}

// daily summary
function computeDailySummary(entries: JournalEntry[]) {
  const out: Record<string, { realized:number; trades:number }> = {};
  for (const j of entries) {
    const d = out[j.date] ?? (out[j.date] = { realized: 0, trades: 0 });
    d.trades += 1;
    if (!j.open && typeof j.exitPrice === "number") {
      const dir = j.direction === "LONG" ? 1 : -1;
      d.realized += (j.exitPrice - j.entryPrice) * dir * j.size;
    }
  }
  return out;
}
function shouldLockout(realizedLoss:number, maxDailyLoss:number, enabled:boolean) {
  if (!enabled) return false;
  return realizedLoss <= -Math.abs(maxDailyLoss);
}

// Fake price feed (random walk)
function usePrices(symbols: string[]) {
  const [prices, setPrices] = useState<Record<string, number>>(() => Object.fromEntries(symbols.map(s => [s, 10 + Math.random()*90])));
  const timer = useRef<number | null>(null);
  useEffect(()=>{
    // add any new symbols with a seed
    setPrices(p => ({...p, ...Object.fromEntries(symbols.filter(s => !(s in p)).map(s => [s, 10 + Math.random()*90]))}));
  }, [symbols]);
  useEffect(()=>{
    timer.current = window.setInterval(()=>{
      setPrices(p => {
        const next = { ...p };
        for (const k of Object.keys(next)) {
          const drift = (Math.random() - 0.5) * 0.5;
          next[k] = Math.max(0.01, +(next[k] + drift).toFixed(2));
        }
        return next;
      });
    }, 1500);
    return ()=> { if (timer.current) window.clearInterval(timer.current); };
  }, []);
  return prices;
}

function ThemeToggleButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <Button aria-label="Toggle theme" onClick={onToggle} className="rounded-2xl">
      {theme === "dark" ? <Sun className="w-5 h-5"/> : <Moon className="w-5 h-5"/>}
    </Button>
  );
}

function PositionSizer({ dollarsRisk }:{ dollarsRisk: number }) {
  const [entry, setEntry] = useState<number>(10);
  const [stop, setStop] = useState<number>(9.8);
  const size = positionSize(dollarsRisk, entry, stop);
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="w-4 h-4"/>Position Sizer</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 items-end">
          <div><Label>Entry</Label><Input type="number" step="0.01" value={entry} onChange={e=>setEntry(+e.target.value)} /></div>
          <div><Label>Stop</Label><Input type="number" step="0.01" value={stop} onChange={e=>setStop(+e.target.value)} /></div>
          <div className="text-sm"><div className="label mb-1">Size</div><div className="text-2xl font-semibold">{size}</div></div>
        </div>
        <div className="mt-2 text-xs text-zinc-500">Risk per trade: {formatCurrency(dollarsRisk)}</div>
      </CardContent>
    </Card>
  );
}

function MonthlyCalendar({ summary }:{ summary: Record<string,{realized:number; trades:number}> }) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const first = new Date(y, m, 1);
  const startDay = first.getDay(); // 0 Sun
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const cells = [];
  for (let i=0;i<startDay;i++) cells.push(null);
  for (let d=1; d<=daysInMonth; d++) cells.push(new Date(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><CalendarIcon className="w-4 h-4"/>Calendar</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 text-xs">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><div key={d} className="text-center font-medium py-1">{d}</div>)}
          {cells.map((dt, i) => {
            if (!dt) return <div key={i} className="h-16 rounded-xl bg-zinc-100 dark:bg-zinc-900/50"/>;
            const iso = dt.toISOString().slice(0,10);
            const s = summary[iso];
            const pnl = s?.realized ?? 0;
            return (
              <div key={i} className={`h-20 rounded-xl p-2 border ${pnl>=0?'border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/10':'border-rose-500/30 bg-rose-50 dark:bg-rose-950/10'}`}>
                <div className="text-xs font-medium">{dt.getDate()}</div>
                <div className="text-[11px] mt-1">{formatCurrency(pnl)}</div>
                <div className="text-[10px] text-zinc-500">{s?.trades ?? 0} trades</div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function NewTradeForm({ onAdd }:{ onAdd:(j:JournalEntry)=>void }) {
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<"LONG"|"SHORT">("LONG");
  const [entry, setEntry] = useState(10);
  const [size, setSize] = useState(100);
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><NotebookPen className="w-4 h-4"/>New Trade</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-3">
          <div><Label>Ticker</Label><Input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} placeholder="AAPL"/></div>
          <div><Label>Side</Label>
            <select className="select" value={direction} onChange={e=>setDirection(e.target.value as any)}>
              <option value="LONG">LONG</option>
              <option value="SHORT">SHORT</option>
            </select>
          </div>
          <div><Label>Entry</Label><Input type="number" step="0.01" value={entry} onChange={e=>setEntry(+e.target.value)}/></div>
          <div><Label>Qty</Label><Input type="number" value={size} onChange={e=>setSize(+e.target.value)}/></div>
        </div>
        <div className="mt-3">
          <Button onClick={()=>{
            if(!symbol) return;
            const j: JournalEntry = { id: Math.random().toString(36).slice(2), date: todayISO(), symbol, direction, entryPrice: entry, size, open: true, tags: [], images: [] };
            onAdd(j);
            setSymbol(""); setSize(100);
          }}><Plus className="w-4 h-4"/>Add Trade</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DevTests() {
  const sizeA = positionSize(500, 10, 9); // 1 risk -> 500 shares
  const sizeB = positionSize(400, 20, 19.5); // .5 risk -> 800
  const sample: JournalEntry[] = [
    { id:"1", date:"2025-01-01", symbol:"AAA", direction:"LONG", size:100, entryPrice:10, exitPrice:11, open:false, tags:[], images:[] },
    { id:"2", date:"2025-01-01", symbol:"BBB", direction:"SHORT", size:50, entryPrice:20, exitPrice:22, open:false, tags:[], images:[] },
  ];
  const sum = computeDailySummary(sample);
  const allPass = sizeA===500 && sizeB===800 && sum["2025-01-01"]?.realized===0;
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Bug className="w-4 h-4"/>Dev Tests</CardTitle></CardHeader>
      <CardContent>
        <div className="text-sm">positionSize A=500, B=800; Jan1 realized=0</div>
        <div className={`mt-2 text-sm font-semibold ${allPass?'text-emerald-600':'text-rose-600'}`}>{allPass? 'ALL PASS' : 'HAS FAILURES'}</div>
      </CardContent>
    </Card>
  );
}

export default function App() {
  const { theme, toggle } = useTheme();

  const [newSymbol, setNewSymbol] = useState("");
  const [tickers, setTickers] = useState<WatchedTicker[]>(() => {
    try { return JSON.parse(localStorage.getItem("dtp.tickers") || "[]"); } catch { return []; }
  });
  useEffect(()=> localStorage.setItem("dtp.tickers", JSON.stringify(tickers)), [tickers]);
  const quotes = usePrices(tickers.map(t => t.symbol));

  const [journal, setJournal] = useState<JournalEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem("dtp.journal") || "[]"); } catch { return []; }
  });
  useEffect(()=> localStorage.setItem("dtp.journal", JSON.stringify(journal)), [journal]);

  const dailySummary = useMemo(()=> computeDailySummary(journal), [journal]);

  // Risk
  const [risk, setRisk] = useState(()=> {
    try { return JSON.parse(localStorage.getItem("dtp.risk") || "null") ?? { accountEquity: 25000, dayStartEquity: 25000, maxRiskPerTradePct: 1, maxDailyLossPct: 4, maxTradesPerDay: 6, lockoutEnabled: true }; } catch { return { accountEquity: 25000, dayStartEquity: 25000, maxRiskPerTradePct: 1, maxDailyLossPct: 4, maxTradesPerDay: 6, lockoutEnabled: true } }
  });
  useEffect(()=> localStorage.setItem("dtp.risk", JSON.stringify(risk)), [risk]);

  const dollarsPerTrade = useMemo(()=> risk.accountEquity * (risk.maxRiskPerTradePct/100), [risk]);
  const maxDailyLoss = useMemo(()=> risk.dayStartEquity * (risk.maxDailyLossPct/100), [risk]);

  const todays = useMemo(()=> journal.filter(j => j.date===todayISO()), [journal]);
  const todaysRealized = useMemo(()=> todays.filter(j=>!j.open && typeof j.exitPrice==="number").reduce((s,j)=> s + (j.exitPrice! - j.entryPrice)*(j.direction==="LONG"?1:-1)*j.size, 0), [todays]);
  const lockout = shouldLockout(todaysRealized, maxDailyLoss, risk.lockoutEnabled);

  return (
    <div className="container py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl flex items-center justify-center bg-zinc-200 dark:bg-zinc-800"><Activity className="w-5 h-5"/></div>
          <div>
            <div className="font-semibold">Day Trading Platform</div>
            <div className="text-xs text-zinc-500">Single-file mockup aligned UI</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button className="hidden sm:inline-flex"><Save className="w-4 h-4"/>Save</Button>
          <Button className="hidden sm:inline-flex"><PlugZap className="w-4 h-4"/>Connect</Button>
          <ThemeToggleButton theme={theme} onToggle={toggle}/>
        </div>
      </div>

      {/* Top grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Watchlist */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="w-4 h-4"/>Watchlist</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input placeholder="Add ticker (AAPL)" value={newSymbol} onChange={e=>setNewSymbol(e.target.value.toUpperCase())}/>
              <Button onClick={()=>{ if(!newSymbol) return; setTickers(t=>[...t, {symbol:newSymbol}]); setNewSymbol(""); }}><Plus className="w-4 h-4"/>Add</Button>
            </div>
            <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {tickers.map((t, idx)=>(
                <div key={idx} className="rounded-xl border p-3 flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{t.symbol}</div>
                    <div className="text-xs text-zinc-500">{formatCurrency(quotes[t.symbol] ?? 0)}</div>
                  </div>
                  <Button variant="ghost" onClick={()=> setTickers(arr => arr.filter((_,i)=>i!==idx))}><Trash2 className="w-4 h-4"/></Button>
                </div>
              ))}
              {tickers.length===0 && <div className="text-sm text-zinc-500">Add symbols to track live quotes.</div>}
            </div>
          </CardContent>
        </Card>

        {/* Risk Panel */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="w-4 h-4"/>Risk</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Equity</Label><Input type="number" value={risk.accountEquity} onChange={e=>setRisk({...risk, accountEquity:+e.target.value})}/></div>
              <div><Label>Start of Day</Label><Input type="number" value={risk.dayStartEquity} onChange={e=>setRisk({...risk, dayStartEquity:+e.target.value})}/></div>
              <div><Label>Risk/Trade %</Label><Input type="number" value={risk.maxRiskPerTradePct} onChange={e=>setRisk({...risk, maxRiskPerTradePct:+e.target.value})}/></div>
              <div><Label>Max Daily Loss %</Label><Input type="number" value={risk.maxDailyLossPct} onChange={e=>setRisk({...risk, maxDailyLossPct:+e.target.value})}/></div>
              <div><Label>Max Trades/Day</Label><Input type="number" value={risk.maxTradesPerDay} onChange={e=>setRisk({...risk, maxTradesPerDay:+e.target.value})}/></div>
              <div className="flex items-center gap-2 mt-6"><Switch checked={risk.lockoutEnabled} onCheckedChange={v=>setRisk({...risk, lockoutEnabled:v})}/> <span className="text-sm">Lockout</span></div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div><div className="label">Risk/Trade</div><div className="text-lg font-semibold">{formatCurrency(dollarsPerTrade)}</div></div>
              <div><div className="label">Max Daily Loss</div><div className="text-lg font-semibold">{formatCurrency(maxDailyLoss)}</div></div>
              <div><div className={`label ${lockout?'text-rose-600':''}`}>Today Realized</div><div className={`text-lg font-semibold ${lockout?'text-rose-600':''}`}>{formatCurrency(todaysRealized)}</div></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Middle grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <NewTradeForm onAdd={(j)=> setJournal(arr => [j, ...arr])}/>
          <div className="mt-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><NotebookPen className="w-4 h-4"/>Journal</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {journal.filter(j=>j.date===todayISO()).map(j=>(
                    <div key={j.id} className="rounded-xl border p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">{j.symbol} · {j.direction} · {j.size} @ {j.entryPrice}</div>
                        <Button variant="ghost" size="icon" onClick={()=> setJournal(arr => arr.filter(x=>x.id!==j.id))}><Trash2 className="w-4 h-4"/></Button>
                      </div>
                      <div className="text-xs text-zinc-500 mt-1">Status: {j.open? "OPEN":"CLOSED"}</div>
                    </div>
                  ))}
                  {journal.filter(j=>j.date===todayISO()).length===0 && <div className="text-sm text-zinc-500">No entries yet. Use “New Trade”.</div>}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        <div>
          <PositionSizer dollarsRisk={dollarsPerTrade}/>
          <div className="mt-4"><MonthlyCalendar summary={dailySummary}/></div>
          <div className="mt-4"><DevTests/></div>
        </div>
      </div>
    </div>
  );
}
