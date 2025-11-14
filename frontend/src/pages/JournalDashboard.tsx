import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import TradesCalendar from "@/components/Calendar";
import {
  fetchClosedTrades,
  listAttachments,
  type NormalizedTrade as Trade,
} from "@/lib/api";

/* ─────────────────────────────────────────
   Small helpers
   ───────────────────────────────────────── */
function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function minusDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() - n);
  return x;
}
function hhmm(iso?: string | null) {
  if (!iso) return "—";
  try {
    const dt = new Date(iso);
    const h = String(dt.getHours()).padStart(2, "0");
    const m = String(dt.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  } catch {
    return "—";
  }
}
function pnlClass(v?: number) {
  if (v == null) return "text-zinc-500";
  return v > 0 ? "text-emerald-600" : v < 0 ? "text-rose-600" : "text-zinc-600";
}

/* ─────────────────────────────────────────
   Data fetchers (use normalized api.ts)
   ───────────────────────────────────────── */
async function fetchDayTrades(dateISO: string): Promise<Trade[]> {
  const r = await fetchClosedTrades({ from: dateISO, to: dateISO });
  return (r?.results ?? []) as Trade[];
}
async function fetchRecentTrades(days = 30): Promise<Trade[]> {
  const to = ymd(new Date());
  const from = ymd(minusDays(new Date(), days));
  const r = await fetchClosedTrades({ from, to });
  return (r?.results ?? []) as Trade[];
}

type Attachment = {
  id: number;
  trade: number;
  image: string;   // absolute or MEDIA_URL-relative
  caption?: string;
  created_at?: string;
};

/* ─────────────────────────────────────────
   Nice, readable overlays
   ───────────────────────────────────────── */
function Modal({
  open, title, onOpenChange, children, maxWidth = "max-w-4xl",
}: { open: boolean; title?: string; onOpenChange: (v: boolean) => void; children: React.ReactNode; maxWidth?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => onOpenChange(false)}>
      <div
        className={`w-full ${maxWidth} rounded-2xl border shadow-2xl bg-white/95 dark:bg-zinc-900/95`}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? (
          <div className="flex items-center justify-between px-5 py-3 border-b">
            <div className="text-sm font-semibold">{title}</div>
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : null}
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function SlideOver({
  open, onOpenChange, title, children, side = "right", width = "w-[560px] sm:w-[640px]",
}: { open: boolean; onOpenChange: (v: boolean) => void; title?: string; children: React.ReactNode; side?: "right" | "left"; width?: string }) {
  if (!open) return null;
  const sideClass = side === "right" ? "right-0" : "left-0";
  return (
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div className={`absolute top-0 ${sideClass} h-full ${width} border-l shadow-2xl bg-white/95 dark:bg-zinc-900/95 flex flex-col`} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="text-sm font-semibold">{title}</div>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Lightbox({
  srcList, start, onClose,
}: { srcList: { src: string; alt?: string }[]; start: number; onClose: () => void }) {
  const [idx, setIdx] = useState(start);
  const img = srcList[idx];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % srcList.length);
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + srcList.length) % srcList.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, srcList.length]);

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
      <div className="max-w-5xl w-[92%] aspect-video relative" onClick={(e) => e.stopPropagation()}>
        <img src={img?.src} alt={img?.alt || ""} className="w-full h-full object-contain rounded-lg shadow-2xl" />
        {srcList.length > 1 && (
          <>
            <button className="absolute left-2 top-1/2 -translate-y-1/2 px-3 py-2 rounded bg-white/10 hover:bg-white/20 text-white" onClick={() => setIdx((i) => (i - 1 + srcList.length) % srcList.length)}>‹</button>
            <button className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-2 rounded bg-white/10 hover:bg-white/20 text-white" onClick={() => setIdx((i) => (i + 1) % srcList.length)}>›</button>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-white/80">{idx + 1} / {srcList.length}</div>
          </>
        )}
        <a
          href={img?.src}
          target="_blank"
          rel="noreferrer"
          className="absolute top-2 left-2 px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 text-white"
          title="Open original"
          onClick={(e) => e.stopPropagation()}
        >
          Open original
        </a>
        <button className="absolute top-2 right-2 px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 text-white" onClick={onClose}>
          Close (Esc)
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   Day modal
   ───────────────────────────────────────── */
function DayTradesModal({
  dateISO, open, onOpenChange, onTradeClick,
}: { dateISO: string | null; open: boolean; onOpenChange: (v: boolean) => void; onTradeClick: (t: Trade) => void }) {
  const [loading, setLoading] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);

  const refresh = useCallback(async () => {
    if (!dateISO) return;
    setLoading(true);
    try { setTrades(await fetchDayTrades(dateISO)); }
    finally { setLoading(false); }
  }, [dateISO]);

  useEffect(() => { if (open && dateISO) void refresh(); }, [open, dateISO, refresh]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Trades · ${dateISO ?? ""}`}>
      <div className="min-h-[180px]">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : trades.length === 0 ? (
          <div className="text-sm text-muted-foreground">No trades for this day.</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {trades.map((t) => (
              <Card key={t.id} className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition" onClick={() => onTradeClick(t)}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">
                      {t.ticker} <Badge variant="outline">{t.side}</Badge>
                    </div>
                    <div className={`text-sm font-semibold ${pnlClass(t.realizedPnl)}`}>
                      {(t.realizedPnl ?? 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {hhmm(t.entryTime)}–{hhmm(t.exitTime)} · R: {t.rMultiple == null ? "—" : Number(t.rMultiple).toFixed(2)}
                  </div>
                  {t.strategyTags?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {t.strategyTags.slice(0, 3).map((tag, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{tag}</Badge>
                      ))}
                      {t.strategyTags.length > 3 && <Badge variant="secondary" className="text-[10px]">+{t.strategyTags.length - 3}</Badge>}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ─────────────────────────────────────────
   Trade detail sheet with emotions + screenshots
   ───────────────────────────────────────── */
function labelFromCaption(c?: string): "ENTRY" | "EXIT" | "SNAPSHOT" {
  const s = (c || "").toLowerCase();
  if (/(entry|open|setup)/.test(s)) return "ENTRY";
  if (/(exit|close|target|stop)/.test(s)) return "EXIT";
  return "SNAPSHOT";
}

function TradeDetailSheet({
  trade, open, onOpenChange,
}: { trade: Trade | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [lightbox, setLightbox] = useState<{ idx: number } | null>(null);

  useEffect(() => {
    if (!open || !trade) return;
    (async () => {
      const att = await listAttachments(trade.id);
      setAttachments(Array.isArray(att) ? att : []);
    })();
  }, [open, trade]);

  const sorted = useMemo(() => {
    const rank = (a: Attachment) => {
      const t = labelFromCaption(a.caption);
      if (t === "ENTRY") return 0;
      if (t === "EXIT") return 1;
      return 2;
    };
    return [...attachments].sort((a, b) => rank(a) - rank(b));
  }, [attachments]);

  const imgs = useMemo(() => sorted.map((a) => ({ src: a.image, alt: a.caption })), [sorted]);

  return (
    <>
      <SlideOver open={open} onOpenChange={onOpenChange} title={`${trade?.ticker} · ${trade?.side}`}>
        <div className="grid gap-4">
          {/* Core stats */}
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Entry" value={trade?.entryPrice ?? "—"} />
            <Stat label="Exit" value={trade?.exitPrice ?? "—"} />
            <Stat label="Size" value={trade?.size ?? "—"} />
            <Stat label="P/L" value={<span className={pnlClass(trade?.realizedPnl)}>{(trade?.realizedPnl ?? 0).toFixed(2)}</span>} />
            <Stat label="R Multiple" value={trade?.rMultiple == null ? "—" : Number(trade?.rMultiple).toFixed(2)} />
            <Stat label="Time" value={`${hhmm(trade?.entryTime)}–${hhmm(trade?.exitTime)}`} />
          </div>

          {/* Emotions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Stat
              label="Entry emotion"
              value={
                trade?.entryEmotion ? (
                  <span>
                    <Badge variant={trade.entryEmotion === "BIASED" ? "destructive" : "secondary"} className="mr-2">
                      {trade.entryEmotion}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{trade.entryEmotionNote || ""}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              }
            />
            <Stat
              label="Exit emotion"
              value={
                trade?.exitEmotion ? (
                  <span>
                    <Badge variant={trade.exitEmotion === "BIASED" ? "destructive" : "secondary"} className="mr-2">
                      {trade.exitEmotion}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{trade.exitEmotionNote || ""}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              }
            />
          </div>

          {/* Tags */}
          {trade?.strategyTags?.length ? (
            <div>
              <div className="text-xs mb-1 text-muted-foreground">Strategy tags</div>
              <div className="flex flex-wrap gap-1">
                {trade.strategyTags.map((tag, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px]">{tag}</Badge>
                ))}
              </div>
            </div>
          ) : null}

          {/* Screenshots */}
          <div>
            <div className="text-xs mb-1 text-muted-foreground">Screenshots</div>
            {sorted.length === 0 ? (
              <div className="text-sm text-muted-foreground">No screenshots attached.</div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {sorted.map((a, i) => (
                  <button
                    key={a.id}
                    className="group relative aspect-video overflow-hidden rounded border hover:ring-2 hover:ring-primary/30"
                    onClick={() => setLightbox({ idx: i })}
                    title={a.caption || ""}
                  >
                    <img src={a.image} alt={a.caption || ""} className="w-full h-full object-cover" />
                    <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-white">
                      {labelFromCaption(a.caption)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          {trade?.notes ? (
            <div>
              <div className="text-xs mb-1 text-muted-foreground">Notes</div>
              <div className="text-sm whitespace-pre-wrap">{trade.notes}</div>
            </div>
          ) : null}
        </div>
      </SlideOver>

      {lightbox && imgs.length > 0 && (
        <Lightbox srcList={imgs} start={lightbox.idx} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}

/* ─────────────────────────────────────────
   Trade list (click → detail)
   ───────────────────────────────────────── */
type SortKey = "time" | "pnl" | "r";
type SideFilter = "ALL" | "LONG" | "SHORT";

function TradeList({ trades, onRowClick }: { trades: Trade[]; onRowClick: (t: Trade) => void }) {
  const [q, setQ] = useState("");
  const [side, setSide] = useState<SideFilter>("ALL");
  const [sort, setSort] = useState<SortKey>("time");
  const [dir, setDir] = useState<1 | -1>(-1);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    let rows = trades.filter((t) => {
      const hitSide = side === "ALL" || t.side === side;
      if (!kw) return hitSide;
      const hay = [t.ticker, t.notes, ...(t.strategyTags ?? [])].filter(Boolean).join(" ").toLowerCase();
      return hitSide && hay.includes(kw);
    });

    rows.sort((a, b) => {
      if (sort === "time") {
        const aa = (a.exitTime ?? a.entryTime ?? "");
        const bb = (b.exitTime ?? b.entryTime ?? "");
        return aa < bb ? -dir : aa > bb ? dir : 0;
      }
      if (sort === "pnl") {
        const aa = Number(a.realizedPnl ?? 0);
        const bb = Number(b.realizedPnl ?? 0);
        return aa < bb ? dir : aa > bb ? -dir : 0;
      }
      const aa = Number(a.rMultiple ?? 0);
      const bb = Number(b.rMultiple ?? 0);
      return aa < bb ? dir : aa > bb ? -dir : 0;
    });

    return rows;
  }, [q, side, sort, dir, trades]);

  const toggleSort = (k: SortKey) => {
    if (sort === k) setDir((d) => (d === 1 ? -1 : 1));
    else { setSort(k); setDir(-1); }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap gap-2 items-center">
          <Input placeholder="Search ticker / tags / notes" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
          <select
            className="rounded-xl border bg-background text-foreground p-2 text-sm"
            value={side}
            onChange={(e) => setSide(e.target.value as SideFilter)}
          >
            <option value="ALL">All sides</option>
            <option value="LONG">LONG only</option>
            <option value="SHORT">SHORT only</option>
          </select>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant={sort === "time" ? "default" : "outline"} onClick={() => toggleSort("time")}>
              Time {sort === "time" ? (dir === -1 ? "↓" : "↑") : ""}
            </Button>
            <Button size="sm" variant={sort === "pnl" ? "default" : "outline"} onClick={() => toggleSort("pnl")}>
              P&L {sort === "pnl" ? (dir === -1 ? "↓" : "↑") : ""}
            </Button>
            <Button size="sm" variant={sort === "r" ? "default" : "outline"} onClick={() => toggleSort("r")}>
              R {sort === "r" ? (dir === -1 ? "↓" : "↑") : ""}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b">
                <th className="py-2 pr-2">Time</th>
                <th className="py-2 pr-2">Ticker</th>
                <th className="py-2 pr-2">Side</th>
                <th className="py-2 pr-2">Entry</th>
                <th className="py-2 pr-2">Exit</th>
                <th className="py-2 pr-2">Size</th>
                <th className="py-2 pr-2">R</th>
                <th className="py-2 pr-2">P&L</th>
                <th className="py-2 pr-2">Strategy</th>
                <th className="py-2 pr-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b last:border-none align-top hover:bg-muted/40 cursor-pointer" onClick={() => onRowClick(t)}>
                  <td className="py-2 pr-2 text-nowrap">{hhmm(t.entryTime)}–{hhmm(t.exitTime)}</td>
                  <td className="py-2 pr-2 font-medium">{t.ticker}</td>
                  <td className="py-2 pr-2"><Badge variant="outline">{t.side}</Badge></td>
                  <td className="py-2 pr-2">{t.entryPrice ?? "—"}</td>
                  <td className="py-2 pr-2">{t.exitPrice ?? "—"}</td>
                  <td className="py-2 pr-2">{t.size ?? "—"}</td>
                  <td className="py-2 pr-2">{t.rMultiple == null ? "—" : Number(t.rMultiple).toFixed(2)}</td>
                  <td className={`py-2 pr-2 font-medium ${pnlClass(t.realizedPnl)}`}>{(t.realizedPnl ?? 0).toFixed(2)}</td>
                  <td className="py-2 pr-2 max-w-[160px]">
                    <div className="flex flex-wrap gap-1">
                      {(t.strategyTags ?? []).slice(0, 3).map((tag, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{tag}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 pr-2 max-w-[260px]">
                    <div className="text-muted-foreground whitespace-pre-wrap line-clamp-2" title={t.notes || ""}>
                      {t.notes || ""}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="py-4 text-sm text-muted-foreground">No trades match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────────────────
   Page
   ───────────────────────────────────────── */
export default function JournalDashboard() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayTrades, setDayTrades] = useState<Trade[] | null>(null);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [activeTrade, setActiveTrade] = useState<Trade | null>(null);

  useEffect(() => {
    (async () => setRecentTrades(await fetchRecentTrades(30)))();
  }, []);

  const onDayClick = useCallback(async (dateISO: string) => {
    setSelectedDate(dateISO);
    setModalOpen(true);
    try {
      const list = await fetchDayTrades(dateISO);
      setDayTrades(list);
    } catch {
      setDayTrades([]);
    }
  }, []);

  const openTradeDetail = useCallback((t: Trade) => {
    setActiveTrade(t);
    setTradeOpen(true);
  }, []);
  const closeTradeDetail = useCallback((v: boolean) => {
    setTradeOpen(v);
    if (!v) setActiveTrade(null);
  }, []);

  const tableRows = selectedDate && dayTrades ? dayTrades : recentTrades;

  return (
    <div className="container max-w-6xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Journal</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onDayClick(ymd(new Date()))}>Today</Button>
          {selectedDate && (
            <Button variant="outline" onClick={() => { setSelectedDate(null); setDayTrades(null); }}>
              Clear day filter
            </Button>
          )}
        </div>
      </div>

      {/* Calendar summary → click to filter and open modal */}
      <TradesCalendar onDayClick={onDayClick} />

      {/* Trade list */}
      <TradeList trades={tableRows} onRowClick={openTradeDetail} />

      {/* Day modal + trade sheet */}
      <DayTradesModal dateISO={selectedDate} open={modalOpen} onOpenChange={(v) => setModalOpen(v)} onTradeClick={openTradeDetail} />
      <TradeDetailSheet trade={activeTrade} open={tradeOpen} onOpenChange={closeTradeDetail} />
    </div>
  );
}

/* tiny stat box used in the sheet */
function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border p-2 bg-white/90 dark:bg-zinc-900/90">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}