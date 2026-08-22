from django import forms
from django.contrib.auth import get_user_model

from house_ops.work.models import Routine, Task


class BootstrapFormMixin:
    def _style_fields(self) -> None:
        for field in self.fields.values():
            css_class = "form-check-input" if isinstance(field.widget, forms.CheckboxInput) else "form-control"
            if isinstance(field.widget, forms.Select):
                css_class = "form-select"
            field.widget.attrs["class"] = css_class


class TaskForm(BootstrapFormMixin, forms.ModelForm):
    class Meta:
        model = Task
        fields = (
            "title",
            "description",
            "priority",
            "due_date",
            "assigned_to",
        )
        widgets = {
            "description": forms.Textarea(attrs={"rows": 3}),
            "due_date": forms.DateInput(attrs={"type": "date"}),
        }
        labels = {
            "title": "Tarea",
            "description": "Descripción",
            "priority": "Prioridad",
            "due_date": "Vencimiento",
            "assigned_to": "Asignada a",
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["assigned_to"].queryset = get_user_model().objects.filter(is_active=True).order_by("username")
        self._style_fields()


class QuickTaskForm(TaskForm):
    class Meta(TaskForm.Meta):
        fields = ("title", "due_date", "assigned_to")


class RoutineForm(BootstrapFormMixin, forms.ModelForm):
    class Meta:
        model = Routine
        fields = (
            "title",
            "description",
            "recurrence",
            "interval",
            "next_due_date",
            "assigned_to",
            "active",
        )
        widgets = {
            "description": forms.Textarea(attrs={"rows": 3}),
            "next_due_date": forms.DateInput(attrs={"type": "date"}),
        }
        labels = {
            "title": "Rutina",
            "description": "Descripción",
            "recurrence": "Unidad",
            "interval": "Cada",
            "next_due_date": "Próximo vencimiento",
            "assigned_to": "Asignada a",
            "active": "Activa",
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["assigned_to"].queryset = get_user_model().objects.filter(is_active=True).order_by("username")
        self._style_fields()
