// Tab component — see frontend/AGENTS.md for context
import { useState, useMemo, useEffect, useRef } from 'react';
import { TRANSACTIONS, ACCOUNTS, MONTHS, RECURRING } from '@/lib/fin';
import { fmtMoney, fmt, fmtAbbr, catById, txnsForMonth, monthSummary } from '@/lib/helpers';
import { apiFetch } from '@/lib/api';
import { TxnList } from '@/components';
import { Sparkline } from '@/components/charts';

const OVERVIEW_WIDGETS = [
  { id: 'networth',  label: 'Net Worth'             },
  { id: 'accounts',  label: 'Account Balances'      },
  { id: 'quality',   label: 'Data Quality'          },
  { id: 'vs6mo',     label: 'vs. 6-Month Avg'       },
  { id: 'anomalies', label: 'Spending Alerts'       },
  { id: 'merchants', label: 'Top Merchants'         },
  { id: 'trends',    label: 'Spending Trends'       },
  { id: 'recurring', label: 'Upcoming Bills'        },
  { id: 'recent',    label: 'Recent Transactions'   },
  { id: 'funfact',   label: '✨ Fun Fact'           },
];

const OVERVIEW_ORDER_KEY = 'mt_overview_order';

function DragCard({ id, index, order, onReorder, title, children, onNavigate }: {
  id: string; index: number; order: string[]; onReorder: (o: string[]) => void;
  title: string; children: React.ReactNode; onNavigate?: () => void;
}) {
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);

  function onDragStart(e) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }
  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
  function onDrop(e) {
    e.preventDefault();
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (fromIdx === index) return;
    const next = [...order];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(index, 0, moved);
    onReorder(next);
  }
  function handleMouseDown(e) {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  }
  function handleClick(e) {
    if (!onNavigate) return;
    if (mouseDownPos.current) {
      const dx = Math.abs(e.clientX - mouseDownPos.current.x);
      const dy = Math.abs(e.clientY - mouseDownPos.current.y);
      if (dx > 5 || dy > 5) return;
    }
    onNavigate();
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      style={{ cursor: onNavigate ? 'pointer' : 'grab' }}
    >
      <div className="card" style={{ transition: 'box-shadow 0.15s' }}
        onMouseEnter={onNavigate ? e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1.5px var(--accent)'; } : undefined}
        onMouseLeave={onNavigate ? e => { (e.currentTarget as HTMLElement).style.boxShadow = ''; } : undefined}
      >
        <div className="card-head">
          <h3>{title}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onNavigate && <span style={{ color: 'var(--ink-3)', fontSize: 13, opacity: 0.6, lineHeight: 1 }}>→</span>}
            <span style={{ color: 'var(--line-2)', fontSize: 14, userSelect: 'none' }}>⠿</span>
          </div>
        </div>
        <div>
          {children}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ setTab, monthKey: propMonthKey }: { setTab?: (t: string) => void; monthKey?: string }) {
  const savedOrder = (() => {
    try { return JSON.parse(localStorage.getItem(OVERVIEW_ORDER_KEY)); } catch(e) { return null; }
  })();
  const defaultOrder = OVERVIEW_WIDGETS.map(w => w.id);
  const [order, setOrder] = useState(savedOrder || defaultOrder);

  function handleReorder(next) {
    setOrder(next);
    localStorage.setItem(OVERVIEW_ORDER_KEY, JSON.stringify(next));
  }

  // ── Pre-compute all widget data ──────────────────────────────────
  const now   = new Date();
  const today = now.toISOString().slice(0, 10);
  const ago30 = new Date(now - 30 * 864e5).toISOString().slice(0, 10);
  const ago90 = new Date(now - 90 * 864e5).toISOString().slice(0, 10);

  const allTxns = TRANSACTIONS.filter(t => t.category !== 'transfer');

  // Net worth from account balances (balance already signed: negative = liability)
  const netWorth = useMemo(() => {
    let assets = 0, liabilities = 0;
    ACCOUNTS.forEach(a => {
      if (a.balance >= 0) assets      += a.balance;
      else                liabilities += Math.abs(a.balance);
    });
    return { total: assets - liabilities, assets, liabilities };
  }, []);

  // Top merchants last 30 days — spending only (amount < 0 after server negation)
  const topMerchants = useMemo(() => {
    const map = {};
    allTxns.filter(t => t.date >= ago30 && t.category !== 'income' && t.amount < 0).forEach(t => {
      map[t.merchant] = (map[t.merchant] || 0) + Math.abs(t.amount);
    });
    return Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0, 8)
      .map(([name, amt]) => ({ name, amt }));
  }, []);

  // Spending anomalies: current month vs 3-month avg (spending only, income excluded)
  const anomalies = useMemo(() => {
    const curMonth = today.slice(0, 7);
    const spendingTxns = allTxns.filter(t => t.category !== 'income' && t.amount < 0);
    const catTotals = (from, to) => {
      const map = {};
      spendingTxns.filter(t => t.date >= from && t.date <= to).forEach(t => {
        map[t.category] = (map[t.category] || 0) + Math.abs(t.amount);
      });
      return map;
    };
    const cur = catTotals(curMonth + '-01', today);
    // avg = prev 90 days / 3
    const alerts = [];
    Object.entries(cur).forEach(([cat, curAmt]) => {
      const p3Total = spendingTxns.filter(t => t.date >= ago90 && t.date < curMonth + '-01'
        && t.category === cat).reduce((s, t) => s + Math.abs(t.amount), 0);
      const avg = p3Total / 3;
      if (avg > 20 && curAmt > avg * 1.25 && curAmt - avg > 50 && now.getDate() >= 7) {
        const catInfo = catById(cat);
        alerts.push({ cat, name: catInfo.name, color: catInfo.color, cur: curAmt, avg, pct: Math.round((curAmt/avg-1)*100) });
      }
    });
    return alerts.sort((a,b) => b.pct - a.pct).slice(0, 4);
  }, []);

  // Spending trends: last 6 months per top spending category (income excluded)
  const trends = useMemo(() => {
    const last6 = MONTHS.slice(-6);
    const topCats = [...new Set(
      allTxns.filter(t => t.category !== 'income' && t.amount < 0)
        .sort((a,b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 100).map(t => t.category)
    )].slice(0, 5);
    return topCats.map(cat => {
      const catInfo = catById(cat);
      const points = last6.map(m => ({
        label: m.short,
        value: allTxns.filter(t => t.date.startsWith(m.key) && t.category === cat && t.amount < 0)
          .reduce((s,t) => s + Math.abs(t.amount), 0),
      }));
      return { cat, name: catInfo.name, color: catInfo.color, points };
    });
  }, []);

  // Upcoming recurring (next 14 days)
  const upcoming = useMemo(() => {
    const dayOfMonth = now.getDate();
    return RECURRING.filter(r => {
      const due = r.day || 1;
      const daysUntil = due >= dayOfMonth ? due - dayOfMonth : (28 - dayOfMonth + due);
      return daysUntil <= 14;
    }).map(r => {
      const due = r.day || 1;
      const daysUntil = due >= dayOfMonth ? due - dayOfMonth : (28 - dayOfMonth + due);
      return { ...r, daysUntil };
    }).sort((a,b) => a.daysUntil - b.daysUntil).slice(0, 6);
  }, []);

  // Recent txns (last 10 across all time)
  const recentTxns = allTxns.slice(0, 10);

  // Fun fact — computed once from spending data
  const funFact = useMemo(() => {
    const spendTxns = allTxns.filter(t => t.amount < 0 && t.category !== 'income');
    if (spendTxns.length === 0) return null;

    const totalSpend  = spendTxns.reduce((s, t) => s + Math.abs(t.amount), 0);
    const catMap      = {};
    spendTxns.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + Math.abs(t.amount); });
    const topCat      = Object.entries(catMap).sort((a,b) => b[1]-a[1])[0];
    const diningAmt   = catMap['dining'] || catMap['food'] || catMap['restaurants'] || 0;
    const coffeeAmt   = catMap['coffee'] || 0;
    const daysOfData  = Math.max(1, Math.round((new Date(spendTxns[0]?.date) - new Date(spendTxns[spendTxns.length-1]?.date)) / 864e5));
    const dailySpend  = totalSpend / Math.max(1, daysOfData);
    const yearlyDining = diningAmt * (365 / Math.max(1, daysOfData));

    const facts = [];

    if (diningAmt > 200) {
      const burritos = Math.round(yearlyDining / 12);
      facts.push({ emoji: '🌯', text: `At your dining pace, you'll spend ${fmtMoney(yearlyDining)} on food this year — that's ${burritos.toLocaleString()} Chipotle burritos.` });
    }
    if (coffeeAmt > 50) {
      const yearCoffee = coffeeAmt * (365 / Math.max(1, daysOfData));
      const cups = Math.round(yearCoffee / 6);
      facts.push({ emoji: '☕', text: `You spend ${fmtMoney(yearCoffee)} on coffee per year — enough for ${cups.toLocaleString()} lattes.` });
    }
    if (topCat && topCat[1] > 100) {
      const catInfo = catById(topCat[0]);
      const topPct  = Math.round((topCat[1] / totalSpend) * 100);
      const CAT_EMOJIS = { dining: '🍽️', food: '🍽️', restaurant: '🍽️', transport: '🚗', auto: '🚗', car: '🚗', shopping: '🛍️', housing: '🏠', rent: '🏠', entertainment: '🎬', health: '💊', travel: '✈️', groceries: '🛒', coffee: '☕', clothing: '👗', utilities: '💡', fitness: '💪', subscription: '📱' };
      const emojiKey = Object.keys(CAT_EMOJIS).find(k => topCat[0].toLowerCase().includes(k));
      facts.push({ emoji: CAT_EMOJIS[emojiKey] || '💸', text: `${catInfo.name} is your #1 spending category at ${topPct}% of total spend.` });
    }
    if (dailySpend > 10) {
      facts.push({ emoji: '📅', text: `You spend about ${fmtMoney(dailySpend)}/day on average — or ${fmtMoney(dailySpend * 365)} a year.` });
    }

    // Pick one pseudo-randomly (based on current date so it changes daily)
    if (facts.length === 0) return null;
    const pick = facts[new Date().getDate() % facts.length];
    return pick;
  }, []);

  // Data quality stats — fetched from /api/review
  const [reviewStats, setReviewStats] = useState(null);
  useEffect(() => {
    apiFetch('/api/review')
      .then(r => r.json())
      .then(d => setReviewStats(d))
      .catch(() => {});
  }, []);

  // Live account balances — fetched from /api/plaid/balances
  const [liveBalances, setLiveBalances] = useState<any[] | null>(null);
  useEffect(() => {
    apiFetch('/api/plaid/balances')
      .then(r => r.json())
      .then(d => setLiveBalances(d.accounts || []))
      .catch(() => setLiveBalances([]));
  }, []);

  // Category spend: this month vs 6-month average
  const curMonthKey = propMonthKey || MONTHS[MONTHS.length - 1]?.key;
  const vs6mo = useMemo(() => {
    const last6 = MONTHS.slice(-7, -1); // 6 months before current
    const curTxns = txnsForMonth(curMonthKey);

    // Sum spending by category for each of the last 6 months, then average
    const avgMap = {};
    last6.forEach(m => {
      txnsForMonth(m.key).forEach(t => {
        if (t.amount >= 0 || t.category === 'transfer' || t.category === 'income') return;
        avgMap[t.category] = (avgMap[t.category] || 0) + Math.abs(t.amount);
      });
    });
    Object.keys(avgMap).forEach(k => { avgMap[k] /= last6.length || 1; });

    // Current month spending by category
    const curMap = {};
    curTxns.forEach(t => {
      if (t.amount >= 0 || t.category === 'transfer' || t.category === 'income') return;
      curMap[t.category] = (curMap[t.category] || 0) + Math.abs(t.amount);
    });

    // Merge all categories
    const cats = [...new Set([...Object.keys(avgMap), ...Object.keys(curMap)])];
    return cats.map(id => {
      const info  = catById(id);
      const avg   = avgMap[id] || 0;
      const cur   = curMap[id] || 0;
      const delta = avg > 0 ? ((cur - avg) / avg) * 100 : null;
      return { id, info, avg, cur, delta };
    })
    .filter(r => r.avg > 20 || r.cur > 20) // hide tiny categories
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 10);
  }, [curMonthKey]);

  // ── Widget renderers ─────────────────────────────────────────────
  function renderWidget(id, index) {
    const label = OVERVIEW_WIDGETS.find(w => w.id === id)?.label || id;

    if (id === 'networth') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Net Worth" onNavigate={setTab ? () => setTab('networth') : undefined}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {fmt(netWorth.total, { decimals: 0 })}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              {fmt(netWorth.assets, { decimals: 0 })} assets · {fmt(netWorth.liabilities, { decimals: 0 })} liabilities
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ACCOUNTS.filter(a => a.balance !== 0).sort((a,b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0,6).map(a => (
            <div key={a.id}
              onClick={setTab ? e => { e.stopPropagation(); setTab('accounts'); } : undefined}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13,
                borderRadius: 6, padding: '2px 4px', margin: '0 -4px',
                transition: 'background 0.1s',
              }}
              onMouseEnter={setTab ? e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2, rgba(0,0,0,0.04))'; } : undefined}
              onMouseLeave={setTab ? e => { (e.currentTarget as HTMLElement).style.background = ''; } : undefined}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: a.color, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ color: 'var(--ink-2)' }}>{a.inst || a.name}</span>
              </div>
              <span style={{ fontWeight: 500, color: a.balance < 0 ? 'var(--terra)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(a.balance, { decimals: 0, sign: false })}
              </span>
            </div>
          ))}
        </div>
      </DragCard>
    );

    if (id === 'accounts') {
      const TYPE_ORDER = ['depository', 'investment', 'credit', 'loan'];
      const TYPE_LABEL: Record<string, string> = { depository: 'Cash', investment: 'Investments', credit: 'Credit', loan: 'Loans' };
      const TYPE_COLOR: Record<string, string> = { depository: 'var(--green)', investment: '#818cf8', credit: '#f97316', loan: '#ef4444' };

      const groups: Record<string, any[]> = {};
      (liveBalances || []).forEach(b => {
        const t = b.account_type || 'other';
        if (!groups[t]) groups[t] = [];
        groups[t].push(b);
      });

      const totalAssets = (liveBalances || [])
        .filter(b => b.account_type !== 'credit' && b.account_type !== 'loan')
        .reduce((s, b) => s + (b.current_balance || 0), 0);
      const totalOwed = (liveBalances || [])
        .filter(b => b.account_type === 'credit' || b.account_type === 'loan')
        .reduce((s, b) => s + (b.current_balance || 0), 0);

      return (
        <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Account Balances" onNavigate={setTab ? () => setTab('accounts') : undefined}>
          {liveBalances === null ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</div>
          ) : liveBalances.length === 0 ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>No accounts linked.</div>
          ) : (
            <>
              {/* Summary strip */}
              <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }}>
                <div style={{ flex: 1, padding: '10px 14px', background: 'color-mix(in srgb, var(--green) 8%, transparent)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Assets</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(totalAssets)}</div>
                </div>
                <div style={{ width: 1, background: 'var(--line)' }} />
                <div style={{ flex: 1, padding: '10px 14px', background: 'color-mix(in srgb, #f97316 6%, transparent)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Owed</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#f97316', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(totalOwed)}</div>
                </div>
              </div>

              {/* Accounts by type */}
              {TYPE_ORDER.filter(t => groups[t]?.length).map(type => (
                <div key={type} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: TYPE_COLOR[type], textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                    {TYPE_LABEL[type] || type}
                  </div>
                  {[...groups[type]].sort((a, b) => (b.current_balance || 0) - (a.current_balance || 0)).map((b, i) => {
                    const isCredit = type === 'credit' || type === 'loan';
                    const bal = b.current_balance || 0;
                    const avail = b.available_balance;
                    const limit = isCredit && avail != null && avail > 0 ? bal + avail : null;
                    const util = limit ? bal / limit : null;
                    return (
                      <div key={i} style={{ marginBottom: i < groups[type].length - 1 ? 10 : 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: util != null ? 5 : 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 3, height: 28, borderRadius: 2, background: TYPE_COLOR[type], flexShrink: 0 }} />
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{b.account_name}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{b.institution_name}</div>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: isCredit ? '#f97316' : 'var(--ink)' }}>
                              {isCredit ? '-' : ''}{fmtMoney(bal)}
                            </div>
                            {avail != null && !isCredit && (
                              <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{fmtMoney(avail)} avail</div>
                            )}
                          </div>
                        </div>
                        {util != null && (
                          <div style={{ marginLeft: 11 }}>
                            <div style={{ height: 3, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(util * 100, 100)}%`, borderRadius: 2,
                                background: util > 0.7 ? '#ef4444' : util > 0.4 ? '#f97316' : 'var(--green)' }} />
                            </div>
                            {limit && (
                              <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>
                                {(util * 100).toFixed(0)}% of {fmtMoney(limit)} limit
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </DragCard>
      );
    }

    if (id === 'quality') {
      const { total = 0, approved = 0, remaining = 0, streak = 0, last_reviewed = null } = reviewStats || {};
      const qPct   = total > 0 ? Math.round((approved / total) * 100) : (reviewStats ? 100 : 0);
      const lowConf = TRANSACTIONS.filter(t => t.confidence === 'low').length;
      const daysSince = last_reviewed
        ? Math.floor((Date.now() - new Date(last_reviewed)) / 864e5)
        : null;
      const needsAttention = daysSince !== null && daysSince > 7;
      // Hide when fully reviewed and recently active — nothing actionable to show
      if (reviewStats && qPct >= 100 && remaining === 0 && !needsAttention) return null;
      return (
        <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Data Quality" onNavigate={setTab ? () => setTab('review') : undefined}>
          {!reviewStats ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: qPct >= 90 ? 'var(--green)' : qPct >= 70 ? '#fbbf24' : 'var(--terra)',
                    letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{qPct}%</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>transactions reviewed</div>
                </div>
                {streak > 0 && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20 }}>{streak >= 2 ? '🔥' : '✓'}</div>
                    <div style={{ fontSize: 11, color: streak >= 4 ? '#f97316' : 'var(--muted)', fontWeight: 600 }}>
                      {streak}w streak
                    </div>
                  </div>
                )}
              </div>
              <div style={{ height: 5, background: 'var(--line)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ height: '100%', width: `${qPct}%`, borderRadius: 3,
                  background: qPct >= 90 ? 'var(--green)' : qPct >= 70 ? '#fbbf24' : 'var(--terra)',
                  transition: 'width 0.4s ease' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 13 }}>
                {remaining > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--ink-2)' }}>Awaiting review</span>
                    <span style={{ fontWeight: 600, color: 'var(--terra)' }}>{remaining}</span>
                  </div>
                )}
                {lowConf > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--ink-2)' }}>Low confidence</span>
                    <span style={{ fontWeight: 600, color: '#d97706' }}>{lowConf}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--ink-2)' }}>Last reviewed</span>
                  <span style={{ fontWeight: 500, color: needsAttention ? 'var(--terra)' : 'var(--ink)' }}>
                    {daysSince === null ? 'Never' : daysSince === 0 ? 'Today' : `${daysSince}d ago`}
                  </span>
                </div>
              </div>
            </>
          )}
        </DragCard>
      );
    }

    if (id === 'vs6mo') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="vs. 6-Month Avg" onNavigate={setTab ? () => setTab('categories') : undefined}>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 12 }}>
          {MONTHS[MONTHS.length - 1]?.label} · compared to 6-month average
        </div>
        {vs6mo.length === 0 ? (
          <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Not enough history yet.</div>
        ) : vs6mo.map(row => {
          const max = Math.max(row.avg, row.cur);
          const avgPct = max > 0 ? (row.avg / max) * 100 : 0;
          const curPct = max > 0 ? (row.cur / max) * 100 : 0;
          const over   = row.cur > row.avg * 1.1;
          const under  = row.cur < row.avg * 0.9;
          return (
            <div key={row.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13 }}>{row.info.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{row.info.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: over ? 'var(--terra)' : under ? 'var(--green)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(row.cur)}
                  </span>
                  {row.delta !== null && (
                    <span style={{ fontSize: 11, color: over ? 'var(--terra)' : under ? 'var(--green)' : 'var(--ink-3)' }}>
                      {row.delta > 0 ? '+' : ''}{row.delta.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
              {/* Dual bar: avg (grey) behind, current (colored) on top */}
              <div style={{ position: 'relative', height: 5 }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${avgPct}%`,
                  background: 'rgba(20,24,32,0.1)', borderRadius: 3 }} />
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${curPct}%`,
                  background: over ? 'var(--terra)' : under ? 'var(--green)' : row.info.color,
                  borderRadius: 3, opacity: 0.75 }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                avg {fmtMoney(row.avg)}/mo
              </div>
            </div>
          );
        })}
      </DragCard>
    );

    if (id === 'anomalies') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Spending Alerts" onNavigate={setTab ? () => setTab('categories') : undefined}>
        {anomalies.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 0' }}>
            All categories within normal range. Nice work.
          </div>
        ) : anomalies.map(a => (
          <div key={a.cat} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: a.color, display: 'inline-block' }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{a.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>avg {fmtMoney(a.avg)}/mo</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--terra)' }}>{fmtMoney(a.cur)}</div>
              <div style={{ fontSize: 11, color: '#ef4444' }}>+{a.pct}% this month</div>
            </div>
          </div>
        ))}
      </DragCard>
    );

    if (id === 'merchants') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Top Merchants" onNavigate={setTab ? () => setTab('txns') : undefined}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>Last 30 days</div>
        {topMerchants.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No transactions yet.</div>
        ) : topMerchants.map((m, i) => {
          const max = topMerchants[0].amt;
          return (
            <div key={m.name} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{m.name}</span>
                <span style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(m.amt)}</span>
              </div>
              <div style={{ height: 3, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(m.amt/max)*100}%`, background: 'var(--accent)', borderRadius: 2 }} />
              </div>
            </div>
          );
        })}
      </DragCard>
    );

    if (id === 'trends') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Spending Trends" onNavigate={setTab ? () => setTab('trends') : undefined}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>Last 6 months by category</div>
        {trends.map(t => (
          <div key={t.cat} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{ width: 90, fontSize: 12, color: 'var(--ink-2)', fontWeight: 500, flexShrink: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
            <div style={{ flex: 1 }}>
              <Sparkline points={t.points.map(p => p.value)} color={t.color} height={28} />
            </div>
            <div style={{ width: 60, textAlign: 'right', fontSize: 12, color: 'var(--ink)',
              fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(t.points[t.points.length-1]?.value || 0)}</div>
          </div>
        ))}
      </DragCard>
    );

    if (id === 'recurring') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Upcoming Bills" onNavigate={setTab ? () => setTab('recurring') : undefined}>
        {upcoming.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No bills due in the next 14 days.</div>
        ) : upcoming.map(r => (
          <div key={r.merchant} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{r.merchant}</div>
              <div style={{ fontSize: 11, color: r.daysUntil <= 3 ? '#f97316' : 'var(--muted)' }}>
                {r.daysUntil === 0 ? 'Due today' : `In ${r.daysUntil} day${r.daysUntil > 1 ? 's' : ''}`}
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
              {fmtMoney(Math.abs(r.amount))}
            </div>
          </div>
        ))}
      </DragCard>
    );

    if (id === 'recent') return (
      <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="Recent Transactions" onNavigate={setTab ? () => setTab('txns') : undefined}>
        {recentTxns.length === 0 ? (
          <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>No transactions yet.</div>
        ) : (
          <div>
            {recentTxns.map(t => {
              const cat = catById(t.category);
              return (
                <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: cat.color + '22', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color, display: 'inline-block' }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.merchant}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                      <span className="cat-pill" style={{ color: cat.color }}>{cat.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>{t.date.slice(5).replace('-', '/')}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.amount >= 0 ? 'var(--green)' : 'var(--ink)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {fmt(t.amount, { sign: true })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DragCard>
    );

    if (id === 'funfact') {
      if (!funFact) return null;
      return (
        <DragCard key={id} id={id} index={index} order={order} onReorder={handleReorder} title="✨ Fun Fact">
          <div style={{
            display: 'flex', gap: 14, alignItems: 'flex-start',
            background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 15%, transparent)',
            borderRadius: 10, padding: '14px 16px',
          }}>
            <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>{funFact.emoji}</span>
            <p style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.65, margin: 0 }}>
              {funFact.text}
            </p>
          </div>
        </DragCard>
      );
    }

    return null;
  }

  const curSummary = useMemo(() => monthSummary(curMonthKey || ''), [curMonthKey]);
  const monthLabel = curMonthKey
    ? new Date(curMonthKey + '-02').toLocaleString('default', { month: 'long', year: 'numeric' })
    : 'This Month';

  return (
    <div className="tab-body">
      <div className="grid-overview">
        {order.map((id, idx) => renderWidget(id, idx))}
      </div>
    </div>
  );
}

export default OverviewTab;
export { DragCard, OVERVIEW_WIDGETS };
