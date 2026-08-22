"""Read Gold/Silver and perform the few explicit Bronze writes used by Django."""

from __future__ import annotations

from calendar import monthrange
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache

from sqlalchemy import Engine, text

from home_lab.database import get_engine


@lru_cache(maxsize=1)
def _engine() -> Engine:
    """Reuse one small SQLAlchemy pool per Django worker."""
    return get_engine()


def month_bounds(month: date) -> tuple[date, date]:
    start = month.replace(day=1)
    return start, start.replace(day=monthrange(start.year, start.month)[1])


def parse_month(value: str | None, *, default: date | None = None) -> date:
    fallback = (default or date.today()).replace(day=1)
    if not value:
        return fallback
    try:
        return date.fromisoformat(f"{value[:7]}-01")
    except ValueError:
        return fallback


def _all(statement: str, params: dict[str, object] | None = None) -> list[dict[str, object]]:
    with _engine().connect() as connection:
        return [
            dict(row)
            for row in connection.execute(text(statement), params or {}).mappings()
        ]


def overview(start_date: date, end_date: date) -> dict[str, object]:
    with _engine().connect() as connection:
        row = connection.execute(
            text(
                """
                SELECT
                    coalesce(sum(amount) FILTER (WHERE amount > 0), 0) AS income,
                    coalesce(sum(amount) FILTER (WHERE amount < 0), 0) AS expenses,
                    coalesce(sum(amount), 0) AS net_flow,
                    coalesce((
                        SELECT running_balance
                        FROM gold.movements
                        WHERE release_date BETWEEN :start_date AND :end_date
                        ORDER BY release_date DESC, source_movement_id DESC
                        LIMIT 1
                    ), 0) AS closing_balance
                FROM gold.movements
                WHERE release_date BETWEEN :start_date AND :end_date
                """
            ),
            {"start_date": start_date, "end_date": end_date},
        ).mappings().one()
    return dict(row)


def daily_flow(start_date: date, end_date: date) -> list[dict[str, object]]:
    return _all(
        """
        SELECT
            release_date,
            coalesce(sum(amount) FILTER (WHERE amount > 0), 0) AS income,
            abs(coalesce(sum(amount) FILTER (WHERE amount < 0), 0)) AS expenses
        FROM gold.movements
        WHERE release_date BETWEEN :start_date AND :end_date
        GROUP BY release_date
        ORDER BY release_date
        """,
        {"start_date": start_date, "end_date": end_date},
    )


def expenses_by_category(start_date: date, end_date: date) -> list[dict[str, object]]:
    return _all(
        """
        SELECT category, abs(sum(amount)) AS amount
        FROM gold.movements
        WHERE release_date BETWEEN :start_date AND :end_date AND amount < 0
        GROUP BY category
        ORDER BY amount DESC
        """,
        {"start_date": start_date, "end_date": end_date},
    )


def movements(
    start_date: date,
    end_date: date,
    search: str = "",
    *,
    limit: int = 200,
) -> list[dict[str, object]]:
    return _all(
        """
        SELECT
            release_date,
            description,
            reference_id,
            category,
            amount,
            running_balance,
            source,
            source_origin
        FROM gold.movements
        WHERE release_date BETWEEN :start_date AND :end_date
          AND (:search = '' OR description ILIKE :pattern)
        ORDER BY release_date DESC, source_movement_id DESC
        LIMIT :limit
        """,
        {
            "start_date": start_date,
            "end_date": end_date,
            "search": search.strip(),
            "pattern": f"%{search.strip()}%",
            "limit": limit,
        },
    )


def bills(start_date: date, end_date: date) -> list[dict[str, object]]:
    return _all(
        """
        SELECT
            bills.bill_id,
            bills.document_id,
            bills.document_type,
            bills.issuer,
            bills.period,
            bills.first_due_date,
            bills.current_amount,
            bills.status,
            coalesce(sum(payments.paid_amount), 0) AS paid_amount
        FROM gold.bills bills
        LEFT JOIN gold.bill_payments payments ON payments.invoice_id = bills.bill_id
        WHERE coalesce(bills.first_due_date, bills.issue_date)
              BETWEEN :start_date AND :end_date
        GROUP BY
            bills.bill_id, bills.document_id, bills.document_type, bills.issuer,
            bills.period, bills.first_due_date, bills.current_amount, bills.status
        ORDER BY bills.first_due_date, bills.bill_id DESC
        """,
        {"start_date": start_date, "end_date": end_date},
    )


def credit_card_expenses(
    start_date: date,
    end_date: date,
    search: str = "",
) -> list[dict[str, object]]:
    return _all(
        """
        SELECT
            purchase_date, category, description, card, installment,
            currency, amount, statement_period, statement_due_date
        FROM gold.credit_card_expenses
        WHERE purchase_date BETWEEN :start_date AND :end_date
          AND (
              :search = ''
              OR description ILIKE :pattern
              OR category ILIKE :pattern
          )
        ORDER BY purchase_date DESC, statement_id DESC, line_number DESC
        LIMIT 300
        """,
        {
            "start_date": start_date,
            "end_date": end_date,
            "search": search.strip(),
            "pattern": f"%{search.strip()}%",
        },
    )


def credit_card_categories(start_date: date, end_date: date) -> list[dict[str, object]]:
    return _all(
        """
        SELECT category, sum(amount) AS amount
        FROM gold.credit_card_expenses
        WHERE purchase_date BETWEEN :start_date AND :end_date AND currency = 'ARS'
        GROUP BY category
        ORDER BY amount DESC
        """,
        {"start_date": start_date, "end_date": end_date},
    )


def credit_card_statements(start_date: date, end_date: date) -> list[dict[str, object]]:
    return _all(
        """
        SELECT
            bill_id AS statement_id, period, issue_date,
            first_due_date AS due_date, total_amount, foreign_total_amount,
            foreign_currency, minimum_payment, status
        FROM gold.bills
        WHERE document_type = 'credit_card_statement'
          AND issue_date BETWEEN :start_date AND :end_date
        ORDER BY issue_date DESC, bill_id DESC
        """,
        {"start_date": start_date, "end_date": end_date},
    )


def export_invoice_summary(as_of: date) -> dict[str, object]:
    with _engine().connect() as connection:
        row = connection.execute(
            text(
                """
                SELECT
                    coalesce(sum(foreign_total_amount) FILTER (
                        WHERE issue_date >= date_trunc('month', cast(:as_of AS date))
                    ), 0) AS current_month_usd,
                    coalesce(sum(total_amount_ars) FILTER (
                        WHERE issue_date >= date_trunc('month', cast(:as_of AS date))
                    ), 0) AS current_month_ars,
                    coalesce(sum(total_amount_ars), 0) AS rolling_12_month_ars,
                    count(*) AS invoice_count
                FROM gold.export_invoices
                WHERE issue_date >= date_trunc('month', cast(:as_of AS date)) - interval '11 months'
                  AND issue_date <= cast(:as_of AS date)
                """
            ),
            {"as_of": as_of},
        ).mappings().one()
    return dict(row)


def export_invoice_monthly(as_of: date) -> list[dict[str, object]]:
    return _all(
        """
        SELECT
            date_trunc('month', issue_date)::date AS month,
            sum(foreign_total_amount) AS total_usd,
            sum(total_amount_ars) AS total_amount_ars,
            count(*) AS invoice_count
        FROM gold.export_invoices
        WHERE issue_date >= date_trunc('month', cast(:as_of AS date)) - interval '11 months'
          AND issue_date <= cast(:as_of AS date)
        GROUP BY 1
        ORDER BY 1
        """,
        {"as_of": as_of},
    )


def export_invoices(start_date: date, end_date: date) -> list[dict[str, object]]:
    return _all(
        """
        SELECT
            invoice_id, invoice_key, issue_date, payment_date, foreign_currency,
            foreign_total_amount, exchange_rate, total_amount_ars, cae, cae_due_date
        FROM gold.export_invoices
        WHERE issue_date BETWEEN :start_date AND :end_date
        ORDER BY issue_date DESC, invoice_key DESC
        """,
        {"start_date": start_date, "end_date": end_date},
    )


def document_filter_options(start_date: date, end_date: date) -> dict[str, list[str]]:
    rows = _all(
        """
        SELECT DISTINCT document_type, issuer, parse_status
        FROM gold.documents
        WHERE coalesce(issue_date, received_at::date) BETWEEN :start_date AND :end_date
        """,
        {"start_date": start_date, "end_date": end_date},
    )
    return {
        key: sorted({str(row[key]) for row in rows if row[key]})
        for key in ("document_type", "issuer", "parse_status")
    }


def documents(
    start_date: date,
    end_date: date,
    search: str = "",
    *,
    document_type: str = "",
    parse_status: str = "",
    limit: int = 100,
) -> list[dict[str, object]]:
    return _all(
        """
        SELECT
            document_id,
            coalesce(issue_date, received_at::date) AS document_date,
            period, issuer, unit, first_due_date, first_due_amount,
            second_due_date, second_due_amount, document_type, parse_status,
            original_filename, byte_size, error_message
        FROM gold.documents
        WHERE coalesce(issue_date, received_at::date) BETWEEN :start_date AND :end_date
          AND (
              :search = ''
              OR coalesce(issuer, '') ILIKE :pattern
              OR coalesce(original_filename, '') ILIKE :pattern
              OR coalesce(unit, '') ILIKE :pattern
          )
          AND (:document_type = '' OR document_type = :document_type)
          AND (:parse_status = '' OR parse_status = :parse_status)
        ORDER BY coalesce(issue_date, received_at::date) DESC, document_id DESC
        LIMIT :limit
        """,
        {
            "start_date": start_date,
            "end_date": end_date,
            "search": search.strip(),
            "pattern": f"%{search.strip()}%",
            "document_type": document_type,
            "parse_status": parse_status,
            "limit": limit,
        },
    )


def document_detail(document_id: int) -> dict[str, object] | None:
    rows = _all(
        """
        SELECT
            gold.*, silver.extracted_data, silver.page_count, silver.mime_type
        FROM gold.documents gold
        JOIN silver.documents silver USING (document_id)
        WHERE document_id = :document_id
        """,
        {"document_id": document_id},
    )
    return rows[0] if rows else None


def shared_expense_months() -> list[date]:
    rows = _all(
        """
        SELECT DISTINCT summary_month
        FROM (
            SELECT summary_month FROM gold.shared_expense_items
            UNION ALL
            SELECT date_trunc('month', release_date)::date
            FROM gold.movements WHERE category = 'Alquiler'
            UNION ALL
            SELECT summary_month FROM bronze.manual_monthly_rents
        ) months
        WHERE summary_month IS NOT NULL
        ORDER BY summary_month
        """
    )
    return [row["summary_month"] for row in rows]  # type: ignore[misc]


def calculate_net_rent(gross_amount: Decimal, extraordinary: Decimal) -> Decimal:
    return max(gross_amount - extraordinary, Decimal("0"))


def save_monthly_rent(month: date, gross_amount: Decimal) -> Decimal:
    rounded = gross_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if rounded <= 0:
        raise ValueError("El alquiler debe ser positivo.")
    with _engine().begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO bronze.manual_monthly_rents (summary_month, gross_amount)
                VALUES (:month, :gross_amount)
                ON CONFLICT (summary_month) DO UPDATE
                SET gross_amount = excluded.gross_amount, updated_at = now()
                """
            ),
            {"month": month.replace(day=1), "gross_amount": rounded},
        )
    return rounded


def monthly_shared_expenses(month: date) -> dict[str, object]:
    engine = _engine()
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                """
                SELECT
                    items.category,
                    sum(items.expected_amount) AS expected_amount,
                    sum(coalesce(items.paid_amount, 0)) AS paid_amount,
                    count(*) AS bill_count,
                    count(*) FILTER (WHERE items.payment_status = 'paid') AS paid_count,
                    min(items.due_date) AS due_date,
                    min(items.payment_date) AS payment_date,
                    string_agg(DISTINCT items.issuer, ', ' ORDER BY items.issuer) AS issuer,
                    coalesce(
                        jsonb_agg(DISTINCT jsonb_build_object(
                            'document_id', documents.document_id,
                            'original_filename', documents.original_filename
                        )) FILTER (WHERE documents.document_id IS NOT NULL),
                        '[]'::jsonb
                    ) AS documents
                FROM gold.shared_expense_items items
                LEFT JOIN gold.documents documents USING (document_id)
                WHERE items.summary_month = :month
                GROUP BY items.category
                """
            ),
            {"month": month},
        ).mappings()
        bill_rows = {row["category"]: row for row in rows}
        rent_paid = Decimal(
            connection.execute(
                text(
                    """
                    SELECT coalesce(sum(abs(amount)), 0)
                    FROM gold.movements
                    WHERE category = 'Alquiler'
                      AND date_trunc('month', release_date)::date = :month
                    """
                ),
                {"month": month},
            ).scalar_one()
        )
        configured = connection.execute(
            text("SELECT gross_amount FROM bronze.manual_monthly_rents WHERE summary_month = :month"),
            {"month": month},
        ).scalar_one_or_none()
        extraordinary = Decimal(
            connection.execute(
                text(
                    """
                    SELECT coalesce(sum(items.amount), 0)
                    FROM silver.invoice_line_items items
                    JOIN silver.invoices invoices USING (invoice_id)
                    WHERE items.concept_code = 'extraordinary_expenses'
                      AND date_trunc('month', invoices.first_due_date)::date = :month
                    """
                ),
                {"month": month},
            ).scalar_one()
        )

    gross_rent = Decimal(configured) if configured is not None else rent_paid + extraordinary
    rent_net = calculate_net_rent(gross_rent, extraordinary)
    applied_rent_payment = min(rent_paid, rent_net)

    services: list[dict[str, object]] = []
    expected_bills = Decimal("0")
    paid_bills = Decimal("0")
    for category in ("Expensas", "Luz", "Agua", "Gas", "TGI", "Internet"):
        bill = bill_rows.get(category)
        if bill is None:
            expected = paid = Decimal("0")
            status = "Sin factura"
            due_date = payment_date = issuer = None
            source_documents: list[dict[str, object]] = []
        else:
            expected = Decimal(bill["expected_amount"])
            paid = Decimal(bill["paid_amount"])
            status = "Pagado" if bill["paid_count"] == bill["bill_count"] else "Parcial" if bill["paid_count"] else "Pendiente"
            due_date = bill["due_date"]
            payment_date = bill["payment_date"]
            issuer = bill["issuer"]
            source_documents = bill["documents"]
        expected_bills += expected
        paid_bills += paid
        services.append(
            {
                "category": category,
                "issuer": issuer,
                "due_date": due_date,
                "amount": expected,
                "paid_amount": paid,
                "pending_amount": max(expected - paid, Decimal("0")),
                "payment_date": payment_date,
                "status": status,
                "documents": source_documents,
            }
        )

    shared_total = rent_net + expected_bills
    paid_total = applied_rent_payment + paid_bills
    pending_total = max(shared_total - paid_total, Decimal("0"))
    return {
        "month": month,
        "services": services,
        "rent": {
            "gross": gross_rent,
            "extraordinary": extraordinary,
            "net": rent_net,
            "paid": rent_paid,
            "configured": configured is not None,
        },
        "shared_total": shared_total,
        "per_person": (shared_total / Decimal("2")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        "paid_total": paid_total,
        "pending_total": pending_total,
        "payment_progress": min(paid_total / shared_total, Decimal("1")) if shared_total else Decimal("0"),
    }
