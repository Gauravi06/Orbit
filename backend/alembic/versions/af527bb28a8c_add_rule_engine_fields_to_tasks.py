"""add rule engine fields to tasks

Revision ID: af527bb28a8c
Revises: bcbf32b99541
Create Date: 2026-08-18 21:14:08.614525

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'af527bb28a8c'
down_revision: Union[str, Sequence[str], None] = 'bcbf32b99541'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Define the enum once so we can create/drop it explicitly,
# and reuse the same definition on the column itself.
task_type_enum = postgresql.ENUM(
    'deadline', 'growth', 'wellbeing_moderate',
    name='tasktype'
)


def upgrade() -> None:
    """Upgrade schema."""
    # Create the Postgres enum TYPE first — this is the step that was
    # missing. checkfirst=True makes it a no-op if it somehow already exists.
    task_type_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        'tasks',
        sa.Column(
            'task_type',
            sa.Enum('deadline', 'growth', 'wellbeing_moderate', name='tasktype', create_type=False),
            nullable=True
        )
    )
    op.add_column('tasks', sa.Column('is_fixed', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('tasks', sa.Column('must_daily', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('tasks', sa.Column('commute_minutes', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('tasks', 'commute_minutes')
    op.drop_column('tasks', 'must_daily')
    op.drop_column('tasks', 'is_fixed')
    op.drop_column('tasks', 'task_type')

    # Now that no column depends on the type, we can safely drop it too.
    task_type_enum.drop(op.get_bind(), checkfirst=True)