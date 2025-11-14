from django.core import signing
from datetime import timedelta
from django.utils.timezone import now

SIGNER = signing.TimestampSigner(salt="accounts.email.verify")

def make_email_token(user_id: int) -> str:
    return SIGNER.sign(str(user_id))

def read_email_token(token: str, max_age_days: int = 2) -> int:
    uid = SIGNER.unsign(token, max_age=timedelta(days=max_age_days).total_seconds())
    return int(uid)
