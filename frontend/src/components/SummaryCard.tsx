// Chart component — see frontend/AGENTS.md for context
import { useState, useEffect, useRef } from 'react';
import { fmtMoney } from '@/lib/helpers';
import Sparkline from '@/components/charts/Sparkline';

function useCountUp(target, duration = 550) {
  const [val, setVal] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    if (target == null || isNaN(target)) return;
    cancelAnimationFrame(rafRef.current);
    let start = null;
    const from = 0;
    function tick(ts) {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // cubic ease-out
      setVal(from + (target - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]);
  return val;
}

function SummaryCard({ label, value, n, nFmt = fmtMoney, sub, trend, accent, spark }) {
  const animated = useCountUp(n);
  const display  = n != null ? nFmt(animated) : value;
  return (
    <div className="card sum-card">
      <div className="sum-label">{label}</div>
      <div className="sum-value" style={{ color: accent || 'var(--ink)' }}>{display}</div>
      <div className="sum-foot">
        {sub && <span className="sum-sub">{sub}</span>}
        {trend != null && (
          <span className={`sum-trend ${trend >= 0 ? 'up' : 'down'}`}>
            {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
          </span>
        )}
        {spark && <Sparkline points={spark} color={accent || 'var(--accent)'} width={60} height={22} />}
      </div>
    </div>
  );
}

export default SummaryCard;
