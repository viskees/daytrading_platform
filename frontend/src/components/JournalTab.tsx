import { useEffect, useMemo, useState } from "react";
import { fetchClosedTrades } from "../lib/api";

type ClosedTrade = ReturnType<typeof useNormalized>[number];
function useNormalized(list: any[]) { return list as any[]; } // just for TS hinting

export default function JournalTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [page, setPage]       = useState(1);
  const [rows, setRows]       = useState<any[]>([]);
  const [next, setNext]       = useState<string | null>(null);
  const [prev, setPrev]       = useState<string | null>(null);
  const [count, setCount]     = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true); setError(null);
        const { results, next, prev, count } = await fetchClosedTrades({ page });
        if (!alive) return;
        setRows(results); setNext(next); setPrev(prev); setCount(count);
      } catch (e:any) {
        setError(e?.message ?? "Failed to load");
      } finally { setLoading(false); }
    })();
    return () => { alive = false; };
  }, [page]);

  const grouped = useMemo(() => {
    const byDay = new Map<string, any[]>();
    for (const t of rows) {
      const d = (t.entryTime ?? "").slice(0,10) || "Unknown date";
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(t);
    }
    return Array.from(byDay.entries()).sort((a,b)=> (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  if (loading) return <div className="p-4 text-sm opacity-80">Loading closed trades…</div>;
  if (error)   return <div className="p-4 text-sm text-red-400">Error: {error}</div>;
  if (!rows.length) return <div className="p-4 text-sm opacity-60">No closed trades yet.</div>;

  return (
    <div className="p-4 space-y-6">
      {grouped.map(([date, items]) => (
        <div key={date} className="rounded-2xl border border-white/10 p-4">
          <div className="text-sm mb-2 opacity-80">{date}</div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left opacity-70">
                <tr>
                  <th className="pr-3 py-2">Ticker</th>
                  <th className="pr-3 py-2">Side</th>
                  <th className="pr-3 py-2">Entry</th>
                  <th className="pr-3 py-2">Exit</th>
                  <th className="pr-3 py-2">Size</th>
                  <th className="pr-3 py-2">R</th>
                  <th className="pr-3 py-2">Tags</th>
                  <th className="pr-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} className="border-t border-white/5">
                    <td className="pr-3 py-2">{t.ticker}</td>
                    <td className="pr-3 py-2">{t.side}</td>
                    <td className="pr-3 py-2">{t.entryPrice ?? "-"}</td>
                    <td className="pr-3 py-2">{t.exitPrice ?? "-"}</td>
                    <td className="pr-3 py-2">{t.size ?? "-"}</td>
                    <td className="pr-3 py-2">{t.riskR ?? t.r_multiple ?? "-"}</td>
                    <td className="pr-3 py-2">
                      {(t.strategyTags ?? []).map((tag: string) => (
                        <span key={tag} className="inline-block mr-2 px-2 py-0.5 rounded-full bg-white/10">{tag}</span>
                      ))}
                    </td>
                    <td className="pr-3 py-2 truncate max-w-[24rem]" title={t.notes || ""}>
                      {t.notes || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button disabled={!prev} onClick={()=>setPage(p=>Math.max(1,p-1))}
                className="px-3 py-1 rounded bg-white/10 disabled:opacity-40">Prev</button>
        <button disabled={!next} onClick={()=>setPage(p=>p+1)}
                className="px-3 py-1 rounded bg-white/10 disabled:opacity-40">Next</button>
        <div className="text-xs opacity-60">Total: {count}</div>
      </div>
    </div>
  );
}
