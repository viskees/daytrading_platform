import { useState } from "react";

type Props = {
  mode: "create" | "edit";
  initial?: {
    id?: number | string;
    ticker?: string;
    side?: "LONG" | "SHORT";
    entryPrice?: number;
    stopLoss?: number | null;
    target?: number | null;
    size?: number;
    notes?: string;
    strategyTags?: string[];
  };
  onSubmit(values: Required<Props>["initial"]): Promise<void>;
  onClose(): void;
};

// keep in sync with App.tsx STRATEGY_TAGS
const STRATEGY_TAGS = ["Breakout", "Pullback", "Reversal", "VWAP", "Trend", "Range", "News"];


export default function TradeEditor({ mode, initial = {}, onSubmit, onClose }: Props) {
  const [form, setForm] = useState({
    ticker: initial.ticker ?? "",
    side: initial.side ?? "LONG",
    entryPrice: initial.entryPrice ?? 0,
    stopLoss: initial.stopLoss ?? null as number | null,
    target: initial.target ?? null as number | null,
    size: initial.size ?? 1,
    notes: initial.notes ?? "",
    strategyTags: initial.strategyTags ?? [],
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  const update = (k: keyof typeof form) => (e: any) =>
    setForm(f => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const toggleTag = (tag: string) =>
    setForm(f => {
      const cur = new Set(f.strategyTags ?? []);
      if (cur.has(tag)) cur.delete(tag); else cur.add(tag);
      return { ...f, strategyTags: Array.from(cur) };
    });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-[640px] max-w-[96vw] rounded-2xl bg-neutral-900 border border-white/10 p-4">
        <div className="text-lg font-semibold mb-2">
          {mode === "edit" ? "Edit trade" : "New trade"}
        </div>
        {err && <div className="mb-2 text-red-400 text-sm">{err}</div>}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm opacity-80">
            Ticker
            <input className="w-full mt-1 bg-black/30 rounded px-2 py-1"
                   value={form.ticker} onChange={update("ticker")} />
          </label>
          <label className="text-sm opacity-80">
            Side
            <select className="w-full mt-1 bg-black/30 rounded px-2 py-1"
                    value={form.side} onChange={update("side")}>
              <option value="LONG">LONG</option>
              <option value="SHORT">SHORT</option>
            </select>
          </label>
          <label className="text-sm opacity-80">
            Entry
            <input type="number" step="0.01" className="w-full mt-1 bg-black/30 rounded px-2 py-1"
                   value={form.entryPrice} onChange={e=>update("entryPrice")(Number(e.target.value))} />
          </label>
          <label className="text-sm opacity-80">
            Size
            <input type="number" step="1" className="w-full mt-1 bg-black/30 rounded px-2 py-1"
                   value={form.size} onChange={e=>update("size")(Number(e.target.value))} />
          </label>
          <label className="text-sm opacity-80">
            Stop
            <input type="number" step="0.01" className="w-full mt-1 bg-black/30 rounded px-2 py-1"
                   value={form.stopLoss ?? ""} placeholder="—"
                   onChange={e=>update("stopLoss")(e.target.value===""?null:Number(e.target.value))} />
          </label>
          <label className="text-sm opacity-80">
            Target
            <input type="number" step="0.01" className="w-full mt-1 bg-black/30 rounded px-2 py-1"
                   value={form.target ?? ""} placeholder="—"
                   onChange={e=>update("target")(e.target.value===""?null:Number(e.target.value))} />
          </label>
          <label className="col-span-2 text-sm opacity-80">
            Strategy
            <div className="mt-1 flex flex-wrap gap-2">
              {STRATEGY_TAGS.map(tag => {
                const on = (form.strategyTags ?? []).includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleTag(tag)}
                    className={`px-2 py-1 rounded border text-sm ${on ? "bg-white/20" : "bg-black/30"}`}>
                    {on ? `− ${tag}` : `+ ${tag}`}
                  </button>
                );
              })}
            </div>
          </label>
          <label className="col-span-2 text-sm opacity-80">
            Notes
            <textarea className="w-full mt-1 bg-black/30 rounded px-2 py-1"
                      rows={3} value={form.notes} onChange={update("notes")} />
          </label>
        </div>

        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1 rounded bg-white/10">Cancel</button>
          <button
            disabled={busy}
            onClick={async ()=>{
              try {
                setBusy(true); setErr(null);
                await onSubmit(form as any);
                onClose();
              } catch (e:any) {
                setErr(e?.message ?? "Failed");
              } finally { setBusy(false); }
            }}
            className="px-3 py-1 rounded bg-white/20 disabled:opacity-50">
            {mode === "edit" ? "Save changes" : "Create trade"}
          </button>
        </div>
      </div>
    </div>
  );
}
