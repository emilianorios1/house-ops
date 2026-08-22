from django.urls import path

from house_ops.work import views


app_name = "work"

urlpatterns = [
    path("", views.task_board, name="task_board"),
    path("new/", views.task_create, name="task_create"),
    path("quick/", views.quick_task_create, name="quick_task_create"),
    path("<int:task_id>/edit/", views.task_update, name="task_update"),
    path("<int:task_id>/status/<str:status>/", views.task_transition, name="task_transition"),
    path("routines/", views.routine_list, name="routine_list"),
    path("routines/new/", views.routine_create, name="routine_create"),
    path("routines/<int:routine_id>/edit/", views.routine_update, name="routine_update"),
    path("routines/<int:routine_id>/complete/", views.routine_complete, name="routine_complete"),
]
