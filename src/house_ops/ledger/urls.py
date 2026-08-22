from django.urls import path

from house_ops.ledger import views


app_name = "ledger"

urlpatterns = [
    path("health/", views.health, name="health"),
    path("ledger/", views.ledger_overview, name="overview"),
    path("ledger/movements/", views.movement_list, name="movements"),
    path("ledger/bills/", views.bill_list, name="bills"),
    path("ledger/shared-expenses/", views.shared_expenses, name="shared_expenses"),
    path("ledger/shared-expenses/rent/", views.save_rent, name="save_rent"),
    path("ledger/credit-cards/", views.credit_cards, name="credit_cards"),
    path("ledger/invoices/", views.invoices, name="invoices"),
    path("documents/", views.document_list, name="documents"),
    path("documents/<int:document_id>/", views.document_detail, name="document_detail"),
    path("documents/<int:document_id>/file/", views.document_file, name="document_file"),
    path("operations/", views.operations, name="operations"),
    path("operations/start/<str:action>/", views.operation_start, name="operation_start"),
    path("operations/import-statement/", views.statement_import, name="statement_import"),
    path("operations/<uuid:operation_id>/status/", views.operation_status, name="operation_status"),
]
