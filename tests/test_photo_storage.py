import pytest

from app import photo_storage as storage


class FakeResponse:
    def __init__(
        self,
        content=b"fake-image-data",
        status_code=200,
        content_type="image/png",
    ):
        self.content = content
        self.status_code = status_code
        self.headers = {"Content-Type": content_type}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def iter_content(self, chunk_size):
        for offset in range(0, len(self.content), chunk_size):
            yield self.content[offset:offset + chunk_size]


def test_upload_requires_cloudinary_configuration(monkeypatch):
    monkeypatch.delenv("CLOUDINARY_URL", raising=False)

    with pytest.raises(storage.PhotoStorageError, match="not configured"):
        storage.upload_driver_photo(b"image")


def test_upload_stores_authenticated_cloudinary_reference(monkeypatch):
    monkeypatch.setenv("CLOUDINARY_URL", "cloudinary://test")
    captured = {}

    def fake_upload(data, **kwargs):
        captured["data"] = data
        captured.update(kwargs)
        return {
            "public_id": "ekimove/driver-photos/test-image",
            "format": "png",
        }

    monkeypatch.setattr(storage.cloudinary.uploader, "upload", fake_upload)

    result = storage.upload_driver_photo(b"image")

    assert result == "cloudinary:ekimove/driver-photos/test-image|png"
    assert captured["data"] == b"image"
    assert captured["type"] == "authenticated"
    assert captured["resource_type"] == "image"


def test_upload_failure_does_not_expose_provider_error(monkeypatch):
    monkeypatch.setenv("CLOUDINARY_URL", "cloudinary://test")

    def fail_upload(*args, **kwargs):
        raise RuntimeError("sensitive provider response")

    monkeypatch.setattr(storage.cloudinary.uploader, "upload", fail_upload)

    with pytest.raises(storage.PhotoStorageError) as exc:
        storage.upload_driver_photo(b"image")

    assert "sensitive provider response" not in str(exc.value)


def test_download_returns_image_bytes_and_content_type(monkeypatch):
    monkeypatch.setattr(
        storage,
        "private_download_url",
        lambda *args, **kwargs: "https://example.invalid/private-download",
    )
    monkeypatch.setattr(
        storage.requests,
        "get",
        lambda *args, **kwargs: FakeResponse(
            b"png-image", content_type="image/png"
        ),
    )

    result = storage.download_driver_photo(
        "cloudinary:ekimove/driver-photos/test-image|png"
    )

    assert result == (b"png-image", "image/png")


def test_download_rejects_unsupported_content_type(monkeypatch):
    monkeypatch.setattr(
        storage,
        "private_download_url",
        lambda *args, **kwargs: "https://example.invalid/private-download",
    )
    monkeypatch.setattr(
        storage.requests,
        "get",
        lambda *args, **kwargs: FakeResponse(
            b"not-an-image", content_type="text/html"
        ),
    )

    with pytest.raises(storage.PhotoStorageError, match="content type"):
        storage.download_driver_photo(
            "cloudinary:ekimove/driver-photos/test-image|png"
        )


def test_download_rejects_oversized_photo(monkeypatch):
    monkeypatch.setattr(
        storage,
        "private_download_url",
        lambda *args, **kwargs: "https://example.invalid/private-download",
    )
    monkeypatch.setattr(
        storage.requests,
        "get",
        lambda *args, **kwargs: FakeResponse(
            b"x" * (5 * 1024 * 1024 + 1),
            content_type="image/png",
        ),
    )

    with pytest.raises(storage.PhotoStorageError, match="exceeds"):
        storage.download_driver_photo(
            "cloudinary:ekimove/driver-photos/test-image|png"
        )


def test_download_maps_missing_cloudinary_photo_to_file_not_found(monkeypatch):
    monkeypatch.setattr(
        storage,
        "private_download_url",
        lambda *args, **kwargs: "https://example.invalid/private-download",
    )
    monkeypatch.setattr(
        storage.requests,
        "get",
        lambda *args, **kwargs: FakeResponse(status_code=404),
    )

    with pytest.raises(FileNotFoundError):
        storage.download_driver_photo(
            "cloudinary:ekimove/driver-photos/missing-image|png"
        )


def test_delete_ignores_legacy_local_photo(monkeypatch):
    def unexpected_destroy(*args, **kwargs):
        raise AssertionError("Legacy files must not trigger Cloudinary deletion")

    monkeypatch.setattr(
        storage.cloudinary.uploader, "destroy", unexpected_destroy
    )

    storage.delete_driver_photo("C:/legacy-driver-photos/old.png")
