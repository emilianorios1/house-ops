from __future__ import annotations

from datetime import timedelta

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.db.models import Q
from django.http import HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST
from sqlalchemy.exc import SQLAlchemyError

from house_ops.work.forms import QuickTaskForm, RoutineForm, TaskForm
from house_ops.work.models import Routine, RoutineCompletion, Task


def _attention_context(*, quick_form: QuickTaskForm | None = None) -> dict[str, object]:
    today = timezone.localdate()
    upcoming = today + timedelta(days=7)
    open_tasks = Task.objects.exclude(status=Task.Status.DONE).select_related("assigned_to")
    due_tasks = open_tasks.filter(due_date__lte=upcoming).order_by("due_date", "-priority")
    inbox_tasks = open_tasks.filter(due_date__isnull=True).order_by("-priority", "created_at")[:5]
    routines = Routine.objects.filter(active=True, next_due_date__lte=upcoming).select_related("assigned_to")
    return {
        "today": today,
        "overdue_tasks": due_tasks.filter(due_date__lt=today),
        "today_tasks": due_tasks.filter(due_date=today),
        "upcoming_tasks": due_tasks.filter(due_date__gt=today),
        "inbox_tasks": inbox_tasks,
        "due_routines": routines.filter(next_due_date__lte=today),
        "upcoming_routines": routines.filter(next_due_date__gt=today),
        "quick_form": quick_form or QuickTaskForm(),
    }


def _home_response(request: HttpRequest, *, quick_form: QuickTaskForm | None = None) -> HttpResponse:
    context = _attention_context(quick_form=quick_form)
    if request.headers.get("HX-Request") == "true":
        return render(request, "work/_attention.html", context)
    try:
        from house_ops.ledger.repository import overview

        first = timezone.localdate().replace(day=1)
        context["financial_summary"] = overview(first, timezone.localdate())
    except SQLAlchemyError:
        context["financial_summary"] = None
    return render(request, "work/home.html", context)


@login_required
def home(request: HttpRequest) -> HttpResponse:
    return _home_response(request)


@login_required
@require_POST
def quick_task_create(request: HttpRequest) -> HttpResponse:
    form = QuickTaskForm(request.POST)
    if form.is_valid():
        task = form.save(commit=False)
        task.created_by = request.user
        task.save()
        messages.success(request, "Tarea creada.")
        return _home_response(request)
    return _home_response(request, quick_form=form)


@login_required
def task_board(request: HttpRequest) -> HttpResponse:
    tasks = Task.objects.select_related("assigned_to", "created_by")
    return render(
        request,
        "work/task_board.html",
        {
            "columns": [
                (Task.Status.INBOX, "Inbox", tasks.filter(status=Task.Status.INBOX)),
                (Task.Status.DOING, "Doing", tasks.filter(status=Task.Status.DOING)),
                (Task.Status.DONE, "Done", tasks.filter(status=Task.Status.DONE)[:30]),
            ]
        },
    )


@login_required
def task_create(request: HttpRequest) -> HttpResponse:
    form = TaskForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        task = form.save(commit=False)
        task.created_by = request.user
        task.save()
        messages.success(request, "Tarea creada.")
        return redirect("work:task_board")
    return render(request, "work/task_form.html", {"form": form, "title": "Nueva tarea"})


@login_required
def task_update(request: HttpRequest, task_id: int) -> HttpResponse:
    task = get_object_or_404(Task, pk=task_id)
    form = TaskForm(request.POST or None, instance=task)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, "Tarea actualizada.")
        return redirect("work:task_board")
    return render(request, "work/task_form.html", {"form": form, "title": "Editar tarea", "task": task})


@login_required
@require_POST
def task_transition(request: HttpRequest, task_id: int, status: str) -> HttpResponse:
    if status not in Task.Status.values:
        return HttpResponse(status=400)
    task = get_object_or_404(Task, pk=task_id)
    task.status = status
    task.completed_at = timezone.now() if status == Task.Status.DONE else None
    task.completed_by = request.user if status == Task.Status.DONE else None
    task.save(update_fields=("status", "completed_at", "completed_by"))
    messages.success(request, "Tarea completada." if status == Task.Status.DONE else "Estado actualizado.")
    if request.headers.get("HX-Request") == "true" and request.POST.get("from_home"):
        return _home_response(request)
    return redirect("work:task_board")


@login_required
def routine_list(request: HttpRequest) -> HttpResponse:
    routines = Routine.objects.select_related("assigned_to").prefetch_related("completions__completed_by")
    return render(
        request,
        "work/routine_list.html",
        {"routines": routines, "today": timezone.localdate()},
    )


@login_required
def routine_create(request: HttpRequest) -> HttpResponse:
    form = RoutineForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        routine = form.save(commit=False)
        routine.created_by = request.user
        routine.save()
        messages.success(request, "Rutina creada.")
        return redirect("work:routine_list")
    return render(request, "work/routine_form.html", {"form": form, "title": "Nueva rutina"})


@login_required
def routine_update(request: HttpRequest, routine_id: int) -> HttpResponse:
    routine = get_object_or_404(Routine, pk=routine_id)
    form = RoutineForm(request.POST or None, instance=routine)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, "Rutina actualizada.")
        return redirect("work:routine_list")
    return render(request, "work/routine_form.html", {"form": form, "title": "Editar rutina", "routine": routine})


@login_required
@require_POST
def routine_complete(request: HttpRequest, routine_id: int) -> HttpResponse:
    today = timezone.localdate()
    with transaction.atomic():
        routine = get_object_or_404(Routine.objects.select_for_update(), pk=routine_id)
        if not routine.active or routine.next_due_date > today:
            messages.info(request, "La rutina ya no está pendiente.")
        else:
            scheduled_for = routine.next_due_date
            RoutineCompletion.objects.create(
                routine=routine,
                scheduled_for=scheduled_for,
                completed_by=request.user,
            )
            completed_at = timezone.now()
            routine.last_completed = completed_at
            routine.next_due_date = routine.next_after(max(scheduled_for, today))
            routine.save(update_fields=("last_completed", "next_due_date"))
            messages.success(request, f"Hecho. Vuelve el {routine.next_due_date:%d/%m/%Y}.")
    if request.headers.get("HX-Request") == "true":
        return _home_response(request)
    return redirect(request.POST.get("next") or "work:routine_list")
