import json
import logging
import os
from datetime import datetime, timezone
from typing import Literal

from clerk_backend_api import AuthenticateRequestOptions, authenticate_request
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client

from embeddings import embed, embed_batch
from llm import extract_profile, generate_match_reason
from overpass import OverpassError, fetch_places, tags_to_text
from scoring import score_places, update_embedding_from_feedback

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_default_origins = "http://localhost:5173,http://127.0.0.1:5173"
_cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", _default_origins).split(",")
    if origin.strip()
]

app = FastAPI(title="Terroir API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

CLERK_SECRET_KEY = os.environ["CLERK_SECRET_KEY"]


def _normalize_supabase_url(url: str) -> str:
    """Strip trailing /rest/v1 so create_client does not double the path."""
    return url.rstrip("/").removesuffix("/rest/v1")


supabase = create_client(
    _normalize_supabase_url(os.environ["SUPABASE_URL"]),
    os.environ["SUPABASE_SERVICE_KEY"],
)


async def get_current_user(request: Request) -> str:
    state = authenticate_request(
        request,
        AuthenticateRequestOptions(
            secret_key=CLERK_SECRET_KEY,
            authorized_parties=_cors_origins,
            accepts_token=["session_token"],
        ),
    )
    if not state.is_signed_in:
        reason = state.reason
        detail = str(reason) if reason is not None else "Token verification failed"
        raise HTTPException(status_code=401, detail=detail)

    user_id = state.payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="No user ID in verified token")

    return user_id


@app.get("/health")
def health():
    """Lightweight probe — no models loaded; Render can bind $PORT immediately."""
    return {"status": "ok"}


class ProfileRequest(BaseModel):
    text: str


class ProfileSaveRequest(BaseModel):
    profile: dict
    embedding: list[float]
    answers: list[str] | None = None


class ProfileFeedbackRequest(BaseModel):
    embedding: list[float]


class ScoreRequest(BaseModel):
    lat: float
    lon: float
    radius: int = 3000
    user_embedding: list[float]


class ReasonRequest(BaseModel):
    place_description: str
    profile_summary: str


class FeedbackRequest(BaseModel):
    user_embedding: list[float]
    place_description: str
    vote: Literal["thumbs_up", "thumbs_down"]


class SavedPlaceRequest(BaseModel):
    place: dict
    city_name: str | None = None


class SavedPlaceRemoveRequest(BaseModel):
    place_id: int


@app.get("/saved/load")
async def load_saved_places(user_id: str = Depends(get_current_user)):
    try:
        result = (
            supabase.table("saved_places")
            .select("place_id, place, city_name, saved_at")
            .eq("user_id", user_id)
            .order("saved_at", desc=True)
            .execute()
        )
    except Exception as exc:
        logger.exception("Failed to load saved places for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not load saved places") from exc
    return {"places": result.data or []}


@app.post("/saved/add")
async def add_saved_place(req: SavedPlaceRequest, user_id: str = Depends(get_current_user)):
    place_id = req.place.get("id")
    if place_id is None:
        raise HTTPException(status_code=400, detail="Place must include an id")
    try:
        supabase.table("saved_places").upsert(
            {
                "user_id": user_id,
                "place_id": place_id,
                "place": req.place,
                "city_name": req.city_name,
                "saved_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="user_id,place_id",
        ).execute()
    except Exception as exc:
        logger.exception("Failed to save place for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not save place") from exc
    return {"success": True}


@app.post("/saved/remove")
async def remove_saved_place(req: SavedPlaceRemoveRequest, user_id: str = Depends(get_current_user)):
    try:
        supabase.table("saved_places").delete().eq("user_id", user_id).eq(
            "place_id", req.place_id
        ).execute()
    except Exception as exc:
        logger.exception("Failed to remove saved place for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not remove saved place") from exc
    return {"success": True}


@app.post("/profile/save")
async def save_profile(req: ProfileSaveRequest, user_id: str = Depends(get_current_user)):
    row = {
        "user_id": user_id,
        "profile": req.profile,
        "embedding": req.embedding,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if req.answers is not None:
        row["answers"] = req.answers
    try:
        supabase.table("profiles").upsert(
            row,
            on_conflict="user_id",
        ).execute()
    except Exception as exc:
        logger.exception("Failed to save profile for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not save profile") from exc
    return {"success": True}


@app.get("/profile/load")
async def load_profile(user_id: str = Depends(get_current_user)):
    try:
        result = (
            supabase.table("profiles")
            .select("profile, embedding, answers")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        logger.exception("Failed to load profile for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not load profile") from exc

    if result.data is None:
        return {"profile": None, "embedding": None, "answers": None}

    return {
        "profile": result.data["profile"],
        "embedding": result.data["embedding"],
        "answers": result.data.get("answers"),
    }


@app.post("/profile/feedback")
async def persist_feedback_embedding(req: ProfileFeedbackRequest, user_id: str = Depends(get_current_user)):
    try:
        supabase.table("profiles").update(
            {"embedding": req.embedding}
        ).eq("user_id", user_id).execute()
    except Exception as exc:
        logger.exception("Failed to persist feedback embedding for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not persist feedback embedding") from exc
    return {"success": True}


@app.post("/feedback")
async def apply_feedback(req: FeedbackRequest, user_id: str = Depends(get_current_user)):
    place_embedding = embed(req.place_description)
    thumbs_up = req.vote == "thumbs_up"
    new_embedding = update_embedding_from_feedback(
        req.user_embedding,
        place_embedding,
        thumbs_up,
    )
    return {"embedding": new_embedding}


@app.post("/reason")
def get_reason(req: ReasonRequest):
    try:
        reason = generate_match_reason(req.profile_summary, req.place_description)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"reason": reason}


@app.post("/score")
async def score_city(req: ScoreRequest, user_id: str = Depends(get_current_user)):
    try:
        raw_places = fetch_places(req.lat, req.lon, req.radius)
    except OverpassError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    places = [
        {
            "id": p["id"],
            "lat": p["lat"],
            "lon": p["lon"],
            "name": p["tags"].get("name"),
            "tags": p["tags"],
            "description": tags_to_text(p["tags"]),
        }
        for p in raw_places
        if "lat" in p and "lon" in p
    ]

    if not places:
        return []

    descriptions = [p["description"] for p in places]
    embeddings = embed_batch(descriptions)
    for place, emb in zip(places, embeddings):
        place["embedding"] = emb

    return score_places(req.user_embedding, places)


@app.post("/profile")
async def create_profile(req: ProfileRequest, user_id: str = Depends(get_current_user)):
    try:
        profile = extract_profile(req.text)
        profile_embedding = embed(profile["summary"])
    except (KeyError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        logger.exception("Profile creation failed")
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        "profile": profile,
        "embedding": profile_embedding,
    }


@app.get("/places")
def get_places(lat: float, lon: float, radius: int = 3000):
    try:
        places = fetch_places(lat, lon, radius)
    except OverpassError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [
        {
            "id": p["id"],
            "lat": p["lat"],
            "lon": p["lon"],
            "name": p["tags"].get("name"),
            "tags": p["tags"],
            "description": tags_to_text(p["tags"]),
        }
        for p in places
        if "lat" in p and "lon" in p
    ]
