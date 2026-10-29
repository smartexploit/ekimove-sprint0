import json
import httpx
import logging
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

    user_content = (
        "Active zone names (use exact names only): "
        + json.dumps(zone_names, ensure_ascii=False)
        + "\nPassenger message: "
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
    """Answer location questions and provide routed directions when verified."""
    if current_user.role != "passenger":
        raise HTTPException(
            status_code=403,
            detail="At??n? geographic assistance is available to passenger accounts only.",
        )

    if not settings.atona_enabled or not settings.groq_api_key:
        raise HTTPException(
            status_code=503,
            detail="At??n? is not configured yet.",
        )

    rows = db.execute(
        select(Place, ServiceArea, Zone)
        .join(ServiceArea, Place.service_area_id == ServiceArea.id)
        .join(Zone, Place.zone_id == Zone.id)
        .where(
            Place.status == "active",
            ServiceArea.status == "active",
            Zone.is_active.is_(True),
        )
        .order_by(ServiceArea.name, Place.name)
    ).all()

    places = []
    for place, area, zone in rows:
        places.append({
            "id": place.id,
            "name": place.name,
            "type": place.place_type,
            "service_area": area.name,
            "area_description": area.description,
            "zone": zone.name,
            "address": place.address_text,
            "aliases": place.aliases,
            "notes": place.notes,
            "latitude": place.latitude,
            "longitude": place.longitude,
        })

    if not places:
        return {
            "kind": "geography",
            "reply": (
                "I don't have any active registered places to reference yet. "
                "Please ask the EkiMove administrator to configure places and service areas."
            ),
            "places": [],
            "route": None,
        }

    message = payload.message.strip()
    normalized_message = normalize_name(message)

    direction_terms = (
        "direction", "directions", "route", "navigate", "navigation",
        "how do i get", "how can i get", "way to", "how far",
        "distance between", "drive from", "go from", "travel from",
        "get from", "directions from",
    )
    wants_directions = any(term in normalized_message for term in direction_terms)

    # Match only registered names and explicitly configured aliases.
    matched = []
    for item in places:
        terms = [item["name"]]
        if item["aliases"]:
            terms.extend(
                alias.strip()
                for alias in item["aliases"].replace("|", ";").replace(",", ";").split(";")
                if alias.strip()
            )
        if item["address"]:
            terms.append(item["address"])

        matching_terms = []
        for term in terms:
            normalized_term = normalize_name(term)
            if len(normalized_term) >= 3 and normalized_term in normalized_message:
                matching_terms.append(normalized_term)

        if matching_terms:
            best_term = max(matching_terms, key=len)
            matched.append({
                **item,
                "_match": best_term,
                "_position": normalized_message.find(best_term),
            })

    # Keep one match per registered place, in the order mentioned.
    unique_matches = {}
    for item in sorted(
        matched,
        key=lambda item: (item["_position"], -len(item["_match"])),
    ):
        unique_matches.setdefault(item["id"], item)
    matched_places = list(unique_matches.values())

    if wants_directions:
        if len(matched_places) < 2:
            return {
                "kind": "directions",
                "reply": (
                    "I need two registered locations to plan directions. "
                    "Please mention both your starting point and destination "
                    "using their EkiMove place names or configured aliases."
                ),
                "places": [
                    {"id": item["id"], "name": item["name"]}
                    for item in matched_places
                ],
                "route": None,
            }

        origin = matched_places[0]
        destination = matched_places[1]

        if origin["id"] == destination["id"]:
            return {
                "kind": "directions",
                "reply": "Your starting point and destination must be different places.",
                "places": [],
                "route": None,
            }

        if origin["latitude"] is None or origin["longitude"] is None:
            return {
                "kind": "directions",
                "reply": (
                    f"{origin['name']} does not have registered coordinates yet. "
                    "The administrator must add its latitude and longitude before "
                    "I can calculate a route."
                ),
                "places": [],
                "route": None,
            }

        if destination["latitude"] is None or destination["longitude"] is None:
            return {
                "kind": "directions",
                "reply": (
                    f"{destination['name']} does not have registered coordinates yet. "
                    "The administrator must add its latitude and longitude before "
                    "I can calculate a route."
                ),
                "places": [],
                "route": None,
            }

        if not settings.geoapify_api_key:
            return {
                "kind": "directions",
                "reply": (
                    "I found both registered places, but route calculation is not "
                    "configured yet. EkiMove needs a Geoapify API key to calculate "
                    "driving directions. I won't guess the route or travel time."
                ),
                "places": [
                    {"id": origin["id"], "name": origin["name"]},
                    {"id": destination["id"], "name": destination["name"]},
                ],
                "route": None,
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
        except (httpx.HTTPError, ValueError):
            logger.exception("At??n? route provider request failed")
            return {
                "kind": "directions",
                "reply": (
                    "I couldn't retrieve a reliable route right now. "
                    "Please try again later; I won't invent directions."
                ),
                "places": [],
                "route": None,
            }

        features = route_data.get("features", [])
        if not features:
            return {
                "kind": "directions",
                "reply": "The routing service did not return a route for those places.",
                "places": [],
                "route": None,
            }

        properties = features[0].get("properties", {})
        legs = properties.get("legs", [])
        steps = []
        for leg in legs:
            for step in leg.get("steps", []):
                instruction = step.get("instruction", {})
                if isinstance(instruction, dict):
                    instruction = instruction.get("text")
                if isinstance(instruction, str) and instruction.strip():
                    steps.append(instruction.strip())

        distance_meters = properties.get("distance")
        duration_seconds = properties.get("time")

        if distance_meters is None or duration_seconds is None:
            return {
                "kind": "directions",
                "reply": (
                    "The routing service returned incomplete distance or travel-time "
                    "information, so I can't provide a reliable route summary yet."
                ),
                "places": [],
                "route": None,
            }

        route = {
            "mode": "drive",
            "origin": origin["name"],
            "destination": destination["name"],
            "distance_meters": distance_meters,
            "duration_seconds": duration_seconds,
            "steps": steps,
            "provider": "Geoapify",
        }
        distance_km = float(distance_meters) / 1000
        duration_minutes = float(duration_seconds) / 60
        reply = (
            f"The routing service estimates about {distance_km:.1f} km "
            f"and {duration_minutes:.0f} minutes by car from {origin['name']} "
            f"to {destination['name']}. This is a route estimate, not a live "
            "traffic or road-closure guarantee."
        )
        if not steps:
            reply += " Turn-by-turn instructions were not returned for this route."

        return {
            "kind": "directions",
            "reply": reply,
            "places": [
                {"id": origin["id"], "name": origin["name"]},
                {"id": destination["id"], "name": destination["name"]},
            ],
            "route": route,
        }

    # For descriptions and geographic questions, ground the AI in active records.
    public_places = [
        {
            "name": item["name"],
            "type": item["type"],
            "service_area": item["service_area"],
            "area_description": item["area_description"],
            "zone": item["zone"],
            "address": item["address"],
            "aliases": item["aliases"],
            "notes": item["notes"],
            "has_coordinates": (
                item["latitude"] is not None
                and item["longitude"] is not None
            ),
        }
        for item in places
    ]

    system_prompt = (
        "You are At??n?, EkiMove's geographic information assistant for Ado-Ekiti, Nigeria. "
        "Answer questions about places, landmarks, addresses, service areas and geography. "
        "Use the supplied active EkiMove place catalogue as the source of truth for "
        "EkiMove-specific records. You may answer general geographic questions using "
        "your general knowledge, but distinguish general knowledge from verified EkiMove "
        "records. Never invent an address, coordinate, nearby business, road, route, "
        "distance, travel time, opening hour or live traffic condition. Do not provide "
        "turn-by-turn directions unless a routing result is supplied. If the catalogue "
        "does not establish a fact, say that you cannot verify it and ask a useful "
        "clarifying question. Be concise and helpful. Understand English and Nigerian "
        "Pidgin. Do not claim to book a ride or confirm a fare."
    )

    user_content = (
        "Active registered place catalogue:\n"
        + json.dumps(public_places, ensure_ascii=False)
        + "\nPassenger question:\n"
        + message
    )

    try:
        client = Groq(
            api_key=settings.groq_api_key,
            timeout=20.0,
            max_retries=1,
        )
        response = client.chat.completions.create(
            model=settings.groq_model,
            temperature=0,
            max_completion_tokens=500,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        )
        reply = response.choices[0].message.content
        if not reply or not reply.strip():
            raise ValueError("Empty geographic answer")
    except (APIConnectionError, APIStatusError, ValueError):
        logger.exception("At??n? geographic answer failed")
        return {
            "kind": "geography",
            "reply": (
                "I couldn't prepare a reliable geographic answer right now. "
                "Please try again shortly or ask about a specific registered EkiMove place."
            ),
            "places": [
                {"id": item["id"], "name": item["name"]}
                for item in matched_places[:5]
            ],
            "route": None,
        }

    return {
        "kind": "geography",
        "reply": reply.strip(),
        "places": [
            {"id": item["id"], "name": item["name"]}
            for item in matched_places[:5]
        ],
        "route": None,
    }

