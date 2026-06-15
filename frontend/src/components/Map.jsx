import { useMemo, useState } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, CircleMarker, Marker, Popup } from 'react-leaflet'
import { Bookmark, ThumbsUp, ThumbsDown } from 'lucide-react'
import axios from 'axios'
import {
  getPlaceCategories,
  PLACE_CATEGORIES,
} from '../utils/placeCategories'
import { buildRelativeScoreMap } from '../utils/matchScores'
import 'leaflet/dist/leaflet.css'
import './Map.css'

const API = import.meta.env.VITE_API_URL

const CATEGORY_LABELS = Object.fromEntries(
  PLACE_CATEGORIES.map(({ id, label }) => [id, label]),
)

const SAVED_STAR_ICON = L.divIcon({
  className: 'saved-star-marker',
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="#2563eb" stroke="#1d4ed8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
})

/** Map a 0–1 relative score (best=1, worst=0 in this batch) to marker style. */
function scoreToStyle(relativeScore) {
  if (relativeScore >= 0.65) return { color: '#9e3c39', radius: 10, opacity: 0.90 }
  if (relativeScore >= 0.50) return { color: '#d19c4d', radius: 7, opacity: 0.75 }
  if (relativeScore >= 0.40) return { color: '#857272', radius: 5, opacity: 0.55 }
  return null
}

const DEFAULT_STYLE = { color: '#857272', radius: 8, opacity: 0.7 }

function PlacePopup({
  place,
  relative,
  reasons,
  votes,
  feedbackLoading,
  savedPlaceIds,
  saveLoading,
  onSubmitFeedback,
  onToggleSave,
  userEmbedding,
  onFeedback,
}) {
  const scored = relative != null
  const isSaved = savedPlaceIds.has(place.id)

  return (
    <Popup>
      <strong>{place.name}</strong>
      {getPlaceCategories(place).length > 0 && (
        <>
          <br />
          <span style={{ fontSize: '0.85em', opacity: 0.85 }}>
            {getPlaceCategories(place)
              .map((id) => CATEGORY_LABELS[id] || id)
              .join(' · ')}
          </span>
        </>
      )}
      {scored && (
        <>
          <br />
          Match: {Math.round(relative * 100)}%
          <br />
          {reasons[place.id] ? (
            <em>{reasons[place.id]}</em>
          ) : (
            <span>Loading match reason…</span>
          )}
          {onToggleSave && (
            <div className="popup-save">
              <button
                type="button"
                className={`popup-save__btn${isSaved ? ' popup-save__btn--active' : ''}`}
                disabled={saveLoading === place.id}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleSave(place)
                }}
              >
                <Bookmark size={14} aria-hidden />
                {isSaved ? 'Saved' : 'Save place'}
              </button>
            </div>
          )}
          {onFeedback && userEmbedding && (
            <div className="popup-feedback">
              <button
                type="button"
                className={`popup-feedback__btn${votes[place.id] === 'thumbs_up' ? ' popup-feedback__btn--active' : ''}`}
                disabled={feedbackLoading === place.id}
                onClick={(e) => {
                  e.stopPropagation()
                  onSubmitFeedback(place, 'thumbs_up')
                }}
                title="More like this"
                aria-label="Thumbs up"
              >
                <ThumbsUp size={16} />
              </button>
              <button
                type="button"
                className={`popup-feedback__btn${votes[place.id] === 'thumbs_down' ? ' popup-feedback__btn--active' : ''}`}
                disabled={feedbackLoading === place.id}
                onClick={(e) => {
                  e.stopPropagation()
                  onSubmitFeedback(place, 'thumbs_down')
                }}
                title="Less like this"
                aria-label="Thumbs down"
              >
                <ThumbsDown size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </Popup>
  )
}

export default function PlacesMap({
  places = [],
  allPlaces = [],
  center = [51.5074, -0.1278],
  userEmbedding,
  onFeedback,
  getToken,
  savedPlaceIds = new Set(),
  onToggleSave,
  /** Full-batch relative scores so popup % matches the match filter slider. */
  relativeScores: relativeScoresProp,
}) {
  const [reasons, setReasons] = useState({})
  const [votes, setVotes] = useState({})
  const [feedbackLoading, setFeedbackLoading] = useState(null)
  const [saveLoading, setSaveLoading] = useState(null)
  const relativeScoresFromPlaces = useMemo(
    () => buildRelativeScoreMap(places),
    [places],
  )
  const relativeScores = relativeScoresProp ?? relativeScoresFromPlaces

  const allPlacesById = useMemo(
    () => new Map(allPlaces.map((place) => [place.id, place])),
    [allPlaces],
  )

  const fetchReason = async (place) => {
    if (reasons[place.id]) return
    const profileSummary = localStorage.getItem('profile_summary')
    if (!profileSummary) return

    try {
      const res = await axios.post(`${API}/reason`, {
        place_description: place.description,
        profile_summary: profileSummary,
      })
      setReasons((prev) => ({ ...prev, [place.id]: res.data.reason }))
    } catch {
      setReasons((prev) => ({
        ...prev,
        [place.id]: 'Could not load match reason.',
      }))
    }
  }

  const submitFeedback = async (place, vote) => {
    if (!userEmbedding || !onFeedback || feedbackLoading === place.id) return

    setFeedbackLoading(place.id)
    try {
      const token = getToken ? await getToken() : null
      const res = await axios.post(
        `${API}/feedback`,
        {
          user_embedding: userEmbedding,
          place_description: place.description,
          vote,
        },
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
      )
      setVotes((prev) => ({ ...prev, [place.id]: vote }))
      onFeedback(res.data.embedding)
    } catch {
      setVotes((prev) => {
        const next = { ...prev }
        delete next[place.id]
        return next
      })
    } finally {
      setFeedbackLoading(null)
    }
  }

  const handleToggleSave = async (place) => {
    if (!onToggleSave || saveLoading === place.id) return
    setSaveLoading(place.id)
    try {
      await onToggleSave(place)
    } finally {
      setSaveLoading(null)
    }
  }

  const popupProps = {
    reasons,
    votes,
    feedbackLoading,
    savedPlaceIds,
    saveLoading,
    onSubmitFeedback: submitFeedback,
    onToggleSave: onToggleSave ? handleToggleSave : null,
    userEmbedding,
    onFeedback,
  }

  return (
    <MapContainer
      center={center}
      zoom={14}
      style={{ height: '100vh', width: '100%' }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap contributors"
      />
      {places.map((place) => {
        if (savedPlaceIds.has(place.id)) return null

        const relative = relativeScores.get(place.id)
        const style =
          relative != null ? scoreToStyle(relative) : DEFAULT_STYLE
        if (!style) return null

        const scored = relative != null

        return (
          <CircleMarker
            key={place.id}
            center={[place.lat, place.lon]}
            radius={style.radius}
            fillColor={style.color}
            color={style.color}
            fillOpacity={style.opacity}
            stroke={false}
            eventHandlers={
              scored ? { click: () => fetchReason(place) } : undefined
            }
          >
            <PlacePopup
              place={place}
              relative={relative}
              {...popupProps}
            />
          </CircleMarker>
        )
      })}
      {[...savedPlaceIds].map((placeId) => {
        const place = allPlacesById.get(placeId)
        if (!place) return null

        const relative = relativeScores.get(place.id)
        const scored = relative != null

        return (
          <Marker
            key={`saved-${place.id}`}
            position={[place.lat, place.lon]}
            icon={SAVED_STAR_ICON}
            eventHandlers={
              scored ? { click: () => fetchReason(place) } : undefined
            }
          >
            <PlacePopup
              place={place}
              relative={relative}
              {...popupProps}
            />
          </Marker>
        )
      })}
    </MapContainer>
  )
}
