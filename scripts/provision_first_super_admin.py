import getpass
import json
import re
import sys

from sqlalchemy import func, select, text

from app.auth import hash_password
from app.database import SessionLocal
from app.models import AuditLog, User


CONFIRMATION = "CREATE-FIRST-SUPER-ADMIN"


def provision(phone: str, full_name: str, password: str, apply: bool) -> str:
    with SessionLocal() as db:
        with db.begin():
            # Serialize concurrent first-admin provisioning attempts.
            db.execute(text("SELECT pg_advisory_xact_lock(721904281, 2)"))

            user_count = db.scalar(select(func.count()).select_from(User))
            if user_count != 0:
                raise RuntimeError(
                    "Provisioning refused: users already exist. "
                    "Use the existing-account recovery process instead."
                )

            duplicate = db.scalar(
                select(User.id).where(User.phone == phone)
            )
            if duplicate is not None:
                raise RuntimeError("Provisioning refused: phone already exists.")

            print("Database user count: 0")
            print("Target role: super_admin")

            if not apply:
                # No inserts or updates occur in dry-run mode.
                return "DRY RUN ONLY: no database changes made."

            user = User(
                phone=phone,
                full_name=full_name,
                password_hash=hash_password(password),
                role="super_admin",
                is_active=True,
            )
            db.add(user)
            db.flush()

            db.add(
                AuditLog(
                    actor_user_id=None,
                    action="provision_first_super_admin",
                    entity_type="user",
                    entity_id=str(user.id),
                    details=json.dumps({
                        "method": "controlled_first_admin_provisioning",
                        "new_role": "super_admin",
                        "actor": "offline_operator",
                    }),
                )
            )
            db.flush()
            new_user_id = user.id

    return f"Provisioned Super Admin account ID: {new_user_id}"


def main() -> int:
    phone = input("New administrator phone number: ").strip()
    full_name = input("Administrator full name: ").strip()
    password = getpass.getpass("Create a strong password: ")
    confirmation = getpass.getpass("Re-enter the password: ")

    if not phone or not full_name or len(full_name) > 160:
        print("A valid phone number and name are required.", file=sys.stderr)
        return 1

    if password != confirmation:
        print("Passwords do not match.", file=sys.stderr)
        return 1

    if (
        len(password) < 14
        or not re.search(r"[a-z]", password)
        or not re.search(r"[A-Z]", password)
        or not re.search(r"\d", password)
        or not re.search(r"[^A-Za-z0-9]", password)
    ):
        print(
            "Use at least 14 characters with uppercase, lowercase, "
            "a number, and a symbol.",
            file=sys.stderr,
        )
        return 1

    dry_run = input("Dry run only? Type YES to keep it dry: ").strip().upper() == "YES"
    apply = not dry_run
    if apply:
        authorization = input(
            f"To authorize creation, type {CONFIRMATION}: "
        ).strip()
        if authorization != CONFIRMATION:
            print("Authorization failed; no changes made.")
            return 1

    try:
        print(provision(phone, full_name, password, apply))
        return 0
    except Exception as exc:
        print(f"Provisioning failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
