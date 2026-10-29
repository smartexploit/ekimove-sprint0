from pathlib import Path

p = Path("app/interswitch_payments.py")
text = p.read_text(encoding="utf-8")

old = '''    response_code = str(result.get("ResponseCode", "")).strip()
    try:
        provider_amount = int(str(result.get("Amount", "")).strip())
    except (ValueError, TypeError):
        provider_amount = -1

    if response_code != "00" or provider_amount != amount_kobo:
'''
new = '''    response_code = str(result.get("ResponseCode", "")).strip()
    returned_reference = str(result.get("MerchantReference", "")).strip()
    try:
        provider_amount = int(str(result.get("Amount", "")).strip())
    except (ValueError, TypeError):
        provider_amount = -1

    if (
        response_code != "00"
        or provider_amount != amount_kobo
        or returned_reference != payment.provider_transaction_ref
    ):
'''
if text.count(old) != 1:
    raise RuntimeError("Could not safely locate the verification check.")
p.write_text(text.replace(old, new, 1), encoding="utf-8")

p = Path("app/main.py")
text = p.read_text(encoding="utf-8")

old = '''    """Expose the transfer-only payment policy."""
    return {
        "supported_methods": ["bank_transfer"],
        "cash_enabled": False,
        "confirmation_rule": "trusted_provider_confirmation_or_authorized_reconciliation",
        "screenshot_alone_confirms_payment": False,
    }
'''
new = '''    """Expose supported payment methods and confirmation rules."""
    return {
        "supported_methods": ["bank_transfer", "interswitch"],
        "cash_enabled": False,
        "confirmation_rule": "server_side_provider_verification_or_authorized_reconciliation",
        "screenshot_alone_confirms_payment": False,
    }
'''
if text.count(old) != 1:
    raise RuntimeError("Could not safely locate the payment policy.")
p.write_text(text.replace(old, new, 1), encoding="utf-8")

print("Verification and payment policy updated.")
