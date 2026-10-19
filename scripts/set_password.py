"""Controlled password provisioning for existing EkiMove accounts."""

import argparse
from getpass import getpass

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.auth import hash_password
from app.database import SessionLocal
from app.models import User


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Set a password for an existing active EkiMove account."
    )
    parser.add_argument(
        "phone",
        help="Phone number of the existing account",
    )
    args = parser.parse_args()

    password = getpass("New password (input hidden): ")
    confirmation = getpass("Confirm new password (input hidden): ")

    if password != confirmation:
        print("Passwords do not match. No changes were made.")
        return 1

    if len(password) < 12:
        print("Password must contain at least 12 characters. No changes were made.")
        return 1

    if len(password) > 256:
        print("Password exceeds the permitted length. No changes were made.")
        return 1

    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.phone == args.phone))

        if user is None:
            print("Account not found. No changes were made.")
            return 1

        if not user.is_active:
            print("Account is inactive. No changes were made.")
            return 1

        print(f"Account found: {user.phone} (role: {user.role})")
        print("This operation changes only the password hash.")
        confirmation_phrase = input(
            'Type SET PASSWORD to confirm this account update: '
        )
        if confirmation_phrase != "SET PASSWORD":
            print("Confirmation not received. No changes were made.")
            return 1

        new_hash = hash_password(password)
        user.password_hash = new_hash
        db.commit()

        print("Password hash updated successfully.")
        print("The plaintext password was not stored.")
        return 0

    except SQLAlchemyError:
        db.rollback()
        print("Database operation failed. The change was rolled back.")
        return 1
    finally:
        db.close()
        password = ""
        confirmation = ""


if __name__ == "__main__":
    raise SystemExit(main())
