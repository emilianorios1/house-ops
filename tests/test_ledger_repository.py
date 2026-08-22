from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import text

from home_lab.cli import run_transform
from home_lab.database import create_schema, get_engine
from home_lab.mercadopago.importer import CSV_COLUMNS, process
from house_ops.ledger import repository


@pytest.fixture(scope="module", autouse=True)
def imported_statement(tmp_path_factory: pytest.TempPathFactory) -> Iterator[None]:
    engine = get_engine()
    create_schema(engine)
    source = tmp_path_factory.mktemp("house-ops-ledger") / "house-ops-ledger.csv"
    source.write_text(
        "INITIAL_BALANCE;CREDITS;DEBITS;FINAL_BALANCE\n"
        "0,00;100,00;-25,00;75,00\n\n"
        + ";".join(CSV_COLUMNS)
        + "\n01-06-2095;Transferencia recibida;house-ops-income;100,00;100,00\n"
        + "02-06-2095;Pago EPE;house-ops-power;-25,00;75,00\n",
        encoding="utf-8",
    )
    statement = process(source, storage_root=source.parent / "store")
    assert run_transform()
    repository._engine.cache_clear()
    yield
    with engine.begin() as connection:
        connection.execute(
            text("DELETE FROM bronze.financial_statements WHERE id = :id"),
            {"id": statement.statement_id},
        )
    repository._engine.cache_clear()


def test_repository_reads_gold_without_pandas_in_requests() -> None:
    start, end = date(2095, 6, 1), date(2095, 6, 30)
    summary = repository.overview(start, end)
    assert summary["income"] == Decimal("100.00")
    assert summary["expenses"] == Decimal("-25.00")
    assert summary["net_flow"] == Decimal("75.00")

    rows = repository.movements(start, end, "EPE")
    assert len(rows) == 1
    assert rows[0]["reference_id"] == "house-ops-power"
    assert rows[0]["category"] == "Luz"
    assert repository.daily_flow(start, end)[1]["expenses"] == Decimal("25.00")
    assert repository.expenses_by_category(start, end)[0] == {
        "category": "Luz",
        "amount": Decimal("25.00"),
    }


def test_all_main_repository_queries_execute_against_real_models() -> None:
    start, end = date(2095, 6, 1), date(2095, 6, 30)
    assert isinstance(repository.bills(start, end), list)
    assert isinstance(repository.credit_card_expenses(start, end), list)
    assert isinstance(repository.credit_card_categories(start, end), list)
    assert isinstance(repository.credit_card_statements(start, end), list)
    assert isinstance(repository.export_invoice_summary(end), dict)
    assert isinstance(repository.export_invoice_monthly(end), list)
    assert isinstance(repository.export_invoices(start, end), list)
    assert isinstance(repository.document_filter_options(start, end), dict)
    assert isinstance(repository.documents(start, end), list)
    assert repository.document_detail(2_147_483_647) is None
    assert isinstance(repository.monthly_shared_expenses(start), dict)


@pytest.mark.parametrize(
    ("gross", "extraordinary", "expected"),
    [
        (Decimal("100000"), Decimal("12000"), Decimal("88000")),
        (Decimal("10000"), Decimal("12000"), Decimal("0")),
    ],
)
def test_net_rent_never_becomes_negative(
    gross: Decimal,
    extraordinary: Decimal,
    expected: Decimal,
) -> None:
    assert repository.calculate_net_rent(gross, extraordinary) == expected


def test_month_helpers_handle_invalid_input_and_leap_year() -> None:
    assert repository.parse_month("2028-02") == date(2028, 2, 1)
    assert repository.parse_month("invalid", default=date(2026, 7, 20)) == date(2026, 7, 1)
    assert repository.month_bounds(date(2028, 2, 12)) == (date(2028, 2, 1), date(2028, 2, 29))
