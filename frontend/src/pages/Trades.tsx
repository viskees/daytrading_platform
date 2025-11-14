import React, { useEffect, useState } from "react";
import { API } from "../lib/api";

export default function Trades() {
  const [trades, setTrades] = useState<any[]>([]);
  useEffect(() => { (async () => setTrades((await API.get("/journal/trades/")).results ?? []))(); }, []);
  return (
    <div>
      <h1 className="text-xl font-semibold">Trades</h1>
      <table className="mt-3 w-full border">
        <thead><tr><th>Ticker</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>PnL</th><th>R</th></tr></thead>
        <tbody>
          {trades.map(t => (
            <tr key={t.id}>
              <td>{t.ticker}</td><td>{t.side}</td><td>{t.quantity}</td>
              <td>{t.entry_price}</td><td>{t.exit_price ?? "-"}</td>
              <td>{t.realized_pnl}</td><td>{t.r_multiple}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
