// data.js — Real data layer for MoneyTalks.
// Fetches live transaction data from the FastAPI backend (/api/fin),
// populates window.FIN with the same interface as the original mock data.js,
// then dynamically loads and transpiles tabs.jsx + app.jsx so they see real data.

// ── Helper functions (same interface as original data.js) ──────────────────

function txnsForMonth(monthKey) {
  return (window.FIN.TRANSACTIONS || []).filter((t) => t.date.startsWith(monthKey));
}

function sumByCategory(txns) {
  const EXCLUDE = new Set(['income', 'transfer', 'refund', 'savings']);
  const map = {};
  txns.forEach((t) => {
    if (EXCLUDE.has(t.category)) return;
    // Expenses (negative amount) add to the total; refunds tagged with a
    // spending category (positive amount) subtract — giving net spend per cat.
    if (t.amount < 0) {
      map[t.category] = (map[t.category] || 0) + Math.abs(t.amount);
    } else if (t.amount > 0) {
      map[t.category] = (map[t.category] || 0) - t.amount;
    }
  });
  return Object.entries(map)
    .filter(([, amt]) => amt > 0) // hide categories that net to zero or negative
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
  const EXCLUDE = new Set(['income', 'transfer', 'refund', 'savings']);
  const txns = txnsForMonth(monthKey);
  const income   = txns.filter((t) => t.category === 'income').reduce((s, t) => s + t.amount, 0);
  // Net expenses: spending minus any refunds tagged with a spending category
  const expenses = Math.max(0, txns
    .filter((t) => !EXCLUDE.has(t.category))
    .reduce((s, t) => t.amount < 0 ? s + Math.abs(t.amount) : s - t.amount, 0));
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

// ── Dynamic script loader ─────────────────────────────────────────────────

// Injects a <script src> tag instead of eval()ing fetched text.
// Benefits: CSP-compatible, real source URLs in browser devtools, no eval.
function loadJSX(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src   = url;
    script.onload  = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.head.appendChild(script);
  });
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
    if (res.status === 401) { window.location.href = '/login'; return; }
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

  // Populate window.FIN — use empty arrays when there's no data yet so the
  // full app loads and the user can reach Settings to upload or connect Plaid.
  window.FIN = {
    ACCOUNTS:          data.ACCOUNTS          || [],
    CATEGORIES:        data.CATEGORIES        || [],
    MONTHS:            data.MONTHS            || [{ key: '', label: 'No data', short: '—' }],
    TRANSACTIONS:      data.TRANSACTIONS      || [],
    RECURRING:         data.RECURRING         || [],
    NET_WORTH_HISTORY: data.NET_WORTH_HISTORY || [],
    txnsForMonth,
    sumByCategory,
    monthSummary,
    fmt,
    catById,
    acctById,
  };

  // Load React components now that FIN is ready
  const files = ['tweaks-panel.jsx', 'charts.jsx', 'tabs.jsx', 'app.jsx'];
  for (const file of files) {
    try {
      await loadJSX(file);
    } catch (e) {
      document.getElementById('root').innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
          height:100vh;gap:12px;font-family:Inter,sans-serif;background:#f6f5f2;padding:20px;box-sizing:border-box;">
          <div style="font-size:32px;">⚠️</div>
          <h2 style="color:#14181f;margin:0;">Failed to load ${file}</h2>
          <pre style="color:#ef4444;font-size:12px;background:#fff;padding:16px;border-radius:8px;
            max-width:600px;overflow:auto;white-space:pre-wrap;">${String(e)}</pre>
        </div>
      `;
      return;
    }
  }
}

bootstrap();
