import asyncio
import logging
from typing import Optional

from app.core.config import settings
from app.db.session import SessionLocal
from app.services.intervention_service import run_detection_cycle

logger = logging.getLogger(__name__)


class InterventionWorker:
    def __init__(self, poll_interval_seconds: Optional[int] = None):
        self.poll_interval_seconds = poll_interval_seconds or settings.intervention_poll_interval_seconds
        self._running: bool = False
        self._task: Optional[asyncio.Task] = None

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="intervention_worker_loop")
        logger.info("Intervention worker started with %ss polling interval", self.poll_interval_seconds)

    async def stop(self) -> None:
        if not self._running:
            return
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Intervention worker stopped cleanly")

    async def _loop(self) -> None:
        # Initial catch-up on startup
        await asyncio.sleep(1)
        while self._running:
            try:
                db = SessionLocal()
                try:
                    run_detection_cycle(db)
                finally:
                    db.close()
            except Exception as exc:
                logger.error("Intervention background detection failed: %s", exc, exc_info=True)

            try:
                await asyncio.sleep(self.poll_interval_seconds)
            except asyncio.CancelledError:
                break


_worker: Optional[InterventionWorker] = None


def get_intervention_worker() -> InterventionWorker:
    global _worker
    if _worker is None:
        _worker = InterventionWorker()
    return _worker


def start_intervention_worker() -> None:
    worker = get_intervention_worker()
    worker.start()


async def stop_intervention_worker() -> None:
    global _worker
    if _worker:
        await _worker.stop()
        _worker = None
