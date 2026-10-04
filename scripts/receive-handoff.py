"""Decode the explicitly supplied private deployment bundle without logging it."""
import base64
import hashlib
import io
import os
from pathlib import Path, PurePosixPath
import sys
import tarfile
import shutil

def receive(destination):
    root = Path(destination).resolve()
    runner = Path(os.environ['RUNNER_TEMP']).resolve()
    if runner not in root.parents or root.exists():
        raise ValueError('Use a new directory within RUNNER_TEMP')
    chunks = [os.environ.get(f'HOUSE_OPS_HANDOFF_{i:02}', '') for i in range(1, 21)]
    payload = base64.b64decode(''.join(chunks), validate=True)
    expected = os.environ['HANDOFF_SHA256']
    if len(payload) > 20 * 1024 * 1024 or hashlib.sha256(payload).hexdigest() != expected:
        raise ValueError('Invalid private bundle integrity')
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as archive:
        members = archive.getmembers()
        if len(members)>200 or sum(m.size for m in members)>100*1024*1024:
            raise ValueError('Private bundle limit exceeded')
        for member in members:
            name=PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or not member.isfile() or member.size>20*1024*1024:
                raise ValueError('Invalid archive member')
        root.mkdir(mode=0o700)
        for member in members:
            path=root.joinpath(*PurePosixPath(member.name).parts)
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            path.write_bytes(archive.extractfile(member).read())
            path.chmod(0o600)
    if not (root/'records.json').is_file():
        raise ValueError('Private manifest missing')
    print('Private deployment bundle validated; no contents were logged.')

if __name__=='__main__':
    try:
        if len(sys.argv)==3 and sys.argv[1]=='--cleanup':
            root=Path(sys.argv[2]).resolve()
            if Path(os.environ['RUNNER_TEMP']).resolve() not in root.parents or not root.name.startswith('casa-handoff-'):
                raise ValueError('Cleanup outside staging directory')
            if root.exists():
                shutil.rmtree(root)
        else:
            receive(sys.argv[1])
    except Exception:
        print('Private bundle failed integrity, size or path validation.',file=sys.stderr)
        sys.exit(1)
