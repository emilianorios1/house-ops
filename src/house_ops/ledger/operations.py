"""Fast internal client for the allow-listed asynchronous runner."""

from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from uuid import UUID


RUNNER_URL = os.getenv("HOME_LAB_SYNC_RUNNER_URL", "http://sync-runner:8080").rstrip("/")


class RunnerError(RuntimeError):
    pass


def _submit(path: str, operation_id: UUID, *, body: bytes | None = None, filename: str = "") -> str:
    request = Request(
        f"{RUNNER_URL}{path}",
        data=body or b"",
        headers={
            "X-Operation-ID": str(operation_id),
            **({"X-Filename": quote(filename, safe=""), "Content-Type": "text/csv"} if filename else {}),
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            payload = json.load(response)
    except HTTPError as error:
        try:
            detail = str(json.load(error).get("message", ""))
        except (ValueError, AttributeError):
            detail = ""
        raise RunnerError(detail or "El runner rechazó la operación.") from error
    except (URLError, TimeoutError) as error:
        raise RunnerError("No se pudo contactar al runner interno.") from error
    return str(payload.get("message", "Operación iniciada."))


def start_sync(action: str, operation_id: UUID) -> str:
    paths = {
        "gmail": "/jobs/sync/gmail",
        "mercadopago": "/jobs/sync/mercadopago",
        "siat-tgi": "/jobs/sync/siat-tgi",
        "transform": "/jobs/transform",
    }
    if action not in paths:
        raise ValueError("Unknown operation")
    return _submit(paths[action], operation_id)


def start_statement_import(operation_id: UUID, filename: str, content: bytes) -> str:
    return _submit(
        "/jobs/import/mercadopago-statement",
        operation_id,
        body=content,
        filename=filename,
    )
