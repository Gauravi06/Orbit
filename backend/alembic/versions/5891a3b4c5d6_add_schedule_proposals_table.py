"""add schedule proposals table

Revision ID: 5891a3b4c5d6
Revises: 47802012c19c
Create Date: 2026-10-11 18:15:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5891a3b4c5d6'
down_revision: Union[str, Sequence[str], None] = '47802012c19c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'schedule_proposals',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('summary', sa.String(), nullable=True),
        sa.Column('task_hash', sa.String(), nullable=False),
        sa.Column('planning_now', sa.DateTime(timezone=True), nullable=False),
        sa.Column('placements_json', sa.Text(), nullable=False),
        sa.Column('at_risk_json', sa.Text(), nullable=False),
        sa.Column('violations_json', sa.Text(), nullable=False),
        sa.Column('displaced_json', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_schedule_proposals_user_id'), 'schedule_proposals', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_schedule_proposals_user_id'), table_name='schedule_proposals')
    op.drop_table('schedule_proposals')
