import json
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
from app.models import User, Zone

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/atona", tags=["Atọ́nà AI"])


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
            detail="Atọ́nà booking is available to passenger accounts only.",
        )

    if not settings.atona_enabled or not settings.groq_api_key:
        raise HTTPException(
            status_code=503,
            detail="Atọ́nà is not configured yet.",
        )

    zones = db.scalars(
        select(Zone).where(Zone.is_active.is_(True)).order_by(Zone.name)
    ).all()
    zone_names = [zone.name for zone in zones]

    if len(zone_names) < 2:
        return {
            "reply": "EkiMove needs at least two active zones before I can help plan this trip.",
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
        "Return JSON with exactly these keys: "
        "origin_zone_name, destination_zone_name, origin_text, destination_text, "
        "passenger_count, vehicle_type, clarification. "
        "Use null for unknown strings. clarification should be a short question when "
        "required information is missing, otherwise null. "
        "Do not claim a ride was booked."
    )

    try:
        client = Groq(api_key=settings.groq_api_key, timeout=20.0, max_retries=1)
        response = client.chat.completions.create(
            model=settings.groq_model,
            temperature=0,
            max_tokens=350,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": (
                        "Active zone names (use exact names only): "
                        + json.dumps(zone_names, ensure_ascii=False)
                        + "\nPassenger message: "
                        + payload.message
                    ),
                },
            ],
        )
        raw = response.choices[0].message.content
        extracted = json.loads(raw or "{}")
    except (APIConnectionError, APIStatusError):
        logger.exception("Atọ́nà Groq request failed")
        raise HTTPException(
            status_code=502,
            detail="Atọ́nà could not reach its AI service. Please use the booking form.",
        )
    except (ValueError, TypeError, KeyError, IndexError):
        logger.exception("Atọ́nà returned an invalid response")
        raise HTTPException(
            status_code=502,
            detail="Atọ́nà could not interpret that request. Please try again.",
        )

    def valid_zone_id(name: object) -> int | None:
        if not isinstance(name, str) or not name.strip():
            return None
        wanted = normalize_name(name)
        matches = [
            zone for zone in zones if normalize_name(zone.name) == wanted
        ]
        return matches[0].id if len(matches) == 1 else None

    origin_zone_id = valid_zone_id(extracted.get("origin_zone_name"))
    destination_zone_id = valid_zone_id(extracted.get("destination_zone_name"))

    def safe_text(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        value = value.strip()
        return value[:255] if len(value) >= 3 else None

    try:
        passenger_count = int(extracted.get("passenger_count", 1))
    except (TypeError, ValueError):
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
    elif origin_zone_id == destination_zone_id and origin_zone_id is not None:
        missing.append("a different destination zone")

    clarification = extracted.get("clarification")
    if not isinstance(clarification, str):
        clarification = None

    if missing:
        reply = "I need a little more detail: " + ", ".join(dict.fromkeys(missing)) + "."
    else:
        reply = (
            "I've prepared your trip details. Please review them in the booking form. "
            "No ride has been submitted."
        )

    return {
        "reply": reply,
        "needs_clarification": booking is None,
        "booking": booking,
        "available_zones": zone_names,
        "ai_clarification": clarification,
    }
