"""
Web Push (VAPID) for AKG ESS — implemented with the `cryptography` library
Frappe already pins (~=44), NOT pywebpush/py-vapid (whose recent releases
require cryptography>=46 and conflict with Frappe).

We send a *data-less* push (no encrypted body). The push service wakes the
service worker, which calls get_push_payload() to fetch the latest unread
notification and shows it. That needs only VAPID JWT signing (ES256), which
cryptography does natively — no RFC 8291 payload encryption, no extra deps.

VAPID keys live in the site config (never committed):
    vapid_private_key  — PKCS8 PEM (private)
    vapid_public_key   — base64url raw EC point (the browser's applicationServerKey)
    vapid_subject      — "mailto:..." contact
Generate once with generate_vapid_keys() (System Manager).
"""
import base64
import json
import time
from urllib.parse import urlparse

import frappe
import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def get_keys():
    priv = frappe.conf.get("vapid_private_key")
    pub = frappe.conf.get("vapid_public_key")
    if not priv or not pub:
        return None
    return {"private_pem": priv, "public_key": pub,
            "subject": frappe.conf.get("vapid_subject") or "mailto:it@akg.ae"}


@frappe.whitelist()
def generate_vapid_keys():
    """One-time setup (System Manager): generate + persist a VAPID keypair in
    the site config. Returns the public application server key. Idempotent."""
    if "System Manager" not in frappe.get_roles(frappe.session.user):
        frappe.throw("System Manager role required.")
    existing = get_keys()
    if existing:
        return existing["public_key"]
    pk = ec.generate_private_key(ec.SECP256R1())
    priv_pem = pk.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    pub_point = pk.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    app_key = _b64u(pub_point)
    from frappe.installer import update_site_config
    update_site_config("vapid_private_key", priv_pem)
    update_site_config("vapid_public_key", app_key)
    if not frappe.conf.get("vapid_subject"):
        update_site_config("vapid_subject", "mailto:it@akg.ae")
    return app_key


def _vapid_auth_header(endpoint: str):
    keys = get_keys()
    if not keys:
        return None
    parsed = urlparse(endpoint)
    aud = f"{parsed.scheme}://{parsed.netloc}"
    header = _b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = _b64u(json.dumps(
        {"aud": aud, "exp": int(time.time()) + 12 * 3600, "sub": keys["subject"]},
        separators=(",", ":"),
    ).encode())
    signing_input = f"{header}.{claims}".encode()
    pk = serialization.load_pem_private_key(keys["private_pem"].encode(), password=None)
    der = pk.sign(signing_input, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw_sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    jwt = f"{header}.{claims}.{_b64u(raw_sig)}"
    return f"vapid t={jwt}, k={keys['public_key']}"


def _send(endpoint: str, ttl: int = 2419200) -> int:
    """Data-less push to one endpoint. Returns HTTP status (0 on transport
    error). 404/410 mean the subscription is dead."""
    auth = _vapid_auth_header(endpoint)
    if not auth:
        return 0
    try:
        resp = requests.post(
            endpoint,
            headers={"Authorization": auth, "TTL": str(ttl), "Content-Length": "0", "Urgency": "high"},
            data=b"",
            timeout=10,
        )
        return resp.status_code
    except Exception:
        return 0


def push_to_user(user: str):
    """Send a data-less push to every enabled subscription of `user`.
    Disables dead subscriptions (404/410). Never raises."""
    if not user or not get_keys():
        return
    try:
        subs = frappe.get_all(
            "ESS Push Subscription",
            filters={"user": user, "enabled": 1},
            fields=["name", "endpoint"],
        )
        for s in subs:
            code = _send(s["endpoint"])
            if code in (404, 410):
                frappe.db.set_value("ESS Push Subscription", s["name"], "enabled", 0)
        frappe.db.commit()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "webpush: push_to_user")


def notify_user(user, title, body, target_tab=None, target_id=None, kind="info", for_role="employee"):
    """Create an in-app ESS Notification for `user` AND fire a web push.
    Safe to call from any server event — never raises."""
    if not user:
        return
    try:
        emp = frappe.db.get_value("Employee", {"user_id": user}, "name")
        doc = frappe.get_doc({
            "doctype": "ESS Notification",
            "recipient": emp,
            "for_role": for_role,
            "kind": kind,
            "title": title,
            "body": body,
            "target_tab": target_tab,
            "target_id": target_id,
            "is_read": 0,
        })
        doc.flags.ignore_permissions = True
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "webpush: notify_user create")
    push_to_user(user)
