import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, TrendingUp, Clock, AlertCircle, CheckCircle2,
  XCircle, RefreshCw, Send, ChevronDown, Activity,
  ArrowUpRight, ArrowDownLeft, Loader2, Zap
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import {
  fetchMerchants, fetchBalance, fetchPayouts, fetchLedger,
  createPayout, formatInr,
  type Merchant, type Payout, type LedgerEntry
} from './api';

// ─── Status Badge ─────────────────────────────────────────────────────────────
const statusConfig = {
  PENDING:    { label: 'Pending',    color: 'text-amber-400   bg-amber-400/10   border-amber-400/20',   icon: Clock },
  PROCESSING: { label: 'Processing', color: 'text-blue-400    bg-blue-400/10    border-blue-400/20',   icon: Loader2 },
  COMPLETED:  { label: 'Completed',  color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20', icon: CheckCircle2 },
  FAILED:     { label: 'Failed',     color: 'text-rose-400    bg-rose-400/10    border-rose-400/20',    icon: XCircle },
};

const StatusBadge = ({ status }: { status: Payout['status'] }) => {
  const cfg = statusConfig[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${cfg.color}`}>
      <Icon size={11} className={status === 'PROCESSING' ? 'animate-spin' : ''} />
      {cfg.label}
    </span>
  );
};

// ─── Balance Card ─────────────────────────────────────────────────────────────
const BalanceCard = ({ label, amount, sub, accent, icon: Icon }: {
  label: string; amount: number; sub?: string; accent: string; icon: React.ElementType;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    className="relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.03] p-6 backdrop-blur"
  >
    <div className={`absolute inset-0 opacity-[0.04] ${accent}`} style={{ background: 'radial-gradient(ellipse at top left, currentColor 0%, transparent 70%)' }} />
    <div className="flex items-start justify-between mb-4">
      <span className="text-sm text-slate-400 font-medium">{label}</span>
      <div className={`p-2 rounded-xl ${accent} bg-current/10`}>
        <Icon size={16} className={accent} />
      </div>
    </div>
    <p className="text-3xl font-bold tracking-tight text-slate-100">{formatInr(amount)}</p>
    {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
  </motion.div>
);

// ─── Payout Form ──────────────────────────────────────────────────────────────
const PayoutForm = ({ merchant, onSuccess }: { merchant: Merchant; onSuccess: () => void }) => {
  const [amountRupees, setAmountRupees] = useState('');
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => createPayout(
      {
        merchant_id: merchant.id,
        amount_paise: Math.round(parseFloat(amountRupees) * 100),
        bank_account_id: merchant.bank_account_id,
      },
      uuidv4()
    ),
    onSuccess: () => {
      setAmountRupees('');
      setError('');
      queryClient.invalidateQueries({ queryKey: ['balance', merchant.id] });
      queryClient.invalidateQueries({ queryKey: ['payouts', merchant.id] });
      queryClient.invalidateQueries({ queryKey: ['ledger', merchant.id] });
      onSuccess();
    },
    onError: (err: any) => {
      console.error("Mutation Error:", err);
      const msg = err?.response?.data?.error || err?.message || String(err) || 'Failed to create payout';
      setError(msg);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const amount = parseFloat(amountRupees);
    if (isNaN(amount) || amount <= 0) return setError('Enter a valid amount');
    mutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2">Amount (₹)</label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">₹</span>
          <input
            id="payout-amount"
            type="number"
            min="1"
            step="0.01"
            value={amountRupees}
            onChange={e => setAmountRupees(e.target.value)}
            placeholder="0.00"
            className="w-full pl-8 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder-slate-600 text-sm focus:outline-none focus:border-indigo-500/60 focus:bg-white/[0.07] transition-all"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2">Bank Account</label>
        <div className="flex items-center gap-2 px-3.5 py-3 rounded-xl bg-white/5 border border-white/10">
          <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
          <span className="text-sm text-slate-300 font-mono">{merchant.bank_account_id}</span>
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 text-rose-400 text-sm bg-rose-400/10 border border-rose-400/20 rounded-xl px-3.5 py-2.5"
          >
            <AlertCircle size={14} />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        id="submit-payout"
        type="submit"
        disabled={mutation.isPending || !amountRupees}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all duration-200 shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/40"
      >
        {mutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        {mutation.isPending ? 'Processing…' : 'Request Payout'}
      </button>
    </form>
  );
};

// ─── Payout Table ─────────────────────────────────────────────────────────────
const PayoutTable = ({ payouts, isLoading }: { payouts: Payout[]; isLoading: boolean }) => {
  if (isLoading) return (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="skeleton h-14 rounded-xl" />
      ))}
    </div>
  );
  if (!payouts.length) return (
    <div className="text-center py-12 text-slate-500">
      <Activity size={32} className="mx-auto mb-3 opacity-40" />
      <p className="text-sm">No payouts yet</p>
    </div>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5">
            {['ID / TRX', 'Amount', 'Status', 'Created'].map(h => (
              <th key={h} className="pb-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          <AnimatePresence initial={false}>
            {payouts.map(p => (
              <motion.tr
                key={p.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="group hover:bg-white/[0.02] transition-colors"
              >
                <td className="py-3.5 pr-4 font-mono text-xs">
                  <div className="text-slate-400 font-semibold">#{p.id}</div>
                  {p.transaction_id && (
                    <div className="text-[10px] text-indigo-400/80 mt-0.5 tracking-wider">{p.transaction_id}</div>
                  )}
                </td>
                <td className="py-3.5 pr-4 font-semibold text-slate-200">{formatInr(p.amount_paise)}</td>
                <td className="py-3.5 pr-4"><StatusBadge status={p.status} /></td>
                <td className="py-3.5 text-slate-500 text-xs">{new Date(p.created_at).toLocaleString('en-IN')}</td>
              </motion.tr>
            ))}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
};

// ─── Ledger Feed ──────────────────────────────────────────────────────────────
const LedgerFeed = ({ entries, isLoading }: { entries: LedgerEntry[]; isLoading: boolean }) => {
  if (isLoading) return (
    <div className="space-y-2">
      {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-12 rounded-xl" />)}
    </div>
  );
  if (!entries.length) return (
    <p className="text-sm text-slate-500 text-center py-8">No transactions yet</p>
  );
  return (
    <div className="space-y-1">
      {entries.map(e => (
        <motion.div
          key={e.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.03] transition-colors"
        >
          <div className={`p-1.5 rounded-lg flex-shrink-0 ${e.entry_type === 'CREDIT' ? 'bg-emerald-400/10' : 'bg-rose-400/10'}`}>
            {e.entry_type === 'CREDIT'
              ? <ArrowDownLeft size={13} className="text-emerald-400" />
              : <ArrowUpRight size={13} className="text-rose-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-300 truncate">{e.description}</p>
            <p className="text-[11px] text-slate-600">{new Date(e.created_at).toLocaleString('en-IN')}</p>
          </div>
          <span className={`text-sm font-semibold flex-shrink-0 ${e.entry_type === 'CREDIT' ? 'text-emerald-400' : 'text-rose-400'}`}>
            {e.entry_type === 'CREDIT' ? '+' : '-'}{formatInr(e.amount_paise)}
          </span>
        </motion.div>
      ))}
    </div>
  );
};

// ─── Merchant Selector ────────────────────────────────────────────────────────
const MerchantSelector = ({
  merchants, selected, onChange
}: { merchants: Merchant[]; selected: Merchant | null; onChange: (m: Merchant) => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        id="merchant-selector"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:border-indigo-500/40 transition-all min-w-[220px]"
      >
        <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center flex-shrink-0">
          <span className="text-indigo-400 text-sm font-bold">{selected?.name[0] ?? '?'}</span>
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-medium text-slate-200 leading-tight">{selected?.name ?? 'Select merchant'}</p>
          {selected && <p className="text-xs text-slate-500 font-mono">{selected.email}</p>}
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute top-full left-0 mt-2 w-full min-w-[280px] z-50 rounded-xl border border-white/10 bg-[#131623] shadow-2xl overflow-hidden"
          >
            {merchants.map(m => (
              <button
                key={m.id}
                onClick={() => { onChange(m); setOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-indigo-400 text-sm font-bold">{m.name[0]}</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-200">{m.name}</p>
                  <p className="text-xs text-slate-500">{formatInr(m.balance_paise)}</p>
                </div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const queryClient = useQueryClient();

  const { data: merchants = [], isLoading: merchantsLoading } = useQuery<Merchant[]>({
    queryKey: ['merchants'],
    queryFn: fetchMerchants,
  });

  // Auto-select first merchant
  React.useEffect(() => {
    if (!selectedMerchant && merchants.length) setSelectedMerchant(merchants[0]);
  }, [merchants, selectedMerchant]);

  const mid = selectedMerchant?.id;

  const { data: balance, isLoading: balanceLoading } = useQuery({
    queryKey: ['balance', mid],
    queryFn: () => fetchBalance(mid!),
    enabled: !!mid,
    refetchInterval: 4000,
  });

  const { data: payouts = [], isLoading: payoutsLoading } = useQuery<Payout[]>({
    queryKey: ['payouts', mid],
    queryFn: () => fetchPayouts(mid!),
    enabled: !!mid,
    refetchInterval: 4000,
  });

  const { data: ledger = [], isLoading: ledgerLoading } = useQuery<LedgerEntry[]>({
    queryKey: ['ledger', mid],
    queryFn: () => fetchLedger(mid!),
    enabled: !!mid,
    refetchInterval: 4000,
  });

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['balance', mid] });
    queryClient.invalidateQueries({ queryKey: ['payouts', mid] });
    queryClient.invalidateQueries({ queryKey: ['ledger', mid] });
  }, [mid, queryClient]);

  const handlePayoutSuccess = useCallback(() => {
    setSuccessMsg('Payout queued! It will process in the background.');
    setTimeout(() => setSuccessMsg(''), 4000);
    handleRefresh();
  }, [handleRefresh]);

  return (
    <div className="min-h-screen bg-[#0a0b0f] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.08),transparent)]">
      {/* Header */}
      <header className="border-b border-white/5 backdrop-blur sticky top-0 z-40 bg-[#0a0b0f]/80">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <Zap size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-100 leading-none">Playto Pay</h1>
              <p className="text-[11px] text-slate-500 mt-0.5">Payout Engine</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!merchantsLoading && (
              <MerchantSelector
                merchants={merchants}
                selected={selectedMerchant}
                onChange={setSelectedMerchant}
              />
            )}
            <button
              id="refresh-btn"
              onClick={handleRefresh}
              className="p-2.5 rounded-xl border border-white/10 hover:border-white/20 text-slate-400 hover:text-slate-200 transition-all"
              title="Refresh"
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* Success toast */}
      <AnimatePresence>
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium shadow-xl"
          >
            <CheckCircle2 size={15} />
            {successMsg}
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {!merchantsLoading && merchants.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <AlertCircle size={32} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">No merchants found in database.</p>
            <p className="text-xs mt-1">Please seed your database to get started.</p>
          </div>
        ) : !selectedMerchant ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 size={24} className="animate-spin text-indigo-400" />
          </div>
        ) : (
          <div className="space-y-6 animate-fade-in-up">
            {/* Balance Cards */}
            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Balance Overview</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {balanceLoading ? (
                  [...Array(3)].map((_, i) => <div key={i} className="skeleton h-36 rounded-2xl" />)
                ) : balance ? (
                  <>
                    <BalanceCard
                      label="Available Balance"
                      amount={balance.available_balance_paise}
                      sub="Ready to withdraw"
                      accent="text-emerald-400"
                      icon={TrendingUp}
                    />
                    <BalanceCard
                      label="Held Balance"
                      amount={balance.held_balance_paise}
                      sub="Pending / processing payouts"
                      accent="text-amber-400"
                      icon={Clock}
                    />
                    <BalanceCard
                      label="Total Balance"
                      amount={balance.total_balance_paise}
                      sub="Available + held"
                      accent="text-indigo-400"
                      icon={Wallet}
                    />
                  </>
                ) : null}
              </div>
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left: Payout Form + Ledger */}
              <div className="space-y-6">
                {/* Payout Form */}
                <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 backdrop-blur">
                  <h2 className="text-sm font-semibold text-slate-200 mb-5 flex items-center gap-2">
                    <Send size={15} className="text-indigo-400" /> Request Payout
                  </h2>
                  <PayoutForm merchant={selectedMerchant} onSuccess={handlePayoutSuccess} />
                </div>

                {/* Ledger */}
                <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 backdrop-blur">
                  <h2 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
                    <Activity size={15} className="text-indigo-400" /> Transaction Feed
                  </h2>
                  <LedgerFeed entries={ledger} isLoading={ledgerLoading} />
                </div>
              </div>

              {/* Right: Payout History */}
              <div className="lg:col-span-2 rounded-2xl border border-white/5 bg-white/[0.03] p-6 backdrop-blur">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Wallet size={15} className="text-indigo-400" /> Payout History
                  </h2>
                  <span className="text-xs text-slate-500 bg-white/5 px-2.5 py-1 rounded-full">
                    Auto-refreshes every 4s
                  </span>
                </div>
                <PayoutTable payouts={payouts} isLoading={payoutsLoading} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
