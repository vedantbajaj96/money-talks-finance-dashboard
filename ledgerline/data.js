// data.js — Real data layer for Ledgerline.
// Fetches live transaction data from the FastAPI backend (/api/fin),
// populates window.FIN with the same interface as the original mock data.js,
// then dynamically loads and transpiles tabs.jsx + app.jsx so they see real data.

// ── Helper functions (same interface as original data.js) ──────────────────

function txnsForMonth(monthKey) {
  return (window.FIN.TRANSACTIONS || []).filter((t) => t.date.startsWith(monthKey));
}

function sumByCategory(txns) {
  const map = {};
  txns.forEach((t) => {
    if (t.category === 'income' || t.category === 'transfer') return;
    if (t.amount >= 0) return; // skip income-signed entries
    map[t.category] = (map[t.category] || 0) + Math.abs(t.amount);
  });
  return Object.entries(map)
    .map(([cat, amt]) => ({
      cat,
      amount: amt,
      ...((window.FIN.CATEGORIES || []).find((c) => c.id === cat) || {
        id: cat, name: cat, color: '#94a3b8', icon: '○', group: 'variable',
      }),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function monthSummary(monthKey) {
  const txns = txnsForMonth(monthKey);
  const income   = txns.filter((t) => t.category === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = txns
    .filter((t) => t.category !== 'income' && t.category !== 'transfer' && t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const savings  = txns
    .filter((t) => t.category === 'savings')
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  return { income, expenses, savings, net: income - expenses };
}

function fmt(amount, opts = {}) {
  const { sign = false, decimals = 2, abbr = false } = opts;
  const abs = Math.abs(amount);
  let str;
  if (abbr && abs >= 1000) {
    str = abs >= 1e6 ? (abs / 1e6).toFixed(1) + 'M' : (abs / 1000).toFixed(1) + 'k';
  } else {
    str = abs.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  const prefix = sign ? (amount >= 0 ? '+' : '−') : amount < 0 ? '−' : '';
  return prefix + '$' + str;
}

function catById(id) {
  return (window.FIN.CATEGORIES || []).find((c) => c.id === id) || {
    id, name: id, color: '#94a3b8', icon: '○', group: 'variable',
  };
}
function acctById(id) {
  return (window.FIN.ACCOUNTS || []).find((a) => a.id === id) || { id, name: id, color: '#94a3b8' };
}

// ── Dynamic JSX loader ────────────────────────────────────────────────────

async function loadJSX(url) {
  const res  = await fetch(url);
  const src  = await res.text();
  const code = Babel.transform(src, { presets: ['react'] }).code;
  // eslint-disable-next-line no-eval
  eval(code);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function bootstrap() {
  // Show loading screen
  document.getElementById('root').innerHTML = `
    <div style="
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:100vh;gap:16px;font-family:Inter,sans-serif;background:#f6f5f2;
    ">
      <div style="
        width:44px;height:44px;border-radius:12px;
        background:linear-gradient(135deg,#5ec98a,#67e8f9);
        display:flex;align-items:center;justify-content:center;
        font-size:22px;box-shadow:0 4px 18px -4px rgba(94,201,138,0.5);
      ">💰</div>
      <div style="font-size:15px;color:#7a8090;font-weight:500;letter-spacing:0.01em;">
        Loading your finances…
      </div>
    </div>
  `;

  let data;
  try {
    const res = await fetch('/api/fin');
    data = await res.json();
  } catch (e) {
    document.getElementById('root').innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:100vh;gap:12px;font-family:Inter,sans-serif;background:#f6f5f2;">
        <div style="font-size:40px;">⚠️</div>
        <h2 style="color:#14181f;margin:0;">Could not connect to server</h2>
        <p style="color:#7a8090;margin:0;">Make sure <code>python3 server.py</code> is running.</p>
      </div>
    `;
    return;
  }

  if (!data.hasData) {
    document.getElementById('root').innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:100vh;gap:16px;font-family:Inter,sans-serif;background:#f6f5f2;">
        <div style="width:64px;height:64px;border-radius:16px;background:#f3f4f6;
          display:flex;align-items:center;justify-content:center;font-size:32px;">📁</div>
        <div style="text-align:center;">
          <h2 style="color:#14181f;margin:0 0 6px 0;">No transactions yet</h2>
          <p style="color:#7a8090;margin:0 0 20px 0;">Upload a bank CSV to get started.</p>
          <a href="http://localhost:8501" target="_blank" style="
            display:inline-block;background:#5ec98a;color:#052015;
            padding:11px 22px;border-radius:9px;text-decoration:none;
            font-weight:600;font-size:14px;font-family:Inter,sans-serif;
          ">Open Upload App →</a>
        </div>
      </div>
    `;
    return;
  }

  // Populate window.FIN with real data + helper functions
  window.FIN = {
    ACCOUNTS:          data.ACCOUNTS,
    CATEGORIES:        data.CATEGORIES,
    MONTHS:            data.MONTHS,
    TRANSACTIONS:      data.TRANSACTIONS,
    RECURRING:         data.RECURRING,
    NET_WORTH_HISTORY: data.NET_WORTH_HISTORY,
    txnsForMonth,
    sumByCategory,
    monthSummary,
    fmt,
    catById,
    acctById,
  };

  // Load React components now that FIN is ready
  await loadJSX('tweaks-panel.jsx');
  await loadJSX('charts.jsx');
  await loadJSX('tabs.jsx');
  await loadJSX('app.jsx');
}

bootstrap();
