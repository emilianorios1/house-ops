from datetime import date
from pathlib import Path
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from house_ops.ledger.models import OperationRun


@pytest.fixture
def ledger_client(client, db):
    user = get_user_model().objects.create_user(username="ledger-user", password="clave")
    client.force_login(user)
    return client, user


@pytest.mark.django_db
def test_health_checks_the_database(client) -> None:
    response = client.get(reverse("ledger:health"))
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "product": "House Ops"}


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("name", "patches"),
    [
        ("ledger:overview", {"overview": {}, "daily_flow": [], "expenses_by_category": []}),
        ("ledger:movements", {"movements": []}),
        ("ledger:bills", {"bills": []}),
        (
            "ledger:credit_cards",
            {"credit_card_expenses": [], "credit_card_categories": [], "credit_card_statements": []},
        ),
        ("ledger:documents", {"document_filter_options": {}, "documents": []}),
    ],
)
def test_main_ledger_pages_render_without_500(ledger_client, name: str, patches: dict[str, object]) -> None:
    client, _ = ledger_client
    patchers = [patch(f"house_ops.ledger.repository.{key}", return_value=value) for key, value in patches.items()]
    for item in patchers:
        item.start()
    try:
        response = client.get(reverse(name), {"month": "2026-08"})
    finally:
        for item in patchers:
            item.stop()
    assert response.status_code == 200
    assert "House Ops" in response.content.decode()


@pytest.mark.django_db
def test_shared_expenses_preserve_obligation_and_payment_values(ledger_client) -> None:
    client, _ = ledger_client
    summary = {
        "rent": {"gross": 100, "extraordinary": 10, "net": 90, "paid": 0},
        "services": [],
        "shared_total": 90,
        "per_person": 45,
        "paid_total": 0,
        "pending_total": 90,
        "payment_progress": 0,
    }
    with patch("house_ops.ledger.repository.monthly_shared_expenses", return_value=summary):
        response = client.get(reverse("ledger:shared_expenses"), {"month": "2026-08"})
    assert response.status_code == 200
    content = response.content.decode()
    assert "Pendiente" in content
    assert "Pagado" in content


@pytest.mark.django_db
def test_document_metadata_and_pdf_are_authenticated(ledger_client, tmp_path: Path) -> None:
    client, _ = ledger_client
    stored = tmp_path / "aa" / "sample.pdf"
    stored.parent.mkdir()
    stored.write_bytes(b"%PDF-1.4\n%%EOF")
    document = {
        "document_id": 7,
        "document_type": "electricity_bill",
        "storage_path": "aa/sample.pdf",
        "original_filename": "factura.pdf",
        "issuer": "EPE",
        "extracted_data": {"amount": "100.00"},
    }
    with (
        patch("house_ops.ledger.repository.document_detail", return_value=document),
        patch("house_ops.ledger.views.document_store_path", return_value=tmp_path),
    ):
        detail = client.get(reverse("ledger:document_detail", args=[7]))
        pdf = client.get(reverse("ledger:document_file", args=[7]))
    assert detail.status_code == 200
    assert "EPE" in detail.content.decode()
    assert pdf.status_code == 200
    assert pdf["Content-Type"] == "application/pdf"


@pytest.mark.django_db
def test_operation_is_queued_and_attributed(ledger_client) -> None:
    client, user = ledger_client
    with patch("house_ops.ledger.views.start_sync") as start:
        response = client.post(reverse("ledger:operation_start", args=["transform"]))
    assert response.status_code == 302
    run = OperationRun.objects.get()
    assert run.action == "transform"
    assert run.requested_by == user
    start.assert_called_once_with("transform", run.id)


@pytest.mark.django_db
def test_statement_import_is_queued_without_credentials_in_browser(ledger_client) -> None:
    client, user = ledger_client
    upload = SimpleUploadedFile("extracto.csv", b"synthetic", content_type="text/csv")
    with patch("house_ops.ledger.views.start_statement_import") as start:
        response = client.post(reverse("ledger:statement_import"), {"statement": upload})
    assert response.status_code == 302
    run = OperationRun.objects.get(requested_by=user)
    start.assert_called_once_with(run.id, "extracto.csv", b"synthetic")
