// App shell — ported from moneytalks/app.jsx
import React, { Component, useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { MONTHS, TRANSACTIONS, _populate } from '@/lib/fin';
import { apiFetch } from '@/lib/api';
import { useTweaks, TweaksPanel, TweakSection, TweakToggle, TweakRadio } from '@/components/TweaksPanel';
import TabSkeleton from '@/components/TabSkeleton';
import VerifyModal from '@/components/modals/VerifyModal';

// ── Lazy tab imports ─────────────────────────────────────────────
const MonthlyTab    = lazy(() => import('@/tabs/Overview'));
const OverviewTab   = lazy(() => import('@/tabs/OverviewWidgets'));
const TransactionsTab = lazy(() => import('@/tabs/Transactions'));
const ReviewTab     = lazy(() => import('@/tabs/Review'));
const TripsTab      = lazy(() => import('@/tabs/Trips'));
const SharedTab     = lazy(() => import('@/tabs/Shared'));
const ChatTab       = lazy(() => import('@/tabs/Chat'));
const FlaggedTab    = lazy(() => import('@/tabs/Flagged'));
const FeedbackTab   = lazy(() => import('@/tabs/Flagged').then(m => ({ default: m.FeedbackTab })));
const SettingsTab   = lazy(() => import('@/tabs/Settings'));
const AdminTab      = lazy(() => import('@/tabs/Admin'));
const InvestmentsTab = lazy(() => import('@/tabs/Investments'));
const NetWorthTab   = lazy(() => import('@/tabs/Wealth'));
const AccountsTab   = lazy(() => import('@/tabs/Wealth').then(m => ({ default: m.AccountsTab })));
const RecurringTab  = lazy(() => import('@/tabs/Wealth').then(m => ({ default: m.RecurringTab })));
const SpendingTab   = lazy(() => import('@/tabs/Spending'));
const FlowTab       = lazy(() => import('@/tabs/Spending').then(m => ({ default: m.FlowTab })));
const CashFlowTab   = lazy(() => import('@/tabs/Spending').then(m => ({ default: m.CashFlowTab })));
const CategoriesTab = lazy(() => import('@/tabs/Analysis').then(m => ({ default: m.CategoriesTab })));
const TrendsTab     = lazy(() => import('@/tabs/Analysis').then(m => ({ default: m.TrendsTab })));

// ── Helpers ──────────────────────────────────────────────────────
function avatarColor(name: string) {
  const palette = ['#5ec98a','#67e8f9','#a78bfa','#fbbf24','#f97316','#ec4899','#d97757'];
  let h = 0;
  for (const c of (name || '')) h = ((h << 5) - h) + c.charCodeAt(0);
  return palette[Math.abs(h) % palette.length];
}

// ── Profile panel ─────────────────────────────────────────────────
function ProfilePanel({ me, onClose, onDisplayNameChange }: { me: any; onClose: () => void; onDisplayNameChange?: (name: string) => void }) {
  const [section, setSection] = useState<string | null>(null);
  const [users,   setUsers]   = useState<any[] | null>(null);
  const [draftName, setDraftName] = useState('');
  const [nameBusy,  setNameBusy]  = useState<boolean | 'error'>(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg,  setPwMsg]  = useState<{ ok?: boolean; error?: string } | null>(null);
  const [uname,   setUname]   = useState('');
  const [upass,   setUpass]   = useState('');
  const [uadmin,  setUadmin]  = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg,  setAddMsg]  = useState<{ ok?: boolean; error?: string } | null>(null);

  useEffect(() => {
    if (section === 'family' && users === null) {
      apiFetch('/api/auth/users').then(r => r.json()).then(d => setUsers(d.users || []));
    }
  }, [section]);

  async function changePassword() {
    if (!oldPw || !newPw) return;
    setPwBusy(true); setPwMsg(null);
    const res = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
    });
    const d = await res.json();
    setPwBusy(false);
    if (res.ok) { setPwMsg({ ok: true }); setOldPw(''); setNewPw(''); }
    else setPwMsg({ error: d.detail || 'Failed' });
  }

  async function addUser() {
    if (!uname || !upass) return;
    setAddBusy(true); setAddMsg(null);
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uname, password: upass, is_admin: uadmin }),
    });
    const d = await res.json();
    setAddBusy(false);
    if (res.ok) {
      setAddMsg({ ok: true });
      setUname(''); setUpass(''); setUadmin(false);
      apiFetch('/api/auth/users').then(r => r.json()).then(d2 => setUsers(d2.users || []));
    } else {
      setAddMsg({ error: d.detail || 'Failed' });
    }
  }

  async function deleteUser(username: string) {
    if (!confirm(`Remove "${username}"?`)) return;
    await fetch(`/api/auth/users/${username}`, { method: 'DELETE' });
    setUsers(prev => prev ? prev.filter(u => u.username !== username) : prev);
  }

  async function saveDisplayName() {
    if (!draftName.trim()) return;
    setNameBusy(true);
    const res = await apiFetch('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: draftName.trim() }),
    });
    setNameBusy(res.ok ? false : 'error');
    if (res.ok) {
      setSection(null);
      onDisplayNameChange && onDisplayNameChange(draftName.trim());
    }
  }

  const displayName = me?.display_name || me?.username || '?';
  const color       = avatarColor(me?.username || '');
  const initial     = displayName[0].toUpperCase();

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--line)',
    background: 'var(--bg)', color: 'var(--ink)', fontSize: 13,
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  };
  const btnStyle = (primary: boolean): React.CSSProperties => ({
    width: '100%', padding: '9px 0', borderRadius: 9, border: primary ? 'none' : '1px solid var(--line)',
    background: primary ? 'var(--accent)' : 'transparent',
    color: primary ? '#052015' : 'var(--ink-2)',
    fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
  });
  const msgStyle = (ok: boolean): React.CSSProperties => ({
    padding: '8px 12px', borderRadius: 8, fontSize: 12, marginTop: 8,
    background: ok ? 'rgba(94,201,138,0.1)' : 'rgba(239,68,68,0.08)',
    border: `1px solid ${ok ? 'rgba(94,201,138,0.3)' : 'rgba(239,68,68,0.3)'}`,
    color: ok ? 'var(--ink)' : '#f87171',
  });

  return (
    <div className="profile-panel">
      <div className="profile-header">
        <div className="profile-avatar" style={{ background: color }}>{initial}</div>
        <div>
          <div className="profile-name">{displayName}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>@{me?.username}</div>
          {me?.is_admin && <div className="profile-badge">Admin</div>}
        </div>
      </div>

      <div className="profile-divider" />

      <div className="profile-sections">
        <button className="profile-section-btn" onClick={() => { setDraftName(displayName); setSection(s => s === 'name' ? null : 'name'); }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Edit display name
          <span className="profile-chevron" style={{ transform: section === 'name' ? 'rotate(90deg)' : '' }}>›</span>
        </button>

        {section === 'name' && (
          <div className="profile-section-body">
            <input autoFocus value={draftName} onChange={e => setDraftName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveDisplayName(); if (e.key === 'Escape') setSection(null); }}
              placeholder="Your display name" style={inputStyle} />
            {nameBusy === 'error' && <div style={msgStyle(false)}>⚠ Failed to save</div>}
            <button onClick={saveDisplayName}
              disabled={nameBusy === true || !draftName.trim() || draftName.trim() === displayName}
              style={{ ...btnStyle(true), marginTop: 2, opacity: (!draftName.trim() || draftName.trim() === displayName) ? 0.6 : 1 }}>
              {nameBusy === true ? 'Saving…' : 'Save name'}
            </button>
          </div>
        )}

        <button className="profile-section-btn" onClick={() => setSection(s => s === 'password' ? null : 'password')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Change password
          <span className="profile-chevron" style={{ transform: section === 'password' ? 'rotate(90deg)' : '' }}>›</span>
        </button>

        {section === 'password' && (
          <div className="profile-section-body">
            <input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)}
              placeholder="Current password" style={{ ...inputStyle, marginBottom: 8 }} />
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
              placeholder="New password" style={{ ...inputStyle, marginBottom: 10 }} />
            {pwMsg && <div style={msgStyle(!!pwMsg.ok)}>{pwMsg.ok ? '✓ Password updated' : `⚠ ${pwMsg.error}`}</div>}
            <button onClick={changePassword} disabled={pwBusy || !oldPw || !newPw}
              style={{ ...btnStyle(true), marginTop: 8, opacity: (pwBusy || !oldPw || !newPw) ? 0.6 : 1 }}>
              {pwBusy ? 'Updating…' : 'Update password'}
            </button>
          </div>
        )}

        {me?.is_admin && (
          <>
            <button className="profile-section-btn" onClick={() => setSection(s => s === 'family' ? null : 'family')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              Manage family
              <span className="profile-chevron" style={{ transform: section === 'family' ? 'rotate(90deg)' : '' }}>›</span>
            </button>

            {section === 'family' && (
              <div className="profile-section-body">
                {(users || []).map(u => (
                  <div key={u.username} className="profile-user-row">
                    <div className="profile-user-dot" style={{ background: avatarColor(u.username) }}>
                      {u.username[0].toUpperCase()}
                    </div>
                    <span className="profile-user-name">{u.username}</span>
                    {u.is_admin && <span className="profile-admin-pill">admin</span>}
                    {u.username !== me.username && (
                      <button className="profile-remove-btn" onClick={() => deleteUser(u.username)}>✕</button>
                    )}
                  </div>
                ))}
                <div style={{ marginTop: 14, display: 'grid', gap: 7 }}>
                  <input value={uname} onChange={e => setUname(e.target.value)}
                    placeholder="New username" style={inputStyle} />
                  <input type="password" value={upass} onChange={e => setUpass(e.target.value)}
                    placeholder="Password" style={inputStyle} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={uadmin} onChange={e => setUadmin(e.target.checked)} />
                    Make admin
                  </label>
                  {addMsg && <div style={msgStyle(!!addMsg.ok)}>{addMsg.ok ? '✓ Created' : `⚠ ${addMsg.error}`}</div>}
                  <button onClick={addUser} disabled={addBusy || !uname || !upass}
                    style={{ ...btnStyle(true), opacity: (addBusy || !uname || !upass) ? 0.6 : 1 }}>
                    {addBusy ? 'Creating…' : 'Add member'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="profile-divider" />

      <div style={{ padding: '8px 16px 16px' }}>
        <button style={btnStyle(false)} onClick={async () => {
          await apiFetch('/api/auth/logout', { method: 'POST' });
          window.location.href = '/login';
        }}>Sign out</button>
      </div>
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────
const TWEAK_DEFAULTS = {
  accent: 'emerald',
  density: 'regular',
  monoNumbers: true,
  sidebarLayout: 'labeled',
  darkMode: false,
  monthlyReminder: true,
};

const ACCENT_PRESETS: Record<string, { accent: string; accent2: string; terra: string }> = {
  emerald: { accent: '#5ec98a', accent2: '#67e8f9', terra: '#d97757' },
  violet:  { accent: '#a78bfa', accent2: '#67e8f9', terra: '#f472b6' },
  amber:   { accent: '#fbbf24', accent2: '#a3e635', terra: '#f97316' },
  cyan:    { accent: '#22d3ee', accent2: '#34d399', terra: '#fb7185' },
};

const ICON_PATHS: Record<string, string> = {
  sun:         'M12 3v1M12 20v1M4.22 4.22l.7.7M18.36 18.36l.7.7M3 12h1M20 12h1M4.22 19.78l.7-.7M18.36 5.64l.7-.7M12 7a5 5 0 1 0 0 10A5 5 0 0 0 12 7z',
  moon:        'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  sync:        'M4 12a8 8 0 0 1 14-5l3-3v6h-6M20 12a8 8 0 0 1-14 5l-3 3v-6h6',
  overview:    'M3 12h4l3-8 4 16 3-8h4',
  txns:        'M3 6h18M3 12h18M3 18h12',
  income:      'M7 17l5-5 4 4 5-9M16 7h5v5',
  spending:    'M21 17l-5-5-4 4-5-9M8 7H3v5',
  cashflow:    'M3 6c4 0 4 12 8 12s4-12 8-12M3 6h2m14 0h2',
  networth:    'M4 19V9l8-5 8 5v10M4 19h16M9 19v-6h6v6',
  accounts:    'M3 6h18v12H3zM3 10h18M7 14h2',
  recurring:   'M4 12a8 8 0 0 1 14-5l3-3v6h-6M20 12a8 8 0 0 1-14 5l-3 3v-6h6',
  categories:  'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  trends:      'M3 17l6-6 4 4 8-8M14 7h7v7',
  chat:        'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  flagged:     'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  search:      'M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-4.5-4.5',
  bell:        'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
  chevron:     'M9 5l7 7-7 7',
  chevronL:    'M15 5l-7 7 7 7',
  upload:      'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  feedback:    'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  monthly:     'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z',
  investments: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83',
  trips:       'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  shared:      'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  review:      'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
};

const Icon = ({ name, size = 18 }: { name: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={ICON_PATHS[name] || ''} />
  </svg>
);

const TABS = [
  { id: 'overview',    name: 'Overview',      icon: 'overview',   group: 'main' },
  { id: 'txns',        name: 'Transactions',  icon: 'txns',       group: 'main' },
  { id: 'monthly',     name: 'Monthly',       icon: 'monthly',    group: 'main' },
  { id: 'review',      name: 'Review',        icon: 'review',     group: 'main' },
  { id: 'trips',       name: 'Trips',         icon: 'trips',      group: 'main' },
  { id: 'shared',      name: 'Shared',        icon: 'shared',     group: 'main' },
  { id: 'cashflow',    name: 'Cash Flow',     icon: 'cashflow',   group: 'analysis' },
  { id: 'flow',        name: 'Flow',          icon: 'cashflow',   group: 'analysis' },
  { id: 'categories',  name: 'Categories',    icon: 'categories', group: 'analysis' },
  { id: 'trends',      name: 'Trends',        icon: 'trends',     group: 'analysis' },
  { id: 'investments', name: 'Investments',   icon: 'investments',group: 'wealth' },
  { id: 'networth',    name: 'Net Worth',     icon: 'networth',   group: 'wealth' },
  { id: 'accounts',    name: 'Accounts',      icon: 'accounts',   group: 'wealth' },
  { id: 'recurring',   name: 'Recurring',     icon: 'recurring',  group: 'wealth' },
  { id: 'chat',        name: 'Chat',          icon: 'chat',       group: 'tools' },
  { id: 'flagged',     name: 'Flagged',       icon: 'flagged',    group: 'tools' },
  { id: 'settings',    name: 'Settings',      icon: 'upload',     group: 'tools' },
  { id: 'feedback',    name: 'Feedback',      icon: 'feedback',   group: 'tools' },
];

const TAB_GROUPS = [
  { id: 'main',     label: 'Money' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'wealth',   label: 'Wealth' },
  { id: 'tools',    label: 'Tools' },
];

function fmtSyncTime(iso: string) {
  if (!iso) return 'Live data';
  const d = new Date(iso);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 2)  return 'Synced just now';
  if (diffMin < 60) return `Synced ${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24)   return `Synced ${diffH}h ago`;
  return `Synced ${Math.round(diffH / 24)}d ago`;
}

// Hover-triggered prefetch: start loading bundle as soon as user mouses over nav item
const HOVER_PREFETCH: Record<string, () => void> = {
  shared:      () => import('@/tabs/Shared'),
  trips:       () => import('@/tabs/Trips'),
  categories:  () => import('@/tabs/Analysis'),
  trends:      () => import('@/tabs/Analysis'),
  networth:    () => import('@/tabs/Wealth'),
  accounts:    () => import('@/tabs/Wealth'),
  recurring:   () => import('@/tabs/Wealth'),
  investments: () => import('@/tabs/Investments'),
  cashflow:    () => import('@/tabs/Spending'),
  flow:        () => import('@/tabs/Spending'),
};

// ── Sidebar ───────────────────────────────────────────────────────
function Sidebar({ active, onChange, layout, syncState }: { active: string | null; onChange: (t: string) => void; layout: string; syncState: any }) {
  const collapsed = layout === 'icons';
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="brand">
        <div className="brand-mark">
          <svg width="22" height="22" viewBox="0 0 22 22">
            <path d="M3 18 L8 6 L11 13 L14 9 L19 16" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="3" cy="18" r="1.6" fill="currentColor" />
            <circle cx="19" cy="16" r="1.6" fill="currentColor" />
          </svg>
        </div>
        {!collapsed && <div className="brand-name">MoneyTalks</div>}
      </div>

      <nav className="nav">
        {TAB_GROUPS.map((g) => (
          <div key={g.id} className="nav-group">
            {!collapsed && <div className="nav-group-label">{g.label}</div>}
            {TABS.filter((t) => t.group === g.id).map((t) => (
              <button key={t.id}
                className={`nav-item ${active === t.id ? 'active' : ''}`}
                onClick={() => onChange(t.id)}
                onMouseEnter={HOVER_PREFETCH[t.id] ? () => HOVER_PREFETCH[t.id]() : undefined}
                title={collapsed ? t.name : ''}>
                <Icon name={t.icon} size={18} />
                {!collapsed && <span>{t.name}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="sync-pill">
          <span className="sync-dot" />
          {!collapsed && <span>{syncState?.last_sync ? fmtSyncTime(syncState.last_sync) : 'Live data'}</span>}
        </div>
      </div>
    </aside>
  );
}

// ── TopBar ────────────────────────────────────────────────────────
function TopBar({ tab, monthKey, setMonthKey, search, setSearch, syncState, syncing, manualSync, isAdmin, darkMode, onToggleDark }: any) {
  const [me,              setMe]             = useState<any>(null);
  const [showProfile,     setShowProfile]    = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    apiFetch('/api/auth/me').then(r => r.json()).then(setMe).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showMonthPicker) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMonthPicker(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showMonthPicker]);

  function fmtLastSync(iso: string) {
    if (!iso) return null;
    const d = new Date(iso);
    const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
    if (diffMin < 2)  return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24)   return `${diffH}h ago`;
    return `${Math.round(diffH/24)}d ago`;
  }

  const idx      = MONTHS.findIndex((m) => m.key === monthKey);
  const showMonth = ['overview', 'txns', 'flow', 'categories', 'monthly'].includes(tab);
  const tabName  = TABS.find((t) => t.id === tab)?.name || '';
  const displayName = me?.display_name || me?.username || '?';
  const initial     = displayName[0].toUpperCase();
  const color       = avatarColor(me?.username || '');

  return (
    <>
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="page-title">{tabName}</h1>
        {showMonth && (() => {
          const yearGroups: Record<string, typeof MONTHS> = {};
          MONTHS.forEach(m => {
            const yr = m.key.slice(0, 4);
            if (!yearGroups[yr]) yearGroups[yr] = [];
            yearGroups[yr].push(m);
          });
          return (
            <div className="month-switcher" style={{ position: 'relative' }}>
              <button className="month-nav" disabled={idx === 0}
                onClick={() => idx > 0 && setMonthKey(MONTHS[idx - 1].key)}>
                <Icon name="chevronL" size={16} />
              </button>
              <button className="month-label-btn"
                onClick={() => setShowMonthPicker(v => !v)}
                title="Click to pick month">
                {MONTHS[idx]?.label}
              </button>
              <button className="month-nav" disabled={idx === MONTHS.length - 1}
                onClick={() => idx < MONTHS.length - 1 && setMonthKey(MONTHS[idx + 1].key)}>
                <Icon name="chevron" size={16} />
              </button>
              {showMonthPicker && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 199 }}
                    onClick={() => setShowMonthPicker(false)} />
                  <div className="month-picker-popover">
                    {Object.entries(yearGroups).reverse().map(([yr, months]) => (
                      <div key={yr}>
                        <div className="month-picker-year-label">{yr}</div>
                        <div className="month-picker-grid">
                          {months.map(m => (
                            <button key={m.key}
                              className={`month-picker-btn ${m.key === monthKey ? 'active' : ''}`}
                              onClick={() => { setMonthKey(m.key); setShowMonthPicker(false); }}>
                              {m.short}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </div>
      <div className="topbar-right">
        {!isAdmin && <>
          <button className="icon-btn sync-btn" onClick={() => manualSync()} disabled={syncing}
            title={syncState?.last_sync ? `Last synced ${fmtLastSync(syncState.last_sync)}` : 'Sync now'}>
            <span style={{ display: 'inline-flex', animation: syncing ? 'spin 1s linear infinite' : 'none' }}>
              <Icon name="sync" size={16} />
            </span>
            <span className="sync-btn-label">
              {syncing ? 'Syncing…' : syncState?.last_sync ? fmtLastSync(syncState.last_sync) : 'Sync'}
            </span>
          </button>
          <div className="topbar-search">
            <Icon name="search" size={14} />
            <input ref={searchRef} placeholder="Search transactions, merchants..." value={search}
              onChange={(e) => setSearch(e.target.value)} />
            <kbd>⌘K</kbd>
          </div>
          <button className="icon-btn" title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={onToggleDark}>
            <Icon name={darkMode ? 'sun' : 'moon'} size={16} />
          </button>
        </>}

        <div className="user-chip" style={{ position: 'relative' }}>
          <button className="avatar" style={{ background: color, border: 'none', cursor: 'pointer' }}
            onClick={() => setShowProfile(v => !v)}
            title={displayName}>
            {initial}
          </button>
          {showProfile && (
            <>
              <div className="profile-overlay" onClick={() => setShowProfile(false)} />
              <ProfilePanel me={me} onClose={() => setShowProfile(false)}
                onDisplayNameChange={(name) => setMe((prev: any) => ({ ...prev, display_name: name }))} />
            </>
          )}
        </div>
      </div>
    </header>
    </>
  );
}

// ── Bottom nav (mobile) ───────────────────────────────────────────
const BOTTOM_TABS = [
  { id: 'overview',  name: 'Overview',  icon: 'overview'  },
  { id: 'txns',      name: 'Txns',      icon: 'txns'      },
  { id: 'spending',  name: 'Spending',  icon: 'spending'  },
  { id: 'networth',  name: 'Net Worth', icon: 'networth'  },
  { id: '__more__',  name: 'More',      icon: 'more'      },
];

const MORE_ICON_PATH = 'M5 12h.01M12 12h.01M19 12h.01';

function BottomNav({ active, onChange }: { active: string | null; onChange: (t: string) => void }) {
  const [showMore, setShowMore] = useState(false);
  const pinnedIds = new Set(BOTTOM_TABS.map(t => t.id).filter(id => id !== '__more__'));
  const moreTabs  = TABS.filter(t => !pinnedIds.has(t.id));

  const handleTab = (id: string) => {
    if (id === '__more__') { setShowMore(true); return; }
    onChange(id);
  };
  const handleMore = (id: string) => { onChange(id); setShowMore(false); };

  return (
    <>
      <nav className="bottom-nav">
        {BOTTOM_TABS.map(t => (
          <button key={t.id}
            className={`bottom-nav-item ${active === t.id ? 'active' : ''}`}
            onClick={() => handleTab(t.id)}>
            {t.icon === 'more'
              ? <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={MORE_ICON_PATH} />
                </svg>
              : <Icon name={t.icon} size={22} />
            }
            <span>{t.name}</span>
          </button>
        ))}
      </nav>

      {showMore && (
        <>
          <div className="more-sheet-overlay" onClick={() => setShowMore(false)} />
          <div className="more-sheet">
            <div className="more-sheet-handle" />
            {moreTabs.map(t => (
              <button key={t.id} className="more-sheet-item" onClick={() => handleMore(t.id)}>
                <Icon name={t.icon} size={20} />
                {t.name}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ── Upload reminder banner ────────────────────────────────────────
function UploadReminder({ onUpload, finVersion, enabled }: { onUpload: () => void; finVersion: number; enabled: boolean }) {
  const now         = new Date();
  const day         = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const inWindow    = day >= daysInMonth - 4 || day <= 3;

  // Month the reminder refers to (current month if near end, previous if early next month)
  const refDate   = day <= 3
    ? new Date(now.getFullYear(), now.getMonth() - 1, 1)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const monthKey  = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}`;
  const monthName = refDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const storageKey = `mt_upload_reminder_${monthKey}`;

  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === '1');

  useEffect(() => { setDismissed(localStorage.getItem(storageKey) === '1'); }, [storageKey, finVersion]);

  if (!enabled || !inWindow || dismissed) return null;

  // Find accounts with possible duplicates flagged during sync
  const dupAccounts = [...new Set(
    TRANSACTIONS
      .filter(t => (t as any).notes?.includes('Possible duplicate'))
      .map(t => (t as any).account as string)
      .filter(Boolean)
  )];

  if (dupAccounts.length === 0) return null;

  const accountList = dupAccounts.length === 1
    ? dupAccounts[0]
    : dupAccounts.slice(0, -1).join(', ') + ' and ' + dupAccounts[dupAccounts.length - 1];

  function dismiss() {
    localStorage.setItem(storageKey, '1');
    setDismissed(true);
  }

  return (
    <div className="upload-reminder">
      <div className="upload-reminder-icon">📋</div>
      <div className="upload-reminder-body">
        <div className="upload-reminder-title">Possible duplicates in {monthName}</div>
        <div className="upload-reminder-sub">
          Upload a statement for <strong>{accountList}</strong> to verify and resolve them.
        </div>
      </div>
      <div className="upload-reminder-actions">
        <button className="upload-reminder-btn-primary" onClick={onUpload}>Upload</button>
        <button className="upload-reminder-btn-dismiss" onClick={dismiss}>Dismiss</button>
      </div>
    </div>
  );
}

// ── Install banner ───────────────────────────────────────────────
function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('mt_install_dismissed') === '1');

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    && !/(CriOS|FxiOS|OPiOS)/.test(navigator.userAgent);
  const isStandalone = (navigator as any).standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler as EventListener);
    return () => window.removeEventListener('beforeinstallprompt', handler as EventListener);
  }, []);

  function dismiss() {
    localStorage.setItem('mt_install_dismissed', '1');
    setDismissed(true);
  }

  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await (deferredPrompt as any).userChoice;
    if (outcome === 'accepted') { setDeferredPrompt(null); dismiss(); }
  }

  if (dismissed || isStandalone) return null;
  if (!deferredPrompt && !isIOS) return null;

  return (
    <div className="upload-reminder">
      <div className="upload-reminder-icon">📱</div>
      <div className="upload-reminder-body">
        <div className="upload-reminder-title">Add to Home Screen</div>
        <div className="upload-reminder-sub">
          {isIOS
            ? <>Tap <strong>Share ↑</strong> then <strong>Add to Home Screen</strong></>
            : 'Install MoneyTalks for quick access — works offline too'}
        </div>
      </div>
      <div className="upload-reminder-actions">
        {deferredPrompt && (
          <button className="upload-reminder-btn-primary" onClick={install}>Install</button>
        )}
        <button className="upload-reminder-btn-dismiss" onClick={dismiss}>
          {deferredPrompt ? 'Not now' : '✕'}
        </button>
      </div>
    </div>
  );
}

// ── Error Boundary ────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="error-state">
          <div className="error-state-icon">⚠</div>
          <div className="error-state-title">Something went wrong</div>
          <div className="error-state-msg">{this.state.error.message}</div>
          <button className="btn-primary" style={{ marginTop: 8 }}
            onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── App ───────────────────────────────────────────────────────────
export default function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [tab, setTab]           = useState<string | null>(null);
  const [isAdmin, setIsAdmin]   = useState(false);
  const [monthKey, setMonthKey] = useState(MONTHS[MONTHS.length - 1]?.key || '');
  const [search, setSearch]     = useState('');
  const [txnOverrides, setTxnOverrides] = useState<Record<string, string>>({});
  const [finVersion, setFinVersion]     = useState(0);
  const [showVerify, setShowVerify]     = useState(false);
  const [toast, setToast]               = useState<{ msg: string; type: string; id: number } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastIdRef    = useRef(0);

  useEffect(() => {
    window.showToast = (msg: string, type = 'success') => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast({ msg, type, id: ++toastIdRef.current });
      toastTimerRef.current = setTimeout(() => setToast(null), 2800);
    };
    return () => {
      delete window.showToast;
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const [pendingJoin, setPendingJoin] = useState(() => {
    const token = new URLSearchParams(window.location.search).get('join');
    if (token) window.history.replaceState({}, '', window.location.pathname);
    return token || null;
  });

  const [syncState,    setSyncState]    = useState<any>(null);
  const [syncing,      setSyncing]      = useState(false);
  const [syncFull,     setSyncFull]     = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ step: string; pct: number; error: boolean } | null>(null);

  useEffect(() => {
    apiFetch('/api/auth/me').then(r => r.json()).then(me => {
      if (me?.is_admin) { setIsAdmin(true); setTab('admin'); return; }
      if (pendingJoin) { setTab('shared'); return; }
      apiFetch('/api/review').then(r => r.json()).then(d => {
        setTab(d.remaining === 0 ? 'monthly' : 'review');
      }).catch(() => setTab('monthly'));
    }).catch(() => {
      apiFetch('/api/review').then(r => r.json()).then(d => {
        setTab(d.remaining === 0 ? 'monthly' : 'review');
      }).catch(() => setTab('monthly'));
    });

    apiFetch('/api/plaid/sync_status').then(r => r.json()).then(d => {
      setSyncState(d);
      if (d.needs_sync) {
        setSyncing(true);
        apiFetch('/api/plaid/sync', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' })
          .then(r => r.json())
          .then(res => {
            setSyncing(false);
            if (res.last_sync) setSyncState({ last_sync: res.last_sync, needs_sync: false });
            if ((res.stats?.added || 0) + (res.stats?.modified || 0) > 0) {
              setTimeout(() => window.location.reload(), 800);
            }
          })
          .catch(() => setSyncing(false));
      }
    }).catch(() => {});
  }, []);

  const manualSync = useCallback(async (full = false) => {
    if (syncing) return;
    setSyncing(true);
    setSyncFull(full);
    setSyncProgress({ step: full ? 'Resetting cursors…' : 'Connecting to bank…', pct: 10, error: false });
    try {
      setSyncProgress({ step: 'Fetching transactions…', pct: 35, error: false });
      const r = await apiFetch('/api/plaid/sync', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ full }) });
      setSyncProgress({ step: 'Categorizing…', pct: 70, error: false });
      if (r.status === 401) { window.location.href = '/login'; return; }
      const res = await r.json();
      if (!r.ok || res.error) {
        setSyncProgress({ step: res.error || res.detail || 'Sync failed', pct: 100, error: true });
        setTimeout(() => { setSyncing(false); setSyncProgress(null); }, 4000);
        return;
      }
      setSyncProgress({ step: 'Saving…', pct: 90, error: false });
      if (res.last_sync) setSyncState({ last_sync: res.last_sync, needs_sync: false });
      const added = (res.stats?.added || 0) + (res.stats?.modified || 0);
      const skipped = res.stats?.duplicates_skipped || 0;
      const doneMsg = added > 0
        ? `Done — ${added} new transaction${added !== 1 ? 's' : ''}${skipped > 0 ? ` (${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped)` : ''}`
        : 'Already up to date';
      setSyncProgress({ step: doneMsg, pct: 100, error: false });
      setTimeout(() => {
        setSyncing(false);
        setSyncProgress(null);
        if (added > 0) {
          window.location.reload();
        } else {
          window.showToast?.('Already up to date');
        }
      }, 1200);
    } catch {
      setSyncProgress({ step: 'Connection failed. Check your internet.', pct: 100, error: true });
      setTimeout(() => { setSyncing(false); setSyncProgress(null); }, 4000);
    }
  }, [syncing]);

  const refreshFin = useCallback(() => {
    apiFetch('/api/fin').then(r => r.json()).then(data => {
      if (data.hasData === false) return;
      _populate(data);
      setFinVersion(v => v + 1);
      setTxnOverrides(prev => {
        if (!Object.keys(prev).length) return prev;
        const txnMap: Record<string, any> = {};
        (data.TRANSACTIONS || []).forEach((txn: any) => { txnMap[txn.id] = txn; });
        const next = { ...prev };
        Object.keys(next).forEach(id => {
          if (txnMap[id] && txnMap[id].category === next[id]) delete next[id];
        });
        return next;
      });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const name = TABS.find(t => t.id === tab)?.name;
    document.title = name ? `${name} — MoneyTalks` : 'MoneyTalks';
  }, [tab]);

  // Prefetch heavy lazy chunks quickly so tab switches feel instant
  useEffect(() => {
    const t = setTimeout(() => {
      import('@/tabs/Shared');
      import('@/tabs/Trips');
      import('@/tabs/Spending');
      import('@/tabs/Analysis');
      import('@/tabs/Wealth');
    }, 500);
    return () => clearTimeout(t);
  }, []);

  const accent  = ACCENT_PRESETS[t.accent] || ACCENT_PRESETS.emerald;
  const cssVars = {
    '--accent':  accent.accent,
    '--accent2': accent.accent2,
    '--terra':   accent.terra,
    '--green':   '#5ec98a',
  };

  const sharedProps = { monthKey, txnOverrides, setTxnOverrides, search, setSearch, refreshFin, finVersion };

  const renderTab = () => {
    if (!tab) return null;
    switch (tab) {
      case 'overview':    return <OverviewTab    {...sharedProps} setTab={setTab} />;
      case 'txns':        return <TransactionsTab {...sharedProps} />;
      case 'monthly':     return <MonthlyTab {...sharedProps} />;
      case 'review':      return <ReviewTab refreshFin={refreshFin} setTab={setTab} />;
      case 'trips':       return <TripsTab refreshFin={refreshFin} finVersion={finVersion} />;
      case 'shared':      return <SharedTab pendingJoin={pendingJoin} clearPendingJoin={() => setPendingJoin(null)} setTab={setTab} />;
      case 'cashflow':    return <CashFlowTab />;
      case 'flow':        return <FlowTab        {...sharedProps} />;
      case 'categories':  return <CategoriesTab  {...sharedProps} />;
      case 'trends':      return <TrendsTab setTab={setTab} setMonthKey={setMonthKey} />;
      case 'investments': return <InvestmentsTab />;
      case 'networth':    return <NetWorthTab />;
      case 'accounts':    return <AccountsTab onSync={manualSync} syncing={syncing} />;
      case 'recurring':   return <RecurringTab />;
      case 'chat':        return <ChatTab />;
      case 'flagged':     return <FlaggedTab />;
      case 'settings':    return <SettingsTab refreshFin={refreshFin} onSync={manualSync} syncing={syncing} />;
      case 'feedback':    return <FeedbackTab />;
      case 'admin':       return <AdminTab />;
      default:            return <OverviewTab    {...sharedProps} />;
    }
  };

  return (
    <div className={`app density-${t.density} ${t.monoNumbers ? 'mono' : ''} ${isAdmin ? 'no-sidebar' : ''} ${t.darkMode ? 'dark' : ''}`}
         style={cssVars as React.CSSProperties}>
      {syncProgress && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--surface)', borderRadius: 20,
            border: '1px solid var(--line)', padding: '36px 40px',
            minWidth: 320, textAlign: 'center', boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>
              {syncProgress.error ? '⚠️' : '🔄'}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
              {syncProgress.error ? 'Sync failed' : syncFull ? 'Full re-sync in progress' : 'Syncing your accounts'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
              {syncProgress.step}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ flex: 1, height: 6, background: 'var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  width: `${syncProgress.pct}%`,
                  background: syncProgress.error ? 'var(--terra)' : 'var(--accent)',
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', minWidth: 32, textAlign: 'right' }}>
                {syncProgress.pct}%
              </div>
            </div>
            {!syncProgress.error && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
                {syncFull ? 'Rebuilding your full transaction history — please wait' : 'Don\'t close the app — this takes a few seconds'}
              </div>
            )}
          </div>
        </div>
      )}
      {toast && (
        <div className={`toast ${toast.type}`} key={toast.id}>
          {toast.type === 'success' ? '✓' : '⚠'} {toast.msg}
        </div>
      )}
      {!isAdmin && <Sidebar active={tab} onChange={setTab} layout={t.sidebarLayout} syncState={syncState} />}
      <main className="main">
        <TopBar tab={tab} monthKey={monthKey} setMonthKey={setMonthKey}
                search={search} setSearch={setSearch}
                syncState={syncState} syncing={syncing} syncProgress={syncProgress}
                manualSync={manualSync} isAdmin={isAdmin}
                darkMode={t.darkMode} onToggleDark={() => setTweak('darkMode', !t.darkMode)} />
        <InstallBanner />
        <UploadReminder onUpload={() => setShowVerify(true)} finVersion={finVersion} enabled={t.monthlyReminder} />
        {showVerify && <VerifyModal onClose={() => setShowVerify(false)} />}
        <div className={`page${tab ? ` tab-${tab}` : ''}`}>
          <ErrorBoundary key={tab}>
            <div key={tab} className="tab-fade">
              <Suspense fallback={<TabSkeleton />}>
                {renderTab()}
              </Suspense>
            </div>
          </ErrorBoundary>
        </div>
      </main>

      {!isAdmin && <BottomNav active={tab} onChange={setTab} />}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Theme">
          <TweakToggle label="Dark mode" value={t.darkMode}
            onChange={(v) => setTweak('darkMode', v)} />
          <TweakRadio label="Accent" value={t.accent}
            options={[
              { label: 'Emerald', value: 'emerald' },
              { label: 'Violet',  value: 'violet'  },
              { label: 'Amber',   value: 'amber'   },
              { label: 'Cyan',    value: 'cyan'     },
            ]}
            onChange={(v) => setTweak('accent', v)} />
        </TweakSection>
        <TweakSection label="Layout">
          <TweakRadio label="Density" value={t.density}
            options={[
              { label: 'Compact', value: 'compact' },
              { label: 'Regular', value: 'regular' },
              { label: 'Comfy',   value: 'comfy'   },
            ]}
            onChange={(v) => setTweak('density', v)} />
          <TweakRadio label="Sidebar" value={t.sidebarLayout}
            options={[{ label: 'Icons', value: 'icons' }, { label: 'Labeled', value: 'labeled' }]}
            onChange={(v) => setTweak('sidebarLayout', v)} />
          <TweakToggle label="Mono numbers" value={t.monoNumbers}
            onChange={(v) => setTweak('monoNumbers', v)} />
          <TweakToggle label="Monthly reminders" value={t.monthlyReminder}
            onChange={(v) => setTweak('monthlyReminder', v)} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}
