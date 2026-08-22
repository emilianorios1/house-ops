from django.contrib import admin

from house_ops.ledger.models import OperationRun


@admin.register(OperationRun)
class OperationRunAdmin(admin.ModelAdmin):
    list_display = ("action", "status", "requested_by", "requested_at", "completed_at")
    list_filter = ("status", "action")
    readonly_fields = ("id", "requested_at", "started_at", "completed_at")
