import os
import stat
import subprocess
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "reauthorize-gmail.sh"


def test_uses_production_gmail_secret_paths(tmp_path: Path) -> None:
    config_dir = tmp_path / "config"
    secrets_dir = config_dir / "secrets"
    secrets_dir.mkdir(parents=True)
    (secrets_dir / "gmail_client_secret.json").write_text("{}", encoding="utf-8")

    command = tmp_path / "home-lab"
    command.write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"$GMAIL_CLIENT_SECRET_PATH\" \"$GMAIL_TOKEN_PATH\" \"$*\"\n",
        encoding="utf-8",
    )
    command.chmod(command.stat().st_mode | stat.S_IXUSR)

    result = subprocess.run(
        [str(SCRIPT)],
        check=True,
        env={
            **os.environ,
            "HOME_LAB_CONFIG_DIR": str(config_dir),
            "HOME_LAB_COMMAND": str(command),
        },
        capture_output=True,
        text=True,
    )

    assert result.stdout.splitlines()[1:] == [
        str(secrets_dir / "gmail_client_secret.json"),
        str(secrets_dir / "gmail_token.json"),
        "gmail-auth",
    ]
