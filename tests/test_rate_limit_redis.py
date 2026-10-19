

from uuid import uuid4
import os
import pytest

from app.rate_limit import (
    CHECK_SCRIPT,
    RECORD_FAILURE_SCRIPT,
    _client,
    _key,
)

@pytest.mark.skipif(
    os.getenv("EKIMOVE_RUN_REDIS_INTEGRATION") != "1",
    reason="Set EKIMOVE_RUN_REDIS_INTEGRATION=1 to run live Redis tests",
)

def test_live_redis_limits_and_expiry():
    client = _client()
    suffix = uuid4().hex

    ip = f"selftest:{suffix}:ip"
    phone_a = f"selftest:{suffix}:phone-a"
    phone_b = f"selftest:{suffix}:phone-b"

    ip_key = _key(ip)
    phone_a_key = _key(phone_a)
    phone_b_key = _key(phone_b)

    limit = 2
    window = 10

    try:
        # Same IP, different phone identifiers: the IP limit must apply.
        for phone in (phone_a, phone_b):
            result = client.eval(
                RECORD_FAILURE_SCRIPT,
                2,
                ip_key,
                _key(phone),
                limit,
                window,
            )
            assert int(result[0]) == 1, result

        check = client.eval(
            CHECK_SCRIPT,
            2,
            ip_key,
            _key(f"selftest:{suffix}:phone-c"),
            limit,
        )
        assert int(check[0]) == 0, "IP limit was not enforced"

        # Same phone, different IP identifiers: the phone limit must apply.
        shared_phone_key = _key(f"selftest:{suffix}:shared-phone")
        ip_a_key = _key(f"selftest:{suffix}:ip-a")
        ip_b_key = _key(f"selftest:{suffix}:ip-b")

        for ip_value in (ip_a_key, ip_b_key):
            result = client.eval(
                RECORD_FAILURE_SCRIPT,
                2,
                ip_value,
                shared_phone_key,
                limit,
                window,
            )
            assert int(result[0]) == 1, result

        check = client.eval(
            CHECK_SCRIPT,
            2,
            _key(f"selftest:{suffix}:ip-c"),
            shared_phone_key,
            limit,
        )
        assert int(check[0]) == 0, "Phone limit was not enforced"

        # Every newly created counter should have a positive TTL.
        for key in (
            ip_key,
            phone_a_key,
            phone_b_key,
            shared_phone_key,
            ip_a_key,
            ip_b_key,
        ):
            ttl = client.ttl(key)
            assert 0 < ttl <= window, f"Unexpected TTL for test key: {ttl}"

        print("PASS: Independent IP limit enforced.")
        print("PASS: Independent phone limit enforced.")
        print("PASS: Counter TTLs are set within the expected window.")

    finally:
        # Remove all keys created by this test.
        client.delete(
            ip_key,
            phone_a_key,
            phone_b_key,
            shared_phone_key,
            ip_a_key,
            ip_b_key,
        )
        client.close()
