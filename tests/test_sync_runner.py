from __future__ import annotations

import json
import subprocess
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import quote
from uuid import uuid4

import pytest

from home_lab import sync_runner


@pytest.fixture
def runner_server() -> tuple[str, int]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), sync_runner.SyncRequestHandler)
    thread = Thread(target=server.serve_forever)
    thread.start()
    try:
        yield server.server_address
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


def request(
    runner_server: tuple[str, int],
    method: str,
    path: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str]]:
    connection = HTTPConnection(*runner_server, timeout=2)
    connection.request(method, path, body=body, headers=headers or {})
    response = connection.getresponse()
    payload = json.loads(response.read())
    connection.close()
    return response.status, payload


def wait_for_runner() -> None:
    assert sync_runner.SYNC_LOCK.acquire(timeout=2)
    sync_runner.SYNC_LOCK.release()


def operation_headers(**extra: str) -> dict[str, str]:
    return {"X-Operation-ID": str(uuid4()), **extra}


def test_health_endpoint(runner_server: tuple[str, int]) -> None:
    status, payload = request(runner_server, "GET", "/health")
    assert status == 200
    assert payload == {"message": "Runner disponible."}


@pytest.mark.parametrize(
    ("path", "command"),
    [
        ("/jobs/sync/gmail", "sync-gmail"),
        ("/jobs/sync/mercadopago", "sync-mercadopago"),
        ("/jobs/sync/siat-tgi", "sync-siat-tgi"),
        ("/jobs/transform", "transform"),
    ],
)
def test_job_endpoint_accepts_only_allowlisted_async_command(
    runner_server: tuple[str, int],
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    command: str,
) -> None:
    calls: list[list[str]] = []
    statuses: list[str] = []

    def run(args: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(sync_runner.subprocess, "run", run)
    monkeypatch.setattr(sync_runner, "_update_operation", lambda _id, status, _message="": statuses.append(status))

    status, payload = request(runner_server, "POST", path, headers=operation_headers())
    assert status == 202
    assert payload == {"message": "Operación iniciada."}
    wait_for_runner()
    assert calls == [["home-lab", command]]
    assert statuses == ["running", "succeeded"]


def test_unknown_job_is_rejected(runner_server: tuple[str, int]) -> None:
    status, _ = request(runner_server, "POST", "/jobs/arbitrary", headers=operation_headers())
    assert status == 404


def test_missing_operation_id_is_rejected(runner_server: tuple[str, int]) -> None:
    status, payload = request(runner_server, "POST", "/jobs/sync/gmail")
    assert status == 400
    assert "identificador" in payload["message"]


def test_statement_endpoint_imports_csv_then_rebuilds_models(
    runner_server: tuple[str, int],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[list[str]] = []
    imported: dict[str, object] = {}

    def run(args: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        if args[1] == "import-account-statement":
            source = Path(args[2])
            imported["name"] = source.name
            imported["content"] = source.read_bytes()
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(sync_runner.subprocess, "run", run)
    monkeypatch.setattr(sync_runner, "_update_operation", lambda *_args: None)
    content = b"synthetic Mercado Pago statement"
    headers = operation_headers(
        **{
            "X-Filename": quote("resumen agosto.csv", safe=""),
            "Content-Length": str(len(content)),
        }
    )

    status, payload = request(
        runner_server,
        "POST",
        sync_runner.STATEMENT_IMPORT_PATH,
        body=content,
        headers=headers,
    )
    assert status == 202
    assert payload == {"message": "Importación iniciada."}
    wait_for_runner()
    assert imported == {"name": "resumen agosto.csv", "content": content}
    assert calls[0][0:2] == ["home-lab", "import-account-statement"]
    assert calls[1] == ["home-lab", "transform"]


@pytest.mark.parametrize("filename", ["../extracto.csv", "extracto.txt"])
def test_statement_endpoint_rejects_invalid_filename(
    runner_server: tuple[str, int], filename: str
) -> None:
    status, payload = request(
        runner_server,
        "POST",
        sync_runner.STATEMENT_IMPORT_PATH,
        body=b"not used",
        headers=operation_headers(
            **{"X-Filename": quote(filename, safe=""), "Content-Length": "8"}
        ),
    )
    assert status == 400
    assert payload == {"message": "Seleccioná un archivo CSV válido."}


def test_statement_endpoint_rejects_oversized_file(runner_server: tuple[str, int]) -> None:
    status, payload = request(
        runner_server,
        "POST",
        sync_runner.STATEMENT_IMPORT_PATH,
        headers=operation_headers(
            **{
                "Content-Length": str(sync_runner.MAX_STATEMENT_BYTES + 1),
                "X-Filename": "extracto.csv",
            }
        ),
    )
    assert status == 413
    assert payload == {"message": "El CSV supera el límite de 10 MB."}


def test_second_job_is_rejected_while_runner_is_busy(runner_server: tuple[str, int]) -> None:
    sync_runner.SYNC_LOCK.acquire()
    try:
        status, payload = request(
            runner_server,
            "POST",
            "/jobs/sync/gmail",
            headers=operation_headers(),
        )
    finally:
        sync_runner.SYNC_LOCK.release()
    assert status == 409
    assert payload == {"message": "Ya hay una operación en ejecución."}
