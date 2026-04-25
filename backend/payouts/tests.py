import uuid
import concurrent.futures
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework import status
from django.db import connection

from .models import Merchant, LedgerEntry, Payout, IdempotencyKey

class PayoutConcurrencyTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.merchant = Merchant.objects.create(
            name="Test Merchant",
            email="test@merchant.com",
            bank_account_id="BANK123"
        )
        # Give merchant a starting balance of exactly 100 rupees
        LedgerEntry.objects.create(
            merchant=self.merchant,
            amount_paise=10000, # 100 rupees
            entry_type='CREDIT',
            description='Initial deposit'
        )

    def test_concurrent_payouts_do_not_overdraw(self):
        """
        A merchant with 100 rupees submitting two simultaneous 60 rupee 
        payout requests should result in exactly ONE success and ONE failure.
        """
        # Ensure we're not running with a sqlite backend unsuited for this
        if connection.vendor == 'sqlite':
            self.skipTest("select_for_update is not fully supported on sqlite. Run with Postgres.")

        url = reverse('payout-create')
        
        def make_request():
            # Use a new connection constraint by using a test client
            client = APIClient()
            return client.post(
                url,
                {
                    'merchant_id': self.merchant.id,
                    'amount_paise': 6000, # 60 rupees
                    'bank_account_id': self.merchant.bank_account_id
                },
                format='json',
                HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()) # different keys ensuring not blocked by idempotency
            )

        # Run 2 concurrent requests
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(make_request) for _ in range(2)]
            responses = [f.result() for f in concurrent.futures.as_completed(futures)]

        status_codes = [r.status_code for r in responses]
        
        # We expect exactly one 201 Created and one 422 Unprocessable Entity
        self.assertIn(status.HTTP_201_CREATED, status_codes)
        self.assertIn(status.HTTP_422_UNPROCESSABLE_ENTITY, status_codes)
        
        # Verify only one payout was actually created
        self.assertEqual(Payout.objects.count(), 1)
        self.assertEqual(Payout.objects.first().amount_paise, 6000)

class PayoutIdempotencyTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.merchant = Merchant.objects.create(
            name="Test Merchant 2",
            email="test2@merchant.com",
            bank_account_id="BANK456"
        )
        LedgerEntry.objects.create(
            merchant=self.merchant,
            amount_paise=50000,
            entry_type='CREDIT'
        )
        self.url = reverse('payout-create')

    def test_idempotency_returns_exact_same_response(self):
        """
        Calling the API twice with the same idempotency key must return the exact
        same response and not create duplicate payouts.
        """
        idem_key = str(uuid.uuid4())
        payload = {
            'merchant_id': self.merchant.id,
            'amount_paise': 20000,
            'bank_account_id': self.merchant.bank_account_id
        }

        # First request
        response1 = self.client.post(self.url, payload, format='json', HTTP_IDEMPOTENCY_KEY=idem_key)
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Payout.objects.count(), 1)

        # Second request with exactly the same key
        response2 = self.client.post(self.url, payload, format='json', HTTP_IDEMPOTENCY_KEY=idem_key)
        
        # Verify it returns the exact same 201 Created response
        self.assertEqual(response2.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response1.data, response2.data)
        
        # Verify no second payout was created
        self.assertEqual(Payout.objects.count(), 1)
        
        # Verify the key is stored properly
        self.assertEqual(IdempotencyKey.objects.count(), 1)
