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
# ponytail: cap the in-dashboard tail at 20k characters; add external log
# storage only if real runs outgrow this limit.
MAX_OPERATION_LOG_LENGTH = 20_000
# ponytail: one process and one global lock fit a two-person home; use a durable
# queue only if concurrent or cross-host workers become a measured need.
SYNC_LOCK = Lock()


def _update_operation(
    operation_id: UUID,
    status: str,
    message: str = "",
    log: str = "",
) -> None:
    assignments = ["status = :status", "message = :message", "log = :log"]
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
                    "log": log[-MAX_OPERATION_LOG_LENGTH:],
                },
            )
    except Exception:
        logging.exception("Could not update House Ops operation %s", operation_id)


def _execute_commands(
    operation_id: UUID,
    commands: tuple[tuple[str, ...], ...],
    *,
    running_message: str,
    success_message: str,
    failure_message: str,
) -> None:
    log = ""
    _update_operation(operation_id, "running", running_message, log)
    try:
        for command in commands:
            result = subprocess.run(
                list(command),
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            log = (log + (result.stdout or ""))[-MAX_OPERATION_LOG_LENGTH:]
            _update_operation(
                operation_id,
                "running",
                f"{command[1]} terminó con código {result.returncode}.",
                log,
            )
            if result.returncode:
                raise RuntimeError(f"{command[1]} terminó con código {result.returncode}")
    except (OSError, RuntimeError) as error:
        logging.exception("Operation %s failed", operation_id)
        log = (log + f"\nERROR: {error}\n")[-MAX_OPERATION_LOG_LENGTH:]
        _update_operation(operation_id, "failed", f"{failure_message} {error}", log)
    else:
        _update_operation(operation_id, "succeeded", success_message, log)


def _execute(operation_id: UUID, commands: tuple[tuple[str, ...], ...]) -> None:
    try:
        _execute_commands(
            operation_id,
            commands,
            running_message="Operación en ejecución.",
            success_message="Operación completada.",
            failure_message="La operación falló.",
        )
    finally:
        SYNC_LOCK.release()


def _execute_statement(operation_id: UUID, filename: str, content: bytes) -> None:
    try:
        with TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / filename
            source.write_bytes(content)
            _execute_commands(
                operation_id,
                (
                    ("home-lab", "import-account-statement", str(source)),
                    ("home-lab", "transform"),
                ),
                running_message="Importando extracto.",
                success_message="Extracto importado y datos actualizados.",
                failure_message="No se pudo importar el extracto.",
            )
    except OSError as error:
        logging.exception("Statement operation %s failed", operation_id)
        _update_operation(operation_id, "failed", f"No se pudo importar el extracto. {error}")
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
