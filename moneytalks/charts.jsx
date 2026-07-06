// Reusable SVG chart primitives for the finance dashboard.
// All charts: hover tooltips, responsive viewBox, dark-theme tuned.
(function () {
const { useState, useRef, useMemo } = React;

// ─── Donut Chart ───────────────────────────────────────────────────
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

// ─── Stacked Bar Chart ─────────────────────────────────────────────
// data: [{ label, segments: [{ key, value, color, name }] }]
function StackedBarChart({ data, height = 240, formatter }) {
  const [hover, setHover] = useState(null);
  const padding = { top: 24, right: 16, bottom: 32, left: 60 };
  const width = 720;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const totals = data.map((d) => d.segments.reduce((s, x) => s + x.value, 0));
  const max = Math.max(...totals) * 1.12;
  const barW = innerW / data.length * 0.58;
  const gap = innerW / data.length;
  const rx = 5; // rounded corners on bars

  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => (max / ticks) * i);

  return (
    <div className="chart-wrap">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        {/* subtle gridlines */}
        {tickVals.map((v, i) => {
          const y = padding.top + innerH - (v / max) * innerH;
          return (
            <g key={i}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y}
                stroke={i === 0 ? 'rgba(20,24,32,0.12)' : 'rgba(20,24,32,0.05)'}
                strokeWidth="1" strokeDasharray={i === 0 ? 'none' : '4 4'} />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" className="chart-axis-label">
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
          const totalH = segs.reduce((a, s) => a + s.h, 0);
          const topY = padding.top + innerH - totalH;

          return (
            <g key={d.label}>
              {/* hover highlight column */}
              {isHovered && (
                <rect x={cx - gap / 2} y={padding.top} width={gap} height={innerH}
                  fill="rgba(20,24,32,0.03)" rx="4" />
              )}
              {segs.map((s, j) => {
                const isTop = j === segs.length - 1;
                const isBottom = j === 0;
                // Rounded top only on the topmost segment
                if (isTop && s.h > rx * 2) {
                  return (
                    <path key={s.key}
                      d={`M ${cx - barW/2} ${s.y + s.h}
                          L ${cx - barW/2} ${s.y + rx}
                          Q ${cx - barW/2} ${s.y} ${cx - barW/2 + rx} ${s.y}
                          L ${cx + barW/2 - rx} ${s.y}
                          Q ${cx + barW/2} ${s.y} ${cx + barW/2} ${s.y + rx}
                          L ${cx + barW/2} ${s.y + s.h} Z`}
                      fill={s.color}
                      opacity={hover && !isHovered ? 0.45 : 1}
                      style={{ transition: 'opacity .18s' }}
                    />
                  );
                }
                return (
                  <rect key={s.key}
                    x={cx - barW / 2} y={s.y}
                    width={barW} height={Math.max(0, s.h)}
                    fill={s.color}
                    opacity={hover && !isHovered ? 0.45 : 1}
                    style={{ transition: 'opacity .18s' }}
                  />
                );
              })}
              {/* hover target */}
              <rect x={cx - gap / 2} y={padding.top} width={gap} height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover({ barIdx: i, data: d, segs, total: totals[i] })}
                onMouseLeave={() => setHover(null)} />
              <text x={cx} y={height - 10} textAnchor="middle" className="chart-axis-label"
                style={{ fontWeight: isHovered ? 600 : 400, fill: isHovered ? 'var(--ink)' : undefined }}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="chart-tooltip" style={{ left: Math.min(padding.left + gap * hover.barIdx + gap / 2 + 12, width - 180), top: 16 }}>
          <div className="tt-title">{hover.data.label}</div>
          <div className="tt-total">{formatter ? formatter(hover.total) : hover.total.toFixed(0)}</div>
          {[...hover.segs].reverse().filter(s => s.value > 0).map((s) => (
            <div key={s.key} className="tt-row">
              <i style={{ background: s.color, borderRadius: 2 }} />
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
  if (!series || !series[0] || series[0].points.length === 0) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 13 }}>No data</div>;
  }
  const n = series[0].points.length;
  if (n === 1) {
    // Single point — can't draw a line, just show the value
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4 }}>
        {series.map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
            <span style={{ color: 'var(--ink-2)' }}>{s.name}</span>
            <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{formatter ? formatter(s.points[0].value) : s.points[0].value}</span>
          </div>
        ))}
      </div>
    );
  }
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
  if (!points || points.length < 2) return null;
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
