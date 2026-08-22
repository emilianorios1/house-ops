"""WSGI entry point for House Ops."""

import os

from django.core.wsgi import get_wsgi_application


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "house_ops.settings")
application = get_wsgi_application()
