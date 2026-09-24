"""Print fresh secrets for a new environment. Run once per environment and store them as env vars.

    python -m app.scripts.generate_secrets

Never commit the output. Changing ENCRYPTION_KEY later makes stored OAuth tokens and uploaded
documents unreadable, so keep it safe (e.g. in the hosting platform's secret settings).
"""

import secrets

from cryptography.fernet import Fernet

if __name__ == "__main__":
    print(f"JWT_SECRET={secrets.token_urlsafe(48)}")
    print(f"ENCRYPTION_KEY={Fernet.generate_key().decode()}")
