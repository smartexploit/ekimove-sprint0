"""Atọ́nà: EkiMove's conversational assistant.

Atọ́nà is open to everyone. It chats naturally in English or Nigerian Pidgin
and answers EkiMove questions from live EkiMove data through tools, rather
than from the model's memory:

* places and service areas, and the approved fare for an exact route
  (which also produces a "trip ready" draft the app can open in booking);
* the signed-in person's own rides, or a driver's own trips and status;
* payment rules, bank-transfer details and support contacts;
* optionally, a Geoapify place lookup and driving-route estimate.

Account tools tell guests to sign in instead of answering. Atọ́nà never
books a ride, assigns a driver or confirms a payment.
"""

import hashlib
import json
import logging
import threading
import time
import unicodedata
from collections import defaultdict, deque
from decimal import Decimal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from groq import APIConnectionError, APIStatusError, Groq
from pydantic import BaseModel, ConfigDict, Field
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import bearer_scheme, get_current_user
from app.config import settings
from app.database import get_db
from app.models import Place, ServiceArea, User, Zone

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/atona", tags=["Atọ́nà AI"])

MAX_TOOL_ROUNDS = 4
MAX_TOOL_CALLS_PER_ROUND = 4
MAX_HISTORY_TURNS = 12


# --------------------------------------------------------------------------
# Request models
# --------------------------------------------------------------------------
class AtonaTurn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=2000)


class AtonaChatMessage(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    message: str = Field(min_length=2, max_length=1000)
    # Turns as {"role", "content"} objects. Plain "user: ..." strings are
    # still accepted for older clients.
    conversation_history: list[AtonaTurn | str] = Field(
        default_factory=list, max_length=MAX_HISTORY_TURNS
    )


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def atona_available() -> bool:
    return bool(settings.atona_enabled and settings.groq_api_key)


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """Return the signed-in user, or None for guests and expired sessions."""
    if credentials is None:
        return None
    try:
        return get_current_user(credentials, db)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            return None
        raise


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", str(value)).casefold()
    value = value.replace("-", " ").replace("’", "'")
    return " ".join(value.split())


def first_name(full_name: str | None) -> str:
    return (full_name or "").strip().split(" ")[0] if full_name else ""


def _json_safe(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


# --------------------------------------------------------------------------
# Rate limiting: Redis when configured, otherwise a per-process fallback so
# Atọ́nà keeps working (with a looser, per-instance limit) without Redis.
# --------------------------------------------------------------------------
_memory_hits: dict[str, deque] = defaultdict(deque)
_memory_lock = threading.Lock()


def _memory_allow(key: str, limit: int, window: int) -> bool:
    now = time.monotonic()
    with _memory_lock:
        hits = _memory_hits[key]
        while hits and now - hits[0] > window:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        return True


def check_rate_limit(identity: str, limit: int) -> bool:
    window = max(1, settings.atona_rate_limit_window_seconds)
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    key = f"ekimove:atona:{digest}"

    if settings.redis_url or settings.redis_host:
        from app.rate_limit import RateLimitUnavailable, _client

        client = None
        try:
            client = _client()
            count = client.incr(key)
            if count == 1:
                client.expire(key, window)
            return int(count) <= limit
        except (RateLimitUnavailable, RedisError, OSError):
            logger.warning("Atọ́nà rate limiter fell back to in-memory limits")
        finally:
            if client is not None:
                try:
                    client.close()
                except RedisError:
                    pass

    return _memory_allow(key, limit, window)


# --------------------------------------------------------------------------
# EkiMove data used by the tools
# --------------------------------------------------------------------------
def bookable_places(db: Session) -> list[tuple[Place, ServiceArea]]:
    """Active places in active service areas and zones (what booking offers)."""
    rows = db.execute(
        select(Place, ServiceArea)
        .join(ServiceArea, Place.service_area_id == ServiceArea.id)
        .join(Zone, Place.zone_id == Zone.id)
        .where(
            Place.status == "active",
            ServiceArea.status == "active",
            Zone.is_active.is_(True),
        )
        .order_by(ServiceArea.name, Place.name)
    ).all()
    return [(place, area) for place, area in rows]


def _place_names(place: Place) -> list[str]:
    names = [place.name]
    if place.aliases:
        names.extend(alias for alias in place.aliases.split(",") if alias.strip())
    return [normalize_name(name) for name in names]


def match_place(query: str, places: list[tuple[Place, ServiceArea]]) -> dict:
    """Match free text to one bookable place: exact, then unique partial."""
    wanted = normalize_name(query or "")
    if len(wanted) < 2:
        return {"status": "missing"}

    exact = [row for row in places if wanted in _place_names(row[0])]
    if len(exact) == 1:
        return {"status": "found", "row": exact[0]}

    partial = [
        row
        for row in places
        if any(wanted in name or (len(name) >= 4 and name in wanted) for name in _place_names(row[0]))
    ]
    if len(partial) == 1:
        return {"status": "found", "row": partial[0]}
    if len(partial) > 1:
        return {
            "status": "ambiguous",
            "candidates": [row[0].name for row in partial[:8]],
        }
    return {"status": "not_found"}


class ToolContext:
    """Per-request state shared by the tools."""

    def __init__(self, db: Session, user: User | None):
        self.db = db
        self.user = user
        self.needs_sign_in = False
        self.booking_draft: dict | None = None
        self._places: list[tuple[Place, ServiceArea]] | None = None

    @property
    def places(self) -> list[tuple[Place, ServiceArea]]:
        if self._places is None:
            self._places = bookable_places(self.db)
        return self._places

    def sign_in_required(self, what: str) -> dict:
        self.needs_sign_in = True
        return {
            "status": "sign_in_required",
            "detail": f"The person must sign in to see {what}. The app shows Sign in and Create account buttons below your reply.",
        }


def tool_list_places(ctx: ToolContext, area: str | None = None) -> dict:
    areas: dict[str, list[str]] = {}
    for place, service_area in ctx.places:
        if area and normalize_name(area) not in normalize_name(service_area.name):
            continue
        areas.setdefault(service_area.name, []).append(place.name)
    if not areas:
        return {
            "status": "none",
            "detail": "No bookable places are configured yet." if not area else f"No bookable places found in '{area}'.",
        }
    return {
        "status": "ok",
        "service_areas": [
            {"name": name, "places": names[:150]} for name, names in areas.items()
        ],
    }


def tool_quote_trip(
    ctx: ToolContext,
    pickup: str = "",
    destination: str = "",
    passengers: int = 1,
    vehicle_type: str | None = None,
) -> dict:
    from app.main import list_active_place_fare_options

    try:
        passengers = int(passengers or 1)
    except (TypeError, ValueError):
        passengers = 1
    if not 1 <= passengers <= 8:
        return {"status": "invalid", "detail": "Passenger count must be between 1 and 8."}

    results = {}
    for label, query in (("pickup", pickup), ("destination", destination)):
        match = match_place(query, ctx.places)
        if match["status"] != "found":
            detail = {
                "status": f"{label}_{match['status']}",
                "query": query,
            }
            if match["status"] == "ambiguous":
                detail["candidates"] = match["candidates"]
            elif match["status"] in ("not_found", "missing"):
                detail["known_places"] = [row[0].name for row in ctx.places[:40]]
            return detail
        results[label] = match["row"]

    origin, origin_area = results["pickup"]
    dest, _dest_area = results["destination"]
    if origin.id == dest.id:
        return {"status": "same_place", "detail": "Pickup and destination are the same place."}

    options = list_active_place_fare_options(
        origin_place_id=origin.id,
        destination_place_id=dest.id,
        passenger_count=passengers,
        db=ctx.db,
    )
    fares = [
        {"vehicle_type": option["vehicle_type"], "fare_naira": str(option["quoted_fare"])}
        for option in options
    ]

    chosen = None
    if vehicle_type:
        wanted = normalize_name(vehicle_type)
        aliases = {"okada": "motorcycle", "bike": "motorcycle", "motorbike": "motorcycle"}
        wanted = aliases.get(wanted, wanted)
        chosen = next(
            (fare["vehicle_type"] for fare in fares if normalize_name(fare["vehicle_type"]) == wanted),
            None,
        )

    if fares:
        ctx.booking_draft = {
            "service_area_id": origin.service_area_id,
            "service_area": origin_area.name,
            "origin_place_id": origin.id,
            "origin_name": origin.name,
            "destination_place_id": dest.id,
            "destination_name": dest.name,
            "passenger_count": passengers,
            "vehicle_type": chosen,
            "fares": fares,
        }

    return {
        "status": "ok" if fares else "no_fare",
        "pickup": origin.name,
        "destination": dest.name,
        "service_area": origin_area.name,
        "passengers": passengers,
        "fares": fares,
        "detail": (
            "These are EkiMove's approved fares for this exact route. The app shows a "
            "'Trip ready' card under your reply with a button to continue booking. "
            "Nothing has been booked."
            if fares
            else "No active fare is configured for this exact route and passenger count yet."
        ),
    }


def tool_get_my_rides(ctx: ToolContext) -> dict:
    if ctx.user is None:
        return ctx.sign_in_required("their rides")

    if ctx.user.role == "passenger":
        from app.main import list_my_ride_requests

        rides = list_my_ride_requests(current_user=ctx.user, db=ctx.db)[:5]
        return {
            "status": "ok",
            "role": "passenger",
            "rides": [
                {
                    "request_id": ride["id"],
                    "route": f"{ride['origin_text']} to {ride['destination_text']}",
                    "vehicle_type": ride["vehicle_type"],
                    "passengers": ride["passenger_count"],
                    "quoted_fare_naira": str(ride["quoted_fare"]),
                    "status": ride["ride_status"] or ride["status"],
                    "driver": ride["driver_name"],
                    "plate": ride["vehicle_plate"],
                    "created_at": ride["created_at"],
                }
                for ride in rides
            ],
            "detail": "Newest first. Status 'requested' means no driver is assigned yet.",
        }

    if ctx.user.role == "driver":
        from app.main import list_driver_rides

        trips = list_driver_rides(current_user=ctx.user, db=ctx.db)[:5]
        return {
            "status": "ok",
            "role": "driver",
            "trips": [
                {
                    "trip_id": trip["id"],
                    "route": f"{trip['origin_text']} to {trip['destination_text']}",
                    "passengers": trip["passenger_count"],
                    "agreed_fare_naira": trip["agreed_fare"],
                    "status": trip["status"],
                }
                for trip in trips
            ],
            "detail": "Newest first. Drivers update trip status on the My trips page.",
        }

    return {
        "status": "not_available",
        "detail": "Ride lists here are for passengers and drivers. Administrators use the operations console.",
    }


def tool_get_my_driver_status(ctx: ToolContext) -> dict:
    if ctx.user is None:
        return ctx.sign_in_required("their driver status")
    if ctx.user.role != "driver":
        return {
            "status": "not_a_driver",
            "detail": "This account is not a driver account. Anyone can apply to drive from the 'Drive with EkiMove' page.",
        }

    from app.driver_applications import get_my_driver_application

    try:
        application = get_my_driver_application(current_user=ctx.user, db=ctx.db)
    except HTTPException:
        return {"status": "not_found", "detail": "No driver application was found for this account."}
    has_approved_vehicle = any(v["is_approved"] for v in application["vehicles"])
    return {
        "status": "ok",
        "verification_status": application["verification_status"],
        "online": application["is_online"],
        "vehicles": application["vehicles"],
        "can_go_online": application["verification_status"] == "approved" and has_approved_vehicle,
        "detail": "Drivers go online or offline on the My status page.",
    }


def tool_get_payment_and_support_info(ctx: ToolContext) -> dict:
    from app.main import business_info, payment_policy

    info = business_info()
    return {
        "status": "ok",
        "payment_policy": payment_policy(),
        "how_to_pay": (
            "Passengers pay after a driver is assigned, from the Payments page: by bank "
            "transfer (then submit the transfer reference) or Interswitch card/wallet "
            "checkout. Cash is not accepted. A bank transfer is confirmed only after the "
            "EkiMove team verifies it; a screenshot alone does not confirm payment."
        ),
        "bank_transfer": info["bank_transfer"],
        "support": info["support"],
        "detail": "Share only these exact account and contact details. If bank_transfer.configured is false, say the details are not available in the app yet and point to support.",
    }


def _geoapify_get(url: str, params: dict) -> dict | None:
    """Call Geoapify without ever logging the API key (it is in the URL)."""
    try:
        response = httpx.get(
            url,
            params={**params, "apiKey": settings.geoapify_api_key},
            timeout=12.0,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as exc:
        logger.warning("Geoapify request failed with HTTP %s", exc.response.status_code)
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Geoapify request failed: %s", type(exc).__name__)
    return None


def _geocode(query: str) -> dict | None:
    if not query or len(query.strip()) < 3:
        return None
    data = _geoapify_get(
        "https://api.geoapify.com/v1/geocode/search",
        {
            "text": f"{query}, Ekiti State, Nigeria",
            "format": "json",
            "limit": 5,
            "filter": "countrycode:ng",
            "bias": "proximity:5.2227,7.6232",
        },
    )
    if not data or not isinstance(data.get("results"), list):
        return None

    query_norm = normalize_name(query)
    candidates = []
    for item in data["results"]:
        if not isinstance(item, dict):
            continue
        if normalize_name(item.get("state") or "") not in ("ekiti", "ekiti state"):
            continue
        name = str(item.get("name") or "").strip()
        formatted = str(item.get("formatted") or "").strip()
        if not name or item.get("lat") is None or item.get("lon") is None:
            continue
        searchable = normalize_name(f"{name} {formatted}")
        if query_norm != normalize_name(name) and not (len(query_norm) >= 5 and query_norm in searchable):
            continue
        candidates.append({
            "name": name,
            "address": formatted,
            "latitude": float(item["lat"]),
            "longitude": float(item["lon"]),
        })
    if not candidates:
        return None
    candidates.sort(key=lambda c: (normalize_name(c["name"]) != query_norm, len(c["address"])))
    return candidates[0]


def tool_look_up_location(ctx: ToolContext, query: str = "") -> dict:
    if not settings.geoapify_api_key:
        return {"status": "unavailable", "detail": "Map lookup is not switched on, so you cannot verify places outside EkiMove's list."}
    place = _geocode(query)
    if place is None:
        return {"status": "not_found", "detail": f"Could not verify '{query}' as a specific place in Ekiti State."}
    return {
        "status": "ok",
        "name": place["name"],
        "address": place["address"],
        "source": "Geoapify map data",
        "detail": "A map result, not proof that EkiMove serves this place. Bookable places come from list_places.",
    }


def tool_estimate_driving_route(ctx: ToolContext, origin: str = "", destination: str = "") -> dict:
    if not settings.geoapify_api_key:
        return {"status": "unavailable", "detail": "Route estimates are not switched on."}
    start = _geocode(origin)
    end = _geocode(destination)
    if start is None or end is None:
        missing = origin if start is None else destination
        return {"status": "not_found", "detail": f"Could not verify '{missing}' as a specific place in Ekiti State."}
    data = _geoapify_get(
        "https://api.geoapify.com/v1/routing",
        {
            "waypoints": f"{start['latitude']},{start['longitude']}|{end['latitude']},{end['longitude']}",
            "mode": "drive",
        },
    )
    features = (data or {}).get("features") or []
    props = features[0].get("properties", {}) if features else {}
    if props.get("distance") is None or props.get("time") is None:
        return {"status": "unavailable", "detail": "No route estimate is available right now."}
    return {
        "status": "ok",
        "from": start["name"],
        "to": end["name"],
        "distance_km": round(float(props["distance"]) / 1000, 1),
        "duration_minutes": round(float(props["time"]) / 60),
        "detail": "Map estimate by car without live traffic or road closures. Not an EkiMove fare.",
    }


TOOLS = {
    "list_places": tool_list_places,
    "quote_trip": tool_quote_trip,
    "get_my_rides": tool_get_my_rides,
    "get_my_driver_status": tool_get_my_driver_status,
    "get_payment_and_support_info": tool_get_payment_and_support_info,
    "look_up_location": tool_look_up_location,
    "estimate_driving_route": tool_estimate_driving_route,
}


def _tool(name: str, description: str, properties: dict | None = None, required: list | None = None) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties or {},
                "required": required or [],
            },
        },
    }


TOOL_SCHEMAS = [
    _tool(
        "list_places",
        "List EkiMove's bookable service areas and pickup/destination places.",
        {"area": {"type": "string", "description": "Optional service area name to filter by."}},
    ),
    _tool(
        "quote_trip",
        "Get EkiMove's approved fares for a trip between two bookable places and prepare it for booking. Use for any fare/price question or when someone wants to book.",
        {
            "pickup": {"type": "string", "description": "Pickup place name as the person said it."},
            "destination": {"type": "string", "description": "Destination place name as the person said it."},
            "passengers": {"type": "integer", "description": "Number of passengers, 1 to 8. Default 1."},
            "vehicle_type": {"type": "string", "description": "Only if the person asked for one, e.g. motorcycle or car."},
        },
        ["pickup", "destination"],
    ),
    _tool("get_my_rides", "The signed-in person's recent rides (passenger) or assigned trips (driver), with live status, driver name and plate."),
    _tool("get_my_driver_status", "The signed-in driver's approval status, vehicles and whether they are online."),
    _tool("get_payment_and_support_info", "How payment works, EkiMove's bank-transfer details and support contacts."),
    _tool(
        "look_up_location",
        "Check a landmark, street or business in Ekiti State on the map. Only for places not in list_places.",
        {"query": {"type": "string"}},
        ["query"],
    ),
    _tool(
        "estimate_driving_route",
        "Map distance and driving time between two places in Ekiti State. Not a fare.",
        {"origin": {"type": "string"}, "destination": {"type": "string"}},
        ["origin", "destination"],
    ),
]


def system_prompt(user: User | None) -> str:
    if user is None:
        who = "The person is a guest who is not signed in."
    else:
        role = {"passenger": "passenger", "driver": "driver", "super_admin": "EkiMove administrator"}.get(user.role, user.role)
        who = f"The person is signed in as a {role} named {first_name(user.full_name) or 'there'}."

    return (
        "You are Atọ́nà (say 'Atona' if accents are awkward), the friendly assistant for EkiMove, "
        "a ride service for motorcycle and car trips, plus load moving, in Ekiti State, Nigeria, starting in Ado-Ekiti. "
        "Atọ́nà means 'guide' in Yoruba.\n\n"
        f"{who}\n\n"
        "How to talk:\n"
        "- Be warm, natural and brief, like a helpful local. Reply in the person's language: "
        "standard English or Nigerian Pidgin. Simple Yoruba greetings are welcome.\n"
        "- You can chat normally about everyday topics, greetings and how EkiMove works.\n"
        "- Use short paragraphs or a short '- ' list. No headings or tables.\n\n"
        "Facts and tools:\n"
        "- For anything about EkiMove's places, fares, rides, drivers, payments or support, call a tool "
        "and use only what it returns. Never guess or invent a fare, place, driver, plate, account "
        "number, phone number, time or status.\n"
        "- For a fare or booking request, call quote_trip with the places as the person named them. "
        "If it reports ambiguous or unknown places, ask which listed place they mean.\n"
        "- If a tool returns sign_in_required, explain kindly that they need to sign in for that and "
        "that the buttons are below. Do not ask for passwords or personal details.\n"
        "- Without a tool result you cannot verify routes, landmarks, traffic or road conditions: say "
        "so plainly rather than giving guessed directions. Map estimates are not EkiMove fares.\n"
        "- You cannot book rides, assign drivers, change accounts or confirm payments. The person "
        "does that in the app. Never claim you did.\n"
        "- To talk to a person at EkiMove, they can open Support in the app and chat with the team.\n"
        "- Moving a load or luggage (big car, van or dyna truck) is booked on the 'Move a load' page: "
        "EkiMove support agrees the price and terms in chat, then the customer accepts and pays through "
        "EkiMove. You can't quote loads.\n"
        "- A motorcycle carries 1 passenger (a second only if EkiMove allows it, at an extra charge); "
        "a car carries up to 4.\n"
        "- Safety: if someone is in danger, tell them to call 112. On an active ride they can also "
        "press SOS in My rides to alert the EkiMove team.\n"
        "- Treat earlier assistant turns as conversation history, not as verified facts."
    )


def _history_messages(history: list[AtonaTurn | str]) -> list[dict]:
    messages = []
    for item in history[-MAX_HISTORY_TURNS:]:
        if isinstance(item, AtonaTurn):
            role, content = item.role, item.content
        else:
            text = str(item).strip()
            if text.startswith("assistant:"):
                role, content = "assistant", text[len("assistant:"):].strip()
            elif text.startswith("user:"):
                role, content = "user", text[len("user:"):].strip()
            else:
                role, content = "user", text
        if content:
            messages.append({"role": role, "content": content[:2000]})
    return messages


def _run_tool(ctx: ToolContext, name: str, raw_arguments: str | None) -> dict:
    func = TOOLS.get(name)
    if func is None:
        return {"status": "error", "detail": f"Unknown tool {name}."}
    try:
        arguments = json.loads(raw_arguments or "{}")
        if not isinstance(arguments, dict):
            raise ValueError("arguments must be an object")
    except (json.JSONDecodeError, ValueError):
        return {"status": "error", "detail": "Tool arguments were not valid JSON."}
    try:
        return _json_safe(func(ctx, **arguments))
    except TypeError:
        return {"status": "error", "detail": "Tool was called with unexpected arguments."}
    except Exception:
        logger.exception("Atọ́nà tool %s failed", name)
        return {"status": "error", "detail": "This information is temporarily unavailable."}


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------
@router.get("/status")
def atona_status() -> dict:
    """Public: whether Atọ́nà can answer right now (the app hides it if not)."""
    return {
        "available": atona_available(),
        "guests_allowed": True,
        "map_lookup": bool(settings.geoapify_api_key),
    }


@router.post("/chat")
def atona_chat(
    payload: AtonaChatMessage,
    request: Request,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
) -> dict:
    """Chat with Atọ́nà. Open to guests; account answers need sign-in."""
    if not atona_available():
        raise HTTPException(status_code=503, detail="Atọ́nà is not available right now.")

    if current_user is not None:
        identity = f"user:{current_user.id}"
        limit = settings.atona_user_message_limit
    else:
        host = request.client.host if request.client is not None else "unknown"
        identity = f"guest:{host}"
        limit = settings.atona_guest_message_limit
    if not check_rate_limit(identity, max(1, limit)):
        raise HTTPException(
            status_code=429,
            detail="You've sent a lot of messages. Please wait a few minutes and try again.",
        )

    ctx = ToolContext(db, current_user)
    messages = [{"role": "system", "content": system_prompt(current_user)}]
    messages.extend(_history_messages(payload.conversation_history))
    messages.append({"role": "user", "content": payload.message})

    try:
        client = Groq(api_key=settings.groq_api_key, timeout=25.0, max_retries=1)
        reply = None
        for round_number in range(MAX_TOOL_ROUNDS + 1):
            allow_tools = round_number < MAX_TOOL_ROUNDS
            kwargs = {
                "model": settings.groq_model,
                "temperature": 0.3,
                "max_completion_tokens": 700,
                "messages": messages,
            }
            if allow_tools:
                kwargs["tools"] = TOOL_SCHEMAS
                kwargs["tool_choice"] = "auto"
            try:
                response = client.chat.completions.create(**kwargs)
            except APIStatusError as exc:
                # A malformed tool call comes back as HTTP 400; answer
                # without tools rather than failing the whole message.
                if not allow_tools or getattr(exc, "status_code", None) != 400:
                    raise
                logger.warning("Atọ́nà tool call rejected; retrying without tools")
                kwargs.pop("tools", None)
                kwargs.pop("tool_choice", None)
                allow_tools = False
                response = client.chat.completions.create(**kwargs)
            message = response.choices[0].message
            tool_calls = list(getattr(message, "tool_calls", None) or [])

            if not tool_calls or not allow_tools:
                reply = message.content
                break

            messages.append({
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.function.name,
                            "arguments": call.function.arguments or "{}",
                        },
                    }
                    for call in tool_calls[:MAX_TOOL_CALLS_PER_ROUND]
                ],
            })
            for call in tool_calls[:MAX_TOOL_CALLS_PER_ROUND]:
                result = _run_tool(ctx, call.function.name, call.function.arguments)
                messages.append({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "name": call.function.name,
                    "content": json.dumps(result, ensure_ascii=False),
                })

        if not reply or not str(reply).strip():
            raise ValueError("Empty reply")
    except (APIConnectionError, APIStatusError) as exc:
        logger.warning("Atọ́nà AI request failed: %s", type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail="Atọ́nà couldn't reach its AI service. Please try again.",
        ) from None
    except Exception:
        logger.exception("Atọ́nà could not prepare a reply")
        raise HTTPException(
            status_code=502,
            detail="Atọ́nà couldn't prepare a reply. Please try again.",
        ) from None

    return {
        "reply": str(reply).strip(),
        "signed_in": current_user is not None,
        "needs_sign_in": ctx.needs_sign_in,
        "booking_draft": _json_safe(ctx.booking_draft),
    }
