// Tab component — see frontend/AGENTS.md for context
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { TRANSACTIONS, CATEGORIES, ACCOUNTS, MONTHS, RECURRING, NET_WORTH_HISTORY } from '@/lib/fin';
import { fmtMoney, fmtMoney2, fmtAbbr, fmt, catById, acctById, txnsForMonth, sumByCategory, monthSummary } from '@/lib/helpers';
import { apiFetch } from '@/lib/api';
import { SummaryCard, TxnList } from '@/components';
import { DonutChart } from '@/components/charts';

export const SHARED_CATS = [
  { id: 'groceries',      name: 'Groceries',       color: '#22c55e' },
  { id: 'eating-out',     name: 'Eating Out',      color: '#f97316' },
  { id: 'transport',      name: 'Transport',       color: '#3b82f6' },
  { id: 'accommodation',  name: 'Accommodation',   color: '#8b5cf6' },
  { id: 'entertainment',  name: 'Entertainment',   color: '#ec4899' },
  { id: 'shopping',       name: 'Shopping',        color: '#f59e0b' },
  { id: 'utilities',      name: 'Utilities',       color: '#6366f1' },
  { id: 'household',      name: 'Household',       color: '#14b8a6' },
  { id: 'activities',     name: 'Activities',      color: '#84cc16' },
  { id: 'other',          name: 'Other',           color: '#94a3b8' },
];
export const SPACE_ICONS = ['✈️','🛒','🍽️','🏠','🎉','💡','🎬','📦','🏋️','🎵'];

function TripsTab({ refreshFin, finVersion }) {
  const [trips, setTrips]       = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm]         = useState({ name: '', start_date: '', end_date: '', budget: '' });
  const [saving, setSaving]     = useState(false);
  const [saveMsg, setSaveMsg]   = useState(null);
  const [selectedCat, setSelectedCat] = useState(null);
  const [sortBy, setSortBy]     = useState('date');
  const [addSearch, setAddSearch] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg]   = useState(null);

  function loadTrips() {
    apiFetch('/api/trips').then(r => r.json()).then(d => setTrips(d.trips || []));
  }
  useEffect(() => { loadTrips(); }, [finVersion]);

  const selectedTrip = trips.find(t => t.id === selectedId);

  // Derive trip transactions client-side from window.FIN.TRANSACTIONS
  const tripTxns = useMemo(() => {
    if (!selectedId) return [];
    return TRANSACTIONS.filter(t =>
      (t.tags || '').split(',').map(s => s.trim()).includes(`trip:${selectedId}`)
    );
  }, [selectedId, finVersion]);

  const expenses = useMemo(() => tripTxns.filter(t => t.amount < 0), [tripTxns]);
  const totalSpent = useMemo(() => expenses.reduce((s, t) => s - t.amount, 0), [expenses]);

  const catBreakdown = useMemo(() => {
    const map = {};
    expenses.forEach(t => {
      const c = catById(t.category);
      if (!map[t.category]) map[t.category] = { cat: t.category, name: c.name, color: c.color, amount: 0 };
      map[t.category].amount -= t.amount;
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  const dailyBreakdown = useMemo(() => {
    const map = {};
    expenses.forEach(t => {
      const d = (t.date || '').slice(0, 10);
      if (d) map[d] = (map[d] || 0) - t.amount;
    });
    return Object.entries(map).map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [expenses]);

  const topMerchants = useMemo(() => {
    const map = {};
    expenses.forEach(t => {
      const m = t.merchant || t.description || 'Unknown';
      if (!map[m]) map[m] = { name: m, amount: 0, count: 0 };
      map[m].amount -= t.amount;
      map[m].count++;
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [expenses]);

  const displayTxns = useMemo(() => {
    const arr = selectedCat ? tripTxns.filter(t => t.category === selectedCat) : [...tripTxns];
    if (sortBy === 'amount') return arr.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return arr.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [tripTxns, selectedCat, sortBy]);

  const addCandidates = useMemo(() => {
    if (!selectedId || !addSearch.trim()) return [];
    const q = addSearch.toLowerCase();
    return TRANSACTIONS
      .filter(t => !(t.tags || '').split(',').map(s => s.trim()).includes(`trip:${selectedId}`))
      .filter(t => (t.merchant || t.description || '').toLowerCase().includes(q))
      .slice(0, 20);
  }, [selectedId, addSearch, finVersion]);

  async function createTrip() {
    if (!form.name || !form.start_date || !form.end_date) return;
    setSaving(true); setSaveMsg(null);
    const res = await apiFetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, start_date: form.start_date, end_date: form.end_date,
        budget: form.budget ? parseFloat(form.budget) : null }),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) {
      setSaveMsg(`Created! ${data.auto_tagged} transaction${data.auto_tagged !== 1 ? 's' : ''} auto-tagged.`);
      setForm({ name: '', start_date: '', end_date: '', budget: '' });
      setCreating(false);
      if (refreshFin) refreshFin();
    } else {
      setSaveMsg(`Error: ${data.detail || 'Failed'}`);
    }
  }

  async function removeFromTrip(txnId) {
    await apiFetch(`/api/trips/${selectedId}/transactions/${txnId}`, { method: 'DELETE' });
    if (refreshFin) refreshFin();
  }

  async function addToTrip(txnId) {
    await apiFetch(`/api/trips/${selectedId}/transactions/${txnId}`, { method: 'POST' });
    setAddSearch('');
    if (refreshFin) refreshFin();
  }

  async function deleteTrip() {
    if (!confirm('Delete this trip? Transactions will be un-tagged but not deleted.')) return;
    await apiFetch(`/api/trips/${selectedId}`, { method: 'DELETE' });
    setSelectedId(null); setSelectedCat(null);
    if (refreshFin) refreshFin();
  }

  async function saveEdit() {
    setEditSaving(true); setEditMsg(null);
    const res = await apiFetch(`/api/trips/${selectedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    setEditSaving(false);
    if (res.ok) { setEditMode(false); loadTrips(); }
    else { const d = await res.json(); setEditMsg(d.detail || 'Failed to save'); }
  }

  const recat = async (id, cat) => {
    try {
      await fetch(`/api/transactions/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: cat }),
      });
      if (refreshFin) refreshFin();
    } catch(e) {}
  };

  const inputStyle = {
    width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--line)',
    background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit',
    outline: 'none', boxSizing: 'border-box',
  };

  // ── Detail view ──────────────────────────────────────────────────
  if (selectedId) {
    if (!selectedTrip) return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}>Loading…</div>
    );
    const trip = selectedTrip;
    const tripDays = trip.start_date && trip.end_date
      ? Math.max(1, Math.round((new Date(trip.end_date) - new Date(trip.start_date)) / 86400000) + 1) : 1;
    const budget    = trip.budget != null ? parseFloat(trip.budget) : null;
    const remaining = budget != null ? budget - totalSpent : null;
    const over      = budget != null && totalSpent > budget;
    const pct       = budget != null ? Math.min(totalSpent / budget * 100, 100) : null;
    const maxDay    = dailyBreakdown.length ? Math.max(...dailyBreakdown.map(d => d.amount), 1) : 1;

    return (
      <div className="tab-body">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <button onClick={() => { setSelectedId(null); setSelectedCat(null); setEditMode(false); }} style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
            color: 'var(--ink-3)', fontSize: 13, cursor: 'pointer', padding: '6px 0',
          }}>← Back to trips</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => {
              setEditMode(v => !v);
              setEditForm({ name: trip.name, start_date: trip.start_date, end_date: trip.end_date, budget: trip.budget ?? '' });
              setEditMsg(null);
            }} style={{
              background: 'none', border: '1px solid var(--line)', borderRadius: 8,
              padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--ink-3)',
            }}>{editMode ? 'Cancel' : 'Edit trip'}</button>
            <button onClick={deleteTrip} style={{
              background: 'none', border: '1px solid color-mix(in srgb, var(--terra) 40%, transparent)',
              color: 'var(--terra)', borderRadius: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
            }}>Delete</button>
          </div>
        </div>

        {editMode && (
          <div className="card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Edit trip</div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Name</div>
                <input value={editForm.name || ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Start date</div>
                <input type="date" value={editForm.start_date || ''} onChange={e => setEditForm(f => ({ ...f, start_date: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>End date</div>
                <input type="date" value={editForm.end_date || ''} onChange={e => setEditForm(f => ({ ...f, end_date: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Budget</div>
                <input type="number" min="0" value={editForm.budget ?? ''} placeholder="optional"
                  onChange={e => setEditForm(f => ({ ...f, budget: e.target.value ? parseFloat(e.target.value) : null }))} style={inputStyle} />
              </div>
            </div>
            {editMsg && <div style={{ fontSize: 13, color: 'var(--terra)' }}>{editMsg}</div>}
            <button onClick={saveEdit} disabled={editSaving} style={{
              alignSelf: 'flex-start', background: 'var(--accent)', color: '#052015', border: 'none',
              borderRadius: 9, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              opacity: editSaving ? 0.6 : 1,
            }}>{editSaving ? 'Saving…' : 'Save changes'}</button>
          </div>
        )}

        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{trip.name}</h2>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
            {trip.start_date} → {trip.end_date} · {tripTxns.length} transactions · {tripDays} day{tripDays !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="grid-4">
          <SummaryCard label="Total spent"   n={totalSpent}            accent="var(--terra)" />
          <SummaryCard label="Daily avg"     n={totalSpent / tripDays} accent="var(--accent)" />
          <SummaryCard label="Transactions"  value={`${tripTxns.length}`} />
          {budget != null
            ? <SummaryCard label={over ? 'Over budget' : 'Remaining'} n={Math.abs(remaining)} accent={over ? 'var(--terra)' : 'var(--green)'} />
            : <SummaryCard label="Trip days" value={`${tripDays}`} accent="var(--ink-3)" />
          }
        </div>

        {pct !== null && (
          <div className="card" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>Budget: {fmtMoney2(budget)}</span>
              <span style={{ color: over ? 'var(--terra)' : 'var(--ink-3)' }}>
                {fmtMoney2(totalSpent)} spent ({pct.toFixed(0)}%)
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--line)' }}>
              <div style={{ height: '100%', borderRadius: 4, width: `${pct}%`,
                background: over ? 'var(--terra)' : 'var(--accent)', transition: 'width .3s' }} />
            </div>
          </div>
        )}

        <div className="grid-2">
          {catBreakdown.length > 0 && (
            <div className="card">
              <div className="card-head"><h3>By category</h3></div>
              <div className="donut-row">
                <DonutChart data={catBreakdown} size={180} thickness={22} formatter={fmtMoney}
                  selectedCat={selectedCat}
                  onSliceClick={s => setSelectedCat(c => c === s.cat ? null : s.cat)} />
                <div className="donut-legend">
                  {catBreakdown.map(b => (
                    <div key={b.cat} className="legend-row"
                      style={{ cursor: 'pointer', opacity: selectedCat && selectedCat !== b.cat ? 0.4 : 1, transition: 'opacity .15s' }}
                      onClick={() => setSelectedCat(c => c === b.cat ? null : b.cat)}>
                      <span className="cat-dot" style={{ background: b.color }} />
                      <span className="legend-name">{b.name}</span>
                      <span className="legend-amt">{fmtMoney(b.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {dailyBreakdown.length > 0 && (
            <div className="card">
              <div className="card-head"><h3>Daily spending</h3></div>
              <div style={{ overflowX: 'auto', padding: '0 4px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 130, minWidth: dailyBreakdown.length * 44 }}>
                  {dailyBreakdown.map(d => (
                    <div key={d.date} style={{ flex: 1, minWidth: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{fmtMoney(d.amount)}</div>
                      <div style={{ width: '100%', borderRadius: 4, minHeight: 4,
                        height: `${Math.round((d.amount / maxDay) * 80)}px`,
                        background: 'var(--accent)', opacity: 0.85 }} />
                      <div style={{ fontSize: 10, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{d.date.slice(5)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {topMerchants.length > 0 && (
          <div className="card">
            <div className="card-head"><h3>Top merchants</h3></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {topMerchants.map((m, i) => (
                <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
                  borderBottom: i < topMerchants.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--surface)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, color: 'var(--ink-3)', fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                  <div style={{ flex: 1, fontSize: 14, color: 'var(--ink)', fontWeight: 500,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginRight: 8 }}>{m.count} txn{m.count !== 1 ? 's' : ''}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{fmtMoney2(m.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <h3>
              {selectedCat
                ? <><span className="cat-dot" style={{ background: catById(selectedCat).color, display: 'inline-block', marginRight: 6 }} />{catById(selectedCat).name}</>
                : 'Transactions'}
            </h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {['date', 'amount'].map(s => (
                <button key={s} onClick={() => setSortBy(s)} style={{
                  background: sortBy === s ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
                  border: `1px solid ${sortBy === s ? 'var(--accent)' : 'var(--line)'}`,
                  borderRadius: 6, padding: '2px 10px', fontSize: 12, cursor: 'pointer',
                  color: sortBy === s ? 'var(--accent)' : 'var(--ink-3)', fontFamily: 'inherit',
                }}>{s === 'amount' ? '$ Amount' : '📅 Date'}</button>
              ))}
              {selectedCat && (
                <button onClick={() => setSelectedCat(null)} style={{
                  background: 'none', border: '1px solid var(--line)', borderRadius: 6,
                  padding: '2px 10px', fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer',
                }}>Clear filter</button>
              )}
              <span className="muted">{displayTxns.length} transactions</span>
            </div>
          </div>
          <TxnList
            txns={displayTxns}
            compact
            presorted
            onRecategorize={recat}
            refreshFin={refreshFin}
            extraMenuItems={t => [{ label: 'Remove from trip', action: () => removeFromTrip(t.id) }]}
          />
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Add transactions</h3>
            <span className="muted">Search any transaction not yet in this trip</span>
          </div>
          <div style={{ padding: '0 0 12px' }}>
            <input value={addSearch} onChange={e => setAddSearch(e.target.value)}
              placeholder="Search by merchant name…"
              style={{ ...inputStyle, marginBottom: 8 }} />
            {addSearch.trim() && addCandidates.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 0' }}>No matching transactions found.</div>
            )}
            {addCandidates.map((t, i) => {
              const cat = catById(t.category);
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                  borderBottom: i < addCandidates.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <span className="cat-dot" style={{ background: cat.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.merchant || t.description}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{(t.date || '').slice(0, 10)} · {cat.name}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.amount < 0 ? 'var(--ink)' : 'var(--green)', flexShrink: 0 }}>
                    {t.amount < 0 ? '-' : '+'}{fmtMoney2(Math.abs(t.amount))}
                  </div>
                  <button onClick={() => addToTrip(t.id)} style={{
                    background: 'var(--accent)', color: '#052015', border: 'none', borderRadius: 7,
                    padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                  }}>+ Add</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Track spending for a trip or event</div>
        <button onClick={() => { setCreating(v => !v); setSaveMsg(null); }} style={{
          background: 'var(--accent)', color: '#052015', border: 'none', borderRadius: 10,
          padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>{creating ? 'Cancel' : '+ New Trip'}</button>
      </div>

      {creating && (
        <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>New trip</div>
          <input autoFocus value={form.name} placeholder="Trip name (e.g. Mexico City)"
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && createTrip()}
            style={inputStyle} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Start date</div>
              <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>End date</div>
              <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Budget (optional)</div>
            <input type="number" min="0" value={form.budget} placeholder="e.g. 1500"
              onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} style={inputStyle} />
          </div>
          {saveMsg && (
            <div style={{ fontSize: 13, color: saveMsg.startsWith('Error') ? 'var(--terra)' : 'var(--accent)' }}>{saveMsg}</div>
          )}
          <button onClick={createTrip} disabled={saving || !form.name || !form.start_date || !form.end_date} style={{
            background: 'var(--accent)', color: '#052015', border: 'none', borderRadius: 9,
            padding: '9px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            opacity: (saving || !form.name || !form.start_date || !form.end_date) ? 0.6 : 1,
          }}>{saving ? 'Creating…' : 'Create Trip'}</button>
        </div>
      )}

      {trips.length === 0
        ? <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✈️</div>
            <div>No trips yet. Create one to track your travel spending.</div>
          </div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {trips.map(trip => {
              const b    = trip.budget != null ? parseFloat(trip.budget) : null;
              const pct  = b ? Math.min(trip.total_spent / b * 100, 100) : null;
              const over = b && trip.total_spent > b;
              return (
                <div key={trip.id} onClick={() => { setSelectedId(trip.id); setSelectedCat(null); }} style={{
                  background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16,
                  padding: '18px 20px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{trip.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
                        {trip.start_date} → {trip.end_date}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: 17, color: over ? 'var(--terra)' : 'var(--accent)' }}>
                        {fmtMoney2(trip.total_spent)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{trip.txn_count} transactions</div>
                    </div>
                  </div>
                  {pct !== null && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>
                        <span>Budget {fmtMoney2(b)}</span>
                        <span style={{ color: over ? 'var(--terra)' : 'var(--ink-3)' }}>
                          {over ? `${fmtMoney2(trip.total_spent - b)} over` : `${fmtMoney2(b - trip.total_spent)} left`}
                        </span>
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: 'var(--line)' }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`,
                          background: over ? 'var(--terra)' : 'var(--accent)' }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}

export default TripsTab;
