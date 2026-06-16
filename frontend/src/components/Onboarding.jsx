import { useState } from 'react'
import axios from 'axios'
import './Onboarding.css'

const QUESTIONS = [
  "When you're exploring a new city, what's the first thing you look for?",
  'Describe your ideal Saturday afternoon out.',
  'What kind of places do you avoid at all costs?',
  "Do you prefer buzzing energy or peaceful quiet when you're out?",
  'Name a place you loved visiting and what made it special.',
]

export { QUESTIONS }

export default function Onboarding({
  onComplete,
  getToken,
  initialAnswers = [],
  mode = 'create',
  onCancel,
}) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState(() => [...initialAnswers])
  const [input, setInput] = useState(() => initialAnswers[0] || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleBack = () => {
  if (step === 0) return

  const previousStep = step - 1

  setStep(previousStep)
  setInput(answers[previousStep] || '')
  setError(null)
  }

  const handleNext = async () => {
    const trimmed = input.trim()
    if (!trimmed) return

    const newAnswers = [...answers]
    newAnswers[step] = trimmed
    setInput('')
    setError(null)

    if (step < QUESTIONS.length - 1) {
      setAnswers(newAnswers)
      setStep(step + 1)
      setInput(newAnswers[step + 1] || '')
    } else {
      setLoading(true)
      try {
        const text = QUESTIONS.map(
          (q, i) => `Q: ${q}\nA: ${newAnswers[i]}`,
        ).join('\n\n')
        // const res = await axios.post(
        //   `${import.meta.env.VITE_API_URL}/profile`,
        //   { text },
        //   { timeout: 300000 },
        // )
        const token = await getToken()
        const res = await axios.post(
          `${import.meta.env.VITE_API_URL}/profile`,
          { text },
          {
            timeout: 300000,
            headers: { Authorization: `Bearer ${token}` },
          },
        )
        onComplete({ ...res.data, answers: newAnswers })
      } catch (err) {
        const detail = err.response?.data?.detail
        const message = Array.isArray(detail)
          ? detail.map((d) => d.msg || JSON.stringify(d)).join(', ')
          : typeof detail === 'string'
            ? detail
            : err.message
        setError(
          message ||
            'Could not build your profile. Is the backend running with Ollama?',
        )
        setLoading(false)
      }
    }
  }

  if (loading) {
    return (
      <div className="onboarding onboarding--loading">
        <div className="onboarding__spinner" />
        <p className="onboarding__status">
          {mode === 'edit'
            ? 'Updating your taste profile'
            : 'Building your taste profile'}
        </p>
      </div>
    )
  }

  return (
    <div className="onboarding">
      <p className="onboarding__progress">
        {mode === 'edit' ? 'Edit taste profile · ' : ''}
        {step + 1} of {QUESTIONS.length}
      </p>
      <p className="onboarding__question">{QUESTIONS[step]}</p>
      <textarea
        className="onboarding__input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={4}
        placeholder="Take your time — there’s no wrong answer."
        autoFocus
      />
      {error && <p className="onboarding__error">{error}</p>}
      <div className="onboarding__actions">
        {mode === 'edit' && onCancel && (
          <button
            type="button"
            className="onboarding__button onboarding__button--secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
        {step > 0 && (
          <button
            type="button"
            className="onboarding__button onboarding__button--secondary"
            onClick={handleBack}
          >
            Back
          </button>
        )}

        <button
          type="button"
          className="onboarding__button"
          onClick={handleNext}
          disabled={!input.trim()}
        >
          {step < QUESTIONS.length - 1
            ? 'Next'
            : mode === 'edit'
              ? 'Update my profile'
              : 'Build my map'}
        </button>
      </div>
    </div>
  )
}
