// Chart component — see frontend/AGENTS.md for context
import { useState } from 'react';
import { ACCOUNTS } from '@/lib/fin';
import { fmt, acctById } from '@/lib/helpers';
import { apiFetch } from '@/lib/api';
import { liveCatById } from '@/components/CategoryPicker';
import CategoryPicker from '@/components/CategoryPicker';
import SearchableSelect from '@/components/SearchableSelect';
import { createPortal } from 'react-dom';
import { BarCol, MerchantDrawer, MapPopover, SplitModal, EditTransactionModal, DateEditor } from '@/components/modals';

function TxnList({ txns, compact = false, onRecategorize, refreshFin, sortCol: initSortCol, sortDir: initSortDir, presorted = false, extraMenuItems }) {
  const [splitTxn, setSplitTxn]     = useState(null);
  const [editDateId, setEditDateId] = useState(null);
  const [editTxn, setEditTxn]       = useState(null);
  const [menuId, setMenuId]         = useState(null);
  const [activeMerchant, setActiveMerchant] = useState(null);
  const [mapTxn, setMapTxn]         = useState(null);
  const [sortCol, setSortCol]       = useState(presorted ? null : (initSortCol || 'date'));
  const [sortDir, setSortDir]       = useState(initSortDir || 'desc');
  const [dateOverrides, setDateOverrides] = useState({});
  const [localFlags, setLocalFlags] = useState(() => {
    const flags = {};
    txns.forEach(t => { if (t.flagged) flags[t.id] = true; });
    return flags;
  });

  async function toggleFlag(txnId, current) {
    const next = !current;
    setLocalFlags(prev => ({ ...prev, [txnId]: next }));
    try {
      await apiFetch(`/api/transactions/${txnId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagged: next }),
      });
      window.showToast?.(next ? '⚑ Flagged for review' : 'Flag removed');
      if (refreshFin) refreshFin();
    } catch(e) {
      setLocalFlags(prev => ({ ...prev, [txnId]: current }));
    }
  }

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  const sorted = sortCol === null ? txns : [...txns].sort((a, b) => {
    let cmp = 0;
    if (sortCol === 'date')   cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    if (sortCol === 'amount') cmp = Math.abs(a.amount) - Math.abs(b.amount);
    return sortDir === 'desc' ? -cmp : cmp;
  });

  function handleSplitClose(reload) {
    setSplitTxn(null);
    if (reload) { if (refreshFin) refreshFin(); else window.location.reload(); }
  }

  async function saveDate(txnId, newDate) {
    setEditDateId(null);
    setDateOverrides(prev => ({ ...prev, [txnId]: newDate }));
    try {
      const res = await fetch(`/api/transactions/${txnId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: newDate }),
      });
      if (!res.ok) console.error('Date save failed:', res.status, await res.text());
      setTimeout(() => { if (refreshFin) refreshFin(); }, 300);
    } catch(e) { console.error('Date save error:', e); }
  }

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <span style={{ opacity: 0.25, fontSize: 10 }}>↕</span>;
    return <span style={{ fontSize: 10, color: 'var(--accent)' }}>{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  return (
    <>
      {mapTxn && <MapPopover txn={mapTxn} onClose={() => setMapTxn(null)} />}
      {activeMerchant && createPortal(<MerchantDrawer merchant={activeMerchant.merchant} category={activeMerchant.category} onClose={() => setActiveMerchant(null)} />, document.body)}
      {!compact && (
        <div style={{
          display: 'grid', gridTemplateColumns: '36px 1fr 56px 96px 20px',
          gap: 10, padding: '6px 4px 5px',
          borderBottom: '2px solid var(--line)',
          fontSize: 11, fontWeight: 600, color: 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: '0.04em',
          userSelect: 'none',
        }}>
          <div />
          <div>Merchant</div>
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
            onClick={() => toggleSort('date')}>
            Date <SortIcon col="date" />
          </div>
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }}
            onClick={() => toggleSort('amount')}>
            <SortIcon col="amount" /> Amount
          </div>
          <div />
        </div>
      )}
      <div className={`txn-list ${compact ? 'compact' : ''}`}>
        {sorted.map((t) => {
          const cat = liveCatById(t.category);
          const acct = acctById(t.account);
          const isSplit = t.is_split;
          const canEdit = !!onRecategorize && !isSplit;
          const isFlagged = !!localFlags[t.id];
          return (
            <div key={t.id} className="txn-row" style={isSplit ? { paddingLeft: 28, borderLeft: `3px solid ${cat.color}40` } : isFlagged ? { background: 'rgba(249,115,22,0.035)' } : {}}>
              <div className="txn-icon" style={{ background: cat.color + '24', color: cat.color }}>
                {isSplit ? '⋮' : cat.icon}
              </div>
              <div className="txn-main">
                <div className="txn-merchant">
                  <span onClick={() => !isSplit && setActiveMerchant({ merchant: t.merchant, category: t.category })} style={{
                    cursor: isSplit ? 'default' : 'pointer',
                    textDecoration: isSplit ? 'none' : 'underline dotted',
                    textUnderlineOffset: 2,
                    textDecorationColor: 'var(--line-2)',
                  }}>{t.merchant}</span>
                  {isFlagged && <span style={{ fontSize: 11, color: '#f97316', marginLeft: 6 }} title="Flagged for review">⚑</span>}
                  {t.pending && <span className="pending-pill">pending</span>}
                  {isSplit && <span className="pending-pill" style={{ background: cat.color + '20', color: cat.color }}>split</span>}
                  {t.notes && !isSplit && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{t.notes}</span>}
                  {isSplit && t.notes && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{t.notes}</span>}
                </div>
                <div className="txn-meta">
                  {onRecategorize && !isSplit ? (
                    <CategoryPicker value={t.category} onChange={(c) => onRecategorize(t.id, c)} />
                  ) : (
                    <span className="cat-pill" style={{ color: cat.color }}>{cat.name}</span>
                  )}
                  <span className="dot-sep">·</span>
                  <span>{acct.name}</span>
                  {(t.location_city || (t.lat != null && t.lon != null)) && (() => {
                    const label = [t.location_city, t.location_region].filter(Boolean).join(', ');
                    return <>
                      <span className="dot-sep">·</span>
                      <button
                        onClick={e => { e.stopPropagation(); setMapTxn(t); }}
                        title={[t.location_address, label].filter(Boolean).join(' · ')}
                        style={{
                          background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                          border: 'none', borderRadius: 5, cursor: 'pointer',
                          color: 'var(--accent)', fontSize: 10.5, fontWeight: 600,
                          padding: '1px 6px 1px 4px', fontFamily: 'inherit', lineHeight: 1.6,
                          display: 'inline-flex', alignItems: 'center', gap: 2,
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 18%, transparent)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 10%, transparent)'}
                      >📍 {label || 'View map'}</button>
                    </>;
                  })()}
                </div>
              </div>
              {canEdit && editDateId === t.id ? (
                <DateEditor
                  currentDate={dateOverrides[t.id] ?? t.date}
                  onSave={d => saveDate(t.id, d)}
                  onCancel={() => setEditDateId(null)}
                />
              ) : (
                <div
                  className="txn-date"
                  title={canEdit ? 'Click to edit date' : undefined}
                  style={canEdit ? { cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 2 } : {}}
                  onClick={canEdit ? () => setEditDateId(t.id) : undefined}
                >
                  {(dateOverrides[t.id] ?? t.date).slice(5).replace('-', '/')}
                </div>
              )}
              <div className={`txn-amt ${t.amount >= 0 ? 'pos' : 'neg'}`}>
                {fmt(t.amount, { sign: true })}
              </div>
              {onRecategorize && !isSplit && !compact ? (
                <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                  <button
                    className="txn-menu-btn"
                    onClick={e => { e.stopPropagation(); setMenuId(menuId === t.id ? null : t.id); }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--muted)', fontSize: 15, padding: '0 2px',
                      lineHeight: 1, width: 20,
                    }}
                  >⋮</button>
                  {menuId === t.id && (
                    <div style={{
                      position: 'absolute', right: 0, top: '100%', zIndex: 300,
                      background: 'var(--surface)', border: '1px solid var(--line)',
                      borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                      minWidth: 130, overflow: 'hidden',
                    }} onClick={e => e.stopPropagation()}>
                      {[
                        { label: 'Edit details', action: () => { setEditTxn(t); setMenuId(null); } },
                        { label: isFlagged ? '⚑ Unflag' : '⚑ Flag for review', action: async () => { setMenuId(null); await toggleFlag(t.id, isFlagged); } },
                        { label: 'Split', action: () => { setSplitTxn(t); setMenuId(null); } },
                        { label: 'Delete', action: async () => {
                          setMenuId(null);
                          if (!confirm(`Delete "${t.merchant}"?`)) return;
                          await fetch(`/api/transactions/${t.id}`, { method: 'DELETE' });
                          window.showToast?.('Transaction deleted');
                          if (refreshFin) refreshFin();
                        }, danger: true },
                        ...(extraMenuItems ? extraMenuItems(t).map(item => ({
                          ...item,
                          action: () => { setMenuId(null); item.action(); },
                        })) : []),
                      ].map(item => (
                        <button key={item.label} onClick={item.action} style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '8px 14px', background: 'none', border: 'none',
                          cursor: 'pointer', fontSize: 13,
                          color: item.danger ? 'var(--terra, #e05c5c)' : 'var(--ink)',
                        }}
                          onMouseEnter={e => e.target.style.background = 'var(--bg)'}
                          onMouseLeave={e => e.target.style.background = 'none'}
                        >{item.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              ) : <div />}
            </div>
          );
        })}
      </div>
      {splitTxn && <SplitModal txn={splitTxn} onClose={handleSplitClose} />}
      {editTxn && <EditTransactionModal txn={editTxn} onClose={() => { setEditTxn(null); if (refreshFin) refreshFin(); }} />}
    </>
  );
}

export default TxnList;
