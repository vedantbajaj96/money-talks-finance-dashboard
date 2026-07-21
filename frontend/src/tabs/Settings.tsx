// Tab component — see frontend/AGENTS.md for context
import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { refreshLiveCategories } from '@/components/CategoryPicker';

function SettingsCard({ title, children }) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 16,
      border: '1px solid var(--line)', padding: '24px 28px', marginBottom: 20,
    }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 20, color: 'var(--ink)' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function SettingsLabel({ children }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)', marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
      {children}
    </div>
  );
}

function StatusDot({ active }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: active ? 'var(--accent)' : 'var(--line-2)', marginRight: 6,
    }} />
  );
}

// ─── Categories Manager Card ────────────────────────────────────────────────
function CategoriesManagerCard() {
  const COLORS = ['#818cf8','#fb7185','#5ec98a','#67e8f9','#d97757','#a3e635','#fbbf24',
                  '#a78bfa','#ec4899','#22d3ee','#f97316','#e879f9','#34d399','#6b8aab','#94a3b8'];
  const SYSTEM_IDS = new Set(['transfer','savings','income']);

  const [cats, setCats]         = useState([]);
  const [editId, setEditId]     = useState(null);  // which row is open for color picker
  const [newName, setNewName]   = useState('');
  const [newColor, setNewColor] = useState('#818cf8');
  const [addErr, setAddErr]     = useState('');
  const [delErr, setDelErr]     = useState({});    // {cat_id: message}
  const [saving, setSaving]     = useState({});

  useEffect(() => {
    apiFetch('/api/categories').then(r => r.json()).then(d => {
      setCats((d.categories || []).filter(c => !SYSTEM_IDS.has(c.id)));
    });
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────
  async function patchCat(id, patch) {
    setSaving(p => ({...p, [id]: true}));
    await fetch(`/api/categories/${id}`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(patch),
    });
    setSaving(p => ({...p, [id]: false}));
    refreshLiveCategories();
  }

  function updateLocal(id, patch) {
    setCats(prev => prev.map(c => c.id === id ? {...c, ...patch} : c));
  }

  async function move(idx, dir) {
    const next = [...cats];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setCats(next);
    await apiFetch('/api/categories/reorder', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ order: next.map(c => c.id) }),
    });
    refreshLiveCategories();
  }

  async function addCat() {
    if (!newName.trim()) return;
    setAddErr('');
    const res  = await apiFetch('/api/categories', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name: newName.trim(), color: newColor, group: 'variable' }),
    });
    const data = await res.json();
    if (!res.ok) { setAddErr(data.detail || 'Failed'); return; }
    setCats(prev => [...prev, data.category]);
    setNewName(''); setNewColor('#818cf8');
    refreshLiveCategories();
  }

  async function deleteCat(id) {
    setDelErr(p => ({...p, [id]: ''}));
    const res  = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      setDelErr(p => ({...p, [id]: data.detail || 'Cannot delete'}));
      return;
    }
    setCats(prev => prev.filter(c => c.id !== id));
    refreshLiveCategories();
  }

  const rowStyle = {
    display: 'grid', gridTemplateColumns: '28px 1fr 36px 36px 28px',
    alignItems: 'center', gap: 8, padding: '8px 12px',
    borderBottom: '1px solid var(--line)',
  };

  return (
    <SettingsCard title="Categories">
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
        Click the color dot to change color. Edit the name inline. Use ↑↓ to reorder.
        Built-in categories can be renamed and recolored but not deleted.
      </div>

      <div style={{ borderRadius: 10, border: '1px solid var(--line)', overflow: 'hidden' }}>

        {cats.map((c, idx) => (
          <div key={c.id}>
            <div style={{...rowStyle, background: idx % 2 === 0 ? 'var(--bg)' : 'transparent'}}>

              {/* Color swatch — click to toggle picker */}
              <button onClick={() => setEditId(editId === c.id ? null : c.id)} style={{
                width: 22, height: 22, borderRadius: 6, background: c.color,
                border: editId === c.id ? `2px solid var(--ink)` : '2px solid transparent',
                cursor: 'pointer', flexShrink: 0,
              }} title="Change color" />

              {/* Name input */}
              <input
                defaultValue={c.name}
                onBlur={e => {
                  const v = e.target.value.trim();
                  if (v && v !== c.name) { updateLocal(c.id, {name: v}); patchCat(c.id, {name: v}); }
                }}
                style={{
                  background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit',
                  fontWeight: 500, width: '100%',
                }}
              />

              {/* Up / Down */}
              <button onClick={() => move(idx, -1)} disabled={idx === 0} style={{
                background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer',
                color: idx === 0 ? 'var(--line-2)' : 'var(--muted)', fontSize: 14, padding: 0,
              }}>↑</button>
              <button onClick={() => move(idx, 1)} disabled={idx === cats.length - 1} style={{
                background: 'none', border: 'none',
                cursor: idx === cats.length - 1 ? 'default' : 'pointer',
                color: idx === cats.length - 1 ? 'var(--line-2)' : 'var(--muted)', fontSize: 14, padding: 0,
              }}>↓</button>

              {/* Delete button — server blocks if transactions exist */}
              <button onClick={() => deleteCat(c.id)} title="Remove category" style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--muted)', fontSize: 16, padding: 0, lineHeight: 1,
              }}>×</button>
            </div>

            {/* Inline color picker */}
            {editId === c.id && (
              <div style={{
                padding: '10px 12px', background: 'var(--surface)',
                borderBottom: '1px solid var(--line)',
                display: 'flex', flexWrap: 'wrap', gap: 6,
              }}>
                {COLORS.map(col => (
                  <button key={col} onClick={() => {
                    updateLocal(c.id, {color: col});
                    patchCat(c.id, {color: col});
                    setEditId(null);
                  }} style={{
                    width: 24, height: 24, borderRadius: 6, background: col, border: 'none',
                    cursor: 'pointer', outline: c.color === col ? `2px solid ${col}` : 'none',
                    outlineOffset: 2, opacity: c.color === col ? 1 : 0.65,
                  }} />
                ))}
              </div>
            )}

            {/* Delete error */}
            {delErr[c.id] && (
              <div style={{
                padding: '6px 12px', fontSize: 12, color: '#ef4444',
                background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid var(--line)',
              }}>⚠ {delErr[c.id]}</div>
            )}
          </div>
        ))}

        {/* Add new row */}
        <div style={{...rowStyle, gridTemplateColumns: '28px 1fr auto', background: 'var(--surface)'}}>
          <button onClick={() => setEditId(editId === '__new__' ? null : '__new__')} style={{
            width: 22, height: 22, borderRadius: 6, background: newColor,
            border: editId === '__new__' ? '2px solid var(--ink)' : '2px solid transparent',
            cursor: 'pointer', flexShrink: 0,
          }} />
          <input
            value={newName} onChange={e => { setNewName(e.target.value); setAddErr(''); }}
            onKeyDown={e => e.key === 'Enter' && addCat()}
            placeholder="Add a category…"
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              fontSize: 14, color: 'var(--ink)', fontFamily: 'inherit',
              fontWeight: 400, width: '100%',
            }}
          />
          <button onClick={addCat} disabled={!newName.trim()} style={{
            background: newName.trim() ? 'var(--accent)' : 'var(--line)',
            color: newName.trim() ? '#052015' : 'var(--muted)',
            border: 'none', borderRadius: 8, padding: '5px 12px',
            fontSize: 12, fontWeight: 600, cursor: newName.trim() ? 'pointer' : 'default',
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}>Add</button>
        </div>

        {editId === '__new__' && (
          <div style={{
            padding: '10px 12px', background: 'var(--surface)',
            borderTop: '1px solid var(--line)',
            display: 'flex', flexWrap: 'wrap', gap: 6,
          }}>
            {COLORS.map(col => (
              <button key={col} onClick={() => { setNewColor(col); setEditId(null); }} style={{
                width: 24, height: 24, borderRadius: 6, background: col, border: 'none',
                cursor: 'pointer', outline: newColor === col ? `2px solid ${col}` : 'none',
                outlineOffset: 2, opacity: newColor === col ? 1 : 0.65,
              }} />
            ))}
          </div>
        )}

        {addErr && (
          <div style={{ padding: '6px 12px', fontSize: 12, color: '#ef4444',
            background: 'rgba(239,68,68,0.06)' }}>⚠ {addErr}</div>
        )}
      </div>
    </SettingsCard>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────
const NOTIFICATION_SUBS = [
  { key: 'market_drop',     label: 'Market drop alert',      desc: 'Email when SPY falls your threshold in a day — DCA signal' },
  { key: 'portfolio_drop',  label: 'Portfolio drop alert',   desc: 'Email when your Wealthfront value drops your threshold' },
  { key: 'daily_brief',     label: 'Daily market brief',     desc: 'AI-written market summary every morning (7–10am)' },
  { key: 'monthly_digest',  label: 'Monthly portfolio digest', desc: 'End-of-month recap: portfolio vs SPY, fees, AI summary' },
];

function NotificationsCard() {
  const [alertEmail,    setAlertEmail]    = useState('');
  const [dropThreshold, setDropThreshold] = useState('1.5');
  const [portThreshold, setPortThreshold] = useState('3.0');
  const [subs,          setSubs]          = useState({});   // { market_drop: true, ... }
  const [saving,        setSaving]        = useState(false);
  const [saved,         setSaved]         = useState(false);
  const [testStatus,    setTestStatus]    = useState(null);
  const [testMsg,       setTestMsg]       = useState('');

  useEffect(() => {
    apiFetch('/api/config').then(r => r.json()).then(d => {
      setAlertEmail(d.alert_email || '');
      setDropThreshold(String(d.market_drop_threshold ?? 1.5));
      setPortThreshold(String(d.portfolio_drop_threshold ?? 3.0));
      setSubs({
        market_drop:    !!d.notify_market_drop,
        portfolio_drop: !!d.notify_portfolio_drop,
        daily_brief:    !!d.daily_brief_enabled,
        monthly_digest: !!d.monthly_digest_enabled,
      });
    });
  }, []);

  async function save() {
    setSaving(true);
    await apiFetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alert_email:              alertEmail.trim() || null,
        market_drop_threshold:    parseFloat(dropThreshold) || 1.5,
        portfolio_drop_threshold: parseFloat(portThreshold) || 3.0,
        notify_market_drop:    !!subs.market_drop,
        notify_portfolio_drop: !!subs.portfolio_drop,
        daily_brief_enabled:   !!subs.daily_brief,
        monthly_digest_enabled:!!subs.monthly_digest,
      }),
    });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function sendTestEmail() {
    setTestStatus('sending'); setTestMsg('');
    try {
      const res  = await apiFetch('/api/notifications/test', { method: 'POST' });
      const data = await res.json();
      if (res.ok) { setTestStatus('ok');    setTestMsg(`Sent to ${data.sent_to}`); }
      else        { setTestStatus('error'); setTestMsg(data.detail || 'Failed'); }
    } catch(e) { setTestStatus('error'); setTestMsg(String(e)); }
    setTimeout(() => { setTestStatus(null); setTestMsg(''); }, 4000);
  }

  const FieldLabel = ({ children }) => (
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 6 }}>{children}</div>
  );

  return (
    <SettingsCard title="Notifications">
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
          AI-powered email alerts sent from the MoneyTalks account. Enter your personal email below to receive them.
        </div>

        <div>
          <FieldLabel>Your Email (receive alerts here)</FieldLabel>
          <input value={alertEmail} onChange={e => setAlertEmail(e.target.value)}
            placeholder="you@gmail.com" type="email"
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-3)', color: 'var(--ink)', fontSize: 13, boxSizing: 'border-box' }} />
        </div>

        {/* Subscription toggles */}
        <div style={{ background: 'var(--surface-3)', borderRadius: 10, overflow: 'hidden' }}>
          {NOTIFICATION_SUBS.map(({ key, label, desc }, i) => (
            <div key={key} onClick={() => setSubs(p => ({ ...p, [key]: !p[key] }))} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
              borderTop: i > 0 ? '1px solid var(--line)' : 'none', cursor: 'pointer',
            }}>
              {/* Checkbox */}
              <div style={{
                width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                border: `2px solid ${subs[key] ? 'var(--accent)' : 'var(--line-2)'}`,
                background: subs[key] ? 'var(--accent)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {subs[key] && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{label}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Thresholds — only show if relevant subs are on */}
        {(subs.market_drop || subs.portfolio_drop) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {subs.market_drop && (
              <div>
                <FieldLabel>Alert me when SPY drops more than…</FieldLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input value={dropThreshold} onChange={e => setDropThreshold(e.target.value)}
                    type="number" step="0.1" min="0.1"
                    style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-3)', color: 'var(--ink)', fontSize: 13 }} />
                  <span style={{ fontSize: 13, color: 'var(--ink-3)', flexShrink: 0 }}>% in a day</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {['0.5', '1', '1.5', '2', '3'].map(v => (
                    <button key={v} onClick={() => setDropThreshold(v)} style={{
                      padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                      borderColor: dropThreshold === v ? 'var(--accent)' : 'var(--line)',
                      background: dropThreshold === v ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                      color: dropThreshold === v ? 'var(--accent)' : 'var(--ink-3)',
                    }}>{v}%</button>
                  ))}
                </div>
              </div>
            )}
            {subs.portfolio_drop && (
              <div>
                <FieldLabel>Alert me when my portfolio drops more than…</FieldLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input value={portThreshold} onChange={e => setPortThreshold(e.target.value)}
                    type="number" step="0.1" min="0.1"
                    style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface-3)', color: 'var(--ink)', fontSize: 13 }} />
                  <span style={{ fontSize: 13, color: 'var(--ink-3)', flexShrink: 0 }}>% in a day</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {['1', '2', '3', '5', '7'].map(v => (
                    <button key={v} onClick={() => setPortThreshold(v)} style={{
                      padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                      borderColor: portThreshold === v ? 'var(--accent)' : 'var(--line)',
                      background: portThreshold === v ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                      color: portThreshold === v ? 'var(--accent)' : 'var(--ink-3)',
                    }}>{v}%</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
          <button onClick={save} disabled={saving} style={{
            background: 'var(--accent)', color: '#052015', border: 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer', opacity: saving ? 0.6 : 1,
          }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
          <button onClick={sendTestEmail} disabled={testStatus === 'sending'} style={{
            background: 'var(--surface-3)', color: 'var(--ink-2)', border: '1px solid var(--line)',
            borderRadius: 10, padding: '11px 18px', fontWeight: 600, fontSize: 13,
            fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            {testStatus === 'sending' ? 'Sending…' : 'Send Test'}
          </button>
        </div>

        {testMsg && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: testStatus === 'ok' ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'color-mix(in srgb, var(--terra) 10%, transparent)',
            color: testStatus === 'ok' ? 'var(--accent)' : 'var(--terra)',
            border: `1px solid ${testStatus === 'ok' ? 'var(--accent)' : 'var(--terra)'}`,
          }}>{testMsg}</div>
        )}
      </div>
    </SettingsCard>
  );
}

function PlaidSyncCard({ onSync, syncing: appSyncing }: { onSync?: (full?: boolean) => void; syncing?: boolean }) {
  const [syncing, setSyncing]             = useState(false);
  const [result,  setResult]             = useState(null);
  const [backfilling, setBackfilling]    = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);

  const isSyncing = appSyncing || syncing;

  async function sync(full = false) {
    // Full re-sync uses the app-level handler (shows full-screen overlay)
    if (full && onSync) { onSync(true); return; }
    setSyncing(true); setResult(null);
    try {
      const res  = await apiFetch('/api/plaid/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full }),
      });
      const data = await res.json();
      setResult({ ...data, full });
      if (data.ok && (data.stats?.added > 0 || data.stats?.modified > 0 || data.stats?.removed > 0)) {
        setTimeout(() => { if (refreshFin) refreshFin(); }, 1200);
      }
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setSyncing(false);
    }
  }

  async function backfillLocations() {
    setBackfilling(true); setBackfillResult(null);
    try {
      const res  = await apiFetch('/api/plaid/backfill-locations', { method: 'POST' });
      const data = await res.json();
      setBackfillResult(data);
      if (data.ok && data.updated > 0) setTimeout(() => { if (refreshFin) refreshFin(); }, 1200);
    } catch (e) {
      setBackfillResult({ ok: false, error: String(e) });
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <SettingsCard title="Plaid — Sync Transactions">
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
          Pull the latest transactions from all your linked bank accounts.
          <strong> Sync now</strong> fetches only new changes (fast).
          <strong> Full re-sync</strong> re-pulls your entire history.
        </div>

        {result && (
          <div style={{
            padding: '12px 16px', borderRadius: 10, fontSize: 13,
            background: result.ok ? 'rgba(94,201,138,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${result.ok ? 'rgba(94,201,138,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: result.ok ? 'var(--ink)' : '#f87171',
          }}>
            {result.ok
              ? `✓ ${result.full ? 'Full re-sync' : 'Synced'} — ${result.stats?.added ?? 0} new, ${result.stats?.modified ?? 0} updated, ${result.stats?.removed ?? 0} removed`
              : `⚠ ${result.error || 'Sync failed'}`}
            {result.ok && result.errors?.length > 0 && (
              <div style={{ marginTop: 6, color: 'var(--ink-3)' }}>
                {result.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => sync(false)} disabled={isSyncing || backfilling} style={{
            flex: 1, background: isSyncing ? 'var(--surface-2)' : 'var(--accent)',
            color: isSyncing ? 'var(--ink-3)' : '#052015', border: isSyncing ? '1px solid var(--line)' : 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: isSyncing ? 'default' : 'pointer',
            transition: 'all 0.2s',
          }}>{isSyncing ? '⏳ Syncing…' : 'Sync now'}</button>
          <button onClick={() => sync(true)} disabled={isSyncing || backfilling} style={{
            flex: 1, background: isSyncing ? 'var(--surface-2)' : 'transparent',
            color: isSyncing ? 'var(--ink-3)' : 'var(--ink-2)',
            border: '1px solid var(--line)', borderRadius: 10, padding: '11px 0',
            fontWeight: 500, fontSize: 14, fontFamily: 'inherit',
            cursor: isSyncing ? 'default' : 'pointer',
            transition: 'all 0.2s',
          }}>Full re-sync</button>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            Backfill location data (📍 city/coordinates) for existing transactions. A backup is created first.
          </div>
          {backfillResult && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 12, marginBottom: 8,
              background: backfillResult.ok ? 'rgba(94,201,138,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${backfillResult.ok ? 'rgba(94,201,138,0.3)' : 'rgba(239,68,68,0.3)'}`,
              color: backfillResult.ok ? 'var(--ink)' : '#f87171',
            }}>
              {backfillResult.ok
                ? `✓ Updated location on ${backfillResult.updated} transaction${backfillResult.updated !== 1 ? 's' : ''}`
                : `⚠ ${backfillResult.error || 'Failed'}`}
            </div>
          )}
          <button onClick={backfillLocations} disabled={isSyncing || backfilling} style={{
            background: 'transparent', color: 'var(--muted)',
            border: '1px solid var(--line)', borderRadius: 8, padding: '8px 16px',
            fontWeight: 500, fontSize: 13, fontFamily: 'inherit',
            cursor: backfilling ? 'default' : 'pointer', opacity: backfilling ? 0.6 : 1,
          }}>{backfilling ? 'Fetching locations…' : '📍 Backfill locations'}</button>
        </div>
      </div>
    </SettingsCard>
  );
}

function SettingsTab({ refreshFin, onSync, syncing }: { refreshFin?: () => void; onSync?: (full?: boolean) => void; syncing?: boolean }) {
  const [dragging, setDragging]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [uploadResult, setUpload]   = useState(null);
  const fileRef = useRef();

  const [cfg, setCfg]               = useState(null);
  const [claudeKey, setClaudeKey]   = useState('');
  const [geminiKey, setGeminiKey]   = useState('');
  const [provider, setProvider]     = useState('claude');
  const [plaidId, setPlaidId]             = useState('');
  const [plaidSecret, setPlaidSecret]     = useState('');
  const [plaidEnv, setPlaidEnv]           = useState('sandbox');
  const [plaidRedirect, setPlaidRedirect] = useState('');
  const [saving, setSaving]               = useState(false);
  const [saved, setSaved]                 = useState(false);
  const [repairing, setRepairing]         = useState(false);
  const [repairResult, setRepairResult]   = useState(null);
  const [syncInterval, setSyncInterval]             = useState(0);
  const [autoInvestSnapshot, setAutoInvestSnapshot] = useState(false);

  useEffect(() => {
    apiFetch('/api/config').then(r => r.json()).then(d => {
      setCfg(d);
      setProvider(d.preferred_provider || 'claude');
      if (d.plaid_environment) setPlaidEnv(d.plaid_environment);
      if (d.plaid_redirect_uri) setPlaidRedirect(d.plaid_redirect_uri);
      setSyncInterval(d.auto_sync_interval || 0);
      setAutoInvestSnapshot(!!d.auto_investment_snapshot);
    });
  }, []);

  async function handleFile(file) {
    if (!file || !file.name.endsWith('.csv')) {
      setUpload({ error: 'Please upload a CSV file.' });
      return;
    }
    setUploading(true);
    setUpload(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await apiFetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) setUpload({ error: data.detail || 'Upload failed' });
      else setUpload(data);
    } catch (e) {
      setUpload({ error: String(e) });
    } finally {
      setUploading(false);
    }
  }

  async function saveConfig() {
    setSaving(true);
    const body = { preferred_provider: provider, plaid_environment: plaidEnv, auto_sync_interval: syncInterval };
    if (claudeKey)    body.anthropic_api_key  = claudeKey;
    if (geminiKey)    body.gemini_api_key     = geminiKey;
    if (plaidId)      body.plaid_client_id    = plaidId;
    if (plaidSecret)  body.plaid_secret       = plaidSecret;
    body.plaid_redirect_uri = plaidRedirect.trim() || null;
    await apiFetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    setSaved(true);
    setCfg(prev => ({
      ...prev,
      has_anthropic: !!(claudeKey || prev?.has_anthropic),
      has_gemini:    !!(geminiKey  || prev?.has_gemini),
      has_plaid:     !!(plaidId   || prev?.has_plaid),
      preferred_provider: provider,
      plaid_environment:  plaidEnv,
    }));
    setClaudeKey(''); setGeminiKey(''); setPlaidId(''); setPlaidSecret('');
    setTimeout(() => setSaved(false), 2500);
  }

  // Card, Label, StatusDot are defined outside this function (above) so
  // React doesn't remount them — and their children — on every state change.
  const Card = SettingsCard;
  const Label = SettingsLabel;

  return (
    <div style={{ maxWidth: 640, padding: '8px 0' }}>
      <Card title="Upload Bank CSV">
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current.click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 12, padding: '36px 24px', textAlign: 'center',
            cursor: 'pointer', transition: 'border-color 0.15s',
            background: dragging ? 'color-mix(in srgb, var(--accent) 5%, transparent)' : 'var(--bg)',
          }}
        >
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
          <div style={{ fontSize: 28, marginBottom: 10 }}>📂</div>
          {uploading
            ? <div style={{ color: 'var(--muted)', fontSize: 14 }}>Processing…</div>
            : <>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: 'var(--text)' }}>
                  Drop a CSV here or click to browse
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Supports Chase Bank, Chase Credit Card, and Amex
                </div>
              </>
          }
        </div>

        {uploadResult && (
          <div style={{
            marginTop: 16, padding: '14px 18px', borderRadius: 10,
            background: uploadResult.error
              ? 'color-mix(in srgb, #ef4444 8%, transparent)'
              : 'color-mix(in srgb, var(--accent) 8%, transparent)',
            border: `1px solid ${uploadResult.error ? '#ef4444' : 'var(--accent)'}`,
            fontSize: 14,
          }}>
            {uploadResult.error
              ? <span style={{ color: '#ef4444' }}>⚠ {uploadResult.error}</span>
              : <div style={{ color: 'var(--text)' }}>
                  <strong>✓ {uploadResult.format?.replace('_', ' ')} uploaded</strong>
                  <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 13 }}>
                    {uploadResult.new} new · {uploadResult.duplicates} duplicates skipped · {uploadResult.total} total on file
                  </div>
                </div>
            }
          </div>
        )}
      </Card>

      <Card title="Plaid — Linked Bank Accounts">
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <Label><StatusDot active={cfg?.has_plaid} />Client ID {cfg?.has_plaid ? '(saved)' : '(not set)'}</Label>
            <input type="password" value={plaidId} onChange={e => setPlaidId(e.target.value)}
              placeholder="Plaid client_id"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
                border: '1px solid var(--border)', fontSize: 14, fontFamily: 'inherit',
                background: 'var(--bg)', color: 'var(--text)', outline: 'none' }} />
          </div>
          <div>
            <Label>Secret</Label>
            <input type="password" value={plaidSecret} onChange={e => setPlaidSecret(e.target.value)}
              placeholder="Plaid secret"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
                border: '1px solid var(--border)', fontSize: 14, fontFamily: 'inherit',
                background: 'var(--bg)', color: 'var(--text)', outline: 'none' }} />
          </div>
          <div>
            <Label>Environment</Label>
            <div style={{ display: 'flex', gap: 10 }}>
              {['sandbox', 'production'].map(env => (
                <button key={env} onClick={() => setPlaidEnv(env)} style={{
                  flex: 1, padding: '9px 0', borderRadius: 9, fontSize: 14,
                  fontFamily: 'inherit', cursor: 'pointer', fontWeight: 500,
                  border: plaidEnv === env ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: plaidEnv === env ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--bg)',
                  color: plaidEnv === env ? 'var(--accent)' : 'var(--muted)',
                }}>
                  {env.charAt(0).toUpperCase() + env.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>OAuth Redirect URI <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(required for AMEX, Chase, BofA, Capital One)</span></Label>
            <input type="text" value={plaidRedirect} onChange={e => setPlaidRedirect(e.target.value)}
              placeholder="https://your-domain.com/oauth_callback"
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
                border: '1px solid var(--border)', fontSize: 14, fontFamily: 'inherit',
                background: 'var(--bg)', color: 'var(--text)', outline: 'none' }} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, lineHeight: 1.5 }}>
              Must match a URI registered in Plaid Dashboard → Developers → API → Allowed Redirect URIs.
              Use <code>ngrok http 8502</code> for a quick HTTPS URL, or Tailscale.
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            Get your keys from <strong>dashboard.plaid.com</strong> → Team Settings → Keys.
            Use Sandbox for testing, Production for real bank connections.
          </div>
          <button onClick={saveConfig} disabled={saving} style={{
            background: 'var(--accent)', color: '#052015', border: 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer', opacity: saving ? 0.6 : 1, width: '100%',
          }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Plaid keys'}
          </button>
        </div>
      </Card>

      <PlaidSyncCard onSync={onSync} syncing={syncing} />

      <Card title="Auto-Sync Schedule">
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            Automatically sync your accounts in the background. New transactions will appear in the Review tab when you next open the app.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { value: 0,  label: 'Off' },
              { value: 6,  label: 'Every 6h' },
              { value: 12, label: 'Every 12h' },
              { value: 24, label: 'Every 24h' },
            ].map(({ value, label }) => (
              <button key={value} onClick={() => setSyncInterval(value)} style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', border: '1px solid',
                borderColor: syncInterval === value ? 'var(--accent)' : 'var(--line)',
                background: syncInterval === value ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surface-3)',
                color: syncInterval === value ? 'var(--accent)' : 'var(--ink-3)',
              }}>{label}</button>
            ))}
          </div>
          <button onClick={async () => {
            setSaving(true);
            await apiFetch('/api/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ auto_sync_interval: syncInterval }),
            });
            setSaving(false); setSaved(true);
            setTimeout(() => setSaved(false), 2500);
          }} disabled={saving} style={{
            background: 'var(--accent)', color: '#052015', border: 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer', opacity: saving ? 0.6 : 1, width: '100%',
          }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </Card>

      <Card title="Investment Snapshot">
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            Record your portfolio value once a day in the background. Builds the historical chart on the Investments tab.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ value: false, label: 'Off' }, { value: true, label: 'Daily' }].map(({ value, label }) => (
              <button key={label} onClick={() => setAutoInvestSnapshot(value)} style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', border: '1px solid',
                borderColor: autoInvestSnapshot === value ? 'var(--accent)' : 'var(--line)',
                background: autoInvestSnapshot === value ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surface-3)',
                color: autoInvestSnapshot === value ? 'var(--accent)' : 'var(--ink-3)',
              }}>{label}</button>
            ))}
          </div>
          <button onClick={async () => {
            setSaving(true);
            await apiFetch('/api/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ auto_investment_snapshot: autoInvestSnapshot }),
            });
            setSaving(false); setSaved(true);
            setTimeout(() => setSaved(false), 2500);
          }} disabled={saving} style={{
            background: 'var(--accent)', color: '#052015', border: 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer', opacity: saving ? 0.6 : 1, width: '100%',
          }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </Card>

      <NotificationsCard />

      <CategoriesManagerCard />

      <Card title="Data Quality">
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
            Fixes corrupted column types, derives missing income/expense labels from
            amounts, and runs AI categorization on any uncategorized transactions.
          </div>

          {repairResult && (
            <div style={{
              padding: '12px 16px', borderRadius: 10, fontSize: 13,
              background: repairResult.ok
                ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
                : 'color-mix(in srgb, #ef4444 8%, transparent)',
              border: `1px solid ${repairResult.ok ? 'var(--accent)' : '#ef4444'}`,
            }}>
              {repairResult.ok ? (
                <div style={{ color: 'var(--text)' }}>
                  ✓ Repaired {repairResult.total} transactions
                  <div style={{ marginTop: 4, color: 'var(--muted)' }}>
                    {repairResult.type_fixed} type labels fixed ·{' '}
                    {repairResult.llm_categorized} of {repairResult.pending_before} uncategorized rows classified
                  </div>
                </div>
              ) : (
                <span style={{ color: '#ef4444' }}>⚠ {repairResult.error}</span>
              )}
            </div>
          )}

          <button onClick={async () => {
            setRepairing(true); setRepairResult(null);
            try {
              const res = await apiFetch('/api/repair', { method: 'POST' });
              setRepairResult(await res.json());
            } catch (e) { setRepairResult({ ok: false, error: String(e) }); }
            finally { setRepairing(false); }
          }} disabled={repairing} style={{
            background: 'var(--accent)', color: '#052015', border: 'none',
            borderRadius: 10, padding: '11px 0', fontWeight: 600, fontSize: 14,
            fontFamily: 'inherit', cursor: repairing ? 'default' : 'pointer',
            opacity: repairing ? 0.6 : 1, width: '100%',
          }}>
            {repairing ? 'Repairing…' : 'Repair data'}
          </button>
        </div>
      </Card>

    </div>
  );
}

export default SettingsTab;
export { PlaidSyncCard, SettingsCard, SettingsLabel, StatusDot, CategoriesManagerCard, NotificationsCard };
