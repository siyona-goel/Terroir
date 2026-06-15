import { Bookmark, X } from 'lucide-react'
import './SavedPlaces.css'

export default function SavedPlaces({
  savedPlaces,
  isOpen,
  onToggleOpen,
  onRemove,
}) {
  const count = savedPlaces.length

  return (
    <>
      <button
        type="button"
        className="saved-places-btn"
        onClick={onToggleOpen}
        aria-expanded={isOpen}
      >
        <Bookmark size={16} aria-hidden />
        <span>Saved places</span>
        {count > 0 && (
          <span className="saved-places-btn__count">{count}</span>
        )}
      </button>

      {isOpen && (
        <div
          className="saved-places-modal__backdrop"
          onClick={onToggleOpen}
          role="presentation"
        >
          <div
            className="saved-places-modal"
            role="dialog"
            aria-labelledby="saved-places-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="saved-places-modal__header">
              <h2 id="saved-places-title" className="saved-places-modal__title">
                Saved places
              </h2>
              <button
                type="button"
                className="saved-places-modal__close"
                onClick={onToggleOpen}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </header>

            {count === 0 ? (
              <p className="saved-places-modal__empty">
                No saved places yet. Click a spot on the map and tap
                &ldquo;Save place&rdquo; to add it here.
              </p>
            ) : (
              <ul className="saved-places-modal__list">
                {savedPlaces.map((entry) => {
                  const place = entry.place
                  return (
                    <li key={entry.place_id} className="saved-places-modal__item">
                      <div className="saved-places-modal__item-body">
                        <strong>{place.name || 'Unnamed place'}</strong>
                        {entry.city_name && (
                          <span className="saved-places-modal__city">
                            {entry.city_name}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="saved-places-modal__remove"
                        onClick={() => onRemove(entry.place_id)}
                        aria-label={`Remove ${place.name || 'place'}`}
                      >
                        Remove
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  )
}
