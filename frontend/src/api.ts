import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://playto-mw1t.onrender.com/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

export interface Merchant {
  id: number;
  name: string;
  email: string;
  bank_account_id: string;
  balance_paise: number;
  created_at: string;
}

export interface BalanceInfo {
  merchant_id: number;
  name: string;
  total_balance_paise: number;
  held_balance_paise: number;
  available_balance_paise: number;
}

export interface Payout {
  id: number;
  merchant_id: number;
  amount_paise: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  bank_account_id: string;
  idempotency_key: string;
  transaction_id?: string;
  created_at: string;
  updated_at: string;
}

export interface LedgerEntry {
  id: number;
  merchant_id: number;
  amount_paise: number;
  entry_type: 'CREDIT' | 'DEBIT';
  payout_id: number | null;
  description: string;
  created_at: string;
}

export interface PayoutCreatePayload {
  merchant_id: number;
  amount_paise: number;
  bank_account_id: string;
}

// --- API Functions ---
export const fetchMerchants = () =>
  api.get<Merchant[]>('/merchants/').then(r => r.data);

export const fetchBalance = (merchantId: number) =>
  api.get<BalanceInfo>(`/merchants/${merchantId}/balance/`).then(r => r.data);

export const fetchPayouts = (merchantId: number) =>
  api.get<Payout[]>(`/payouts/${merchantId}/`).then(r => r.data);

export const fetchLedger = (merchantId: number) =>
  api.get<LedgerEntry[]>(`/merchants/${merchantId}/ledger/`).then(r => r.data);

export const createPayout = (payload: PayoutCreatePayload, idempotencyKey: string) =>
  api.post<Payout>('/payouts/', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then(r => r.data);
export const debugAddFunds = (merchantId: number) =>
  api.post<{ message: string; new_balance: number }>(`/merchants/${merchantId}/add-funds/`).then(r => r.data);


// Utility
export const formatInr = (paise: number): string => {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(rupees);
};
