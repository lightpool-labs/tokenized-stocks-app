"use client";

const MARKETS = [
  { pair: "AAPL/USDT", hint: "Apple" },
  { pair: "TSLA/USDT", hint: "Tesla" },
  { pair: "NVDA/USDT", hint: "NVIDIA" },
  { pair: "MSFT/USDT", hint: "Microsoft" },
];

type MarketsListProps = {
  selected: string;
  onSelect: (pair: string) => void;
};

export function MarketsList({ selected, onSelect }: MarketsListProps) {
  return (
    <section className="panel">
      <div className="panel-header">Markets</div>
      <div className="panel-body" style={{ padding: "0.35rem" }}>
        {MARKETS.map((market) => (
          <button
            key={market.pair}
            type="button"
            className={`market-row ${selected === market.pair ? "selected" : ""}`}
            onClick={() => onSelect(market.pair)}
          >
            <span className="pair">{market.pair}</span>
            <span className="hint">{market.hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
