// Chart component — see frontend/AGENTS.md for context
import { useState } from 'react';

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

export default StackedBarChart;
