import React, { useState } from "react";
import { API } from "../lib/api";

export default function NewTrade() {
  const [ticker, setTicker] = useState("");
  const [side, setSide] = useState<"LONG"|"SHORT">("LONG");
  const [qty, setQty] = useState(100);
  const [entryPrice, setEntryPrice] = useState(1.00);
  const [riskPerShare, setRiskPerShare] = useState(0.10);

  async function submit() {
    // find-or-create JournalDay for today (simple demo path)
    const today = new Date().toISOString().slice(0,10);
    let dayList = await API.get(`/journal/days/?search=${today}`);
    let day = dayList?.results?.[0];
    if (!day) {
      day = await API.post("/journal/days/", { date: today, day_start_equity: 10000 });
    }
    await API.post("/journal/trades/", {
      journal_day: day.id,
      ticker, side,
      quantity: qty,
      entry_price: entryPrice,
      entry_time: new Date().toISOString(),
      risk_per_share: riskPerShare
    });
    setTicker("");
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">New Trade</h1>
      <div className="grid gap-2 mt-3 max-w-md">
        <input placeholder="Ticker" value={ticker} onChange={e=>setTicker(e.target.value.toUpperCase())}/>
        <select value={side} onChange={e=>setSide(e.target.value as any)}>
          <option value="LONG">Long</option>
          <option value="SHORT">Short</option>
        </select>
        <input type="number" placeholder="Quantity" value={qty} onChange={e=>setQty(+e.target.value)} />
        <input type="number" step="0.0001" placeholder="Entry Price" value={entryPrice} onChange={e=>setEntryPrice(+e.target.value)} />
        <input type="number" step="0.0001" placeholder="Risk/Share" value={riskPerShare} onChange={e=>setRiskPerShare(+e.target.value)} />
        <button onClick={submit}>Create</button>
      </div>
    </div>
  );
}
