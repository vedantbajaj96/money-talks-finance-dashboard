// Central TypeScript types for MoneyTalks.
// Import from here rather than defining inline: import type { Transaction } from '@/types'

export interface Transaction {
  id?: string;
  txn_id?: string;
  date: string;          // 'YYYY-MM-DD'
  description: string;
  merchant?: string;
  amount: number;        // positive = expense, negative = income/refund
  category: string;
  source?: string;
  notes?: string;
  tags?: string;
  approved?: boolean;
  flagged?: boolean;
  lat?: number;
  lon?: number;
  location_city?: string;
  location_region?: string;
  location_address?: string;
  pending?: boolean;
  plaid_txn_id?: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon?: string;
  group?: string;
}

export interface Account {
  id: string;
  name: string;
  color: string;
  type?: string;
  balance?: number;
  institution?: string;
}

export interface MonthKey {
  key: string;    // 'YYYY-MM'
  label: string;  // 'January 2026'
  short: string;  // 'Jan'
}

export interface RecurringItem {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  category: string;
  next_date?: string;
}

export interface NetWorthEntry {
  date: string;
  net_worth: number;
  assets?: number;
  liabilities?: number;
}

export interface FinData {
  ACCOUNTS: Account[];
  CATEGORIES: Category[];
  MONTHS: MonthKey[];
  TRANSACTIONS: Transaction[];
  RECURRING: RecurringItem[];
  NET_WORTH_HISTORY: NetWorthEntry[];
}
