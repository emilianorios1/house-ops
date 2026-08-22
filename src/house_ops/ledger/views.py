from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import connection
from django.http import FileResponse, Http404, HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from home_lab.arca.client import AfipSdkClient, AfipSdkError
from home_lab.arca.emission import (
    emit_export_invoice,
    recurring_invoice_profile,
    save_recurring_invoice_profile,
)
from home_lab.config import afip_sdk_access_token, document_store_path, monotributo_annual_limit_ars
from home_lab.database import get_engine
from home_lab.documents.storage import resolve_document_path
from house_ops.ledger import repository
from house_ops.ledger.forms import ExportInvoiceForm, RentForm, StatementUploadForm
from house_ops.ledger.models import OperationRun
from house_ops.ledger.operations import RunnerError, start_statement_import, start_sync


DOCUMENT_LABELS = {
    "condominium_expense": "Expensas",
    "credit_card_statement": "Resumen de tarjeta",
    "electricity_bill": "Luz",
    "export_service_invoice": "Factura E",
    "gas_bill": "Gas",
    "internet_bill": "Internet",
    "property_tax_bill": "TGI",
    "water_bill": "Agua",
}


def _period(request: HttpRequest) -> tuple[date, date, date]:
    month = repository.parse_month(request.GET.get("month") or request.POST.get("month"))
    start, end = repository.month_bounds(month)
    return month, start, end


def health(request: HttpRequest) -> JsonResponse:
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        cursor.fetchone()
    return JsonResponse({"status": "ok", "product": "House Ops"})


@login_required
def ledger_overview(request: HttpRequest) -> HttpResponse:
    month, start, end = _period(request)
    return render(
        request,
        "ledger/overview.html",
        {
            "month": month,
            "summary": repository.overview(start, end),
            "daily": repository.daily_flow(start, end),
            "categories": repository.expenses_by_category(start, end),
        },
    )


@login_required
def movement_list(request: HttpRequest) -> HttpResponse:
    month, start, end = _period(request)
    search = request.GET.get("q", "")
    rows = repository.movements(start, end, search)
    return render(request, "ledger/movements.html", {"month": month, "search": search, "movements": rows})


@login_required
def bill_list(request: HttpRequest) -> HttpResponse:
    month, start, end = _period(request)
    return render(request, "ledger/bills.html", {"month": month, "bills": repository.bills(start, end)})


@login_required
def shared_expenses(request: HttpRequest) -> HttpResponse:
    month, _, _ = _period(request)
    summary = repository.monthly_shared_expenses(month)
    rent_form = RentForm(initial={"gross_amount": summary["rent"]["gross"]})
    return render(request, "ledger/shared_expenses.html", {"month": month, "summary": summary, "rent_form": rent_form})


@login_required
@require_POST
def save_rent(request: HttpRequest) -> HttpResponse:
    month, _, _ = _period(request)
    form = RentForm(request.POST)
    if form.is_valid():
        repository.save_monthly_rent(month, form.cleaned_data["gross_amount"])
        messages.success(request, "Alquiler bruto guardado.")
    else:
        messages.error(request, "Revisá el importe del alquiler.")
    return redirect(f"/ledger/shared-expenses/?month={month:%Y-%m}")


@login_required
def credit_cards(request: HttpRequest) -> HttpResponse:
    month, start, end = _period(request)
    search = request.GET.get("q", "")
    expenses = repository.credit_card_expenses(start, end, search)
    totals = {
        currency: sum((Decimal(row["amount"]) for row in expenses if row["currency"] == currency), Decimal("0"))
        for currency in ("ARS", "USD")
    }
    return render(
        request,
        "ledger/credit_cards.html",
        {
            "month": month,
            "search": search,
            "expenses": expenses,
            "categories": repository.credit_card_categories(start, end),
            "statements": repository.credit_card_statements(start, end),
            "totals": totals,
        },
    )


@login_required
def invoices(request: HttpRequest) -> HttpResponse:
    month, start, end = _period(request)
    engine = get_engine()
    profile = recurring_invoice_profile(engine)
    form = ExportInvoiceForm(request.POST or None, profile=profile)
    if request.method == "POST" and form.is_valid():
        action = request.POST.get("action")
        try:
            if action == "profile":
                save_recurring_invoice_profile(engine, form.profile())
                messages.success(request, "Perfil recurrente guardado.")
                return redirect(f"/ledger/invoices/?month={month:%Y-%m}")
            if action == "emit":
                if not form.cleaned_data["confirmed"]:
                    raise ValueError("Confirmá el envío al sandbox.")
                token = afip_sdk_access_token()
                if not token:
                    raise ValueError("Falta AFIP_SDK_ACCESS_TOKEN.")
                cae, due, voucher = emit_export_invoice(form.draft(), AfipSdkClient(token))
                due_label = f"; vence {due:%d/%m/%Y}" if due else ""
                messages.success(request, f"CAE de prueba {cae} para comprobante {voucher}{due_label}.")
                return redirect(f"/ledger/invoices/?month={month:%Y-%m}")
        except (ValueError, AfipSdkError) as error:
            messages.error(request, str(error))
    summary = repository.export_invoice_summary(end)
    annual_limit = monotributo_annual_limit_ars()
    return render(
        request,
        "ledger/invoices.html",
        {
            "month": month,
            "summary": summary,
            "monthly": repository.export_invoice_monthly(end),
            "invoices": repository.export_invoices(start, end),
            "annual_limit": annual_limit,
            "form": form,
            "has_token": afip_sdk_access_token() is not None,
        },
    )


@login_required
def document_list(request: HttpRequest) -> HttpResponse:
    month, start, end = _period(request)
    search = request.GET.get("q", "")
    document_type = request.GET.get("type", "")
    parse_status = request.GET.get("status", "")
    return render(
        request,
        "ledger/documents.html",
        {
            "month": month,
            "search": search,
            "selected_type": document_type,
            "selected_status": parse_status,
            "options": repository.document_filter_options(start, end),
            "documents": repository.documents(start, end, search, document_type=document_type, parse_status=parse_status),
            "document_labels": DOCUMENT_LABELS,
        },
    )


@login_required
def document_detail(request: HttpRequest, document_id: int) -> HttpResponse:
    document = repository.document_detail(document_id)
    if document is None:
        raise Http404
    extracted = document.get("extracted_data")
    document["parsed_json"] = json.dumps(extracted, ensure_ascii=False, indent=2, default=str) if extracted else ""
    return render(request, "ledger/document_detail.html", {"document": document, "document_labels": DOCUMENT_LABELS})


@login_required
def document_file(request: HttpRequest, document_id: int) -> FileResponse:
    document = repository.document_detail(document_id)
    if document is None:
        raise Http404
    try:
        path = resolve_document_path(document_store_path(), str(document["storage_path"]))
        response = FileResponse(path.open("rb"), content_type="application/pdf")
    except (OSError, ValueError) as error:
        raise Http404 from error
    response["Content-Disposition"] = f'inline; filename="document-{document_id}.pdf"'
    return response


@login_required
def operations(request: HttpRequest) -> HttpResponse:
    return render(
        request,
        "ledger/operations.html",
        {"runs": OperationRun.objects.select_related("requested_by")[:15], "upload_form": StatementUploadForm()},
    )


@login_required
@require_POST
def operation_start(request: HttpRequest, action: str) -> HttpResponse:
    labels = {
        "gmail": "Sincronizar Gmail",
        "mercadopago": "Sincronizar Mercado Pago",
        "siat-tgi": "Sincronizar TGI",
        "transform": "Reconstruir Silver/Gold",
    }
    if action not in labels:
        raise Http404
    run = OperationRun.objects.create(action=action, requested_by=request.user)
    try:
        start_sync(action, run.id)
    except RunnerError as error:
        run.status = OperationRun.Status.FAILED
        run.message = str(error)
        run.save(update_fields=("status", "message"))
        messages.error(request, str(error))
    else:
        messages.success(request, f"{labels[action]} iniciada.")
    return redirect("ledger:operations")


@login_required
@require_POST
def statement_import(request: HttpRequest) -> HttpResponse:
    form = StatementUploadForm(request.POST, request.FILES)
    if not form.is_valid():
        messages.error(request, "Seleccioná un extracto CSV válido.")
        return redirect("ledger:operations")
    statement = form.cleaned_data["statement"]
    run = OperationRun.objects.create(action="mercadopago-statement", requested_by=request.user)
    try:
        start_statement_import(run.id, statement.name, statement.read())
    except RunnerError as error:
        run.status = OperationRun.Status.FAILED
        run.message = str(error)
        run.save(update_fields=("status", "message"))
        messages.error(request, str(error))
    else:
        messages.success(request, "Importación iniciada.")
    return redirect("ledger:operations")


@login_required
def operation_status(request: HttpRequest, operation_id) -> HttpResponse:
    run = get_object_or_404(OperationRun.objects.select_related("requested_by"), pk=operation_id)
    return render(request, "ledger/_operation_status.html", {"run": run})
