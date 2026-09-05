from datetime import date
from unittest.mock import patch

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.urls import reverse

from house_ops.work.models import Routine, RoutineCompletion, Task


def test_settings_resolve_the_house_ops_project_root() -> None:
    assert (settings.BASE_DIR / "manage.py").is_file()
    assert (settings.BASE_DIR / "src" / "house_ops" / "static").is_dir()


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(username="persona", password="clave-segura")


@pytest.fixture
def authenticated_client(client, user):
    client.force_login(user)
    return client


def test_home_requires_authentication(client) -> None:
    response = client.get(reverse("home"))
    assert response.status_code == 302
    assert response.url.startswith(reverse("login"))


@pytest.mark.django_db
def test_login_opens_house_ops_home(client, user) -> None:
    with patch("house_ops.ledger.repository.overview", return_value={}):
        response = client.post(
            reverse("login"),
            {"username": user.username, "password": "clave-segura"},
            follow=True,
        )
    assert response.status_code == 200
    assert "¿Qué necesita atención?" in response.content.decode()


@pytest.mark.django_db
def test_top_navigation_exposes_shared_expenses_and_movements(authenticated_client) -> None:
    with patch("house_ops.ledger.repository.overview", return_value={}):
        response = authenticated_client.get(reverse("home"))

    content = response.content.decode()
    assert response.status_code == 200
    assert f'href="{reverse("ledger:shared_expenses")}">Gastos compartidos</a>' in content
    assert f'href="{reverse("ledger:movements")}">Movimientos</a>' in content


@pytest.mark.django_db
def test_initial_ant_routine_is_monthly_and_due() -> None:
    routine = Routine.objects.get(title="Poner veneno para hormigas")
    assert routine.recurrence == Routine.Recurrence.MONTHS
    assert routine.interval == 1
    assert routine.active is True


@pytest.mark.django_db
def test_complete_ant_routine_from_home_is_one_click_and_keeps_history(
    authenticated_client,
    user,
) -> None:
    routine = Routine.objects.get(title="Poner veneno para hormigas")
    routine.next_due_date = date(2026, 1, 31)
    routine.save(update_fields=("next_due_date",))

    with (
        patch("house_ops.work.views.timezone.localdate", return_value=date(2026, 1, 31)),
        patch("house_ops.ledger.repository.overview", return_value={}),
    ):
        response = authenticated_client.post(
            reverse("work:routine_complete", args=[routine.id]),
            HTTP_HX_REQUEST="true",
        )

    assert response.status_code == 200
    assert "Poner veneno para hormigas" not in response.content.decode()
    routine.refresh_from_db()
    assert routine.last_completed is not None
    assert routine.next_due_date == date(2026, 2, 28)
    completion = RoutineCompletion.objects.get(routine=routine)
    assert completion.scheduled_for == date(2026, 1, 31)
    assert completion.completed_by == user

    with patch("house_ops.work.views.timezone.localdate", return_value=date(2026, 1, 31)):
        authenticated_client.post(reverse("work:routine_complete", args=[routine.id]))
    assert RoutineCompletion.objects.filter(routine=routine).count() == 1


@pytest.mark.django_db
def test_task_moves_from_inbox_to_doing_and_done(authenticated_client, user) -> None:
    response = authenticated_client.post(
        reverse("work:task_create"),
        {
            "title": "Comprar lámpara",
            "description": "Para el pasillo",
            "priority": Task.Priority.HIGH,
            "due_date": "2026-08-25",
            "assigned_to": user.id,
        },
    )
    assert response.status_code == 302
    task = Task.objects.get(title="Comprar lámpara")
    assert task.status == Task.Status.INBOX
    assert task.created_by == user

    response = authenticated_client.post(
        reverse("work:task_transition", args=[task.id, Task.Status.DOING])
    )
    assert response.status_code == 302
    task.refresh_from_db()
    assert task.status == Task.Status.DOING
    assert task.completed_at is None

    authenticated_client.post(reverse("work:task_transition", args=[task.id, Task.Status.DONE]))
    task.refresh_from_db()
    assert task.status == Task.Status.DONE
    assert task.completed_at is not None
    assert task.completed_by == user


@pytest.mark.django_db
def test_quick_task_is_created_from_home_with_htmx(authenticated_client, user) -> None:
    with patch("house_ops.ledger.repository.overview", return_value={}):
        response = authenticated_client.post(
            reverse("work:quick_task_create"),
            {"title": "Sacar la basura", "assigned_to": user.id},
            HTTP_HX_REQUEST="true",
        )
    assert response.status_code == 200
    task = Task.objects.get(title="Sacar la basura")
    assert task.created_by == user
    assert "Tarea creada." in response.content.decode()


@pytest.mark.django_db
def test_kanban_renders_all_three_columns(authenticated_client) -> None:
    response = authenticated_client.get(reverse("work:task_board"))
    content = response.content.decode()
    assert response.status_code == 200
    assert all(label in content for label in ("Inbox", "Doing", "Done"))
