import { useMemo, useState, useEffect, useCallback } from 'react'
import { useAuth, useUser } from '@clerk/clerk-react'
import { Pencil } from 'lucide-react'
import Landing from './components/Landing'
import Onboarding from './components/Onboarding'
import PlacesMap from './components/Map'
import CitySearch from './components/CitySearch'
import CityPicker from './components/CityPicker'
import CategoryFilter from './components/CategoryFilter'
import MatchFilter from './components/MatchFilter'
import SavedPlaces from './components/SavedPlaces'
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
import './components/Map.css'

const API = import.meta.env.VITE_API_URL

export default function App() {
  const { isSignedIn, isLoaded: authLoaded, getToken } = useAuth()
  const { user, isLoaded: userLoaded } = useUser()

  const [showLanding, setShowLanding] = useState(true)
  const [userProfile, setUserProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [places, setPlaces] = useState([])
  const [placesCache, setPlacesCache] = useState([])
  const [city, setCity] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [activeCategories, setActiveCategories] = useState(new Set())
  const [minMatchPercent, setMinMatchPercent] = useState(0)
  const [savedPlaces, setSavedPlaces] = useState([])
  const [savedPlacesOpen, setSavedPlacesOpen] = useState(false)
  const [onboardingAnswers, setOnboardingAnswers] = useState([])
  const [editingProfile, setEditingProfile] = useState(false)
  const [mapKey, setMapKey] = useState(0)

  const savedPlaceIds = useMemo(
    () => new Set(savedPlaces.map((entry) => entry.place_id)),
    [savedPlaces],
  )

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

  const loadSavedPlaces = useCallback(async () => {
    try {
      const token = await getToken()
      const res = await axios.get(`${API}/saved/load`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setSavedPlaces(res.data.places ?? [])
    } catch (err) {
      console.warn('Could not load saved places:', err)
    }
  }, [getToken])

  useEffect(() => {
    if (!authLoaded || !userLoaded || !isSignedIn || !user) {
      setProfileLoading(false)
      return
    }

    const loadProfile = async () => {
      setProfileLoading(true)
      try {
        const token = await getToken()
        const [profileRes] = await Promise.all([
          axios.get(`${API}/profile/load`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          loadSavedPlaces(),
        ])
        if (profileRes.data.profile && profileRes.data.embedding) {
          setUserProfile({
            profile: profileRes.data.profile,
            embedding: profileRes.data.embedding,
          })
          if (Array.isArray(profileRes.data.answers)) {
            setOnboardingAnswers(profileRes.data.answers)
          }
          localStorage.setItem('profile_summary', profileRes.data.profile.summary)
          setShowLanding(false)
        }
      } catch (err) {
        console.warn('Could not load profile:', err)
      } finally {
        setProfileLoading(false)
      }
    }

    loadProfile()
  }, [authLoaded, userLoaded, isSignedIn, user, getToken, loadSavedPlaces])

  useEffect(() => {
    if (!isSignedIn) {
      setUserProfile(null)
      setOnboardingAnswers([])
      setEditingProfile(false)
      setSavedPlaces([])
      setCity(null)
      setPlaces([])
      setPlacesCache([])
      setShowLanding(true)
    }
  }, [isSignedIn])

  useEffect(() => {
    if (!showLanding || !isSignedIn || !authLoaded || profileLoading) return
    setShowLanding(false)
  }, [showLanding, isSignedIn, authLoaded, profileLoading])

  const handleGetStarted = () => {
    setShowLanding(false)
  }

  const handleProfileComplete = async (data) => {
    const wasEditing = editingProfile
    try {
      const token = await getToken()
      await axios.post(
        `${API}/profile/save`,
        {
          profile: data.profile,
          embedding: data.embedding,
          answers: data.answers ?? null,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      )
    } catch (err) {
      console.warn('Could not save profile:', err)
    }
    setUserProfile({ profile: data.profile, embedding: data.embedding })
    if (Array.isArray(data.answers)) {
      setOnboardingAnswers(data.answers)
    }
    localStorage.setItem('profile_summary', data.profile.summary)
    setEditingProfile(false)

    if (wasEditing && city) {
      setMapKey((key) => key + 1)
      await loadPlaces(data.embedding, city)
    }
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
      const token = await getToken()
      const res = await axios.post(
        `${API}/score`,
        { lat: targetCity.lat, lon: targetCity.lon, user_embedding: embedding },
        { headers: { Authorization: `Bearer ${token}` } },
      )
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

  const handleFeedback = async (newEmbedding) => {
    const rescored = rescorePlaces(newEmbedding, placesCache)
    applyScoredPlaces(rescored, newEmbedding)

    getToken().then((token) => {
      axios
        .post(
          `${API}/profile/feedback`,
          { embedding: newEmbedding },
          { headers: { Authorization: `Bearer ${token}` } },
        )
        .catch((err) => console.warn('Could not persist feedback embedding:', err))
    })
  }

  const handleToggleSave = async (place) => {
    const isSaved = savedPlaceIds.has(place.id)

    try {
      const token = await getToken()

      if (isSaved) {
        await axios.post(
          `${API}/saved/remove`,
          { place_id: place.id },
          { headers: { Authorization: `Bearer ${token}` } },
        )
        setSavedPlaces((prev) =>
          prev.filter((entry) => entry.place_id !== place.id),
        )
      } else {
        await axios.post(
          `${API}/saved/add`,
          {
            place,
            city_name: city?.name ?? null,
          },
          { headers: { Authorization: `Bearer ${token}` } },
        )
        setSavedPlaces((prev) => [
          {
            place_id: place.id,
            place,
            city_name: city?.name ?? null,
            saved_at: new Date().toISOString(),
          },
          ...prev.filter((entry) => entry.place_id !== place.id),
        ])
      }
    } catch (err) {
      console.warn('Could not update saved place:', err)
      throw err
    }
  }

  const handleRemoveSaved = async (placeId) => {
    try {
      const token = await getToken()
      await axios.post(
        `${API}/saved/remove`,
        { place_id: placeId },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      setSavedPlaces((prev) => prev.filter((entry) => entry.place_id !== placeId))
    } catch (err) {
      console.warn('Could not remove saved place:', err)
    }
  }

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
    return (
      <Landing
        isSignedIn={isSignedIn}
        onGetStarted={handleGetStarted}
      />
    )
  }

  if (!isSignedIn) {
    return (
      <Landing
        isSignedIn={false}
        onGetStarted={handleGetStarted}
      />
    )
  }

  if (profileLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p>Loading…</p>
      </div>
    )
  }

  if (!userProfile || editingProfile) {
    return (
      <Onboarding
        onComplete={handleProfileComplete}
        getToken={getToken}
        initialAnswers={editingProfile ? onboardingAnswers : []}
        mode={editingProfile ? 'edit' : 'create'}
        onCancel={editingProfile ? () => setEditingProfile(false) : undefined}
      />
    )
  }

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
        <SavedPlaces
          savedPlaces={savedPlaces}
          isOpen={savedPlacesOpen}
          onToggleOpen={() => setSavedPlacesOpen((open) => !open)}
          onRemove={handleRemoveSaved}
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
            top: 90,
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
      <button
        type="button"
        className="edit-profile-btn"
        onClick={() => setEditingProfile(true)}
      >
        <Pencil size={16} aria-hidden />
        <span>Edit taste profile</span>
      </button>
      <PlacesMap
        key={mapKey}
        places={filteredPlaces}
        allPlaces={places}
        center={[city.lat, city.lon]}
        userEmbedding={userProfile.embedding}
        onFeedback={handleFeedback}
        getToken={getToken}
        savedPlaceIds={savedPlaceIds}
        onToggleSave={handleToggleSave}
        relativeScores={relativeScores}
      />
    </div>
  )
}
