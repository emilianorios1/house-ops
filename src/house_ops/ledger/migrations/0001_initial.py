import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="OperationRun",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("action", models.CharField(max_length=40)),
                ("status", models.CharField(choices=[("queued", "En cola"), ("running", "En ejecución"), ("succeeded", "Completada"), ("failed", "Falló")], default="queued", max_length=12)),
                ("message", models.CharField(blank=True, max_length=500)),
                ("requested_at", models.DateTimeField(auto_now_add=True)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("requested_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="operation_runs", to=settings.AUTH_USER_MODEL)),
            ],
            options={"db_table": "house_ops_operation_runs", "ordering": ("-requested_at",)},
        ),
        migrations.AddIndex(model_name="operationrun", index=models.Index(fields=["status", "requested_at"], name="operation_status_idx")),
    ]
