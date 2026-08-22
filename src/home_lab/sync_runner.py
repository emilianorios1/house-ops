"""Internal asynchronous runner for House Ops allow-listed operations."""

from __future__ import annotations

import json
import logging
import subprocess
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock, Thread
from urllib.parse import unquote
from uuid import UUID

from sqlalchemy import text

from home_lab.database import get_engine
from home_lab.logging import configure_logging


JOB_COMMANDS = {
    "/jobs/sync/gmail": (("home-lab", "sync-gmail"),),
    "/jobs/sync/mercadopago": (("home-lab", "sync-mercadopago"),),
    "/jobs/sync/siat-tgi": (("home-lab", "sync-siat-tgi"),),
    "/jobs/transform": (("home-lab", "transform"),),
}
STATEMENT_IMPORT_PATH = "/jobs/import/mercadopago-statement"
MAX_STATEMENT_BYTES = 10 * 1024 * 1024
# ponytail: one process and one global lock fit a two-person home; use a durable
# queue only if concurrent or cross-host workers become a measured need.
SYNC_LOCK = Lock()


def _update_operation(operation_id: UUID, status: str, message: str = "") -> None:
    assignments = ["status = :status", "message = :message"]
    if status == "running":
        assignments.append("started_at = now()")
    if status in {"succeeded", "failed"}:
        assignments.append("completed_at = now()")
    try:
        with get_engine().begin() as connection:
            connection.execute(
                text(
                    f"UPDATE house_ops_operation_runs SET {', '.join(assignments)} "
                    "WHERE id = :operation_id"
                ),
                {
                    "operation_id": operation_id,
                    "status": status,
                    "message": message[:500],
                },
            )
    except Exception:
        logging.exception("Could not update House Ops operation %s", operation_id)


def _execute(operation_id: UUID, commands: tuple[tuple[str, ...], ...]) -> None:
    _update_operation(operation_id, "running", "Operación en ejecución.")
    try:
        for command in commands:
            result = subprocess.run(
                list(command),
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if result.returncode:
                raise RuntimeError(f"{command[1]} terminó con código {result.returncode}")
    except (OSError, RuntimeError):
        logging.exception("Operation %s failed", operation_id)
        _update_operation(operation_id, "failed", "La operación falló. Revisá los logs del runner.")
    else:
        _update_operation(operation_id, "succeeded", "Operación completada.")
    finally:
        SYNC_LOCK.release()


def _execute_statement(operation_id: UUID, filename: str, content: bytes) -> None:
    _update_operation(operation_id, "running", "Importando extracto.")
    try:
        with TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / filename
            source.write_bytes(content)
            commands = (
                ("home-lab", "import-account-statement", str(source)),
                ("home-lab", "transform"),
            )
            for command in commands:
                result = subprocess.run(
                    list(command),
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                if result.returncode:
                    raise RuntimeError(f"{command[1]} terminó con código {result.returncode}")
    except (OSError, RuntimeError):
        logging.exception("Statement operation %s failed", operation_id)
        _update_operation(operation_id, "failed", "No se pudo importar el extracto. Revisá formato y logs.")
    else:
        _update_operation(operation_id, "succeeded", "Extracto importado y datos actualizados.")
    finally:
        SYNC_LOCK.release()


class SyncRequestHandler(BaseHTTPRequestHandler):
    """Accept jobs only from the private Docker network."""

    def do_GET(self) -> None:
        if self.path != "/health":
            self._respond(HTTPStatus.NOT_FOUND, "Endpoint inexistente.")
            return
        self._respond(HTTPStatus.OK, "Runner disponible.")

    def do_POST(self) -> None:
        operation_id = self._operation_id()
        if operation_id is None:
            return
        if self.path == STATEMENT_IMPORT_PATH:
            self._import_statement(operation_id)
            return
        commands = JOB_COMMANDS.get(self.path)
        if commands is None:
            self._respond(HTTPStatus.NOT_FOUND, "Operación inexistente.")
            return
        if not SYNC_LOCK.acquire(blocking=False):
            self._respond(HTTPStatus.CONFLICT, "Ya hay una operación en ejecución.")
            return
        Thread(target=_execute, args=(operation_id, commands), daemon=True).start()
        self._respond(HTTPStatus.ACCEPTED, "Operación iniciada.")

    def _operation_id(self) -> UUID | None:
        try:
            return UUID(self.headers.get("X-Operation-ID", ""))
        except ValueError:
            self._respond(HTTPStatus.BAD_REQUEST, "Falta un identificador de operación válido.")
            return None

    def _import_statement(self, operation_id: UUID) -> None:
        filename = unquote(self.headers.get("X-Filename", ""))
        if (
            not filename
            or filename in {".", ".."}
            or "/" in filename
            or "\\" in filename
            or Path(filename).suffix.lower() != ".csv"
        ):
            self._respond(HTTPStatus.BAD_REQUEST, "Seleccioná un archivo CSV válido.")
            return
        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            content_length = 0
        if content_length <= 0:
            self._respond(HTTPStatus.LENGTH_REQUIRED, "El archivo está vacío.")
            return
        if content_length > MAX_STATEMENT_BYTES:
            self._respond(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "El CSV supera el límite de 10 MB.")
            return
        content = self.rfile.read(content_length)
        if len(content) != content_length:
            self._respond(HTTPStatus.BAD_REQUEST, "No se recibió el archivo completo.")
            return
        if not SYNC_LOCK.acquire(blocking=False):
            self._respond(HTTPStatus.CONFLICT, "Ya hay una operación en ejecución.")
            return
        Thread(
            target=_execute_statement,
            args=(operation_id, filename, content),
            daemon=True,
        ).start()
        self._respond(HTTPStatus.ACCEPTED, "Importación iniciada.")

    def _respond(self, status: HTTPStatus, message: str) -> None:
        body = json.dumps({"message": message}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except OSError:
            logging.info("Client disconnected before receiving runner response")

    def log_message(self, format: str, *args: object) -> None:
        logging.info("%s - %s", self.client_address[0], format % args)


def main() -> None:
    configure_logging()
    server = ThreadingHTTPServer(("0.0.0.0", 8080), SyncRequestHandler)
    logging.info("House Ops runner listening on port 8080")
    server.serve_forever()


if __name__ == "__main__":
    main()
