import { useState, useEffect, useRef } from 'react';

function useCountUp(target: number, duration = 520) {
  const [val, setVal] = useState(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (target == null || isNaN(target)) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    let start: number | null = null;
    function tick(ts: number) {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setVal(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);
  return val;
}

interface HeroStat { val: string; key: string; }

interface TabHeroProps {
  value: number;
  format?: (n: number) => string;
  label: string;
  sublabel: string;
  /** true = accent/green, false = terra/red, undefined = neutral ink */
  positive?: boolean;
  stats?: HeroStat[];
}

export default function TabHero({ value, format, label, sublabel, positive, stats }: TabHeroProps) {
  const animated = useCountUp(Math.abs(value));
  const display  = format ? format(animated) : animated.toFixed(0);
  const prefix   = value < 0 ? '–' : '';
  const cls      = positive === true ? 'positive' : positive === false ? 'negative' : '';

  return (
    <div className="month-hero">
      <div className="hero-eyebrow">{label}</div>
      <div className={`hero-net ${cls}`}>{prefix}{display}</div>
      <div className="hero-sublabel">{sublabel}</div>
      {stats && stats.length > 0 && (
        <div className="hero-stats">
          {stats.map((s, i) => (
            <span key={s.key} style={{ display: 'contents' }}>
              {i > 0 && <div className="hero-stat-divider" />}
              <div className="hero-stat">
                <span className="hero-stat-val">{s.val}</span>
                <span className="hero-stat-key">{s.key}</span>
              </div>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
