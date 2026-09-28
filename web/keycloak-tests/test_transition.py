"""Offline safety contracts for the deployment sequence; no infrastructure calls."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]
ACTIVE = ROOT/'web/deploy/preview/active-long-transcript-20260927.yml'
CANDIDATE = ROOT/'web/deploy/preview/keycloak-candidate-20260927.yml'
SCRIPT = ROOT/'web/scripts/keycloak-transition.py'

class TransitionTest(unittest.TestCase):
    def command(self, out, candidate=CANDIDATE):
        return ['python3', str(SCRIPT), '--active', str(ACTIVE), '--candidate', str(candidate), '--output-dir', str(out)]

    def test_continuity_maintenance_and_return_preserve_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)/'phases'
            subprocess.run(self.command(out), capture_output=True, check=True)
            phases = {p.stem:yaml.safe_load(p.read_text()) for p in out.glob('*.yml')}
            base, candidate = yaml.safe_load(ACTIVE.read_text()), yaml.safe_load(CANDIDATE.read_text())
            self.assertEqual(len(phases), 7)
            for phase in phases.values():
                self.assertEqual(phase['volumes'], candidate['volumes'])
                for name in ['db','egress']:
                    self.assertEqual(phase['services'][name], base['services'][name])
                self.assertEqual(phase['services']['keycloak']['image'], candidate['services']['keycloak']['image'])
            for name in ['01-authdb','02-private-bootstrap','03-private-identity-ready','07-return-authelia']:
                for service in ['web','worker']:
                    self.assertEqual(phases[name]['services'][service], base['services'][service])
            self.assertFalse(phases['01-authdb']['services']['keycloak']['enabled'])
            self.assertTrue(phases['02-private-bootstrap']['services']['keycloak']['enabled'])
            for name in ['03-private-identity-ready','04-maintenance','05-private-web','06-private-worker','07-return-authelia']:
                self.assertNotIn('tarjama-keycloak-bootstrap', str(phases[name]['services']['keycloak']['secrets']))
            for service in ['web','worker']:
                self.assertFalse(phases['04-maintenance']['services'][service]['enabled'])
            self.assertEqual(phases['04-maintenance']['jobs']['migrate'], candidate['jobs']['migrate'])
            self.assertEqual(phases['01-authdb']['jobs']['backup'], base['jobs']['backup'])
            self.assertTrue(phases['05-private-web']['services']['web']['enabled'])
            self.assertFalse(phases['05-private-web']['services']['worker']['enabled'])
            for service in ['web','worker']:
                self.assertTrue(phases['06-private-worker']['services'][service]['enabled'])
                self.assertEqual(phases['06-private-worker']['services'][service]['image'], candidate['services'][service]['image'])
            self.assertEqual(phases['03-private-identity-ready'], phases['07-return-authelia'])

    def test_refuses_changed_egress_storage_and_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            for key in ['egress','storage']:
                value = yaml.safe_load(CANDIDATE.read_text())
                if key=='egress': value['services']['egress']['image']='docker.io/other@sha256:'+'0'*64
                else: value['volumes']['library']['size']='1Gi'
                candidate=Path(tmp)/(key+'.yml');candidate.write_text(yaml.safe_dump(value))
                result=subprocess.run(self.command(Path(tmp)/key, candidate), capture_output=True)
                self.assertNotEqual(result.returncode, 0)
            out=Path(tmp)/'phases'
            subprocess.run(self.command(out), capture_output=True, check=True)
            before={p.name:p.read_bytes() for p in out.glob('*.yml')}
            self.assertNotEqual(subprocess.run(self.command(out), capture_output=True).returncode,0)
            self.assertEqual(before,{p.name:p.read_bytes() for p in out.glob('*.yml')})

    def test_private_master_contract_matches_qualified_origin(self):
        contract=json.loads((ROOT/'web/deploy/keycloak/master-private-contract.json').read_text())
        candidate=yaml.safe_load(CANDIDATE.read_text())
        self.assertEqual(contract['realm'],'master')
        self.assertTrue(contract['merge_existing_attributes'])
        self.assertEqual(contract['required_attributes']['frontendUrl'],candidate['services']['keycloak']['env']['KC_HOSTNAME_ADMIN'])
        self.assertEqual(contract['tarjama_issuer_unchanged'],candidate['services']['web']['env']['OIDC_ISSUER'])
        self.assertEqual(contract['public_master_and_admin_routes'],'denied')
