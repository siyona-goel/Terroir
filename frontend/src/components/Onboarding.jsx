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

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleNext = async () => {
    const trimmed = input.trim()
    if (!trimmed) return

    const newAnswers = [...answers, trimmed]
    setInput('')
    setError(null)

    if (step < QUESTIONS.length - 1) {
      setAnswers(newAnswers)
      setStep(step + 1)
    } else {
      setLoading(true)
      try {
        const text = QUESTIONS.map(
          (q, i) => `Q: ${q}\nA: ${newAnswers[i]}`,
        ).join('\n\n')
        const res = await axios.post(
          `${import.meta.env.VITE_API_URL}/profile`,
          { text },
          { timeout: 300000 },
        )
        onComplete(res.data)
      } catch (err) {
        const detail = err.response?.data?.detail
        const message = Array.isArray(detail)
          ? detail.map((d) => d.msg || JSON.stringify(d)).join(', ')
          : detail
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
        <p className="onboarding__status">Building your taste profile…</p>
      </div>
    )
  }

  return (
    <div className="onboarding">
      <p className="onboarding__progress">
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
      <button
        type="button"
        className="onboarding__button"
        onClick={handleNext}
        disabled={!input.trim()}
      >
        {step < QUESTIONS.length - 1 ? 'Next' : 'Build my map'}
      </button>
    </div>
  )
}
