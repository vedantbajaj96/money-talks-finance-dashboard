// Unit tests for pure helper functions.
// Run with: cd frontend && npm run test
import { describe, it, expect, beforeEach } from 'vitest';
import { fmt, fmtMoney, fmtMoney2, fmtAbbr } from '@/lib/helpers';
import { _populate } from '@/lib/fin';

// Seed minimal data before each test suite so catById / txnsForMonth work.
beforeEach(() => {
  _populate({
    TRANSACTIONS: [
      { id: 't1', date: '2025-06', amount: -50,  category: 'groceries', description: 'Safeway', account_id: 'a1', merchant: '', notes: '', pending: false, approved: true, txn_id: 't1', is_manual: false, flagged: false },
      { id: 't2', date: '2025-06', amount: -20,  category: 'eating-out', description: 'Chipotle', account_id: 'a1', merchant: '', notes: '', pending: false, approved: true, txn_id: 't2', is_manual: false, flagged: false },
      { id: 't3', date: '2025-06', amount: 2000, category: 'income',    description: 'Paycheck', account_id: 'a1', merchant: '', notes: '', pending: false, approved: true, txn_id: 't3', is_manual: false, flagged: false },
      { id: 't4', date: '2025-06', amount: -100, category: 'transfer',  description: 'Transfer', account_id: 'a1', merchant: '', notes: '', pending: false, approved: true, txn_id: 't4', is_manual: false, flagged: false },
      { id: 't5', date: '2025-07', amount: -80,  category: 'shopping',  description: 'Amazon',  account_id: 'a1', merchant: '', notes: '', pending: false, approved: true, txn_id: 't5', is_manual: false, flagged: false },
    ] as any,
    CATEGORIES: [
      { id: 'groceries', name: 'Groceries', color: '#22c55e', icon: '🛒', group: 'variable' },
      { id: 'eating-out', name: 'Eating Out', color: '#f97316', icon: '🍽️', group: 'variable' },
      { id: 'income',     name: 'Income',    color: '#5ec98a', icon: '💰', group: 'income'   },
      { id: 'transfer',   name: 'Transfer',  color: '#94a3b8', icon: '↔',  group: 'transfer' },
      { id: 'shopping',   name: 'Shopping',  color: '#a78bfa', icon: '🛍️', group: 'variable' },
    ] as any,
    ACCOUNTS:          [] as any,
    MONTHS:            [{ key: '2025-06', label: 'June 2025', short: 'Jun' }, { key: '2025-07', label: 'July 2025', short: 'Jul' }] as any,
    RECURRING:         [] as any,
    NET_WORTH_HISTORY: [] as any,
  });
});

describe('fmt', () => {
  it('formats positive with two decimals', () => {
    expect(fmt(123.45)).toBe('$123.45');
  });

  it('formats negative with minus sign', () => {
    expect(fmt(-50)).toBe('−$50.00');
  });

  it('formats with sign option', () => {
    expect(fmt(200, { sign: true })).toBe('+$200.00');
    expect(fmt(-200, { sign: true })).toBe('−$200.00');
  });

  it('zero decimals', () => {
    expect(fmt(1234, { decimals: 0 })).toBe('$1,234');
  });

  it('abbreviates large numbers', () => {
    expect(fmt(1500, { abbr: true, decimals: 0 })).toBe('$1.5k');
    expect(fmt(2500000, { abbr: true, decimals: 0 })).toBe('$2.5M');
  });
});

describe('fmtMoney', () => {
  it('no decimals', () => {
    expect(fmtMoney(99)).toBe('$99');
    expect(fmtMoney(-99)).toBe('−$99');
  });
});

describe('fmtMoney2', () => {
  it('two decimals', () => {
    expect(fmtMoney2(99.5)).toBe('$99.50');
  });
});

describe('fmtAbbr', () => {
  it('abbreviates', () => {
    expect(fmtAbbr(5000)).toBe('$5.0k');
  });
  it('small amounts not abbreviated', () => {
    expect(fmtAbbr(500)).toBe('$500');
  });
});

describe('monthSummary (via imported helpers)', async () => {
  const { monthSummary, txnsForMonth } = await import('@/lib/helpers');

  it('txnsForMonth filters by month key prefix', () => {
    const june = txnsForMonth('2025-06');
    expect(june).toHaveLength(4);
    const july = txnsForMonth('2025-07');
    expect(july).toHaveLength(1);
  });

  it('monthSummary calculates income, expenses, net', () => {
    const s = monthSummary('2025-06');
    expect(s.income).toBe(2000);
    expect(s.expenses).toBe(70); // 50 groceries + 20 eating-out (transfer excluded)
    expect(s.net).toBe(1930);
  });
});

describe('sumByCategory (via imported helpers)', async () => {
  const { sumByCategory, txnsForMonth } = await import('@/lib/helpers');

  it('returns sorted breakdown excluding income/transfer', () => {
    const june = txnsForMonth('2025-06');
    const breakdown = sumByCategory(june);
    expect(breakdown.length).toBe(2);
    expect(breakdown[0].cat).toBe('groceries'); // $50 > $20
    expect(breakdown[0].amount).toBe(50);
  });
});
