// Chart component — see frontend/AGENTS.md for context
import { useState } from 'react';

function DonutChart({ data, size = 220, thickness = 28, onSliceHover, onSliceClick, selectedCat, formatter }) {
  const [hover, setHover] = useState(null);
  if (!data || data.length === 0) {
    return (
      <div className="donut-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: size }}>
        <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>No spending data</span>
      </div>
    );
  }
  const total = data.reduce((s, d) => s + d.amount, 0);
  const r = size / 2 - thickness / 2 - 4;
  const cx = size / 2, cy = size / 2;
  let angle = -Math.PI / 2;
  const GAP = 0.025; // radians gap between slices

  const slices = data.map((d, i) => {
    const frac = d.amount / total;
    const a0 = angle + GAP / 2;
    const a1 = angle + frac * Math.PI * 2 - GAP / 2;
    angle = angle + frac * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * r;
    const y0 = cy + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r;
    const y1 = cy + Math.sin(a1) * r;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const path = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    return { ...d, path, i, frac };
  });

  const activeIdx = hover != null ? hover : (selectedCat != null ? slices.findIndex(s => s.cat === selectedCat) : null);

  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(20,24,32,0.05)" strokeWidth={thickness} />
        {slices.map((s) => (
          <path
            key={s.cat}
            d={s.path}
            fill="none"
            stroke={s.color}
            strokeWidth={(selectedCat === s.cat || hover === s.i) ? thickness + 4 : thickness}
            strokeLinecap="butt"
            opacity={activeIdx != null && activeIdx !== s.i ? 0.35 : 1}
            style={{ transition: 'all .18s', cursor: 'pointer' }}
            onMouseEnter={() => { setHover(s.i); onSliceHover?.(s); }}
            onMouseLeave={() => { setHover(null); onSliceHover?.(null); }}
            onClick={() => onSliceClick?.(s)}
          />
        ))}
        <text x={cx} y={cy - 8} textAnchor="middle" className="donut-center-label">
          {activeIdx != null && activeIdx >= 0 ? slices[activeIdx].name : 'Total spend'}
        </text>
        <text x={cx} y={cy + 18} textAnchor="middle" className="donut-center-value">
          {formatter
            ? formatter(activeIdx != null && activeIdx >= 0 ? slices[activeIdx].amount : total)
            : (activeIdx != null && activeIdx >= 0 ? slices[activeIdx].amount : total)}
        </text>
        {activeIdx != null && activeIdx >= 0 && (
          <text x={cx} y={cy + 38} textAnchor="middle" className="donut-center-pct">
            {(slices[activeIdx].frac * 100).toFixed(1)}%
          </text>
        )}
      </svg>
    </div>
  );
}

export default DonutChart;
