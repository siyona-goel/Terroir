import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
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

/** Map a 0–1 relative score (best=1, worst=0 in this batch) to marker style. */
function scoreToStyle(relativeScore) {
  if (relativeScore >= 0.65) return { color: '#9e3c39', radius: 10, opacity: 0.90 }
  if (relativeScore >= 0.50) return { color: '#d19c4d', radius: 7, opacity: 0.75 }
  if (relativeScore >= 0.40) return { color: '#857272', radius: 5, opacity: 0.55 }
  return null
}

const DEFAULT_STYLE = { color: '#857272', radius: 8, opacity: 0.7 }

export default function PlacesMap({
  places = [],
  center = [51.5074, -0.1278],
  userEmbedding,
  onFeedback,
  /** Full-batch relative scores so popup % matches the match filter slider. */
  relativeScores: relativeScoresProp,
}) {
  const [reasons, setReasons] = useState({})
  const [votes, setVotes] = useState({})
  const [feedbackLoading, setFeedbackLoading] = useState(null)
  const relativeScoresFromPlaces = useMemo(
    () => buildRelativeScoreMap(places),
    [places],
  )
  const relativeScores = relativeScoresProp ?? relativeScoresFromPlaces

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
      const res = await axios.post(`${API}/feedback`, {
        user_embedding: userEmbedding,
        place_description: place.description,
        vote,
      })
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
                  {onFeedback && userEmbedding && (
                    <div className="popup-feedback">
                      <button
                        type="button"
                        className={`popup-feedback__btn${votes[place.id] === 'thumbs_up' ? ' popup-feedback__btn--active' : ''}`}
                        disabled={feedbackLoading === place.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          submitFeedback(place, 'thumbs_up')
                        }}
                        title="More like this"
                        aria-label="Thumbs up"
                      >
                        👍
                      </button>
                      <button
                        type="button"
                        className={`popup-feedback__btn${votes[place.id] === 'thumbs_down' ? ' popup-feedback__btn--active' : ''}`}
                        disabled={feedbackLoading === place.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          submitFeedback(place, 'thumbs_down')
                        }}
                        title="Less like this"
                        aria-label="Thumbs down"
                      >
                        👎
                      </button>
                    </div>
                  )}
                </>
              )}
            </Popup>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
