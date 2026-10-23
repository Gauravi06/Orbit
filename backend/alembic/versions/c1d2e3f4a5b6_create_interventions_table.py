"""create interventions table

Revision ID: c1d2e3f4a5b6
Revises: 5891a3b4c5d6
Create Date: 2026-10-22 01:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, Sequence[str], None] = '5891a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'interventions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('task_id', sa.UUID(), nullable=True),
        sa.Column('intervention_type', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('message', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='active'),
        sa.Column('dedup_key', sa.String(), nullable=False),
        sa.Column('snoozed_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('dismissed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('dedup_key', name='uq_interventions_dedup_key'),
    )
    op.create_index(op.f('ix_interventions_user_id'), 'interventions', ['user_id'], unique=False)
    op.create_index(op.f('ix_interventions_task_id'), 'interventions', ['task_id'], unique=False)
    op.create_index(op.f('ix_interventions_status'), 'interventions', ['status'], unique=False)
    op.create_index(op.f('ix_interventions_dedup_key'), 'interventions', ['dedup_key'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_interventions_dedup_key'), table_name='interventions')
    op.drop_index(op.f('ix_interventions_status'), table_name='interventions')
    op.drop_index(op.f('ix_interventions_task_id'), table_name='interventions')
    op.drop_index(op.f('ix_interventions_user_id'), table_name='interventions')
    op.drop_table('interventions')
