"""change task priority to integer

Revision ID: 3f6f75368c30
Revises: af527bb28a8c
Create Date: 2026-08-29 22:39:47.087256

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3f6f75368c30'
down_revision: Union[str, Sequence[str], None] = 'af527bb28a8c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        'tasks', 'priority',
        existing_type=sa.VARCHAR(),
        type_=sa.Integer(),
        nullable=False,
        postgresql_using='priority::integer'
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        'tasks', 'priority',
        existing_type=sa.Integer(),
        type_=sa.VARCHAR(),
        nullable=True
    )