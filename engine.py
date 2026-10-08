"""Own only the GRENOUGH server launched by this Pi package, inside WSL."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone


def identity(pid):
    try:
        stat = Path(f'/proc/{pid}/stat').read_text()
        fields = stat[stat.rfind(')') + 2:].split()
        return {'boot': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                'start_ticks': fields[19]}
    except (OSError, IndexError):
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start', 'stop'])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--owner')
    parser.add_argument('--profile', default='mtp_k8v4')
    parser.add_argument('--merge', choices=['upstream', 'warp'], default='warp')
    parser.add_argument('--split-cap', type=int, choices=[1, 2, 4, 8], default=4)
    args = parser.parse_args()
    root = args.root.resolve()
    if not root.is_absolute() or not (root / 'tools/serve.py').is_file() or not 1 <= args.port <= 65535:
        parser.error('Valid GRENOUGH root and TCP port required')
    state_path = root / f'results/pi-engine-{args.port}.json'
    if args.action == 'stop':
        if not state_path.exists():
            print('No Pi-managed GRENOUGH server is running.'); return 0
        state = json.loads(state_path.read_text())
        if args.owner and state.get('owner') != args.owner:
            print('Server belongs to another Pi session; left running.'); return 0
        pid = state['pid']
        if identity(pid) != state.get('identity'):
            state_path.unlink(missing_ok=True)
            print('Removed stale server record.'); return 0
        command = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
        allowed = [str(root / 'tools/serve.py').encode(), str(root / 'worktrees/candidate/build/apps/ninfer-serve').encode()]
        if not any(item in command for item in allowed):
            raise RuntimeError('PID does not match the managed GRENOUGH server; refusing to stop it')
        os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + 15
        while identity(pid) == state.get('identity') and time.monotonic() < deadline:
            time.sleep(.1)
        if identity(pid) == state.get('identity'):
            os.kill(pid, signal.SIGKILL)
        print('GRENOUGH stopped; GPU allocation released.'); return 0

    if not args.owner:
        parser.error('Server start requires an owner identifier')
    state_path.parent.mkdir(parents=True, exist_ok=True)
    with state_path.with_suffix('.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('A Pi-managed GRENOUGH server is already starting/running')
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        command = [str(root / '.venv/bin/python'), '-u', str(root / 'tools/serve.py'),
                   '--variant', 'candidate', '--profile', args.profile,
                   '--merge', args.merge, '--split-cap', str(args.split_cap),
                   '--host', '127.0.0.1', '--port', str(args.port),
                   '--model-id', 'GRENOUGH-Qwen3.8-27B',
                   '--clocks-policy', 'driver-default-no-manual-lock',
                   '--out', str(root / 'results' / f'pi-server-{stamp}')]
        env = dict(os.environ)
        env['PATH'] = '/usr/local/cuda-13.1/bin:' + env.get('PATH', '')
        child = subprocess.Popen(command, cwd=root, env=env)
        state = {'pid': child.pid, 'identity': identity(child.pid), 'owner': args.owner,
                 'root': str(root), 'port': args.port, 'started_utc': stamp}
        temp = state_path.with_suffix('.tmp')
        temp.write_text(json.dumps(state, indent=2))
        temp.replace(state_path)

        def forward(_signal, _frame):
            if child.poll() is None:
                child.terminate()
        signal.signal(signal.SIGTERM, forward)
        signal.signal(signal.SIGINT, forward)
        try:
            return child.wait()
        finally:
            if state_path.exists() and json.loads(state_path.read_text()).get('owner') == args.owner:
                state_path.unlink()


if __name__ == '__main__':
    raise SystemExit(main())
