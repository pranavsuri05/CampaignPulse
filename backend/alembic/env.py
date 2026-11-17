import os

from alembic import context

from app.config import get_settings
from app.db import make_engine
from app.models import Base

target_metadata = Base.metadata


def _url() -> str:
    return os.environ.get("ALEMBIC_DATABASE_URL") or get_settings().database_url


def run_migrations_online() -> None:
    connectable = context.config.attributes.get("connection")
    if connectable is None:
        engine = make_engine(_url())
        with engine.connect() as conn:
            _run(conn)
    else:
        _run(connectable)


def _run(conn) -> None:  # noqa: ANN001
    context.configure(connection=conn, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


run_migrations_online()
