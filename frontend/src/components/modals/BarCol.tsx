// Modal component — see frontend/AGENTS.md for context
import { useState } from 'react';

function BarCol({ label, value, maxVal }) {
  const [hovered, setHovered] = useState(false);
  const amt = value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : value > 0 ? `$${Math.round(value)}` : '';
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, position: 'relative' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={{ height: 24, flexShrink: 0 }} />
      <div style={{
        position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
        fontSize: 20, color: 'var(--accent)', fontWeight: 700, lineHeight: '24px',
        opacity: hovered && value > 0 ? 1 : 0, transition: 'opacity 0.15s', whiteSpace: 'nowrap', zIndex: 2,
      }}>{amt}</div>
      <div style={{
        width: '100%', borderRadius: 3,
        background: value > 0 ? (hovered ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 70%, transparent)') : 'var(--line)',
        height: value > 0 ? `${Math.max(4, (value / maxVal) * 44)}px` : '3px',
        transition: 'height 0.2s, background 0.15s',
      }} />
      <div style={{ fontSize: 9, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{label}</div>
    </div>
  );
}

export default BarCol;
