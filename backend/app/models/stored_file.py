"""Encrypted document bytes kept in the database (STORAGE_BACKEND=database).

For hosts where the server disk is wiped on restart and no separate object store is set up.
The content is Fernet-encrypted with ENCRYPTION_KEY before it reaches the database.
"""

from datetime import datetime

from sqlalchemy import LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, UTCDateTime, utcnow


class StoredFile(Base):
    __tablename__ = "stored_files"

    key: Mapped[str] = mapped_column(String(200), primary_key=True)  # "<user_id>/<document_id>"
    content_type: Mapped[str] = mapped_column(String(100))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
