
import hashlib
import threading
import time
from urllib.parse import urlsplit

from redis import Redis
from redis.exceptions import RedisError

from app.config import settings
import logging

logger = logging.getLogger(__name__)


# KEYS[1] counts failures from one IP address, KEYS[2] failures for one
# account. ARGV[1] is the account limit and ARGV[2] the (higher) address
# limit: many people in Nigeria share one mobile-network address, so one
# person's typos must not lock out their neighbours.
CHECK_SCRIPT = """
local ip_count = tonumber(redis.call('GET', KEYS[1]) or '0')
local phone_count = tonumber(redis.call('GET', KEYS[2]) or '0')
local limit = tonumber(ARGV[1])
local ip_limit = tonumber(ARGV[2])

if ip_count >= ip_limit or phone_count >= limit then
    local ip_ttl = redis.call('TTL', KEYS[1])
    local phone_ttl = redis.call('TTL', KEYS[2])
    return {0, math.max(0, ip_ttl, phone_ttl)}
end

return {1, 0}
"""


RECORD_FAILURE_SCRIPT = """
local ip_count = tonumber(redis.call('GET', KEYS[1]) or '0')
local phone_count = tonumber(redis.call('GET', KEYS[2]) or '0')
local limit = tonumber(ARGV[1])
local ip_limit = tonumber(ARGV[2])

if ip_count >= ip_limit or phone_count >= limit then
    local ip_ttl = redis.call('TTL', KEYS[1])
    local phone_ttl = redis.call('TTL', KEYS[2])
    return {0, math.max(0, ip_ttl, phone_ttl)}
end

local window = tonumber(ARGV[3])
ip_count = redis.call('INCR', KEYS[1])
phone_count = redis.call('INCR', KEYS[2])

if ip_count == 1 then
    redis.call('EXPIRE', KEYS[1], window)
end

if phone_count == 1 then
    redis.call('EXPIRE', KEYS[2], window)
end

return {1, 0}
"""


class RateLimitUnavailable(Exception):
    """Raised when the rate-limit service cannot be reached."""


def _key(value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return f"ekimove:login:fail:{digest}"


def _client() -> Redis:
    if settings.redis_url:
        try:
            parsed = urlsplit(settings.redis_url)
            valid_scheme = parsed.scheme in ('redis', 'rediss')
            valid_host = bool(parsed.hostname)
            parsed.port  # Validate the port if one is specified.
        except ValueError as exc:
            raise RateLimitUnavailable('Invalid Redis URL configuration') from exc

        if not valid_scheme or not valid_host:
            raise RateLimitUnavailable('Invalid Redis URL configuration')

        return Redis.from_url(
            settings.redis_url,
            socket_connect_timeout=2,
            socket_timeout=2,
            decode_responses=True,
        )

    if not all(
        (
            settings.redis_host,
            settings.redis_port,
            settings.redis_username,
            settings.redis_password,
        )
    ):
        raise RateLimitUnavailable("Rate limiter is not configured")

    return Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        username=settings.redis_username,
        password=settings.redis_password,
        ssl=settings.redis_ssl,
        ssl_cert_reqs="required" if settings.redis_ssl else None,
        socket_connect_timeout=2,
        socket_timeout=2,
        decode_responses=True,
    )


def _run_script(script: str, ip_address: str, phone: str, *args: int) -> tuple[bool, int]:
    client = None

    try:
        client = _client()
        result = client.eval(
            script,
            2,
            _key(f"ip:{ip_address}"),
            _key(f"phone:{phone.strip()}"),
            *args,
        )
        return bool(int(result[0])), max(0, int(result[1]))
    except RedisError as exc:
        logger.error(
            "Redis rate limiter failed: %s",
            type(exc).__name__,
        )
        raise RateLimitUnavailable from exc
    finally:
        if client is not None:
            client.close()


def check_login_allowed(ip_address: str, phone: str) -> tuple[bool, int]:
    """Return whether login is allowed and the retry delay in seconds."""
    return _run_script(
        CHECK_SCRIPT,
        ip_address,
        phone,
        settings.login_rate_limit_attempts,
        max(settings.login_rate_limit_attempts, settings.login_ip_rate_limit_attempts),
    )


def record_failed_login(ip_address: str, phone: str) -> tuple[bool, int]:
    """Atomically record a failure unless either limit has been reached."""
    return _run_script(
        RECORD_FAILURE_SCRIPT,
        ip_address,
        phone,
        settings.login_rate_limit_attempts,
        max(settings.login_rate_limit_attempts, settings.login_ip_rate_limit_attempts),
        settings.login_rate_limit_window_seconds,
    )


# --------------------------------------------------------------------------
# Simple counters: sign-ups, code requests and driver applications
# --------------------------------------------------------------------------

_memory_hits: dict[str, tuple[int, float]] = {}
_memory_lock = threading.Lock()


def _memory_allow(key: str, limit: int, window: int) -> bool:
    now = time.monotonic()
    with _memory_lock:
        if len(_memory_hits) > 10_000:
            for stale in [k for k, (_, start) in _memory_hits.items() if now - start >= window]:
                _memory_hits.pop(stale, None)
        count, start = _memory_hits.get(key, (0, now))
        if now - start >= window:
            count, start = 0, now
        count += 1
        _memory_hits[key] = (count, start)
        return count <= limit


def allow(bucket: str, identity: str, limit: int, window_seconds: int) -> bool:
    """Count one action for this identity; False once it passes the limit.

    Uses the shared Redis counter when Redis is set up, and a counter in
    this process otherwise (or if Redis can't be reached), so a Redis
    outage never blocks sign-ups outright.
    """
    if limit <= 0:
        return True
    window = max(1, int(window_seconds))
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    key = f"ekimove:{bucket}:{digest}"
    if settings.redis_url or settings.redis_host:
        client = None
        try:
            client = _client()
            count = client.incr(key)
            if count == 1:
                client.expire(key, window)
            return int(count) <= limit
        except (RateLimitUnavailable, RedisError, OSError):
            logger.warning("Rate limiter fell back to in-memory counting")
        finally:
            if client is not None:
                try:
                    client.close()
                except RedisError:
                    pass
    return _memory_allow(key, limit, window)


def reset_memory_counters() -> None:
    """Tests start each case with clean counters."""
    with _memory_lock:
        _memory_hits.clear()


def enforce(bucket: str, identity: str, limit: int, window_seconds: int, message: str) -> None:
    """Raise 429 with ``message`` once ``identity`` passes the limit."""
    from fastapi import HTTPException  # keep this module importable without FastAPI

    if not allow(bucket, identity, limit, window_seconds):
        raise HTTPException(status_code=429, detail=message, headers={"Retry-After": str(max(60, window_seconds // 4))})
