type ChartPanelProps = {
  pair: string;
};

export function ChartPanel({ pair }: ChartPanelProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <span>Chart / bars</span>
        <span>{pair}</span>
      </div>
      <div className="panel-body">
        <div className="chart-placeholder">Chart placeholder</div>
      </div>
    </section>
  );
}
