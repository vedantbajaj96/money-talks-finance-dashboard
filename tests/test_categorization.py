"""
Unit tests for the pure categorization functions in core/categories.py and core/fin_data.py.

No parquet files, no network, no ML model needed — just function calls.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.categories import map_category, _resolve_category
from core.fin_data import _month_labels


class TestMapCategory:
    def test_human_name_dining(self):
        assert map_category("Dining & Drinks") == "dining"

    def test_slug_dining(self):
        assert map_category("dining-and-drinks") == "dining"

    def test_income_paycheck(self):
        assert map_category("Paycheck & Salary") == "income"

    def test_income_freelance(self):
        assert map_category("Freelance & Side Income") == "income"

    def test_transport(self):
        assert map_category("Commute & Transport") == "transport"

    def test_rent(self):
        assert map_category("Housing & Utilities") == "rent"

    def test_subs(self):
        assert map_category("Connectivity") == "subs"

    def test_unknown_falls_back_to_slugified(self):
        assert map_category("My Custom Category") == "my-custom-category"

    def test_unknown_ampersand_slugified(self):
        assert map_category("Food & Wine") == "food-and-wine"

    def test_legacy_groceries(self):
        assert map_category("Groceries") == "groceries"

    def test_legacy_entertainment(self):
        assert map_category("Entertainment") == "entertainment"

    def test_already_valid_id(self):
        assert map_category("dining") == "dining"


class TestResolveCategory:
    def test_automatic_payment_forces_transfer(self):
        assert _resolve_category("Automatic Payment - Chase", "Dining & Drinks", None, 50.0) == "transfer"

    def test_payment_thank_you_forces_transfer(self):
        assert _resolve_category("PAYMENT - THANK YOU", "Other", None, 200.0) == "transfer"

    def test_online_transfer_from(self):
        assert _resolve_category("Online Transfer From Savings", "Other", None, 100.0) == "transfer"

    def test_ach_transfer(self):
        assert _resolve_category("ACH TRANSFER TO EXTERNAL", "Other", None, 500.0) == "transfer"

    def test_account_transfer(self):
        assert _resolve_category("Account Transfer Debit", "Financial & Transfers", None, 100.0) == "transfer"

    def test_category_transfer_passes_through(self):
        assert _resolve_category("Zelle Payment", "Financial & Transfers", None, 50.0) == "transfer"

    def test_reimbursement_becomes_other(self):
        assert _resolve_category("Expensify", "Reimbursements", None, -50.0) == "other"

    def test_negative_amount_no_type_is_income(self):
        assert _resolve_category("Payroll", "Other", None, -2500.0) == "income"

    def test_txn_type_income(self):
        assert _resolve_category("Direct Deposit", "Other", "income", 3000.0) == "income"

    def test_positive_expense_type_not_income(self):
        assert _resolve_category("Chipotle", "Dining & Drinks", "expense", 15.0) == "dining"

    def test_normal_dining_expense(self):
        assert _resolve_category("Chipotle", "Dining & Drinks", None, 12.0) == "dining"

    def test_health_expense(self):
        assert _resolve_category("CVS Pharmacy", "Health & Medical", None, 20.0) == "health"

    def test_transfer_pattern_overrides_income_category(self):
        assert _resolve_category("E-PAYMENT CHASE CREDIT CARD", "Income", None, 800.0) == "transfer"

    def test_unknown_category_slugified(self):
        assert _resolve_category("Some Shop", "My New Category", "expense", 30.0) == "my-new-category"


class TestMonthLabels:
    def test_january(self):
        label, short, short2 = _month_labels("2024-01")
        assert label == "Jan 2024"
        assert short == "Jan"
        assert short2 == "Jan 24"

    def test_december(self):
        label, short, _ = _month_labels("2023-12")
        assert label == "Dec 2023"
        assert short == "Dec"

    def test_march(self):
        label, short, short2 = _month_labels("2024-03")
        assert label == "Mar 2024"
        assert short == "Mar"
        assert short2 == "Mar 24"
