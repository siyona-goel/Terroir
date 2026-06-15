import { useMemo, useState, useEffect } from 'react'
import { SignedIn, SignedOut, SignInButton, useAuth, useUser } from '@clerk/clerk-react'
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

function AuthedApp() {
  const { user, isLoaded } = useUser()
  const { getToken } = useAuth()

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

  useEffect(() => {
    if (!isLoaded || !user) return

    const loadProfile = async () => {
      try {
        const token = await getToken()
        const res = await axios.get(`${API}/profile/load`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.data.profile && res.data.embedding) {
          setUserProfile({ profile: res.data.profile, embedding: res.data.embedding })
          localStorage.setItem('profile_summary', res.data.profile.summary)
          setShowLanding(false)
        }
      } catch (err) {
        console.warn('Could not load profile:', err)
      } finally {
        setProfileLoading(false)
      }
    }

    loadProfile()
  }, [isLoaded, user])

  const handleProfileComplete = async (data) => {
    try {
      const token = await getToken()
      await axios.post(
        `${API}/profile/save`,
        { profile: data.profile, embedding: data.embedding },
        { headers: { Authorization: `Bearer ${token}` } },
      )
    } catch (err) {
      console.warn('Could not save profile:', err)
    }
    setUserProfile(data)
    localStorage.setItem('profile_summary', data.profile.summary)
  }

  const handleEditProfile = () => {
    setUserProfile(null)
    setPlaces([])
    setPlacesCache([])
    setCity(null)
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

  const handleCitySelect = (newCity) => {
    setCity(newCity)
    setActiveCategories(new Set())
    setMinMatchPercent(0)
    setPlacesCache([])
    if (userProfile) {
      loadPlaces(userProfile.embedding, newCity)
    }
  }

  if (profileLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p>Loading…</p>
      </div>
    )
  }

  if (showLanding) {
    return <Landing onGetStarted={() => setShowLanding(false)} />
  }

  if (!userProfile) {
    return <Onboarding onComplete={handleProfileComplete} getToken={getToken} />
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
      </div>
      {/* <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 1000,
        }}
      >
        <button
          type="button"
          onClick={handleEditProfile}
          style={{ fontSize: '0.75rem', opacity: 0.75 }}
        >
          Edit taste profile
        </button>
      </div> */}
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
      <PlacesMap
        places={filteredPlaces}
        center={[city.lat, city.lon]}
        userEmbedding={userProfile.embedding}
        onFeedback={handleFeedback}
        getToken={getToken}
        relativeScores={relativeScores}
      />
    </div>
  )
}

export default function App() {
  return (
    <>
      <SignedOut>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: '1rem',
            textAlign: 'center',
            padding: '1rem',
          }}
        >
          <h1 style={{ margin: 0 }}>Terroir</h1>
          <p style={{ margin: 0, color: 'var(--text-muted, #666)' }}>
            Discover places that match your taste, wherever you go.
          </p>
          <SignInButton mode="modal">
            <button type="button">Sign in to get started</button>
          </SignInButton>
        </div>
      </SignedOut>
      <SignedIn>
        <AuthedApp />
      </SignedIn>
    </>
  )
}
