"""Install-local encryption with descriptor secrets and defensive name-based redaction."""

from core.errors import DomainError
import copy
import json
import os
from pathlib import Path
import re
import tempfile
from cryptography.fernet import Fernet, InvalidToken

MASK = "••••••••"
PREFIX = "argus:sealed:v1:"
JSON_PREFIX = "argus:sealed:json:v1:"
SECRET_KEY = re.compile(
    "(?:password|token|secret|api[_-]?key|sessionid|cookie|authorization|credential)$",
    re.I,
)


def is_secret(key, fields=()):
    return key in fields or bool(SECRET_KEY.search(str(key)))


def redact(value, fields=()):
    if isinstance(value, dict):
        return {
            key: (
                MASK
                if child
                and (
                    is_secret(key, fields)
                    or (
                        isinstance(child, str)
                        and child.startswith((PREFIX, JSON_PREFIX))
                    )
                )
                else redact(child, fields)
            )
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [redact(child, fields) for child in value]
    return copy.deepcopy(value)


class SecretStore:
    """The volume key belongs in backups with the database, never in Git."""

    def __init__(self, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        key_file = directory / ".credentials.key"
        if not key_file.exists():
            fd, name = tempfile.mkstemp(prefix=".credentials-", dir=directory)
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(Fernet.generate_key())
                try:
                    os.link(name, key_file)
                except FileExistsError:
                    pass
            finally:
                Path(name).unlink(missing_ok=True)
        key_file.chmod(384)
        self.cipher = Fernet(key_file.read_bytes())

    def encrypt_text(self, value):
        return self.cipher.encrypt(value.encode()).decode()

    def decrypt_text(self, value):
        try:
            return self.cipher.decrypt(value.encode()).decode()
        except InvalidToken:
            raise DomainError("validation.c03d68db5c") from None

    def seal(self, value, fields=()):
        if isinstance(value, dict):
            result = {}
            for key, child in value.items():
                already = isinstance(child, str) and child.startswith(
                    (PREFIX, JSON_PREFIX)
                )
                if is_secret(key, fields) and child and (not already):
                    prefix, plain = (
                        (PREFIX, child)
                        if isinstance(child, str)
                        else (JSON_PREFIX, json.dumps(child))
                    )
                    result[key] = prefix + self.cipher.encrypt(plain.encode()).decode()
                else:
                    result[key] = self.seal(child, fields)
            return result
        if isinstance(value, list):
            return [self.seal(child, fields) for child in value]
        return copy.deepcopy(value)

    def reveal(self, value):
        if isinstance(value, dict):
            return {key: self.reveal(child) for key, child in value.items()}
        if isinstance(value, list):
            return [self.reveal(child) for child in value]
        if isinstance(value, str) and value.startswith((PREFIX, JSON_PREFIX)):
            prefix = JSON_PREFIX if value.startswith(JSON_PREFIX) else PREFIX
            try:
                plain = self.cipher.decrypt(value[len(prefix) :].encode()).decode()
                return json.loads(plain) if prefix == JSON_PREFIX else plain
            except (InvalidToken, ValueError):
                raise DomainError("validation.819545b513") from None
        return copy.deepcopy(value)

    def preserve_masks(self, incoming, previous):
        if isinstance(incoming, dict):
            previous = previous if isinstance(previous, dict) else {}
            return {
                key: (
                    copy.deepcopy(previous.get(key, ""))
                    if child == MASK
                    else self.preserve_masks(child, previous.get(key))
                )
                for key, child in incoming.items()
            }
        if isinstance(incoming, list):
            return [self.preserve_masks(child, None) for child in incoming]
        return copy.deepcopy(incoming)


def scrub_text(value, settings):
    """Remove known credentials and URL-encoded variants from diagnostics."""
    from urllib.parse import quote, quote_plus

    secrets = []

    def collect(item, forced=False):
        if isinstance(item, dict):
            for key, child in item.items():
                collect(child, forced or is_secret(key))
        elif isinstance(item, list):
            for child in item:
                collect(child, forced)
        elif forced and isinstance(item, str) and item and (item != MASK):
            secrets.append(item)

    collect(settings)
    text = str(value)
    for secret in sorted(secrets, key=len, reverse=True):
        for variant in (secret, quote(secret, safe=""), quote_plus(secret)):
            text = text.replace(variant, "[redacted]")
    return text
