FROM python:3.12-slim-bookworm AS runtime

LABEL org.opencontainers.image.source="https://github.com/emilianorios1/house-ops"

ENV HOME=/tmp \
    HOME_LAB_DBT_PROJECT_DIR=/app/dbt \
    DJANGO_SETTINGS_MODULE=house_ops.settings \
    PYTHONPATH=/app/src \
    DBT_SEND_ANONYMOUS_USAGE_STATS=false \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN groupadd --gid 10001 house-ops \
    && useradd --uid 10001 --gid house-ops --no-create-home --shell /usr/sbin/nologin house-ops

COPY pyproject.toml requirements.lock README.md manage.py ./
COPY src ./src
COPY dbt ./dbt

RUN python -m pip install --constraint requirements.lock . \
    && HOUSE_OPS_SECRET_KEY=collectstatic-build-key \
       DATABASE_URL=postgresql://unused:unused@localhost/unused \
       python manage.py collectstatic --noinput

USER 10001:10001

EXPOSE 8000

CMD ["gunicorn", "house_ops.wsgi:application", "--bind=0.0.0.0:8000", \
     "--workers=2", "--threads=2", "--timeout=60", "--access-logfile=-"]
