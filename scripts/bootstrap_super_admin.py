import argparse
import json
import sys
from getpass import getpass

from sqlalchemy import func, select, text
from sqlalchemy.orm import sessionmaker

from app.auth import verify_password
from app.database import SessionLocal
from app.models import AuditLog, User


class BootstrapRefused(Exception):
    """A safety check rejected the bootstrap operation."""


class DryRunComplete(Exception):
    """The checks passed, but no changes were requested."""


def bootstrap(
    session_factory: sessionmaker,
    phone: str,
    password: str,
    apply: bool = False,
) -> str:
    try:
        with session_factory() as db:
            with db.begin():
                # Serialize concurrent bootstrap attempts on PostgreSQL.
                if db.bind.dialect.name == "postgresql":
                    db.execute(
                        text("SELECT pg_advisory_xact_lock(721904281, 1)")
                    )

                user = db.scalar(
                    select(User)
                    .where(User.phone == phone)
                    .with_for_update()
                )

                if user is None:
                    raise BootstrapRefused(
                        "Account not found; no changes made."
                    )

                if not user.is_active or not user.password_hash:
                    raise BootstrapRefused(
                        "Account must be active and have a password hash."
                    )

                if not verify_password(password, user.password_hash):
                    raise BootstrapRefused(
                        "Account verification failed; no changes made."
                    )

                if user.role != "passenger":
                    raise BootstrapRefused(
                        "Only an existing passenger account can be bootstrapped."
                    )

                admin_count = db.scalar(
                    select(func.count())
                    .select_from(User)
                    .where(User.role == "super_admin")
                )
                if admin_count:
                    raise BootstrapRefused(
                        "A Super Admin already exists; bootstrap refused."
                    )

                result = (
                    f"Verified target account ID: {user.id}\n"
                    f"Current role: {user.role}\n"
                    "Proposed role: super_admin"
                )

                if not apply:
                    raise DryRunComplete(
                        result + "\nDRY RUN: no changes committed."
                    )

                user.role = "super_admin"
                db.add(
                    AuditLog(
                        actor_user_id=None,
                        action="bootstrap_super_admin",
                        entity_type="user",
                        entity_id=str(user.id),
                        details=json.dumps(
                            {
                                "previous_role": "passenger",
                                "new_role": "super_admin",
                                "method": "controlled_bootstrap",
                                "actor": "offline_operator",
                            }
                        ),
                    )
                )
                db.flush()

        return result + "\nRole change and audit record committed."

    except DryRunComplete as exc:
        return str(exc)
    except BootstrapRefused:
        raise


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bootstrap the first EkiMove Super Admin."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Commit the role change. Without this flag, only a dry run runs.",
    )
    args = parser.parse_args()

    phone = input("Target account phone number: ").strip()
    if not phone:
        print("A phone number is required.", file=sys.stderr)
        return 1

    password = getpass("Verify the existing account password: ")
    if not password:
        print("Password verification is required.", file=sys.stderr)
        return 1

    if args.apply:
        confirmation = getpass(
            "Type BOOTSTRAP-SUPER-ADMIN to authorize the change: "
        )
        if confirmation != "BOOTSTRAP-SUPER-ADMIN":
            print("Confirmation failed; no changes made.")
            return 1

    try:
        result = bootstrap(SessionLocal, phone, password, args.apply)
        print(result)
        return 0
    except BootstrapRefused as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception:
        print(
            "Bootstrap failed. The transaction was rolled back if it had "
            "started. Check local application logs for details.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
