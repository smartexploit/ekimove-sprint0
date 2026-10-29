from pathlib import Path

p = Path("app/main.py")
text = p.read_text(encoding="utf-8")
imp = "from app.interswitch_payments import router as interswitch_payments_router\n"
include = "app.include_router(interswitch_payments_router)\n"

if imp not in text:
    anchor = "from app.payments import router as payments_router\n"
    if text.count(anchor) != 1:
        raise RuntimeError("Could not safely locate payment router import in app/main.py")
    text = text.replace(anchor, anchor + imp, 1)

if include not in text:
    anchor = "app.include_router(payments_router)\n"
    if text.count(anchor) != 1:
        raise RuntimeError("Could not safely locate payment router registration in app/main.py")
    text = text.replace(anchor, anchor + include, 1)

p.write_text(text, encoding="utf-8")
print("Interswitch router registered.")
