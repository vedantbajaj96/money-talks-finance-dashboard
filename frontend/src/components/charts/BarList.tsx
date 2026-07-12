// Chart component — see frontend/AGENTS.md for context

// data: [{ cat, name, color, amount }]
function BarList({ data, formatter, max }) {
  const m = max || Math.max(...data.map((d) => d.amount));
  return (
    <div className="bar-list">
      {data.map((d) => (
        <div key={d.cat} className="bar-list-row">
          <div className="bar-list-name">
            <span className="cat-dot" style={{ background: d.color }} />
            <span>{d.name}</span>
          </div>
          <div className="bar-list-track">
            <div className="bar-list-fill" style={{ width: `${(d.amount / m) * 100}%`, background: d.color }} />
          </div>
          <div className="bar-list-amt">{formatter ? formatter(d.amount) : d.amount.toFixed(2)}</div>
        </div>
      ))}
    </div>
  );
}

export default BarList;
