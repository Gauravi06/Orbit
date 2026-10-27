from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import auth, tasks, schedules, preferences, notes, interventions
from app.core.config import settings
from app.services.intervention_worker import start_intervention_worker, stop_intervention_worker

@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.intervention_worker_enabled:
        start_intervention_worker()
    try:
        yield
    finally:
        await stop_intervention_worker()

app = FastAPI(title="Orbit API", lifespan=lifespan)

cors_origins_list = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(tasks.router)
app.include_router(schedules.router)
app.include_router(preferences.router)
app.include_router(notes.router)
app.include_router(interventions.router)

@app.get("/health")
def health_check():
    return {"status": "ok"}