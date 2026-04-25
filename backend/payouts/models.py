import uuid
from django.db import models, transaction
from django.db.models import Sum, Case, When, F, IntegerField
from django.db.models.functions import Coalesce

class Merchant(models.Model):
    name = models.CharField(max_length=255)
    email = models.EmailField(unique=True)
    bank_account_id = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

    @property
    def balance_paise(self):
        """
        Calculates the balance dynamically from the ledger.
        Balance = SUM(CREDIT) - SUM(DEBIT)
        """
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
        return result['total']

class Payout(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('PROCESSING', 'Processing'),
        ('COMPLETED', 'Completed'),
        ('FAILED', 'Failed'),
    ]

    merchant = models.ForeignKey(Merchant, on_delete=models.CASCADE, related_name='payouts')
    amount_paise = models.BigIntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    bank_account_id = models.CharField(max_length=100)
    idempotency_key = models.UUIDField(null=True, blank=True)
    transaction_id = models.CharField(max_length=100, null=True, blank=True)
    attempts = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Payout {self.id} - {self.status}"

class LedgerEntry(models.Model):
    ENTRY_TYPE_CHOICES = [
        ('CREDIT', 'Credit'), # Customer payment
        ('DEBIT', 'Debit'),   # Payout request
    ]

    merchant = models.ForeignKey(Merchant, on_delete=models.CASCADE, related_name='ledger_entries')
    amount_paise = models.BigIntegerField()
    entry_type = models.CharField(max_length=10, choices=ENTRY_TYPE_CHOICES)
    payout = models.ForeignKey(Payout, on_delete=models.SET_NULL, null=True, blank=True)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "Ledger entries"

class IdempotencyKey(models.Model):
    key = models.UUIDField()
    merchant = models.ForeignKey(Merchant, on_delete=models.CASCADE)
    response_data = models.JSONField(null=True)
    status_code = models.IntegerField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('key', 'merchant')
