import { useEffect, useState } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet'
import {
  LANDING_DEMO_PLACES,
  LANDING_MAP_CENTER,
  LANDING_MAP_ZOOM,
} from '../data/landingDemoPlaces'
import 'leaflet/dist/leaflet.css'
import './Landing.css'

const MARKER_REVEAL_MS = 650
const CURSOR_DWELL_MS = 2600

const CURSOR_W = 24
const CURSOR_H = 24
const VIEWPORT_PAD = 16
const TOOLTIP_OFFSET_X = 18
const TOOLTIP_OFFSET_Y = 8
/** Estimated tooltip size for flip/clamp (max-width 14rem + padding). */
const TOOLTIP_W = 230
const TOOLTIP_H = 88

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
function tooltipPosition(cursorX, cursorY, width, height) {
  const roomAbove = cursorY - TOOLTIP_OFFSET_Y - TOOLTIP_H
  const roomBelow = height - cursorY - TOOLTIP_OFFSET_Y - TOOLTIP_H
  const placeAbove = roomAbove >= VIEWPORT_PAD || roomAbove >= roomBelow

  let left = cursorX + TOOLTIP_OFFSET_X
  let top = placeAbove
    ? cursorY - TOOLTIP_OFFSET_Y
    : cursorY + TOOLTIP_OFFSET_Y + CURSOR_H

  if (left + TOOLTIP_W > width - VIEWPORT_PAD) {
    left = cursorX - TOOLTIP_W - TOOLTIP_OFFSET_X
  }
  left = Math.min(
    Math.max(left, VIEWPORT_PAD),
    width - TOOLTIP_W - VIEWPORT_PAD,
  )

  if (placeAbove) {
    top = Math.max(top - TOOLTIP_H, VIEWPORT_PAD)
  } else {
    top = Math.min(top, height - TOOLTIP_H - VIEWPORT_PAD)
  }

  return { left, top, placeAbove }
}

/** Keeps cursor + tooltip aligned with map pan/zoom and marker lat/lng. */
function LandingMapOverlay({ hoverIndex, visibleCount }) {
  const map = useMap()
  const [layout, setLayout] = useState(null)

  const activePlace =
    hoverIndex != null && hoverIndex < visibleCount
      ? LANDING_DEMO_PLACES[hoverIndex]
      : null

  useEffect(() => {
    if (!activePlace) {
      setLayout(null)
      return
    }

    const updatePosition = () => {
      const { x: width, y: height } = map.getSize()
      const raw = map.latLngToContainerPoint([
        activePlace.lat,
        activePlace.lon,
      ])
      const cursor = clampCursorPoint(raw.x, raw.y, width, height)
      const tooltip = tooltipPosition(cursor.x, cursor.y, width, height)
      setLayout({ cursor, tooltip })
    }

    updatePosition()
    map.on('move zoom resize viewreset', updatePosition)
    return () => {
      map.off('move zoom resize viewreset', updatePosition)
    }
  }, [map, activePlace])

  if (!layout || !activePlace) return null

  const { cursor, tooltip } = layout

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
        className={`landing-tooltip${tooltip.placeAbove ? ' landing-tooltip--above' : ' landing-tooltip--below'}`}
        style={{ left: tooltip.left, top: tooltip.top }}
      >
        <strong>{activePlace.name}</strong>
        <br />
        Match: {activePlace.match}%
        <br />
        <em>{activePlace.reason}</em>
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

export default function Landing({ onGetStarted }) {
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
        <button
          type="button"
          className="landing__cta"
          onClick={onGetStarted}
        >
          Get Started
        </button>
      </header>
    </div>
  )
}
