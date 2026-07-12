// Modal component — see frontend/AGENTS.md for context
import { useState } from 'react';
import { TRANSACTIONS } from '@/lib/fin';
import { fmtMoney, catById, fmt } from '@/lib/helpers';
import BarCol from './BarCol';

function MerchantDrawer({ merchant, category, onClose }) {
  const [drawerSort, setDrawerSort] = useState('date');
  const allTxns = TRANSACTIONS.filter(t => t.merchant === merchant && t.category === category)
    .sort((a, b) => drawerSort === 'date'
      ? b.date.localeCompare(a.date)
      : Math.abs(b.amount) - Math.abs(a.amount));

  const allTimeTotal = allTxns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  const thisYear     = new Date().getFullYear().toString();
  const yearTotal    = allTxns.filter(t => t.amount < 0 && t.date.startsWith(thisYear))
                              .reduce((s, t) => s + Math.abs(t.amount), 0);
  const avgTxn       = allTxns.length > 0 ? allTimeTotal / allTxns.filter(t => t.amount < 0).length : 0;

  // Monthly spend for bar chart — last 12 months
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return d.toISOString().slice(0, 7);
  });
  const byMonth = {};
  allTxns.filter(t => t.amount < 0).forEach(t => {
    const m = t.date.slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + Math.abs(t.amount);
  });
  const chartData = months.map(m => ({ label: m.slice(5), value: byMonth[m] || 0 }));
  const maxVal = Math.max(...chartData.map(d => d.value), 1);

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)',
      }} />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 401,
        width: 420, background: 'var(--surface)', borderLeft: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
                {merchant}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
                {category} · {allTxns.length} transaction{allTxns.length !== 1 ? 's' : ''}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'none', border: '1px solid var(--line)', borderRadius: 8,
              padding: '5px 10px', cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)',
              lineHeight: 1, flexShrink: 0,
            }}>✕</button>
          </div>

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
            {[
              { label: 'All time',    value: fmtMoney(allTimeTotal) },
              { label: thisYear,      value: fmtMoney(yearTotal) },
              { label: 'Avg / txn',  value: fmtMoney(avgTxn) },
            ].map(({ label, value }) => (
              <div key={label} style={{
                background: 'var(--surface-3)', borderRadius: 10, padding: '10px 12px',
              }}>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly bar chart */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase',
            letterSpacing: '0.07em', marginBottom: 10 }}>Monthly spend — last 12 months</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 96 }}>
            {chartData.map(({ label, value }) => (
              <BarCol key={label} label={label} value={value} maxVal={maxVal} />
            ))}
          </div>
        </div>

        {/* Transaction list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
          <div style={{ display: 'flex', gap: 6, padding: '10px 24px', borderBottom: '1px solid var(--line)' }}>
            {['date', 'amount'].map(s => (
              <button key={s} onClick={() => setDrawerSort(s)} style={{
                background: drawerSort === s ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
                border: `1px solid ${drawerSort === s ? 'var(--accent)' : 'var(--line)'}`,
                borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer',
                color: drawerSort === s ? 'var(--accent)' : 'var(--ink-3)', fontFamily: 'inherit',
              }}>{s === 'date' ? '📅 Date' : '$ Amount'}</button>
            ))}
          </div>
          {allTxns.map(t => {
            const cat = catById(t.category);
            return (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 24px', borderBottom: '1px solid var(--line)',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: cat.color + '24', color: cat.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
                }}>{cat.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{t.date.slice(5).replace('-', '/')}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>
                    <span className="cat-pill" style={{ color: cat.color }}>{cat.name}</span>
                  </div>
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                  color: t.amount >= 0 ? 'var(--green)' : 'var(--ink)',
                }}>{fmt(t.amount, { sign: true })}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default MerchantDrawer;
