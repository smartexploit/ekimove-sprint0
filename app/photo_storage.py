import os
import time
import uuid

import cloudinary
import cloudinary.uploader
import requests
from cloudinary.utils import private_download_url


PHOTO_PREFIX = "cloudinary:"


class PhotoStorageError(RuntimeError):
    """Raised when private photo storage cannot complete an operation."""


def upload_driver_photo(photo_bytes: bytes) -> str:
    """Upload a validated driver photo as an authenticated Cloudinary asset."""
    if not os.environ.get("CLOUDINARY_URL"):
        raise PhotoStorageError("Cloudinary is not configured")

    try:
        result = cloudinary.uploader.upload(
            photo_bytes,
            resource_type="image",
            type="authenticated",
            public_id=f"ekimove/driver-photos/{uuid.uuid4().hex}",
            overwrite=False,
            unique_filename=False,
            use_filename=False,
        )
        return f"{PHOTO_PREFIX}{result['public_id']}|{result['format']}"
    except Exception:
        raise PhotoStorageError("Cloudinary photo upload failed") from None


def delete_driver_photo(photo_ref: str | None) -> None:
    """Best-effort cleanup after a database transaction fails."""
    if not photo_ref or not photo_ref.startswith(PHOTO_PREFIX):
        return

    try:
        asset, _image_format = photo_ref[len(PHOTO_PREFIX):].rsplit("|", 1)
        cloudinary.uploader.destroy(
            asset,
            resource_type="image",
            type="authenticated",
            invalidate=True,
        )
    except Exception:
        # Cleanup failure must not hide the original application error.
        pass


def download_driver_photo(photo_ref: str) -> tuple[bytes, str]:
    """Fetch an authenticated asset without exposing its signed URL."""
    if not photo_ref.startswith(PHOTO_PREFIX):
        raise ValueError("Unsupported photo reference")

    try:
        asset, image_format = photo_ref[len(PHOTO_PREFIX):].rsplit("|", 1)
        url = private_download_url(
            asset,
            image_format,
            resource_type="image",
            type="authenticated",
            expires_at=int(time.time()) + 60,
        )

        with requests.get(url, timeout=(5, 20), stream=True) as response:
            if response.status_code == 404:
                raise FileNotFoundError("Driver photo is missing from Cloudinary")

            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "").split(";")[0].lower()

            if content_type not in {"image/jpeg", "image/png", "image/webp"}:
                raise PhotoStorageError("Unexpected photo content type")

            chunks = []
            total = 0
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > 5 * 1024 * 1024:
                    raise PhotoStorageError("Photo exceeds the allowed size")
                chunks.append(chunk)

            if total == 0:
                raise PhotoStorageError("Cloudinary returned an empty photo")

            return b"".join(chunks), content_type

    except FileNotFoundError:
        raise
    except PhotoStorageError:
        raise
    except Exception:
        raise PhotoStorageError("Cloudinary photo retrieval failed") from None
