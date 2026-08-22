from django.db import migrations
from django.utils import timezone


def add_initial_routine(apps, schema_editor):
    Routine = apps.get_model("work", "Routine")
    Routine.objects.get_or_create(
        title="Poner veneno para hormigas",
        defaults={
            "description": "Aplicar el tratamiento mensual para hormigas.",
            "recurrence": "months",
            "interval": 1,
            "next_due_date": timezone.localdate(),
            "active": True,
        },
    )


class Migration(migrations.Migration):
    dependencies = [("work", "0001_initial")]
    operations = [migrations.RunPython(add_initial_routine, migrations.RunPython.noop)]
