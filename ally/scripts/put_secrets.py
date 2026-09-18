"""Create or update Ally's secret bundle in AWS Secrets Manager. Idempotent.

Generates the VAPID key pair, device key and reply-token secret if they don't exist yet, and takes
SARVAM_API_KEY from the environment (root .env). Prints only the public values.

    python scripts/put_secrets.py
    python scripts/put_secrets.py --rotate device_key   # replace one value
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import secrets as pysecrets
import sys
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config import AWS_REGION, SECRET_NAME  # noqa: E402

PUBLIC_KEYS = ("vapid_public_key",)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def new_vapid() -> tuple[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    private = b64url(key.private_numbers().private_value.to_bytes(32, "big"))
    public = b64url(
        key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    )
    return public, private


def load(client) -> dict[str, str]:
    try:
        return json.loads(client.get_secret_value(SecretId=SECRET_NAME)["SecretString"])
    except ClientError as err:
        if err.response["Error"]["Code"] == "ResourceNotFoundException":
            return {}
        raise


def save(client, bundle: dict[str, str], existed: bool) -> None:
    payload = json.dumps(bundle)
    if existed:
        client.put_secret_value(SecretId=SECRET_NAME, SecretString=payload)
    else:
        client.create_secret(
            Name=SECRET_NAME,
            SecretString=payload,
            Description="Ally runtime secrets: web push (VAPID), watch device key, reply-token HMAC, Sarvam API key.",
        )


def main(rotate: list[str]) -> None:
    client = boto3.client("secretsmanager", region_name=AWS_REGION)
    bundle = load(client)
    existed = bool(bundle)
    for key in rotate:
        bundle.pop(key, None)
        if key == "vapid_private_key":
            bundle.pop("vapid_public_key", None)

    if not bundle.get("vapid_private_key"):
        bundle["vapid_public_key"], bundle["vapid_private_key"] = new_vapid()
        print("generated a VAPID key pair (existing push subscriptions must re-subscribe)")
    bundle.setdefault("device_key", pysecrets.token_urlsafe(32))
    bundle.setdefault("hmac_secret", pysecrets.token_urlsafe(48))

    sarvam = (os.getenv("SARVAM_API_KEY") or "").strip()
    if sarvam:
        bundle["sarvam_api_key"] = sarvam
    elif not bundle.get("sarvam_api_key"):
        print("WARNING: SARVAM_API_KEY not set — voice input stays 'not configured'.")

    save(client, bundle, existed)
    print(f"{'updated' if existed else 'created'} secret {SECRET_NAME} ({len(bundle)} values)")
    print("\nPublic values (safe to share):")
    print(f"NEXT_PUBLIC_VAPID_PUBLIC_KEY={bundle['vapid_public_key']}")
    print("\nThe watch device key is secret — read it with:")
    print(f"  aws secretsmanager get-secret-value --secret-id {SECRET_NAME} --query SecretString --output text")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--rotate", action="append", default=[], help="value to regenerate, e.g. device_key")
    main(parser.parse_args().rotate)
