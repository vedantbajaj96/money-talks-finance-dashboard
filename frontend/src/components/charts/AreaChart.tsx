// Chart component — see frontend/AGENTS.md for context
import { useState } from 'react';

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

export default AreaChart;
