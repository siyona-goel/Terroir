import { useMemo, useState } from 'react'
import Landing from './components/Landing'
import Onboarding from './components/Onboarding'
import PlacesMap from './components/Map'
import CitySearch from './components/CitySearch'
import CityPicker from './components/CityPicker'
import CategoryFilter from './components/CategoryFilter'
import MatchFilter from './components/MatchFilter'
import axios from 'axios'
import {
  filterPlacesByCategory,
  getPlaceCategories,
  PLACE_CATEGORIES,
} from './utils/placeCategories'
import {
  buildRelativeScoreMap,
  filterPlacesByMatchPercent,
} from './utils/matchScores'
import { rescorePlaces, stripEmbeddings } from './utils/rescorePlaces'

const API = import.meta.env.VITE_API_URL

export default function App() {
  const [showLanding, setShowLanding] = useState(true)
  const [userProfile, setUserProfile] = useState(null)
  const [places, setPlaces] = useState([])
  const [placesCache, setPlacesCache] = useState([])
  // No default city — set only after onboarding city picker or map search
  const [city, setCity] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [activeCategories, setActiveCategories] = useState(new Set())
  const [minMatchPercent, setMinMatchPercent] = useState(0)

  const relativeScores = useMemo(() => buildRelativeScoreMap(places), [places])

  const categoryFilteredPlaces = useMemo(
    () => filterPlacesByCategory(places, activeCategories),
    [places, activeCategories],
  )

  const filteredPlaces = useMemo(
    () =>
      filterPlacesByMatchPercent(
        categoryFilteredPlaces,
        minMatchPercent,
        relativeScores,
      ),
    [categoryFilteredPlaces, minMatchPercent, relativeScores],
  )

  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(
      PLACE_CATEGORIES.map(({ id }) => [id, 0]),
    )
    for (const place of places) {
      for (const cat of getPlaceCategories(place)) {
        counts[cat] = (counts[cat] || 0) + 1
      }
    }
    return counts
  }, [places])

  /** Profile only — city selection and map load happen in handleCitySelect. */
  const handleProfileComplete = (data) => {
    setUserProfile(data)
    localStorage.setItem('profile_summary', data.profile.summary)
  }

  const applyScoredPlaces = (scoredWithEmbeddings, embedding) => {
    setPlacesCache(scoredWithEmbeddings)
    setPlaces(stripEmbeddings(scoredWithEmbeddings))
    setUserProfile((prev) =>
      prev ? { ...prev, embedding } : prev,
    )
  }

  const loadPlaces = async (embedding, targetCity) => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await axios.post(`${API}/score`, {
        lat: targetCity.lat,
        lon: targetCity.lon,
        user_embedding: embedding,
      })
      applyScoredPlaces(res.data, embedding)
    } catch (err) {
      const detail = err.response?.data?.detail
      setLoadError(
        typeof detail === 'string'
          ? detail
          : 'Could not load places. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  const handleFeedback = (newEmbedding) => {
    const rescored = rescorePlaces(newEmbedding, placesCache)
    applyScoredPlaces(rescored, newEmbedding)
  }

  /** First city after onboarding, or changing city from the map search bar. */
  const handleCitySelect = (newCity) => {
    setCity(newCity)
    setActiveCategories(new Set())
    setMinMatchPercent(0)
    setPlacesCache([])
    if (userProfile) {
      loadPlaces(userProfile.embedding, newCity)
    }
  }

  if (showLanding) {
    return <Landing onGetStarted={() => setShowLanding(false)} />
  }

  if (!userProfile) {
    return <Onboarding onComplete={handleProfileComplete} />
  }

  // Taste profile ready — ask for city before showing the map
  if (!city) {
    return (
      <CityPicker onCitySelect={handleCitySelect} loading={loading} />
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
        }}
      >
        <CitySearch onCitySelect={handleCitySelect} />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <CategoryFilter
          activeCategories={activeCategories}
          onChange={setActiveCategories}
          placeCounts={categoryCounts}
        />
        <MatchFilter
          minMatchPercent={minMatchPercent}
          onChange={setMinMatchPercent}
          visibleCount={filteredPlaces.length}
          totalCount={places.length}
        />
      </div>
      {loadError && (
        <div
          style={{
            position: 'absolute',
            top: 60,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            padding: '0.5rem 1rem',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: 'var(--shadow)',
            maxWidth: 420,
            textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 0.5rem' }}>{loadError}</p>
          <button
            type="button"
            onClick={() => loadPlaces(userProfile.embedding, city)}
          >
            Retry
          </button>
        </div>
      )}
      {loading && !loadError && (
        <div
          style={{
            position: 'absolute',
            top: 60,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            padding: '0.5rem 1rem',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: 'var(--shadow)',
          }}
        >
          Scoring places…
        </div>
      )}
      <PlacesMap
        places={filteredPlaces}
        center={[city.lat, city.lon]}
        userEmbedding={userProfile.embedding}
        onFeedback={handleFeedback}
        relativeScores={relativeScores}
      />
    </div>
  )
}
