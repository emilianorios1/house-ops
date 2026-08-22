import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Create the two local House Ops users when they do not exist"

    def handle(self, *args, **options):
        users = (
            (
                os.getenv("HOUSE_OPS_ADMIN_USERNAME", "emiliano"),
                os.getenv("HOUSE_OPS_ADMIN_PASSWORD", ""),
                True,
            ),
            (
                os.getenv("HOUSE_OPS_SECOND_USERNAME", "vitoria"),
                os.getenv("HOUSE_OPS_SECOND_PASSWORD", ""),
                False,
            ),
        )
        User = get_user_model()
        for username, password, is_admin in users:
            if not username:
                continue
            if User.objects.filter(username=username).exists():
                continue
            if not password:
                raise CommandError(f"Missing password for initial user {username}")
            User.objects.create_user(
                username=username,
                password=password,
                is_staff=is_admin,
                is_superuser=is_admin,
            )
            self.stdout.write(f"Created House Ops user {username}")
