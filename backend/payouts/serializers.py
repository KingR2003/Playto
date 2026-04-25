from rest_framework import serializers
from .models import Merchant, Payout, LedgerEntry


class MerchantSerializer(serializers.ModelSerializer):
    balance_paise = serializers.IntegerField(read_only=True)

    class Meta:
        model = Merchant
        fields = ['id', 'name', 'email', 'bank_account_id', 'balance_paise', 'created_at']


class PayoutSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payout
        fields = ['id', 'merchant_id', 'amount_paise', 'status', 'bank_account_id', 'idempotency_key', 'transaction_id', 'created_at', 'updated_at']


class LedgerEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = LedgerEntry
        fields = ['id', 'merchant_id', 'amount_paise', 'entry_type', 'payout_id', 'description', 'created_at']
