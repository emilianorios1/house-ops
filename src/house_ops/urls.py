"""House Ops URL configuration."""

from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import include, path

from house_ops.work import views as work_views


urlpatterns = [
    path("", work_views.home, name="home"),
    path(
        "login/",
        auth_views.LoginView.as_view(template_name="registration/login.html"),
        name="login",
    ),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("admin/", admin.site.urls),
    path("tasks/", include("house_ops.work.urls")),
    path("", include("house_ops.ledger.urls")),
]
