type ChartPanelProps = {
  pair: string;
  spotMarket: string | null;
};

export function ChartPanel({ pair, spotMarket }: ChartPanelProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <span>Chart / bars</span>
        <span>{pair}</span>
      </div>
      <div className="panel-body">
        <div className="chart-placeholder">
          Chart placeholder
          {spotMarket && (
            <div className="spot-hint">spot: {spotMarket}</div>
          )}
        </div>
      </div>
    </section>
  );
}
