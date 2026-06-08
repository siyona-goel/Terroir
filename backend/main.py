import json
import logging
import os

from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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


@app.get("/health")
def health():
    """Lightweight probe — no models loaded; Render can bind $PORT immediately."""
    return {"status": "ok"}


class ProfileRequest(BaseModel):
    text: str


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


@app.post("/feedback")
def apply_feedback(req: FeedbackRequest):
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
def score_city(req: ScoreRequest):
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
def create_profile(req: ProfileRequest):
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
