import random
import time
from datetime import timedelta
import uuid
from django.utils import timezone
from django.db import transaction
from django_huey import db_task, db_periodic_task
from huey import crontab
from .models import Payout, LedgerEntry


@db_task(queue='default', retries=3, retry_delay=2)
def process_payout(payout_id):
    """
    Background task that simulates bank settlement:
    - 70% chance: succeeds -> COMPLETED
    - 20% chance: fails -> FAILED (funds returned)
    - 10% chance: hangs in PROCESSING (handled by retry_stuck_payouts)
    """
    try:
        payout = Payout.objects.get(id=payout_id)
    except Payout.DoesNotExist:
        return

    # State machine: only process PENDING or PROCESSING (if retried)
    if payout.status not in ('PENDING', 'PROCESSING'):
        return

    # Move to PROCESSING
    with transaction.atomic():
        payout_locked = Payout.objects.select_for_update().get(id=payout_id)
        if payout_locked.status not in ('PENDING', 'PROCESSING'):
            return
        if payout_locked.status == 'PENDING':
            payout_locked.status = 'PROCESSING'
            payout_locked.save()

    # Simulate bank call
    outcome = random.random()

    if outcome < 0.10:
        # 10%: hang — do nothing, periodic retry logic will catch it
        return

    elif outcome < 0.30:
        # 20%: failure — return funds atomically
        with transaction.atomic():
            payout_locked = Payout.objects.select_for_update().get(id=payout_id)
            if payout_locked.status != 'PROCESSING':
                return
            # Create reversal credit entry atomically with state change
            LedgerEntry.objects.create(
                merchant=payout_locked.merchant,
                amount_paise=payout_locked.amount_paise,
                entry_type='CREDIT',
                payout=payout_locked,
                description=f'Reversal: payout #{payout_id} failed',
            )
            payout_locked.status = 'FAILED'
            payout_locked.save()
    else:
        # 70%: success
        with transaction.atomic():
            payout_locked = Payout.objects.select_for_update().get(id=payout_id)
            if payout_locked.status != 'PROCESSING':
                return
            # Create debit ledger entry
            LedgerEntry.objects.create(
                merchant=payout_locked.merchant,
                amount_paise=payout_locked.amount_paise,
                entry_type='DEBIT',
                payout=payout_locked,
                description=f'Payout #{payout_id} settled to {payout_locked.bank_account_id}',
            )
            payout_locked.status = 'COMPLETED'
            payout_locked.transaction_id = f"TRX-{uuid.uuid4().hex[:12].upper()}"
            payout_locked.save()


@db_periodic_task(crontab(minute='*'), queue='default')
def retry_stuck_payouts():
    """
    Finds payouts stuck in PROCESSING and retries them.
    Exponential backoff: 30s * (2^attempts). Max 3 attempts, then mark FAILED.
    """
    now = timezone.now()
    stuck_payouts = Payout.objects.filter(status='PROCESSING')
    
    for p in stuck_payouts:
        # calculate exponential backoff delay
        delay_seconds = 30 * (2 ** p.attempts)
        if p.updated_at < now - timedelta(seconds=delay_seconds):
            if p.attempts >= 3:
                # Max retries reached, fail it
                with transaction.atomic():
                    p_locked = Payout.objects.select_for_update().get(id=p.id)
                    if p_locked.status != 'PROCESSING':
                        continue
                    
                    LedgerEntry.objects.create(
                        merchant=p_locked.merchant,
                        amount_paise=p_locked.amount_paise,
                        entry_type='CREDIT',
                        payout=p_locked,
                        description=f'Reversal: payout #{p.id} failed after max retries',
                    )
                    p_locked.status = 'FAILED'
                    p_locked.save()
            else:
                # Increment attempts and retry
                with transaction.atomic():
                    p_locked = Payout.objects.select_for_update().get(id=p.id)
                    if p_locked.status != 'PROCESSING':
                        continue
                    p_locked.attempts += 1
                    p_locked.save() # Updates updated_at to reset backoff window
                
                process_payout(p.id)
