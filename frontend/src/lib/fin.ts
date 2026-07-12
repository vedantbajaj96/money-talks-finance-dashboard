// Data singleton — populated once at boot from /api/fin, then read-only.
// Import named exports directly: import { TRANSACTIONS } from '@/lib/fin'
// Do NOT mutate these arrays in components — they are the source of truth.
// To refresh after a Plaid sync, call window.location.reload() or re-call _populate().

import type { FinData, Transaction, Category, Account, MonthKey, RecurringItem, NetWorthEntry } from '@/types';

export let TRANSACTIONS:      Transaction[]   = [];
export let CATEGORIES:        Category[]      = [];
export let ACCOUNTS:          Account[]       = [];
export let MONTHS:            MonthKey[]      = [{ key: '', label: 'No data', short: '—' }];
export let RECURRING:         RecurringItem[] = [];
export let NET_WORTH_HISTORY: NetWorthEntry[] = [];

// Called once by main.tsx after /api/fin responds.
export function _populate(data: FinData): void {
  TRANSACTIONS      = data.TRANSACTIONS      || [];
  CATEGORIES        = data.CATEGORIES        || [];
  ACCOUNTS          = data.ACCOUNTS          || [];
  MONTHS            = data.MONTHS?.length    ? data.MONTHS : [{ key: '', label: 'No data', short: '—' }];
  RECURRING         = data.RECURRING         || [];
  NET_WORTH_HISTORY = data.NET_WORTH_HISTORY || [];
}
