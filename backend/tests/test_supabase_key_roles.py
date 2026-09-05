"""The startup key-role log names the ROLE of each bound key and never the key.

Why it exists: the pipeline's SUPABASE_ANON_KEY secret carries the service
JWT in production and a publishable key locally, so "which role is this run
using" was answerable only by decoding a secret by hand. assert_key_roles()
prints the claim at startup. These tests pin that the claim is right for every
key shape, that the key itself never reaches the log, and that a service key
without a service role refuses to start rather than failing on the first
insert.
"""

import base64
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from supabase_client import assert_key_roles, describe_key_role  # noqa: E402


def _jwt(role):
    payload = base64.urlsafe_b64encode(json.dumps({"role": role, "iss": "supabase"}).encode()).decode().rstrip("=")
    return f"eyJhbGciOiJIUzI1NiJ9.{payload}.signature-not-checked"


class TestDescribeKeyRole:
    @pytest.mark.parametrize("key,role", [
        (_jwt("service_role"), "service_role"),
        (_jwt("anon"), "anon"),
        ("sb_publishable_abc123", "publishable"),
        ("sb_secret_abc123", "secret"),
        (None, "unset"),
        ("", "unset"),
        ("not-a-key", "unknown"),
        ("a.b.c", "unparseable-jwt"),
    ])
    def test_role_for_each_key_shape(self, key, role):
        assert describe_key_role(key) == role

    def test_jwt_without_role_claim_is_named_as_such(self):
        payload = base64.urlsafe_b64encode(b'{"iss":"x"}').decode().rstrip("=")
        assert describe_key_role(f"h.{payload}.s") == "jwt-without-role"


class TestAssertKeyRoles:
    def _run(self, env):
        lines = []
        roles = assert_key_roles(env, log=lines.append)
        return roles, "\n".join(lines)

    def test_logs_the_claim_of_both_keys(self):
        roles, log = self._run({"SUPABASE_SERVICE_ROLE_KEY": _jwt("service_role"), "SUPABASE_ANON_KEY": "sb_publishable_x"})
        assert roles == {"SUPABASE_SERVICE_ROLE_KEY": "service_role", "SUPABASE_ANON_KEY": "publishable"}
        assert "SUPABASE_SERVICE_ROLE_KEY=service_role" in log and "SUPABASE_ANON_KEY=publishable" in log

    def test_the_key_itself_never_reaches_the_log(self):
        svc, anon = _jwt("service_role"), "sb_publishable_SECRETSECRET"
        _, log = self._run({"SUPABASE_SERVICE_ROLE_KEY": svc, "SUPABASE_ANON_KEY": anon})
        for secret in (svc, anon, svc.split(".")[1], "SECRETSECRET"):
            assert secret not in log

    def test_service_shaped_anon_key_is_a_warning_not_an_error(self):
        """How production runs today: the ANON secret carries the service JWT."""
        roles, log = self._run({"SUPABASE_SERVICE_ROLE_KEY": _jwt("service_role"), "SUPABASE_ANON_KEY": _jwt("service_role")})
        assert roles["SUPABASE_ANON_KEY"] == "service_role"
        assert "warning" in log and "SUPABASE_ANON_KEY carries a service role" in log

    def test_service_key_without_service_role_refuses_to_start(self):
        with pytest.raises(RuntimeError, match="not a service role"):
            self._run({"SUPABASE_SERVICE_ROLE_KEY": "sb_publishable_x"})
        with pytest.raises(RuntimeError, match="not a service role"):
            self._run({"SUPABASE_SERVICE_ROLE_KEY": _jwt("anon")})

    def test_unclassifiable_service_key_is_a_warning_not_fatal(self):
        """A fake key in a test, or a key format this helper has not met, must
        not kill the pipeline at startup. Refusal is for a POSITIVE anon read."""
        roles, log = self._run({"SUPABASE_SERVICE_ROLE_KEY": "fake-test-key", "SUPABASE_ANON_KEY": "fake"})
        assert roles["SUPABASE_SERVICE_ROLE_KEY"] == "unknown"
        assert "could not be classified" in log

    def test_unset_service_key_is_logged_not_raised(self):
        """Absence is get_service_client()'s error to raise, at first use."""
        roles, log = self._run({})
        assert roles["SUPABASE_SERVICE_ROLE_KEY"] == "unset"
        assert "SUPABASE_SERVICE_ROLE_KEY=unset" in log
