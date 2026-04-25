# EXPLAINER.md

## The Ledger

```python
        result = LedgerEntry.objects.filter(merchant=self).aggregate(
            total=Coalesce(
                Sum(
                    Case(
                        When(entry_type='CREDIT', then=F('amount_paise')),
                        When(entry_type='DEBIT', then=-F('amount_paise')),
                        output_field=models.BigIntegerField(),
                    )
                ),
                0,
                output_field=models.BigIntegerField()
            )
        )
```

Why did you model credits and debits this way?
I chose a transaction-first double-entry ledger instead of a basic balance column. In financial systems, a simple balance variable is susceptible to drift. By deriving the balance dynamically and strictly from immutable Ledger entry rows, I ensure complete auditability and mathematical correctness.

## The Lock

```python
        # THE CRITICAL SECTION: select_for_update + atomic
        with transaction.atomic():
            # Lock the merchant row to prevent concurrent overdrafts
            merchant = Merchant.objects.select_for_update().get(id=merchant_id)

            # Calculate available balance inside the lock
            held = Payout.objects.filter(
                merchant=merchant,
                status__in=['PENDING', 'PROCESSING']
            ).aggregate(total=Sum('amount_paise'))['total'] or 0
            available_balance = merchant.balance_paise - held

            if amount_paise > available_balance:
```

Explain what database primitive it relies on.
It relies on pessimistic locking via the `SELECT FOR UPDATE` primitive in PostgreSQL. When the query runs inside the database transaction, the database locks the specific merchant's row. Any other concurrent request trying to lock the exact same row will be forced to wait until the current transaction commits or rolls back, cleanly preventing overdraft race conditions.

## The Idempotency

How does your system know it has seen a key before? What happens if the first request is in flight when the second arrives?
The system records merchant-supplied UUIDs in an `IdempotencyKey` table with a unique constraint on `(key, merchant)`. When a request arrives, the view attempts a `get_or_create` for a placeholder. If `get_or_create` indicates the record already exists (`created=False`) AND `response_data` is `None`, it means the first request is currently in-flight holding the lock on that row, so I immediately block it and return a `409 Conflict`. If the first request has finished processing, the data is cached and I return the exact cached `response_data` and status.

## The State Machine

Where in the code is failed-to-completed blocked? Show the check.
It is blocked directly inside the background Hueytask worker `process_payout` using the `select_for_update` lock on the Payout row. Before simulating a bank call and attempting to mark a payout as completed, we explicitly ensure its state is correct.

```python
    # Move to PROCESSING
    with transaction.atomic():
        payout_locked = Payout.objects.select_for_update().get(id=payout_id)
        if payout_locked.status not in ('PENDING', 'PROCESSING'):
            return
```

## The AI Audit

One specific example where AI wrote subtly wrong code (bad locking, wrong aggregation, race condition). Paste what it gave you, what you caught, and what you replaced it with.

AI initially created a single `balance` integer field right on the `Merchant` model and handled payments with simplistic logic:

```python
merchant.balance_paise -= amount_paise
merchant.save()
```

I caught this as a classic race condition and re-architected it by removing the balance field entirely. I replaced it with a Double-Entry Ledger where the balance is a dynamically calculated projection `Sum(credits) - Sum(debits)` using Django's database-level aggregation functions, and forced a database-level pessimistic lock (`select_for_update()`) on the `Merchant` row before ever calculating available funds.

## How to Test the State Machine

The payout background worker (`tasks.py`) relies on a random number generator to simulate real bank settlement probabilities as specified:
- 70% chance: Settles immediately (`COMPLETED`).
- 20% chance: Bank rejects it (`FAILED`).
- 10% chance: Bank API times out (`PROCESSING`).

To naturally observe all states, quickly submit 5-10 back-to-back payouts on the dashboard. Because of the weighted probabilities, you will see a mix of green (`COMPLETED`), red (`FAILED`), and blue (`PROCESSING`) badges. 

If a payout lands on the 10% chance and hangs in `PROCESSING`, you do not need to manually refresh. The frontend actively polls, and the background `retry_stuck_payouts` periodic task acts as a safety-net—sweeping it up, running the exponential backoff delay, and forcibly resolving it in the background.

To cleanly force a specific outcome for testing purposes, temporarily modify `outcome = random.random()` on Line 34 in `backend/payouts/tasks.py`:
- `outcome = 0.25` (Forces `<0.30` block: `FAILED` and refunds account)
- `outcome = 0.05` (Forces `<0.10` block: Hangs in `PROCESSING` and triggers background retries)

## Deployment Note

While the system is strictly architected for asynchronous processing via Huey and Redis (as seen in `tasks.py` and the `Procfile`), for the live Render demonstration, tasks are configured to run in **Immediate Mode**. 

This allows the full state machine and ledger logic to be verified in a single-service environment without requiring a dedicated background worker, which is a paid feature on the hosting provider. The underlying code remains fully background-ready and production-compliant.
