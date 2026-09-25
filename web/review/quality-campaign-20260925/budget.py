"""Persistent dollar reservations. Unknown outcomes keep their whole reservation."""
import fcntl
import json
import math
import os
from pathlib import Path
import tempfile
import time

class Budget:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.path = self.directory / 'budget.json'

    def update(self, operation):
        self.directory.mkdir(parents=True, exist_ok=True)
        with (self.directory / 'budget.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            state = json.loads(self.path.read_text()) if self.path.exists() else {'limit_usd': 2, 'calls': {}}
            result = operation(state)
            with tempfile.NamedTemporaryFile(mode='w', dir=self.directory, delete=False) as tmp:
                json.dump(state, tmp, indent=2); tmp.flush(); os.fsync(tmp.fileno())
            os.replace(tmp.name, self.path)
            fd = os.open(self.directory, os.O_DIRECTORY)
            try: os.fsync(fd)
            finally: os.close(fd)
            return result

    @staticmethod
    def committed(state):
        return sum(x.get('actual_usd', x.get('reconciled_upper_usd', x['reserved_usd'])) for x in state['calls'].values())

    def reconcile_upper(self, name, upper, evidence):
        """Record an externally evidenced bound, never pretend it is an actual cost."""
        if not math.isfinite(upper) or upper < 0 or not evidence:
            raise ValueError('invalid reconciliation')
        def operation(state):
            call = state['calls'][name]
            if 'actual_usd' in call or 'reconciled_upper_usd' in call or upper > call['reserved_usd']:
                raise ValueError('invalid reconciliation state')
            call.update(reconciled_upper_usd=upper, reconciliation_evidence=evidence,
                        reconciled_at=time.time())
        self.update(operation)

    def reserve(self, name, amount, phase):
        if not math.isfinite(amount) or amount <= 0:
            raise ValueError('invalid reservation')
        def operation(state):
            if name in state['calls']: raise ValueError('call ID already used')
            ceiling = 1.4 if phase == 'development' else 2.0
            if self.committed(state) + amount > min(ceiling, state['limit_usd']):
                raise RuntimeError('budget reservation refused')
            state['calls'][name] = {'reserved_usd': amount, 'phase': phase, 'reserved_at': time.time()}
        self.update(operation)

    def settle(self, name, cost):
        if not isinstance(cost, (float, int)) or not math.isfinite(cost) or cost < 0:
            raise ValueError('unknown cost')
        def operation(state):
            call = state['calls'][name]
            if 'actual_usd' in call: raise ValueError('already settled')
            call['actual_usd'] = cost
            call['settled_at'] = time.time()
            call['bound_violated'] = cost > call['reserved_usd']
            return self.committed(state)
        total = self.update(operation)
        if total > 2: raise RuntimeError('provider exceeded authorized bounds; stop')
        return total

    def ensure_supervised(self):
        lease = self.directory / 'agent.lease'
        if not lease.exists() or not 0 <= time.time()-lease.stat().st_mtime < 90:
            raise RuntimeError('agent supervision lease expired')
        state = json.loads(self.path.read_text()) if self.path.exists() else {'calls': {}}
        if any(('actual_usd' not in c and 'reconciled_upper_usd' not in c) or c.get('bound_violated') for c in state['calls'].values()):
            raise RuntimeError('unresolved reservation: no additional paid call')
