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
                    "Atọ́nà returned invalid JSON on attempt %s of 2.",
                    attempt + 1,
                )

        if extracted is None:
            logger.error(
                "Atọ́nà failed to return valid JSON after two attempts: %s",
                type(last_error).__name__ if last_error else "UnknownError",
            )
            raise HTTPException(
                status_code=502,
                detail=(
                    "Atọ́nà could not reliably interpret that request. "
                    "Please use the booking form."
                ),
            )

    except (APIConnectionError, APIStatusError):
        logger.exception("Atọ́nà Groq request failed")
        raise HTTPException(
            status_code=502,
            detail=(
                "Atọ́nà could not process this request through its AI service. "
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
