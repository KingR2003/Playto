"""
Seed script: Creates 3 merchants with credit history.
Run with: python manage.py seed
"""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from payouts.models import Merchant, LedgerEntry

def run():
    print("Seeding merchants...")

    merchants_data = [
        {
            'name': 'Arjun Sharma Design Co.',
            'email': 'arjun@sharma.design',
            'bank_account_id': 'HDFC-ARJUN-001',
            'credits': [
                (500000, 'USD invoice #INV-001 - Design project'),
                (300000, 'USD invoice #INV-002 - Brand refresh'),
                (150000, 'USD invoice #INV-003 - Logo design'),
            ]
        },
        {
            'name': 'Priya Consulting LLC',
            'email': 'priya@consulting.io',
            'bank_account_id': 'ICICI-PRIYA-002',
            'credits': [
                (1000000, 'USD invoice #INV-101 - Strategy consulting Q1'),
                (750000, 'USD invoice #INV-102 - Market analysis'),
            ]
        },
        {
            'name': 'Rahul Dev Labs',
            'email': 'rahul@devlabs.tech',
            'bank_account_id': 'SBI-RAHUL-003',
            'credits': [
                (200000, 'USD invoice #INV-201 - API integration'),
                (450000, 'USD invoice #INV-202 - Full-stack project'),
                (100000, 'USD invoice #INV-203 - Code review'),
                (80000,  'USD invoice #INV-204 - Bug fixes'),
            ]
        },
    ]

    for data in merchants_data:
        merchant, created = Merchant.objects.get_or_create(
            email=data['email'],
            defaults={
                'name': data['name'],
                'bank_account_id': data['bank_account_id'],
            }
        )
        if created:
            print(f"  Created merchant: {merchant.name}")
            for amount, desc in data['credits']:
                LedgerEntry.objects.create(
                    merchant=merchant,
                    amount_paise=amount,
                    entry_type='CREDIT',
                    description=desc,
                )
            print(f"    Balance: Rs.{merchant.balance_paise / 100:.2f}")
        else:
            print(f"  Merchant already exists: {merchant.name} (Balance: Rs.{merchant.balance_paise / 100:.2f})")

    print("\nSeeding complete!")

if __name__ == '__main__':
    run()
