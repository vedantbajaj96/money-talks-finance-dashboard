// Pure utility functions — no React, no side effects.
// Ported from moneytalks/data.js.
// Import what you need: import { fmtMoney, catById } from '@/lib/helpers'

import { CATEGORIES, ACCOUNTS, TRANSACTIONS } from '@/lib/fin';
import type { Category, Account } from '@/types';

// ── Formatting ────────────────────────────────────────────────────────────────

interface FmtOptions {
  sign?: boolean;
  decimals?: number;
  abbr?: boolean;
}

export function fmt(amount: number, opts: FmtOptions = {}): string {
  const { sign = false, decimals = 2, abbr = false } = opts;
  const abs = Math.abs(amount);
  let str: string;
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

export const fmtMoney  = (v: number) => fmt(v, { decimals: 0 });
export const fmtMoney2 = (v: number) => fmt(v, { decimals: 2 });
export const fmtAbbr   = (v: number) => fmt(v, { decimals: 0, abbr: true });

// ── Category / Account lookups ────────────────────────────────────────────────

const FALLBACK_CAT: Category = { id: '', name: '', color: '#94a3b8', icon: '○', group: 'variable' };

export function catById(id: string): Category {
  return CATEGORIES.find(c => c.id === id) || { ...FALLBACK_CAT, id, name: id };
}

export function acctById(id: string): Account {
  return ACCOUNTS.find(a => a.id === id) || { id, name: id, color: '#94a3b8' };
}

// ── Transaction aggregation ───────────────────────────────────────────────────

const EXCLUDE_CATS = new Set(['income', 'transfer', 'refund', 'savings']);

export function txnsForMonth(monthKey: string) {
  return TRANSACTIONS.filter(t => t.date.startsWith(monthKey));
}

export function sumByCategory(txns: typeof TRANSACTIONS) {
  const map: Record<string, number> = {};
  txns.forEach(t => {
    if (EXCLUDE_CATS.has(t.category)) return;
    if (t.amount < 0)      map[t.category] = (map[t.category] || 0) + Math.abs(t.amount);
    else if (t.amount > 0) map[t.category] = (map[t.category] || 0) - t.amount;
  });
  return Object.entries(map)
    .filter(([, amt]) => amt > 0)
    .map(([cat, amount]) => ({
      cat, amount,
      ...(CATEGORIES.find(c => c.id === cat) || { ...FALLBACK_CAT, id: cat, name: cat }),
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function monthSummary(monthKey: string) {
  const txns = txnsForMonth(monthKey);
  const income   = txns.filter(t => t.category === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = Math.max(0, txns
    .filter(t => !EXCLUDE_CATS.has(t.category))
    .reduce((s, t) => t.amount < 0 ? s + Math.abs(t.amount) : s - t.amount, 0));
  const savings  = txns
    .filter(t => t.category === 'savings')
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  return { income, expenses, savings, net: income - expenses };
}
