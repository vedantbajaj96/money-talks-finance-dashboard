// Reusable SVG chart primitives for the finance dashboard.
// All charts: hover tooltips, responsive viewBox, dark-theme tuned.
(function () {
const { useState, useRef, useMemo } = React;

// ─── Donut Chart ───────────────────────────────────────────────────
function DonutChart({ data, size = 220, thickness = 28, onSliceHover, formatter }) {
  const [hover, setHover] = useState(null);
  const total = data.reduce((s, d) => s + d.amount, 0);
  const r = size / 2 - thickness / 2 - 2;
  const cx = size / 2, cy = size / 2;
  let angle = -Math.PI / 2;

  const slices = data.map((d, i) => {
    const frac = d.amount / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const x0 = cx + Math.cos(a0) * r;
    const y0 = cy + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r;
    const y1 = cy + Math.sin(a1) * r;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const path = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    return { ...d, path, i, frac };
  });

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
            strokeWidth={hover === s.i ? thickness + 4 : thickness}
            strokeLinecap="butt"
            opacity={hover != null && hover !== s.i ? 0.35 : 1}
            style={{ transition: 'all .18s', cursor: 'pointer' }}
            onMouseEnter={() => { setHover(s.i); onSliceHover?.(s); }}
            onMouseLeave={() => { setHover(null); onSliceHover?.(null); }}
          />
        ))}
        <text x={cx} y={cy - 8} textAnchor="middle" className="donut-center-label">
          {hover != null ? slices[hover].name : 'Total spend'}
        </text>
        <text x={cx} y={cy + 18} textAnchor="middle" className="donut-center-value">
          {formatter ? formatter(hover != null ? slices[hover].amount : total) : (hover != null ? slices[hover].amount : total)}
        </text>
        {hover != null && (
          <text x={cx} y={cy + 38} textAnchor="middle" className="donut-center-pct">
            {(slices[hover].frac * 100).toFixed(1)}%
          </text>
        )}
      </svg>
    </div>
  );
}

// ─── Stacked Bar Chart ─────────────────────────────────────────────
// data: [{ label, segments: [{ key, value, color, name }] }]
function StackedBarChart({ data, height = 240, formatter }) {
  const [hover, setHover] = useState(null);
  const padding = { top: 20, right: 12, bottom: 28, left: 56 };
  const width = 720;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const totals = data.map((d) => d.segments.reduce((s, x) => s + x.value, 0));
  const max = Math.max(...totals) * 1.15;
  const barW = innerW / data.length * 0.62;
  const gap = innerW / data.length;

  // Y gridlines
  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => (max / ticks) * i);

  return (
    <div className="chart-wrap">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        {/* gridlines */}
        {tickVals.map((v, i) => {
          const y = padding.top + innerH - (v / max) * innerH;
          return (
            <g key={i}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y}
                stroke="rgba(20,24,32,0.06)" strokeWidth="1" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" className="chart-axis-label">
                {formatter ? formatter(v) : v.toFixed(0)}
              </text>
            </g>
          );
        })}
        {/* bars */}
        {data.map((d, i) => {
          const cx = padding.left + gap * i + gap / 2;
          let yCursor = padding.top + innerH;
          const segs = d.segments.map((s, j) => {
            const segH = (s.value / max) * innerH;
            yCursor -= segH;
            return { ...s, y: yCursor, h: segH, j };
          });
          const isHovered = hover?.barIdx === i;
          return (
            <g key={d.label}>
              {segs.map((s) => (
                <rect key={s.key}
                  x={cx - barW / 2}
                  y={s.y}
                  width={barW}
                  height={Math.max(0, s.h - 1)}
                  fill={s.color}
                  rx="2"
                  opacity={hover && hover.barIdx !== i ? 0.4 : 1}
                  style={{ transition: 'opacity .15s' }}
                />
              ))}
              {/* hover area */}
              <rect x={cx - gap / 2} y={padding.top} width={gap} height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover({ barIdx: i, data: d, segs, total: totals[i] })}
                onMouseLeave={() => setHover(null)} />
              <text x={cx} y={height - 8} textAnchor="middle" className="chart-axis-label">
                {d.label}
              </text>
              {isHovered && (
                <line x1={cx} x2={cx} y1={padding.top} y2={padding.top + innerH}
                  stroke="rgba(20,24,32,0.25)" strokeDasharray="2 2" />
              )}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="chart-tooltip" style={{ left: padding.left + gap * hover.barIdx + gap / 2, top: 12 }}>
          <div className="tt-title">{hover.data.label}</div>
          <div className="tt-total">{formatter ? formatter(hover.total) : hover.total.toFixed(0)}</div>
          {[...hover.segs].reverse().map((s) => (
            <div key={s.key} className="tt-row">
              <i style={{ background: s.color }} />
              <span>{s.name}</span>
              <span className="tt-val">{formatter ? formatter(s.value) : s.value.toFixed(0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Area / Line Chart (cash flow with income & expenses) ─────────
// series: [{ key, name, color, points: [{ label, value }] }]
function AreaChart({ series, height = 260, formatter, fill = true }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const padding = { top: 20, right: 16, bottom: 28, left: 56 };
  const width = 720;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const n = series[0].points.length;
  const allVals = series.flatMap((s) => s.points.map((p) => p.value));
  const minV = Math.min(0, ...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV;
  const pad = range * 0.12 || 1;
  const yMin = minV - pad;
  const yMax = maxV + pad;

  const xAt = (i) => padding.left + (innerW * i) / (n - 1);
  const yAt = (v) => padding.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const tickVals = [yMin, yMin + (yMax - yMin) / 2, yMax];

  const buildPath = (pts) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.value)}`).join(' ');
  const buildArea = (pts) => buildPath(pts) + ` L ${xAt(n - 1)} ${yAt(0)} L ${xAt(0)} ${yAt(0)} Z`;

  const onMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((x - padding.left) / innerW) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="chart-wrap">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}
           onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`grad-${s.key}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {/* gridlines */}
        {tickVals.map((v, i) => {
          const y = yAt(v);
          return (
            <g key={i}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y}
                stroke="rgba(20,24,32,0.06)" strokeWidth="1" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" className="chart-axis-label">
                {formatter ? formatter(v) : v.toFixed(0)}
              </text>
            </g>
          );
        })}
        {/* zero line */}
        {yMin < 0 && yMax > 0 && (
          <line x1={padding.left} x2={width - padding.right} y1={yAt(0)} y2={yAt(0)}
            stroke="rgba(20,24,32,0.2)" strokeWidth="1" strokeDasharray="2 3" />
        )}
        {/* areas */}
        {fill && series.map((s, i) => (
          <path key={`area-${s.key}`} d={buildArea(s.points)} fill={`url(#grad-${s.key}-${i})`} />
        ))}
        {/* lines */}
        {series.map((s) => (
          <path key={`line-${s.key}`} d={buildPath(s.points)} fill="none"
            stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* x labels */}
        {series[0].points.map((p, i) => (
          <text key={i} x={xAt(i)} y={height - 8} textAnchor="middle" className="chart-axis-label">
            {p.label}
          </text>
        ))}
        {/* hover */}
        {hoverIdx != null && (
          <g>
            <line x1={xAt(hoverIdx)} x2={xAt(hoverIdx)} y1={padding.top} y2={padding.top + innerH}
              stroke="rgba(20,24,32,0.25)" strokeDasharray="2 2" />
            {series.map((s) => (
              <circle key={s.key} cx={xAt(hoverIdx)} cy={yAt(s.points[hoverIdx].value)}
                r="4" fill="#ffffff" stroke={s.color} strokeWidth="2" />
            ))}
          </g>
        )}
      </svg>
      {hoverIdx != null && (
        <div className="chart-tooltip" style={{ left: xAt(hoverIdx) + 12, top: 12 }}>
          <div className="tt-title">{series[0].points[hoverIdx].label}</div>
          {series.map((s) => (
            <div key={s.key} className="tt-row">
              <i style={{ background: s.color }} />
              <span>{s.name}</span>
              <span className="tt-val">{formatter ? formatter(s.points[hoverIdx].value) : s.points[hoverIdx].value.toFixed(0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sparkline (compact line for cards) ────────────────────────────
function Sparkline({ points, color = '#5ec98a', height = 32, width = 80 }) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const path = points.map((v, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Horizontal Bar List (category breakdown) ─────────────────────
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

Object.assign(window, { DonutChart, StackedBarChart, AreaChart, Sparkline, BarList });
})();
