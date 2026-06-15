import './MatchFilter.css'

/**
 * Slider filter for minimum relative match percentage (0–100).
 * Sits below the category filter on the map view.
 */
export default function MatchFilter({ minMatchPercent, onChange, visibleCount, totalCount }) {
  return (
    <div className="match-filter">
      <div className="match-filter__header">
        <span className="match-filter__title">Match percentage above</span>
        <span className="match-filter__value">{minMatchPercent}%</span>
      </div>
      <input
        type="range"
        className="match-filter__slider"
        min={40}
        max={100}
        step={5}
        value={minMatchPercent}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Minimum match percentage"
      />
      <p className="match-filter__hint">
        Showing {visibleCount} of {totalCount} places
      </p>
    </div>
  )
}
