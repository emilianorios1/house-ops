from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("work", "0002_initial_ant_routine"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="completed_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="completed_tasks",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
