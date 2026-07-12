// Modal component — see frontend/AGENTS.md for context
import { useEffect } from 'react';
import { catById } from '@/lib/helpers';

function MapPopover({ txn, onClose }) {
  useEffect(() => {
    // Inject animation once
    if (!document.getElementById('map-popover-css')) {
      const s = document.createElement('style');
      s.id = 'map-popover-css';
      s.textContent = `
        @keyframes mapPopIn {
          from { opacity: 0; transform: translate(-50%, -48%) scale(0.94); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `;
      document.head.appendChild(s);
    }
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const hasCoords = txn.lat != null && txn.lon != null;
  const fullAddress = [txn.location_address, txn.location_city, txn.location_region]
    .filter(Boolean).join(', ');
  const coordLabel = [txn.location_city, txn.location_region].filter(Boolean).join(', ');

  const delta = 0.007;
  const osmSrc = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${txn.lon - delta},${txn.lat - delta},${txn.lon + delta},${txn.lat + delta}&layer=mapnik&marker=${txn.lat},${txn.lon}`
    : null;
  // Use Apple Maps on iOS/macOS (opens natively), Google Maps elsewhere
  const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && !window.MSStream;
  const mapsUrl = hasCoords
    ? (isApple
        ? `https://maps.apple.com/?q=${txn.lat},${txn.lon}`
        : `https://www.google.com/maps?q=${txn.lat},${txn.lon}`)
    : (isApple
        ? `https://maps.apple.com/?q=${encodeURIComponent(fullAddress || txn.merchant)}`
        : `https://www.google.com/maps/search/${encodeURIComponent(fullAddress || txn.merchant)}`);

  const cat = catById(txn.category);

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 800,
        background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(2px)',
      }} />
      <div style={{
        position: 'fixed', zIndex: 801,
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 340,
        background: 'var(--surface)',
        borderRadius: 20, overflow: 'hidden',
        border: '1px solid var(--line)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.4)',
        animation: 'mapPopIn 0.22s cubic-bezier(0.2, 0.8, 0.3, 1.15) forwards',
      }}>
        {/* Category accent bar */}
        <div style={{ height: 3, background: cat.color }} />

        {/* Header */}
        <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {txn.merchant}
            </div>
            {fullAddress && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fullAddress}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'var(--surface-2)', border: 'none', borderRadius: 8,
            cursor: 'pointer', color: 'var(--ink-3)', fontSize: 13, lineHeight: 1,
            padding: '5px 8px', flexShrink: 0, fontFamily: 'inherit',
          }}>✕</button>
        </div>

        {/* Map */}
        {hasCoords ? (
          <div style={{ position: 'relative', height: 224 }}>
            <iframe
              src={osmSrc}
              title={`Map: ${txn.merchant}`}
              style={{ width: '100%', height: '100%', border: 'none', display: 'block', filter: 'saturate(0.8) brightness(0.9)' }}
              loading="lazy"
            />
            {/* Inner vignette */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 24px rgba(0,0,0,0.18)' }} />
          </div>
        ) : (
          <div style={{
            height: 110, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 7,
            background: 'var(--surface-2)', color: 'var(--ink-3)', fontSize: 13,
          }}>
            <span style={{ fontSize: 28 }}>📍</span>
            <span>No exact coordinates — city-level only</span>
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: '10px 16px', borderTop: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
            {hasCoords ? `${txn.lat.toFixed(5)}, ${txn.lon.toFixed(5)}` : (coordLabel || '—')}
          </span>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none', letterSpacing: '-0.01em' }}>
            {isApple ? 'Open in Apple Maps ↗' : 'Open in Google Maps ↗'}
          </a>
        </div>
      </div>
    </>
  );
}

export default MapPopover;
