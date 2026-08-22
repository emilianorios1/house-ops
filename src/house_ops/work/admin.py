from django.contrib import admin

from house_ops.work.models import Routine, RoutineCompletion, Task


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ("title", "status", "priority", "due_date", "assigned_to")
    list_filter = ("status", "priority", "assigned_to")
    search_fields = ("title", "description")


@admin.register(Routine)
class RoutineAdmin(admin.ModelAdmin):
    list_display = ("title", "next_due_date", "active", "assigned_to")
    list_filter = ("active", "recurrence", "assigned_to")
    search_fields = ("title", "description")


@admin.register(RoutineCompletion)
class RoutineCompletionAdmin(admin.ModelAdmin):
    list_display = ("routine", "scheduled_for", "completed_at", "completed_by")
    list_filter = ("routine", "completed_by")
