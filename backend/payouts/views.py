import uuid
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Merchant, Payout, LedgerEntry, IdempotencyKey
from .serializers import MerchantSerializer, PayoutSerializer, LedgerEntrySerializer


class MerchantListView(APIView):
    def get(self, request):
        merchants = Merchant.objects.all()
        data = MerchantSerializer(merchants, many=True).data
        return Response(data)


class MerchantBalanceView(APIView):
    def get(self, request, merchant_id):
        try:
            merchant = Merchant.objects.get(id=merchant_id)
        except Merchant.DoesNotExist:
            return Response({'error': 'Merchant not found'}, status=status.HTTP_404_NOT_FOUND)

        # Held balance = sum of PENDING payouts
        held = Payout.objects.filter(
            merchant=merchant,
            status__in=['PENDING', 'PROCESSING']
        ).aggregate(total=Sum('amount_paise'))['total'] or 0

        available = merchant.balance_paise - held
        return Response({
            'merchant_id': merchant.id,
            'name': merchant.name,
            'total_balance_paise': merchant.balance_paise,
            'held_balance_paise': held,
            'available_balance_paise': available,
        })


class LedgerView(APIView):
    def get(self, request, merchant_id):
        try:
            merchant = Merchant.objects.get(id=merchant_id)
        except Merchant.DoesNotExist:
            return Response({'error': 'Merchant not found'}, status=status.HTTP_404_NOT_FOUND)

        entries = LedgerEntry.objects.filter(merchant=merchant).order_by('-created_at')[:50]
        return Response(LedgerEntrySerializer(entries, many=True).data)


class PayoutCreateView(APIView):
    def post(self, request):
        idempotency_key_str = request.headers.get('Idempotency-Key')
        if not idempotency_key_str:
            return Response(
                {'error': 'Idempotency-Key header is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            idempotency_key = uuid.UUID(idempotency_key_str)
        except ValueError:
            return Response({'error': 'Invalid Idempotency-Key format, must be a UUID'}, status=status.HTTP_400_BAD_REQUEST)

        merchant_id = request.data.get('merchant_id')
        amount_paise = request.data.get('amount_paise')
        bank_account_id = request.data.get('bank_account_id')

        if not all([merchant_id, amount_paise, bank_account_id]):
            return Response({'error': 'merchant_id, amount_paise, and bank_account_id are required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            merchant = Merchant.objects.get(id=merchant_id)
        except Merchant.DoesNotExist:
            return Response({'error': 'Merchant not found'}, status=status.HTTP_404_NOT_FOUND)

        # Check idempotency key - return cached response if exists
        existing_key = IdempotencyKey.objects.filter(
            key=idempotency_key,
            merchant=merchant,
            created_at__gte=timezone.now() - timezone.timedelta(hours=24)
        ).first()

        if existing_key and existing_key.response_data is not None:
            return Response(existing_key.response_data, status=existing_key.status_code)

        # Create a placeholder idempotency record (before processing)
        try:
            idem_record, created = IdempotencyKey.objects.get_or_create(
                key=idempotency_key,
                merchant=merchant,
                defaults={'response_data': None, 'status_code': None}
            )
            if not created and idem_record.response_data is None:
                # First request still in flight
                return Response(
                    {'error': 'Request with this Idempotency-Key is already in progress'},
                    status=status.HTTP_409_CONFLICT
                )
        except Exception:
            return Response(
                {'error': 'Request with this Idempotency-Key is already in progress'},
                status=status.HTTP_409_CONFLICT
            )

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
                # Clean up the idempotency placeholder and reject
                idem_record.delete()
                return Response(
                    {
                        'error': 'Insufficient funds',
                        'available_balance_paise': available_balance,
                        'requested_paise': amount_paise,
                    },
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY
                )

            # Create the payout - this HOLDS the funds (no ledger debit yet)
            payout = Payout.objects.create(
                merchant=merchant,
                amount_paise=amount_paise,
                bank_account_id=bank_account_id,
                status='PENDING',
                idempotency_key=idempotency_key,
            )

        response_data = PayoutSerializer(payout).data
        response_status = status.HTTP_201_CREATED

        # Cache the response on the idempotency record
        idem_record.response_data = response_data
        idem_record.status_code = response_status
        idem_record.save()

        # Enqueue background task
        from .tasks import process_payout
        process_payout(payout.id)

        return Response(response_data, status=response_status)


class PayoutListView(APIView):
    def get(self, request, merchant_id):
        try:
            merchant = Merchant.objects.get(id=merchant_id)
        except Merchant.DoesNotExist:
            return Response({'error': 'Merchant not found'}, status=status.HTTP_404_NOT_FOUND)

        payouts = Payout.objects.filter(merchant=merchant).order_by('-created_at')[:50]
        return Response(PayoutSerializer(payouts, many=True).data)

