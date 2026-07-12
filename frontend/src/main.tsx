// Entry point — fetches /api/fin, populates the data singleton, then mounts <App/>.
// <App/> is not imported until data is ready, so all tab components can read
// TRANSACTIONS/CATEGORIES/etc. as module-level constants without a loading check.

import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { _populate } from '@/lib/fin';
import '@/styles/index.css';

const App = lazy(() => import('@/App'));

const QUIPS = [
  "Hiding your Uber Eats receipts from yourself…",
  "Confirming you are, in fact, not rich yet…",
  "Calculating exactly how many lattes stand between you and a house…",
  "Asking Plaid why it takes this long…",
  "Rounding up your Costco trips to 'groceries'…",
  "Discovering new and exciting ways you spent $47…",
  "Tallying up the 'treat yourself' tax…",
  "Your accountant would not approve of this…",
  "Locating the 47 transactions labeled 'misc'…",
  "Filing your dining spend under 'investment in happiness'…",
  "Notifying your future self…",
  "Performing a financial wellness check. Initial results: concerning…",
  "Loading the part where you swore you'd spend less this month…",
  "Calculating your Costco cost-per-visit. It's not good…",
  "Summoning the ghost of every impulse purchase…",
  "Counting how many times 'just this once' appeared this month…",
  "Estimating time until financial freedom. Recalculating…",
  "Aggregating your vibes into actionable insights…",
  "Preparing the numbers. You may want to sit down…",
];

function showLoadingScreen() {
  const shuffled = [...QUIPS].sort(() => Math.random() - 0.5);
  let qi = 0;
  const INTERVAL = 5000 + Math.random() * 2000;

  document.getElementById('root')!.innerHTML = `
    <style>
      @keyframes _bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
      @keyframes _quip { 0%{opacity:0;transform:translateY(6px)} 15%,85%{opacity:1;transform:translateY(0)} 100%{opacity:0;transform:translateY(-6px)} }
      ._c{display:inline-block;font-size:36px;animation:_bounce 1s ease-in-out infinite}
      ._c:nth-child(2){animation-delay:.15s} ._c:nth-child(3){animation-delay:.30s}
    </style>
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:20px;font-family:sans-serif;background:#f6f5f2">
      <div style="display:flex;gap:8px"><span class="_c">💰</span><span class="_c">📈</span><span class="_c">💸</span></div>
      <div style="text-align:center">
        <div style="font-size:18px;font-weight:700;color:#14181f;margin-bottom:6px">MoneyTalks</div>
        <div id="_quip" style="font-size:14px;color:#7a8090;font-weight:500;min-height:1.4em"></div>
      </div>
    </div>
  `;

  function nextQuip() {
    const el = document.getElementById('_quip');
    if (!el) return;
    el.textContent = shuffled[qi++ % shuffled.length];
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = `_quip ${INTERVAL}ms ease both`;
  }
  nextQuip();
  return setInterval(nextQuip, INTERVAL);
}

async function bootstrap() {
  const timer = showLoadingScreen();

  let data;
  try {
    const res = await fetch('/api/fin');
    if (res.status === 401) { window.location.href = '/login'; return; }
    data = await res.json();
    clearInterval(timer);
  } catch {
    clearInterval(timer);
    document.getElementById('root')!.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:12px;font-family:sans-serif;background:#f6f5f2">
        <div style="font-size:40px">⚠️</div>
        <h2 style="color:#14181f;margin:0">Could not connect to server</h2>
        <p style="color:#7a8090;margin:0">Make sure the backend is running.</p>
      </div>
    `;
    return;
  }

  _populate(data);

  // Reset root and mount React — App and all tabs are lazy-loaded from here
  document.getElementById('root')!.innerHTML = '';
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </React.StrictMode>
  );
}

bootstrap();
