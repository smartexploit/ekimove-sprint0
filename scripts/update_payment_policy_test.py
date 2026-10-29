from pathlib import Path

p = Path("tests/test_api.py")
text = p.read_text(encoding="utf-8")

old = '''def test_transfer_only_payment_policy(client):
    response = client.get("/api/v1/policy/payments")
    assert response.status_code == 200
    body = response.json()
    assert body["supported_methods"] == ["bank_transfer"]
    assert body["cash_enabled"] is False
    assert body["screenshot_alone_confirms_payment"] is False
'''

new = '''def test_supported_payment_methods_policy(client):
    response = client.get("/api/v1/policy/payments")
    assert response.status_code == 200
    body = response.json()
    assert body["supported_methods"] == ["bank_transfer", "interswitch"]
    assert body["cash_enabled"] is False
    assert body["screenshot_alone_confirms_payment"] is False
'''

if text.count(old) != 1:
    raise RuntimeError("Expected test block not found exactly once; no changes made.")

p.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Payment policy test updated.")
