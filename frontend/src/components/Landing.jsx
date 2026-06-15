import { SignInButton } from '@clerk/clerk-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet'
import { Bookmark, ThumbsUp, ThumbsDown } from 'lucide-react'
import {
  LANDING_DEMO_PLACES,
  LANDING_MAP_CENTER,
  LANDING_MAP_ZOOM,
} from '../data/landingDemoPlaces'
import 'leaflet/dist/leaflet.css'
import '../components/Map.css'
import './Landing.css'

const MARKER_REVEAL_MS = 650
const CURSOR_DWELL_MS = 2600

const CURSOR_W = 24
const CURSOR_H = 24
const VIEWPORT_PAD = 16
const TOOLTIP_OFFSET_X = 18
const TOOLTIP_OFFSET_Y = 8
/** Fallback tooltip size before first layout measure (max-width 14rem + padding). */
const TOOLTIP_W = 240
const TOOLTIP_H = 280

/** Fit map so every demo marker stays in view (prevents off-screen cursor targets). */
function FitLandingBounds() {
  const map = useMap()

  useEffect(() => {
    const bounds = L.latLngBounds(
      LANDING_DEMO_PLACES.map((p) => [p.lat, p.lon]),
    )
    map.fitBounds(bounds, {
      paddingTopLeft: [48, 48],
      paddingBottomRight: [48, 48],
      maxZoom: 13,
    })
  }, [map])

  return null
}

function clampCursorPoint(x, y, width, height) {
  return {
    x: Math.min(
      Math.max(x, VIEWPORT_PAD),
      width - CURSOR_W - VIEWPORT_PAD,
    ),
    y: Math.min(
      Math.max(y, VIEWPORT_PAD),
      height - CURSOR_H - VIEWPORT_PAD,
    ),
  }
}

/** Place tooltip beside cursor; flip above/below and left/right near edges. */
function tooltipPosition(
  cursorX,
  cursorY,
  width,
  height,
  tooltipW = TOOLTIP_W,
  tooltipH = TOOLTIP_H,
) {
  const pad = VIEWPORT_PAD
  const roomAbove = cursorY - TOOLTIP_OFFSET_Y - tooltipH
  const roomBelow =
    height - cursorY - TOOLTIP_OFFSET_Y - CURSOR_H - tooltipH
  const placeAbove =
    roomAbove >= pad && (roomBelow < pad || roomAbove >= roomBelow)

  let left = cursorX + TOOLTIP_OFFSET_X
  if (left + tooltipW > width - pad) {
    left = cursorX - tooltipW - TOOLTIP_OFFSET_X
  }
  left = Math.min(Math.max(left, pad), width - tooltipW - pad)

  let top
  if (placeAbove) {
    // `.landing-tooltip--above` anchors `top` to the tooltip's bottom edge.
    top = cursorY - TOOLTIP_OFFSET_Y
    top = Math.max(top, pad + tooltipH)
    top = Math.min(top, height - pad)
  } else {
    top = cursorY + TOOLTIP_OFFSET_Y + CURSOR_H
    top = Math.max(top, pad)
    top = Math.min(top, height - tooltipH - pad)
  }

  return { left, top, placeAbove }
}

function computeLandingOverlayLayout(map, place, tooltipEl) {
  const { x: width, y: height } = map.getSize()
  const raw = map.latLngToContainerPoint([place.lat, place.lon])
  const cursor = clampCursorPoint(raw.x, raw.y, width, height)
  const tooltipW = tooltipEl?.offsetWidth || TOOLTIP_W
  const tooltipH = tooltipEl?.offsetHeight || TOOLTIP_H
  const tooltip = tooltipPosition(
    cursor.x,
    cursor.y,
    width,
    height,
    tooltipW,
    tooltipH,
  )
  return { cursor, tooltip }
}

function LandingDemoPopup({ place }) {
  return (
    <>
      <strong>{place.name}</strong>
      {place.categories?.length > 0 && (
        <>
          <br />
          <span className="landing-tooltip__categories">
            {place.categories.join(' · ')}
          </span>
        </>
      )}
      <br />
      Match: {place.match}%
      <br />
      <em>{place.reason}</em>
      <div className="popup-save">
        <span
          className={`popup-save__btn${place.saved ? ' popup-save__btn--active' : ''}`}
        >
          <Bookmark size={14} aria-hidden />
          {place.saved ? 'Saved' : 'Save place'}
        </span>
      </div>
      <div className="popup-feedback">
        <span
          className={`popup-feedback__btn${place.vote === 'thumbs_up' ? ' popup-feedback__btn--active' : ''}`}
          title="More like this"
          aria-hidden
        >
          <ThumbsUp size={16} />
        </span>
        <span
          className={`popup-feedback__btn${place.vote === 'thumbs_down' ? ' popup-feedback__btn--active' : ''}`}
          title="Less like this"
          aria-hidden
        >
          <ThumbsDown size={16} />
        </span>
      </div>
    </>
  )
}

/** Keeps cursor + tooltip aligned with map pan/zoom and marker lat/lng. */
function LandingMapOverlay({ hoverIndex, visibleCount }) {
  const map = useMap()
  const tooltipRef = useRef(null)
  const [layout, setLayout] = useState(null)

  const activePlace =
    hoverIndex != null && hoverIndex < visibleCount
      ? LANDING_DEMO_PLACES[hoverIndex]
      : null

  useLayoutEffect(() => {
    if (!activePlace) {
      setLayout(null)
      return
    }

    const updatePosition = () => {
      setLayout(computeLandingOverlayLayout(map, activePlace, tooltipRef.current))
    }

    updatePosition()
    map.on('move zoom resize viewreset', updatePosition)
    return () => {
      map.off('move zoom resize viewreset', updatePosition)
    }
  }, [map, activePlace])

  useLayoutEffect(() => {
    if (!activePlace || !tooltipRef.current) return

    const el = tooltipRef.current
    const observer = new ResizeObserver(() => {
      setLayout(computeLandingOverlayLayout(map, activePlace, el))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [map, activePlace])

  if (!activePlace) return null

  const { cursor, tooltip } =
    layout ?? computeLandingOverlayLayout(map, activePlace, null)

  return (
    <div className="landing-map-overlay" aria-hidden>
      <div
        className="landing-cursor"
        style={{ left: cursor.x, top: cursor.y }}
      >
        <svg
          className="landing-cursor__icon"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M5.5 3.5L18 12L11 13.5L9 20L5.5 3.5Z"
            fill="var(--text-h)"
            stroke="var(--bg)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div
        ref={tooltipRef}
        className={`landing-tooltip${tooltip.placeAbove ? ' landing-tooltip--above' : ' landing-tooltip--below'}`}
        style={{ left: tooltip.left, top: tooltip.top }}
      >
        <LandingDemoPopup place={activePlace} />
      </div>
    </div>
  )
}

/** Animated background map: markers appear one-by-one; cursor tours visible markers. */
function LandingMapBackground({ visibleCount, hoverIndex }) {
  return (
    <div className="landing-map">
      <MapContainer
        center={LANDING_MAP_CENTER}
        zoom={LANDING_MAP_ZOOM}
        className="landing-map__container"
        zoomControl={false}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        touchZoom={false}
        boxZoom={false}
        keyboard={false}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitLandingBounds />
        {LANDING_DEMO_PLACES.map((place, index) =>
          index < visibleCount ? (
            <CircleMarker
              key={place.id}
              center={[place.lat, place.lon]}
              radius={place.radius}
              fillColor={place.color}
              color={place.color}
              fillOpacity={0.9}
              stroke={false}
              className="landing-map__marker"
            />
          ) : null,
        )}
        <LandingMapOverlay
          hoverIndex={hoverIndex}
          visibleCount={visibleCount}
        />
      </MapContainer>
    </div>
  )
}

export default function Landing({ isSignedIn, onGetStarted }) {
  const [visibleCount, setVisibleCount] = useState(0)
  const [hoverIndex, setHoverIndex] = useState(null)

  // Reveal preference markers one at a time
  useEffect(() => {
    if (visibleCount >= LANDING_DEMO_PLACES.length) return

    const timer = setTimeout(() => {
      setVisibleCount((c) => c + 1)
    }, MARKER_REVEAL_MS)

    return () => clearTimeout(timer)
  }, [visibleCount])

  // Loop cursor across visible markers (like hovering popups in the app)
  useEffect(() => {
    if (visibleCount === 0) {
      setHoverIndex(null)
      return
    }

    setHoverIndex(0)
    const tour = setInterval(() => {
      setHoverIndex((i) => ((i ?? 0) + 1) % visibleCount)
    }, CURSOR_DWELL_MS)

    return () => clearInterval(tour)
  }, [visibleCount])

  const ctaButton = (
    <button
      type="button"
      className="landing__cta"
      onClick={isSignedIn ? onGetStarted : undefined}
    >
      {isSignedIn ? 'Get started' : 'Sign in to get started'}
    </button>
  )

  return (
    <div className="landing">
      <LandingMapBackground
        visibleCount={visibleCount}
        hoverIndex={hoverIndex}
      />

      <div className="landing__scrim" aria-hidden />

      <header className="landing__hero">
        <p className="landing__eyebrow">Your taste, any city</p>
        <h1 className="landing__title">Terroir</h1>
        <p className="landing__tagline">
          Answer a few questions about what you love. We create a living map of
          places scored to match your taste, anywhere in the world.
        </p>
        {isSignedIn ? (
          ctaButton
        ) : (
          <SignInButton mode="modal">{ctaButton}</SignInButton>
        )}
      </header>
    </div>
  )
}
