import uuid

from django.conf import settings
from django.db import models


class OperationRun(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "En cola"
        RUNNING = "running", "En ejecución"
        SUCCEEDED = "succeeded", "Completada"
        FAILED = "failed", "Falló"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    action = models.CharField(max_length=40)
    status = models.CharField(max_length=12, choices=Status, default=Status.QUEUED)
    message = models.CharField(max_length=500, blank=True)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="operation_runs",
    )
    requested_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(blank=True, null=True)
    completed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        db_table = "house_ops_operation_runs"
        ordering = ("-requested_at",)
        indexes = [models.Index(fields=("status", "requested_at"), name="operation_status_idx")]

    def __str__(self) -> str:
        return f"{self.action}: {self.get_status_display()}"
