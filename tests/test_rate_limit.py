
import app.rate_limit as rate_limit_module
from app.config import settings
from app.rate_limit import check_login_allowed, record_failed_login


class FakeRedis:
    def __init__(self, result):
        self.result = result
        self.calls = []
        self.closed = False

    def eval(self, *args):
        self.calls.append(args)
        return self.result

    def close(self):
        self.closed = True


def test_check_uses_separate_ip_and_phone_keys(monkeypatch):
    fake = FakeRedis([1, 0])
    monkeypatch.setattr(rate_limit_module, "_client", lambda: fake)

    allowed, retry_after = check_login_allowed(
        "192.0.2.10", "08000000001"
    )

    assert allowed is True
    assert retry_after == 0
    assert len(fake.calls) == 1

    call = fake.calls[0]
    assert call[0] == rate_limit_module.CHECK_SCRIPT
    assert call[1] == 2

    ip_key, phone_key = call[2], call[3]
    assert ip_key == rate_limit_module._key("ip:192.0.2.10")
    assert phone_key == rate_limit_module._key("phone:08000000001")
    assert ip_key != phone_key
    assert "192.0.2.10" not in ip_key
    assert "08000000001" not in phone_key
    assert call[4] == settings.login_rate_limit_attempts
    assert fake.closed is True


def test_failed_login_uses_both_keys_and_configured_expiry(monkeypatch):
    fake = FakeRedis([1, 0])
    monkeypatch.setattr(rate_limit_module, "_client", lambda: fake)

    recorded, retry_after = record_failed_login(
        "192.0.2.20", "08000000002"
    )

    assert recorded is True
    assert retry_after == 0
    assert len(fake.calls) == 1

    call = fake.calls[0]
    assert call[0] == rate_limit_module.RECORD_FAILURE_SCRIPT
    assert call[1] == 2
    assert call[2] == rate_limit_module._key("ip:192.0.2.20")
    assert call[3] == rate_limit_module._key("phone:08000000002")
    assert call[4] == settings.login_rate_limit_attempts
    assert call[5] == settings.login_rate_limit_window_seconds
    assert fake.closed is True


def test_blocked_check_returns_retry_delay(monkeypatch):
    fake = FakeRedis([0, 73])
    monkeypatch.setattr(rate_limit_module, "_client", lambda: fake)

    allowed, retry_after = check_login_allowed(
        "192.0.2.30", "08000000003"
    )

    assert allowed is False
    assert retry_after == 73
    assert fake.closed is True


def test_blocked_failure_does_not_bypass_limit(monkeypatch):
    fake = FakeRedis([0, 45])
    monkeypatch.setattr(rate_limit_module, "_client", lambda: fake)

    recorded, retry_after = record_failed_login(
        "192.0.2.40", "08000000004"
    )

    assert recorded is False
    assert retry_after == 45
    assert fake.closed is True

def test_client_supports_redis_url(monkeypatch):
    expected_url = "rediss://example.invalid:6379"
    captured = {}
    fake = FakeRedis([1, 0])

    def fake_from_url(url, **kwargs):
        captured["url"] = url
        captured["kwargs"] = kwargs
        return fake

    monkeypatch.setattr(settings, "redis_url", expected_url)
    monkeypatch.setattr(rate_limit_module.Redis, "from_url", fake_from_url)

    result = rate_limit_module._client()

    assert result is fake
    assert captured["url"] == expected_url
    assert captured["kwargs"]["decode_responses"] is True
    assert captured["kwargs"]["socket_connect_timeout"] == 2
    assert captured["kwargs"]["socket_timeout"] == 2


def test_client_rejects_invalid_redis_url(monkeypatch):
    from app.rate_limit import RateLimitUnavailable

    monkeypatch.setattr(settings, "redis_url", "https://example.invalid")

    try:
        rate_limit_module._client()
    except RateLimitUnavailable:
        pass
    else:
        raise AssertionError("Invalid Redis URL should be rejected")
