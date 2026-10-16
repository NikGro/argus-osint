"""Authentication policy for the isolated Instagram worker; never prompt on stdin."""


class ManualVerificationRequired(Exception):
    pass


def login(client, config, verification_code=""):
    saved = config.get("saved_session")
    if saved:
        client.set_settings(saved)
    username = config.get("login_username", "").strip()
    password = config.get("login_password", "")
    sessionid = config.get("sessionid", "")

    def challenge_code(_username, _choice):
        if verification_code:
            return verification_code
        raise ManualVerificationRequired()

    client.challenge_code_handler = challenge_code
    if username and password:
        client.login(username, password, verification_code=verification_code)
        return True
    if sessionid:
        client.login_by_sessionid(sessionid)
        return True
    return False


def input_request(exc):
    name = type(exc).__name__
    if name in ("TwoFactorRequired", "ManualVerificationRequired", "ChallengeRequired"):
        return {
            "kind": "instagram_auth",
            "title": "Instagram-Anmeldung bestätigen",
            "message": "Bestätigungscode aus deiner Authenticator-App, E-Mail oder SMS eingeben. Eine zusätzliche Freigabe kann direkt bei Instagram erforderlich sein.",
            "fields": [
                {
                    "key": "verification_code",
                    "label": "Instagram-Bestätigungscode",
                    "type": "password",
                    "required": True,
                    "transient": True,
                }
            ],
        }
    return None
