from django.conf import settings
from django.core.mail import send_mail


def email_admin(event_name: str, payload: dict, request=None) -> None:
    """
    Sends a minimal internal notification email to the configured admin mailbox.
    Uses existing EMAIL_* settings (we do not change backend config).
    """
    to_email = getattr(settings, "ADMIN_NOTIFY_EMAIL", "")
    if not to_email:
        return

    subject = f"[Trade Journal] Event: {event_name}"
    lines = [f"Event: {event_name}", ""]
    for k, v in payload.items():
        lines.append(f"{k}: {v}")
    lines.append("")
    if request is not None:
        try:
            lines.append(f"path: {request.path}")
        except Exception:
            pass

    send_mail(
        subject=subject,
        message="\n".join(lines),
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None),
        recipient_list=[to_email],
        fail_silently=True,
    )