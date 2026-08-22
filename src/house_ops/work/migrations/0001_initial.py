from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(
            name="Routine",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=200, unique=True)),
                ("description", models.TextField(blank=True)),
                ("recurrence", models.CharField(choices=[("days", "Días"), ("weeks", "Semanas"), ("months", "Meses"), ("years", "Años")], max_length=10)),
                ("interval", models.PositiveSmallIntegerField(default=1)),
                ("next_due_date", models.DateField()),
                ("last_completed", models.DateTimeField(blank=True, null=True)),
                ("active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("assigned_to", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="assigned_routines", to=settings.AUTH_USER_MODEL)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_routines", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("next_due_date", "title")},
        ),
        migrations.CreateModel(
            name="Task",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=200)),
                ("description", models.TextField(blank=True)),
                ("status", models.CharField(choices=[("inbox", "Inbox"), ("doing", "Doing"), ("done", "Done")], default="inbox", max_length=10)),
                ("priority", models.CharField(choices=[("1", "Baja"), ("2", "Normal"), ("3", "Alta")], default="2", max_length=10)),
                ("due_date", models.DateField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("assigned_to", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="assigned_tasks", to=settings.AUTH_USER_MODEL)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_tasks", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ("due_date", "-priority", "created_at")},
        ),
        migrations.CreateModel(
            name="RoutineCompletion",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("scheduled_for", models.DateField()),
                ("completed_at", models.DateTimeField(auto_now_add=True)),
                ("completed_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="routine_completions", to=settings.AUTH_USER_MODEL)),
                ("routine", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="completions", to="work.routine")),
            ],
            options={"ordering": ("-completed_at",)},
        ),
        migrations.AddIndex(model_name="routine", index=models.Index(fields=["active", "next_due_date"], name="routine_active_due_idx")),
        migrations.AddIndex(model_name="routine", index=models.Index(fields=["assigned_to", "active"], name="routine_assignee_idx")),
        migrations.AddConstraint(model_name="routine", constraint=models.CheckConstraint(condition=models.Q(("interval__gte", 1)), name="routine_interval_positive")),
        migrations.AddIndex(model_name="task", index=models.Index(fields=["status", "due_date"], name="task_status_due_idx")),
        migrations.AddIndex(model_name="task", index=models.Index(fields=["assigned_to", "status"], name="task_assignee_status_idx")),
        migrations.AddConstraint(model_name="routinecompletion", constraint=models.UniqueConstraint(fields=("routine", "scheduled_for"), name="unique_routine_occurrence_completion")),
    ]
