from django.urls import path
from . import views

urlpatterns = [
    # Merchant endpoints
    path('merchants/', views.MerchantListView.as_view(), name='merchant-list'),
    path('merchants/<int:merchant_id>/balance/', views.MerchantBalanceView.as_view(), name='merchant-balance'),
    path('merchants/<int:merchant_id>/ledger/', views.LedgerView.as_view(), name='merchant-ledger'),
    
    # Payout endpoints
    path('payouts/', views.PayoutCreateView.as_view(), name='payout-create'),
    path('payouts/<int:merchant_id>/', views.PayoutListView.as_view(), name='payout-list'),
    
    # Debug/Test endpoints
    path('merchants/<int:merchant_id>/add-funds/', views.DebugAddFundsView.as_view(), name='debug-add-funds'),
]
