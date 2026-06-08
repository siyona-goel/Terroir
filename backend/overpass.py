import hashlib
import json
import logging
import time
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    # "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]
USER_AGENT = "Terroir/1.0 (https://github.com/siyona-goel/Terroir; dev)"
CACHE_DIR = Path(__file__).resolve().parent / "cache"
REQUEST_TIMEOUT = 60
MAX_RETRIES_PER_URL = 2


class OverpassError(RuntimeError):
    """Raised when all Overpass API endpoints fail."""

# These tag categories capture interesting places for a taste profile
PLACE_QUERIES = [
    'node["amenity"~"bar|cafe|restaurant|cinema|theatre|library|music_venue"]',
    'node["leisure"~"park|garden|sports_centre|fitness_centre|swimming_pool"]',
    'node["shop"~"books|music|art|records|vintage|antiques"]',
    'node["tourism"~"museum|gallery|attraction|artwork"]',
]


def fetch_places(lat, lon, radius_m=3000):
    """
    Fetch places within radius_m meters of (lat, lon).
    Results are cached locally so you don't hammer the API during dev.
    """
    cache_key = hashlib.md5(f"{lat},{lon},{radius_m}".encode()).hexdigest()
    cache_path = CACHE_DIR / f"{cache_key}.json"

    if cache_path.exists():
        with open(cache_path, encoding="utf-8") as f:
            return json.load(f)

    union_parts = "\n".join(
        f'  {q}(around:{radius_m},{lat},{lon});'
        for q in PLACE_QUERIES
    )
    query = f"""
    [out:json][timeout:25];
    (
    {union_parts}
    );
    out body;
    """

    elements = _query_overpass(query)

    # Filter: only keep places that have a name
    places = [e for e in elements if e.get("tags", {}).get("name")]

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(places, f)

    return places


def _query_overpass(query: str) -> list:
    """Try each Overpass mirror with retries before giving up."""
    errors: list[str] = []

    for url in OVERPASS_URLS:
        for attempt in range(MAX_RETRIES_PER_URL):
            try:
                resp = requests.post(
                    url,
                    data={"data": query},
                    headers={"User-Agent": USER_AGENT},
                    timeout=REQUEST_TIMEOUT,
                )
                resp.raise_for_status()
                return resp.json().get("elements", [])
            except requests.RequestException as exc:
                msg = f"{url} (attempt {attempt + 1}): {exc}"
                logger.warning("Overpass request failed: %s", msg)
                errors.append(msg)
                if attempt + 1 < MAX_RETRIES_PER_URL:
                    time.sleep(1.5 * (attempt + 1))

    raise OverpassError(
        "Could not fetch places from OpenStreetMap. "
        "The Overpass API may be temporarily overloaded — please try again in a moment. "
        f"Details: {'; '.join(errors)}"
    )


def tags_to_text(tags: dict) -> str:
    """
    Convert OSM tags into a readable sentence for embedding.
    Example: {"amenity": "bar", "music": "jazz", "name": "Blue Note"}
    → "A bar called Blue Note. Cuisine: italian. Music: jazz."
    """
    parts = []
    name = tags.get("name", "unnamed place")
    amenity = tags.get(
        "amenity",
        tags.get("leisure", tags.get("tourism", tags.get("shop", ""))),
    )
    cuisine = tags.get("cuisine", "")
    music = tags.get("music", "")
    opening_hours = tags.get("opening_hours", "")
    description = tags.get("description", "")
    outdoor_seating = tags.get("outdoor_seating", "")

    parts.append(f"A {amenity} called {name}.")
    if cuisine:
        parts.append(f"Cuisine: {cuisine}.")
    if music:
        parts.append(f"Music: {music}.")
    if outdoor_seating == "yes":
        parts.append("Has outdoor seating.")
    if description:
        parts.append(description)

    return " ".join(parts)
