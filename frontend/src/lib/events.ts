// frontend/src/lib/events.ts
type TradeClosedDetail = { tradeId?: number | string; dateISO?: string };

const BUS_KEY = "__daytrading_trade_bus__";
const g = globalThis as any;
if (!g[BUS_KEY]) {
  g[BUS_KEY] = new EventTarget();
  console.log("[events] created global bus", import.meta.url);
} else {
  console.log("[events] reusing global bus", import.meta.url);
}
const bus: EventTarget = g[BUS_KEY];

export function onTradeClosed(handler: (d: TradeClosedDetail) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<TradeClosedDetail>).detail || {});
  bus.addEventListener("trade:closed", listener);
  return () => bus.removeEventListener("trade:closed", listener);
}

export function emitTradeClosed(detail: TradeClosedDetail = {}) {
  bus.dispatchEvent(new CustomEvent<TradeClosedDetail>("trade:closed", { detail }));
  console.log("[events] emitted trade:closed", detail);
}