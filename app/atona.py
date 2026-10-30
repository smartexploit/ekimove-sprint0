import json
import httpx
import logging
import re
import unicodedata

from fastapi import APIRouter, Depends, HTTPException
from groq import APIConnectionError, APIStatusError, Groq
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import Place, ServiceArea, User, Zone

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/atona", tags=["Atá»ÌnÃ  AI"])


class AtonaMessage(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    message: str = Field(min_length=3, max_length=1000)
    origin_hint: str | None = Field(default=None, max_length=255)
    destination_hint: str | None = Field(default=None, max_length=255)
    conversation_history: list[str] = Field(default_factory=list, max_length=8)



class AtonaChatMessage(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    message: str = Field(min_length=2, max_length=1000)
    conversation_history: list[str] = Field(default_factory=list, max_length=12)


@router.post("/chat")
def atona_chat(
    payload: AtonaChatMessage,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Conversational demo assistant for Ekiti routes and landmarks."""
    if not settings.atona_enabled or not settings.groq_api_key:
        raise HTTPException(
            status_code=503,
            detail="Atona AI is not configured yet.",
        )

    history = [
        item.strip()[:1000]
        for item in payload.conversation_history[-12:]
        if isinstance(item, str) and item.strip()
    ]

    system_prompt = (
        "You are Atona, the conversational travel assistant for EkiMove in Ekiti State, Nigeria. "
        "Communicate naturally in standard English or Nigerian Pidgin. "
        "Match the passenger's language and tone. "
        "Remember the origin, destination, transport preference, and other details "
        "provided earlier in the conversation. Do not ask for information already provided. "
        "Ask one short question when essential trip information is missing. "
        "You do not have live GPS, live traffic, verified road conditions, or live map access. "
        "Never invent or guess road names, junctions, landmarks, hospitals, markets, "
        "transport stops, directions, distances, travel times, fares, or opening hours. "
        "Never present an unverified route as fact or give guessed turn-by-turn instructions. "
        "If a passenger asks for directions and verified route information is unavailable, "
        "clearly say that you cannot verify the exact route. "
        "You may suggest that the passenger tell the driver the confirmed starting point "
        "and destination, then ask the driver to confirm the route before departure. "
        "Do not repeat earlier unverified directions as if they were correct. "
        "For motorcycle trips, advise passengers to confirm the destination and route "
        "with the rider before setting out. "
        "Never claim to have booked a ride, contacted a driver, or processed payment. "
        "Keep responses concise, helpful, natural, and easy to understand."
    )

    messages = [{"role": "system", "content": system_prompt}]
    for item in history:
        if item.startswith("assistant:"):
            role = "assistant"
            content = item[len("assistant:"):].strip()
        elif item.startswith("user:"):
            role = "user"
            content = item[len("user:"):].strip()
        else:
            role = "user"
            content = item

        if content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": payload.message})

    try:
        client = Groq(
            api_key=settings.groq_api_key,
            timeout=25.0,
            max_retries=1,
        )
        response = client.chat.completions.create(
            model=settings.groq_model,
            temperature=0.4,
            max_completion_tokens=650,
            messages=messages,
        )
        reply = response.choices[0].message.content

        if not reply or not reply.strip():
            raise ValueError("Groq returned an empty response.")

        return {
            "reply": reply.strip(),
            "mode": "conversational_demo",
            "provider": "Groq",
        }

    except (APIConnectionError, APIStatusError):
        logger.exception("Atona Groq conversational request failed")
        raise HTTPException(
            status_code=502,
            detail="Atona could not reach its AI service. Please try again.",
        ) from None
    except Exception:
        logger.exception("Atona conversational response failed")
        raise HTTPException(
            status_code=502,
            detail="Atona could not prepare a response. Please try again.",
        ) from None


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(value.split())


@router.post("/interpret")
def interpret_booking(
    payload: AtonaMessage,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Interpret a passenger's message; never creates a ride or sets a fare."""
    if current_user.role != "passenger":
        raise HTTPException(
            status_code=403,
            detail="Atá»ÌnÃ  booking is available to passenger accounts only.",
        )

    if not settings.atona_enabled or not settings.groq_api_key:
        raise HTTPException(
            status_code=503,
            detail="Atá»ÌnÃ  is not configured yet.",
        )

    zones = db.scalars(
        select(Zone)
        .where(Zone.is_active.is_(True))
        .order_by(Zone.name)
    ).all()
    zone_names = [zone.name for zone in zones]

    if len(zone_names) < 2:
        return {
            "reply": (
                "EkiMove needs at least two active zones before I can help "
                "plan this trip."
            ),
            "needs_clarification": True,
            "booking": None,
            "available_zones": zone_names,
        }

    system_prompt = (
        "You are Atona, the ride-booking assistant for EkiMove in Ado-Ekiti, Nigeria. "
        "Extract booking details only. Understand English and Nigerian Pidgin. "
        "Never invent locations, fares, routes, vehicle availability, or safety claims. "
        "Choose origin_zone_name and destination_zone_name ONLY from the exact supplied "
        "active-zone names. If unclear or not a confident match, use null. "
        "origin_text and destination_text are the passenger's landmark/address details; "
        "use a short useful location phrase, or null if missing. "
        "passenger_count is an integer from 1 to 8, default 1 only if not specified. "
        "vehicle_type must be null unless the passenger explicitly requests a vehicle type. "
        "Return ONLY a valid JSON object with exactly these keys: "
        "origin_zone_name, destination_zone_name, origin_text, destination_text, "
        "passenger_count, vehicle_type, clarification. "
        "Use null for unknown strings. clarification should be a short question when "
        "required information is missing, otherwise null. "
        "Do not include Markdown fences or any text outside the JSON object. "
        "Do not claim a ride was booked."
    )

    history = [
        item.strip()[:1000]
        for item in payload.conversation_history[-8:]
        if isinstance(item, str) and item.strip()
    ]

    user_content = (
        "Active zone names (use exact names only): "
        + json.dumps(zone_names, ensure_ascii=False)
        + "\nEarlier passenger messages (oldest first): "
        + json.dumps(history, ensure_ascii=False)
        + "\nLatest passenger message: "
        + payload.message
    )

    required_keys = {
        "origin_zone_name",
        "destination_zone_name",
        "origin_text",
        "destination_text",
        "passenger_count",
        "vehicle_type",
        "clarification",
    }

    try:
        client = Groq(
            api_key=settings.groq_api_key,
            timeout=20.0,
            max_retries=1,
        )

        extracted = None
        last_error = None
        previous_response = None

        for attempt in range(2):
            messages = [
                {
                    "role": "system",
                    "content": (
                        system_prompt
                        + " Return exactly one complete JSON object with all "
                        "seven required keys. Use double quotes for keys and "
                        "string values, null for unknown values, and no "
                        "Markdown fences or extra text."
                    ),
                },
                {"role": "user", "content": user_content},
            ]

            if attempt == 1:
                messages.extend([
                    {
                        "role": "assistant",
                        "content": previous_response or "",
                    },
                    {
                        "role": "user",
                        "content": (
                            "Correct your previous response. Return one "
                            "complete, valid JSON object with all seven "
                            "required keys. Do not add any other text."
                        ),
                    },
                ])

            response = client.chat.completions.create(
                model=settings.groq_model,
                temperature=0,
                max_completion_tokens=700,
                messages=messages,
            )

            raw = response.choices[0].message.content
            previous_response = raw

            try:
                if not raw or not raw.strip():
                    raise ValueError("The AI returned an empty response.")

                candidate = json.loads(raw)

                if not isinstance(candidate, dict):
                    raise ValueError("The AI response was not a JSON object.")

                if not required_keys.issubset(candidate):
                    raise ValueError("The AI response is missing required fields.")

                extracted = candidate
                break

            except (json.JSONDecodeError, ValueError, TypeError) as exc:
                last_error = exc
                logger.warning(
                    "Atá»ÌnÃ  returned invalid JSON on attempt %s of 2.",
                    attempt + 1,
                )

        if extracted is None:
            logger.error(
                "Atá»ÌnÃ  failed to return valid JSON after two attempts: %s",
                type(last_error).__name__ if last_error else "UnknownError",
            )
            raise HTTPException(
                status_code=502,
                detail=(
                    "Atá»ÌnÃ  could not reliably interpret that request. "
                    "Please use the booking form."
                ),
            )

    except (APIConnectionError, APIStatusError):
        logger.exception("Atá»ÌnÃ  Groq request failed")
        raise HTTPException(
            status_code=502,
            detail=(
                "Atá»ÌnÃ  could not process this request through its AI service. "
                "Please use the booking form."
            ),
        ) from None

    def valid_zone_id(name: object) -> int | None:
        if not isinstance(name, str) or not name.strip():
            return None

        wanted = normalize_name(name)
        matches = [
            zone
            for zone in zones
            if normalize_name(zone.name) == wanted
        ]
        return matches[0].id if len(matches) == 1 else None

    origin_zone_id = valid_zone_id(extracted.get("origin_zone_name"))
    destination_zone_id = valid_zone_id(
        extracted.get("destination_zone_name")
    )

    def safe_text(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        value = value.strip()
        return value[:255] if len(value) >= 3 else None

    passenger_value = extracted.get("passenger_count", 1)
    try:
        if isinstance(passenger_value, bool):
            raise ValueError("Boolean is not a passenger count.")
        passenger_count = int(passenger_value)
    except (TypeError, ValueError, OverflowError):
        passenger_count = 1

    if not 1 <= passenger_count <= 8:
        passenger_count = 1

    vehicle_type = safe_text(extracted.get("vehicle_type"))
    if vehicle_type and len(vehicle_type) > 32:
        vehicle_type = None

    origin_text = safe_text(extracted.get("origin_text"))
    destination_text = safe_text(extracted.get("destination_text"))

    missing = []
    if origin_zone_id is None:
        missing.append("pickup zone")
    if destination_zone_id is None:
        missing.append("destination zone")
    if origin_text is None:
        missing.append("pickup landmark")
    if destination_text is None:
        missing.append("destination landmark")

    booking = None

    if not missing and origin_zone_id != destination_zone_id:
        booking = {
            "origin_zone_id": origin_zone_id,
            "destination_zone_id": destination_zone_id,
            "origin_text": origin_text,
            "destination_text": destination_text,
            "passenger_count": passenger_count,
            "vehicle_type": vehicle_type,
        }
    elif (
        origin_zone_id is not None
        and destination_zone_id is not None
        and origin_zone_id == destination_zone_id
    ):
        missing.append("a different destination zone")

    clarification = extracted.get("clarification")
    if not isinstance(clarification, str):
        clarification = None
    elif len(clarification) > 300:
        clarification = clarification[:300]

    if missing:
        reply = (
            "I need a little more detail: "
            + ", ".join(dict.fromkeys(missing))
            + "."
        )
    else:
        reply = (
            "I've prepared your trip details. Please review them in the "
            "booking form. No ride has been submitted."
        )

    return {
        "reply": reply,
        "needs_clarification": booking is None,
        "booking": booking,
        "available_zones": zone_names,
        "ai_clarification": clarification,
    }


@router.post("/geography")
def answer_geography(
    payload: AtonaMessage,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Resolve Ekiti locations and calculate routes using Geoapify."""
    if current_user.role != "passenger":
        raise HTTPException(
            status_code=403,
            detail="Atọ́nà geographic assistance is available to passenger accounts only.",
        )

    if not settings.atona_enabled:
        raise HTTPException(
            status_code=503,
            detail="Atọ́nà is not configured yet.",
        )

    if not settings.geoapify_api_key:
        raise HTTPException(
            status_code=503,
            detail="Atọ́nà's geographic search service is not configured yet.",
        )

    message = payload.message.strip()
    normalized = normalize_name(message)

    # EkiMove database records remain authoritative for configured service areas.
    areas = db.execute(
        select(ServiceArea.name, ServiceArea.description)
        .where(ServiceArea.status == "active")
        .order_by(ServiceArea.name)
    ).all()
    zones = db.scalars(
        select(Zone).where(Zone.is_active.is_(True)).order_by(Zone.name)
    ).all()

    direction_terms = (
        "direction", "directions", "route", "navigate", "navigation",
        "how do i get", "how can i get", "way to", "how far",
        "distance between", "drive from", "go from", "travel from",
        "get from", "guide me to", "take me to", "get me to",
        "how do i reach", "how can i reach", "driving to",
    )
    wants_directions = bool(payload.destination_hint) or any(
        term in normalized for term in direction_terms
    )

    origin_query = (payload.origin_hint or "").strip()
    destination_query = (payload.destination_hint or "").strip()

    # Explicit origin/destination hints are used for follow-up turns.
    # Otherwise extract simple "from X to Y" phrases where possible.
    if wants_directions and not origin_query and not destination_query:
        match = re.search(
            r"\bfrom\s+(.+?)\s+to\s+(.+?)(?:[?.!,]|$)",
            message,
            flags=re.IGNORECASE,
        )
        if match:
            origin_query = match.group(1).strip()
            destination_query = match.group(2).strip()
        else:
            destination_match = re.search(
                r"\b(?:guide me to|take me to|get me to|route to|directions to|how do i get to|how can i get to|how do i reach|how can i reach)\s+(.+?)(?:[?.!,]|$)",
                message,
                flags=re.IGNORECASE,
            )
            if destination_match:
                destination_query = destination_match.group(1).strip()

    # A follow-up such as "I'm at EKSU Main Gate" supplies the pickup.
    if payload.destination_hint and not origin_query:
        origin_query = message

    def resolve_location(query: str) -> dict | None:
        if not query or len(query.strip()) < 3:
            return None

        search_text = f"{query}, Ekiti State, Nigeria"
        try:
            response = httpx.get(
                "https://api.geoapify.com/v1/geocode/search",
                params={
                    "text": search_text,
                    "format": "json",
                    "limit": 5,
                    "filter": "countrycode:ng",
                    "bias": "proximity:5.2227,7.6232",
                    "apiKey": settings.geoapify_api_key,
                },
                timeout=15.0,
            )
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError):
            logger.exception("Atọ́nà Geoapify geocoding request failed")
            return None

        results = data.get("results", [])
        if not isinstance(results, list):
            return None

        query_norm = normalize_name(query)
        query_is_city = any(
            token in query_norm
            for token in ("ado ekiti", "ado-ekiti")
        )

        candidates = []
        for item in results:
            if not isinstance(item, dict):
                continue

            state = normalize_name(str(item.get("state") or ""))
            country = normalize_name(str(item.get("country") or ""))
            if state not in ("ekiti", "ekiti state") or country != "nigeria":
                continue

            name = str(item.get("name") or "").strip()
            formatted = str(item.get("formatted") or "").strip()
            result_type = normalize_name(str(item.get("result_type") or ""))

            if not name or item.get("lat") is None or item.get("lon") is None:
                continue

            # Do not mistake the Ado-Ekiti city result for a requested landmark.
            if not query_is_city:
                searchable = normalize_name(f"{name} {formatted}")
                name_match = query_norm == normalize_name(name)
                meaningful_overlap = (
                    len(query_norm) >= 5
                    and query_norm in searchable
                )
                if not name_match and not meaningful_overlap:
                    continue
                if result_type in (
                    "city", "state", "country", "county",
                    "municipality", "administrative",
                ):
                    continue

            candidates.append({
                "name": name,
                "formatted": formatted,
                "latitude": float(item["lat"]),
                "longitude": float(item["lon"]),
                "result_type": result_type,
                "state": item.get("state"),
                "country": item.get("country"),
            })

        if not candidates:
            return None

        # Prefer exact name matches over broader formatted-address matches.
        candidates.sort(
            key=lambda item: (
                normalize_name(item["name"]) != query_norm,
                len(item["formatted"]),
            )
        )
        return candidates[0]

    def public_location(item: dict) -> dict:
        return {
            "name": item["name"],
            "address": item["formatted"],
            "state": item["state"],
            "country": item["country"],
            "latitude": item["latitude"],
            "longitude": item["longitude"],
            "provider": "Geoapify",
        }

    if wants_directions:
        if not destination_query:
            return {
                "kind": "directions",
                "reply": (
                    "Where would you like to go? Tell me your destination. "
                    "If you also provide your pickup location, I can check the route."
                ),
                "places": [],
                "route": None,
                "context": {"destination": None},
                "needs_origin": False,
            }

        destination = resolve_location(destination_query)
        if destination is None:
            return {
                "kind": "directions",
                "reply": (
                    f"I couldn't verify '{destination_query}' as a specific location "
                    "in Ekiti State. Please provide a more precise landmark, business "
                    "name, or address. I won't substitute a nearby city or an unrelated result."
                ),
                "places": [],
                "route": None,
                "context": {"destination": None},
                "needs_origin": False,
            }

        if not origin_query:
            return {
                "kind": "directions",
                "reply": (
                    f"I found {destination['name']} in Ekiti State. "
                    "Where are you starting from? For example, give me your "
                    "current landmark or a nearby address."
                ),
                "places": [public_location(destination)],
                "route": None,
                "context": {"destination": destination_query},
                "needs_origin": True,
            }

        origin = resolve_location(origin_query)
        if origin is None:
            return {
                "kind": "directions",
                "reply": (
                    f"I couldn't verify '{origin_query}' as a specific location "
                    "in Ekiti State. Please give me a more precise pickup landmark "
                    "or address."
                ),
                "places": [public_location(destination)],
                "route": None,
                "context": {"destination": destination_query},
                "needs_origin": True,
            }

        try:
            route_response = httpx.get(
                "https://api.geoapify.com/v1/routing",
                params={
                    "waypoints": (
                        f"{origin['latitude']},{origin['longitude']}|"
                        f"{destination['latitude']},{destination['longitude']}"
                    ),
                    "mode": "drive",
                    "apiKey": settings.geoapify_api_key,
                },
                timeout=15.0,
            )
            route_response.raise_for_status()
            route_data = route_response.json()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Geoapify routing failed with HTTP status %s",
                exc.response.status_code,
            )
            return {
                "kind": "directions",
                "reply": (
                    "I verified both locations, but couldn't retrieve a route "
                    "right now. Please try again shortly."
                ),
                "places": [public_location(origin), public_location(destination)],
                "route": None,
                "context": {"destination": destination_query},
                "needs_origin": False,
            }
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning(
                "Geoapify routing failed: %s",
                type(exc).__name__,
            )
            return {
                "kind": "directions",
                "reply": (
                    "I verified both locations, but couldn't retrieve a route "
                    "right now. Please try again shortly."
                ),
                "places": [public_location(origin), public_location(destination)],
                "route": None,
                "context": {"destination": destination_query},
                "needs_origin": False,
            }

        features = route_data.get("features", [])
        if not features:
            return {
                "kind": "directions",
                "reply": "Geoapify did not return a route for these locations.",
                "places": [public_location(origin), public_location(destination)],
                "route": None,
                "context": {"destination": destination_query},
                "needs_origin": False,
            }

        properties = features[0].get("properties", {})
        distance_meters = properties.get("distance")
        duration_seconds = properties.get("time")
        if distance_meters is None or duration_seconds is None:
            return {
                "kind": "directions",
                "reply": "The routing service returned incomplete route information.",
                "places": [public_location(origin), public_location(destination)],
                "route": None,
                "context": {"destination": destination_query},
                "needs_origin": False,
            }

        steps = []
        for leg in properties.get("legs", []):
            for step in leg.get("steps", []):
                instruction = step.get("instruction", {})
                if isinstance(instruction, dict):
                    instruction = instruction.get("text")
                if isinstance(instruction, str) and instruction.strip():
                    steps.append(instruction.strip())

        route = {
            "mode": "drive",
            "origin": origin["name"],
            "destination": destination["name"],
            "distance_meters": distance_meters,
            "duration_seconds": duration_seconds,
            "steps": steps,
            "provider": "Geoapify",
        }
        reply = (
            f"Geoapify estimates about {float(distance_meters) / 1000:.1f} km "
            f"and {float(duration_seconds) / 60:.0f} minutes by car from "
            f"{origin['name']} to {destination['name']}. This is an estimate, "
            "not a live traffic or road-closure guarantee."
        )
        if not steps:
            reply += " Turn-by-turn instructions were not returned."

        return {
            "kind": "directions",
            "reply": reply,
            "places": [public_location(origin), public_location(destination)],
            "route": route,
            "context": {"destination": None},
            "needs_origin": False,
        }

    # For a place question, search Geoapify rather than requiring a Place row.
    # Remove common question prefixes to isolate the requested place.
    query = message
    for prefix in (
        "tell me about ", "where is ", "where are ",
        "describe ", "location of ", "what is ",
    ):
        if normalized.startswith(prefix):
            query = message[len(prefix):].strip(" ?.! ")
            break

    if not query:
        query = message

    location = resolve_location(query)
    if location is None:
        return {
            "kind": "geography",
            "reply": (
                f"I couldn't verify '{query}' as a specific place in Ekiti State. "
                "Try the full landmark or business name, or include a nearby street "
                "or neighbourhood. I won't invent details."
            ),
            "places": [],
            "route": None,
        }

    if not settings.groq_api_key:
        return {
            "kind": "geography",
            "reply": (
                f"I verified {location['name']} at {location['formatted']}. "
                "I can confirm its returned location, but the AI explanation service "
                "is not configured right now."
            ),
            "places": [public_location(location)],
            "route": None,
        }

    knowledge = {
        "verified_geoapify_result": public_location(location),
        "active_ekimove_service_areas": [
            {"name": row.name, "description": row.description}
            for row in areas
        ],
        "active_ekimove_zones": [zone.name for zone in zones],
    }

    try:
        client = Groq(
            api_key=settings.groq_api_key,
            timeout=20.0,
            max_retries=1,
        )
        response = client.chat.completions.create(
            model=settings.groq_model,
            temperature=0,
            max_completion_tokens=450,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are Atọ́nà, EkiMove's geographic assistant for Ekiti State, Nigeria. "
                        "Explain the verified place using only the supplied Geoapify result "
                        "and EkiMove service-area records. Do not invent history, nearby "
                        "businesses, opening hours, phone numbers, coordinates, fares, "
                        "availability, routes or travel times. Clearly distinguish a "
                        "verified geographic result from EkiMove service coverage. If "
                        "the records do not establish a fact, say it cannot be verified. "
                        "Be concise and helpful. Understand English and Nigerian Pidgin. "
                        "Never claim to book a ride or confirm payment."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Verified context:\n"
                        + json.dumps(knowledge, ensure_ascii=False)
                        + "\nPassenger question:\n"
                        + message
                    ),
                },
            ],
        )
        reply = response.choices[0].message.content
        if not reply or not reply.strip():
            raise ValueError("Empty geographic answer")
    except (APIConnectionError, APIStatusError, ValueError):
        logger.exception("Atọ́nà geographic explanation failed")
        reply = (
            f"I verified {location['name']} at {location['formatted']}, "
            "but couldn't prepare a fuller explanation right now."
        )

    return {
        "kind": "geography",
        "reply": reply.strip(),
        "places": [public_location(location)],
        "route": None,
    }
