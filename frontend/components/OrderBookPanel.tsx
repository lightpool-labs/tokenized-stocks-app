export function OrderBookPanel() {
  return (
    <section className="panel orderbook-panel">
      <div className="panel-header">Order book</div>
      <div className="panel-body">
        <div className="book-split">
          <div>
            <table className="book-table">
              <thead>
                <tr>
                  <th>Price</th>
                  <th>Size</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={3} className="book-empty ask">
                    Asks — empty
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mid-price">—</div>

          <div>
            <table className="book-table">
              <thead>
                <tr>
                  <th>Price</th>
                  <th>Size</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={3} className="book-empty bid">
                    Bids — empty
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <div className="panel-header" style={{ paddingLeft: 0, paddingRight: 0 }}>
              Recent trades
            </div>
            <ul className="trades-list">
              <li>
                <span>Price</span>
                <span>Size</span>
                <span>Time</span>
              </li>
              <li>
                <span>—</span>
                <span>—</span>
                <span>empty</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
