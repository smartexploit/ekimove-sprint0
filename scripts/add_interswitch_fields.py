from pathlib import Path

def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}. No replacement made.")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

replace_once(
    "app/models.py",
    '        CheckConstraint("method = \'bank_transfer\'", name="ck_payments_bank_transfer_only"),',
    '        CheckConstraint("method IN (\'bank_transfer\', \'interswitch\')", name="ck_payments_method"),'
)

replace_once(
    "app/models.py",
    '    transfer_reference: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)\n',
    '    transfer_reference: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)\n'
    '    provider_transaction_ref: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True, index=True)\n'
)

replace_once(
    "app/config.py",
    '    redis_ssl: bool = True\n',
    '    redis_ssl: bool = True\n\n'
    '    # Interswitch Web Checkout. TEST is the safe default.\n'
    '    interswitch_merchant_code: str | None = None\n'
    '    interswitch_pay_item_id: str | None = None\n'
    '    interswitch_mode: str = "TEST"\n'
    '    interswitch_requery_base_url: str = "https://sandbox.interswitchng.com/collections/api/v1/gettransaction.json"\n'
)

replace_once(
    ".env.example",
    "REDIS_SSL=true\n",
    "REDIS_SSL=true\n\n"
    "# Interswitch checkout: configure these with values confirmed by your team.\n"
    "# Never commit private credentials. TEST mode is the default.\n"
    "INTERSWITCH_MERCHANT_CODE=\n"
    "INTERSWITCH_PAY_ITEM_ID=\n"
    "INTERSWITCH_MODE=TEST\n"
    "INTERSWITCH_REQUERY_BASE_URL=https://sandbox.interswitchng.com/collections/api/v1/gettransaction.json\n"
)

print("Updated model, configuration, and example environment settings.")
