import json
from pathlib import Path
import tempfile
import unittest
from budget import Budget

class BudgetTests(unittest.TestCase):
    def test_unknown_is_not_free_and_calls_cannot_be_reused(self):
        with tempfile.TemporaryDirectory() as tmp:
            b=Budget(tmp);Path(tmp,'agent.lease').touch()
            b.reserve('first',1.2,'development')
            with self.assertRaises(RuntimeError):b.ensure_supervised()
            with self.assertRaises(RuntimeError):b.reserve('second',.3,'development')
            b.settle('first',.01);b.ensure_supervised()
            with self.assertRaises(ValueError):b.reserve('first',.1,'development')
            b.reserve('second',1.3,'development')
            with self.assertRaises(RuntimeError):b.reserve('third',.8,'final')
    def test_missing_lease_stops_before_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(RuntimeError):Budget(tmp).ensure_supervised()
    def test_reconciled_bound_is_counted_without_claiming_actual(self):
        with tempfile.TemporaryDirectory() as tmp:
            b=Budget(tmp);Path(tmp,'agent.lease').touch()
            b.reserve('lost',1.2,'development')
            b.reconcile_upper('lost',.03,'read-only account audit')
            b.ensure_supervised()
            state=json.loads(b.path.read_text())
            self.assertNotIn('actual_usd',state['calls']['lost'])
            self.assertAlmostEqual(b.committed(state),.03)
            with self.assertRaises(ValueError):b.reconcile_upper('lost',0,'new guess')
    def test_budget_bound_and_nonfinite_costs(self):
        with tempfile.TemporaryDirectory() as tmp:
            b=Budget(tmp)
            with self.assertRaises(ValueError):b.reserve('bad',float('nan'),'final')
            b.reserve('a',1.4,'development');b.settle('a',1.4)
            with self.assertRaises(RuntimeError):b.reserve('b',.61,'final')
            b.reserve('b',.6,'final')
            with self.assertRaises(ValueError):b.settle('b',None)
            self.assertAlmostEqual(b.committed(json.loads(b.path.read_text())),2)

if __name__=='__main__':unittest.main()
