from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q

from house_ops.work.recurrence import next_occurrence


class Task(models.Model):
    class Status(models.TextChoices):
        INBOX = "inbox", "Inbox"
        DOING = "doing", "Doing"
        DONE = "done", "Done"

    class Priority(models.TextChoices):
        LOW = "1", "Baja"
        NORMAL = "2", "Normal"
        HIGH = "3", "Alta"

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status, default=Status.INBOX)
    priority = models.CharField(
        max_length=10,
        choices=Priority,
        default=Priority.NORMAL,
    )
    due_date = models.DateField(blank=True, null=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="assigned_tasks",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="created_tasks",
    )
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="completed_tasks",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ("due_date", "-priority", "created_at")
        indexes = [
            models.Index(fields=("status", "due_date"), name="task_status_due_idx"),
            models.Index(fields=("assigned_to", "status"), name="task_assignee_status_idx"),
        ]

    def __str__(self) -> str:
        return self.title


class Routine(models.Model):
    class Recurrence(models.TextChoices):
        DAYS = "days", "Días"
        WEEKS = "weeks", "Semanas"
        MONTHS = "months", "Meses"
        YEARS = "years", "Años"

    title = models.CharField(max_length=200, unique=True)
    description = models.TextField(blank=True)
    recurrence = models.CharField(max_length=10, choices=Recurrence)
    interval = models.PositiveSmallIntegerField(default=1)
    next_due_date = models.DateField()
    last_completed = models.DateTimeField(blank=True, null=True)
    active = models.BooleanField(default=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="assigned_routines",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="created_routines",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("next_due_date", "title")
        indexes = [
            models.Index(fields=("active", "next_due_date"), name="routine_active_due_idx"),
            models.Index(fields=("assigned_to", "active"), name="routine_assignee_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(interval__gte=1),
                name="routine_interval_positive",
            )
        ]

    def next_after(self, value):
        return next_occurrence(self.recurrence, self.interval, value)

    def __str__(self) -> str:
        return self.title


class RoutineCompletion(models.Model):
    routine = models.ForeignKey(
        Routine,
        on_delete=models.PROTECT,
        related_name="completions",
    )
    scheduled_for = models.DateField()
    completed_at = models.DateTimeField(auto_now_add=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="routine_completions",
    )

    class Meta:
        ordering = ("-completed_at",)
        constraints = [
            models.UniqueConstraint(
                fields=("routine", "scheduled_for"),
                name="unique_routine_occurrence_completion",
            )
        ]

    def __str__(self) -> str:
        return f"{self.routine} · {self.scheduled_for:%d/%m/%Y}"
