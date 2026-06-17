# Terroir

I wanted a map that knew who I was when I travelled. So I built one.

[insert landing page screenshot]

## 🗺️ Overview

I recently finished my semester abroad at NYU Paris, and after a lot of travelling, I realized how much I would love to have a map familiar with my personality. The things I like, dislike, all contributing to a collection of places it knows I would love to visit, in whichever corner of the world I chose. The word "Terroir" refers to the French concept that a place's character comes from its environment. Felt like a rather poetic name for this project.

## 🚀 Features
- Builds and saves your **personal taste profile** based on your answers to 5 questions at the start.
- For whatever city you search, Terroir adds **color-coded markers** on locations it thinks you would love visiting.
- The **red** spots are places that match your personality by at least 65%, the **orange** are for 50% - 65%, and the **gray** for 40% - 50%.
- **Filter** places by **category** or **match percentage**.
- Get information about the location by clicking on its marker to see a **popup** with the place's name, category, match percentage, the **reason why it was suggested for you**, and thumbs up and down buttons to give **feedback** so your suggestions get **refined** over time.
- **Save** locations you are interested in so you can come back to them later.
- **Edit** your taste profile anytime to get updated suggestions.

## 🛠️ Tech Stack

### Frontend
- **React** + **Vite**
- **Leaflet.js** + react-leaflet (map rendering)
- **OpenStreetMap** tiles (free map layer, no API key)
- **Clerk** (authentication)
- **Axios** (HTTP client)
- **Vercel** (hosting)

### Backend
- **FastAPI** (Python)
- **Sentence Transformers** - **all-MiniLM-L6-v2** (place + profile embeddings)
- **Ollama + Llama 3.1 8B** (local LLM for taste profile extraction and match reasons)
- **Overpass API** (OpenStreetMap place data)
- **Nominatim API** (city search / geocoding)
- **Supabase** — **PostgreSQL** (user profile + embedding persistence)
- **Render** (hosting)

## 🏛️ Architecture

Terroir is split into a React frontend and a FastAPI backend. The two communicate via a REST API, with every request authenticated using a Clerk JWT token.
 
```
┌─────────────────────────────────────────────────────┐
│                     Frontend                        │
│                  React + Vite                       │
│                  Vercel hosting                     │
│                                                     │
│  Clerk (auth) → JWT attached to every API request   │
│  Leaflet.js   → renders map + scored markers        │
│  Nominatim    → city name to lat/lon (geocoding)    │
└───────────────────────┬─────────────────────────────┘
                        │ HTTPS + Bearer token
┌───────────────────────▼─────────────────────────────┐
│                     Backend                         │
│                 FastAPI (Python)                    │
│                  Render hosting                     │
│                                                     │
│  /profile      → extract structured taste profile   │
│  /profile/save → persist profile + embedding        │
│  /profile/load → load returning user's profile      │
│  /score        → fetch + embed + rank places        │
│  /feedback     → update embedding from vote         │
│  /profile/feedback → persist updated embedding      │
│  /reason       → generate per-place match reason    │
└────┬──────────────┬──────────────────┬──────────────┘
     │              │                  │
┌────▼────┐  ┌──────▼──────┐  ┌───────▼──────────────┐
│Supabase │  │  Overpass   │  │  Sentence Transformers│
│Postgres │  │  API (OSM)  │  │  all-MiniLM-L6-v2    │
│         │  │             │  │                      │
│profiles │  │ place data  │  │ embeds user profile  │
│table    │  │ for any     │  │ and place descriptions│
│user_id  │  │ city in     │  │ into shared 384-dim  │
│profile  │  │ the world   │  │ vector space         │
│embedding│  └─────────────┘  └───────────────────────┘
└─────────┘
```

### 🦙 Why Ollama

The LLM tasks in Terroir (taste profile extraction and per-place match reasons) are handled by a locally hosted Llama 3.1 8B model via Ollama rather than a cloud API. This was a deliberate tradeoff:

- **Cost** — zero API cost during development and for local use, which matters
  for a self-funded side project
- **No rate limits** — local inference means unrestricted iteration during
  development without worrying about burning through credits
- **Tradeoff** — response quality and speed are lower than a frontier model
  like Claude or GPT-4. For the profile extraction task this is acceptable
  since the prompt is structured and the output schema is well-defined.
  For match reasons, the results are sometimes generic but good enough for
  a portfolio context

The backend's `llm.py` is intentionally isolated so the Ollama calls can be swapped for any OpenAI-compatible API (Claude, GPT-4, Gemini) by changing the base URL and model name — no other files need to change.

### 😔 Known Limitations

**The deployed version requires Ollama running locally.**
Since the LLM runs on your own machine via Ollama rather than a cloud API, the backend needs to reach your local Ollama instance at runtime. In production this is bridged using [ngrok](https://ngrok.com), which exposes your local Ollama server to the deployed Render backend via a public tunnel.

This means the deployed demo only works when ngrok is actively running on the host machine — it is not a fully serverless deployment.

To run the demo: start Ollama, run `ngrok http 11434`, and update the `OLLAMA_BASE_URL` environment variable on Render with the ngrok forwarding URL.

The fix for this would be replacing Ollama with a cloud LLM API (Claude, GPT-4, etc.) which would make the deployment fully serverless. This was skipped to keep the project cost at zero.

## 📦 Installation & Setup

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.11+
- **Ollama** — [install from ollama.com](https://ollama.com), then pull the model:
  ```bash
  ollama pull llama3.1:8b
  ```
- Accounts / API keys for:
  - **[Clerk](https://clerk.com)** — authentication
  - **[Supabase](https://supabase.com)** — profile and saved-places storage
  - **[Hugging Face](https://huggingface.co)** — embedding API token (default backend mode), *or* use local embeddings (see below)

### 1. Clone the repo

```bash
git clone https://github.com/<your-username>/Terroir.git
cd Terroir
```

### 2. Supabase

Create a new Supabase project, then open the **SQL editor** and run:

```sql
create table if not exists public.profiles (
  user_id text primary key,
  profile jsonb not null,
  embedding jsonb not null,
  answers jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.saved_places (
  id bigint generated always as identity primary key,
  user_id text not null,
  place_id bigint not null,
  place jsonb not null,
  city_name text,
  saved_at timestamptz not null default now(),
  unique (user_id, place_id)
);

create index if not exists saved_places_user_id_idx on public.saved_places (user_id);
```

From **Project Settings → API**, copy:
- **Project URL** → `SUPABASE_URL` (base URL only, no `/rest/v1` suffix)
- **service_role** key → `SUPABASE_SERVICE_KEY`

### 3. Clerk

Create a Clerk application and enable **Email** (or your preferred sign-in method).

From the Clerk dashboard, copy:
- **Publishable key** → frontend `VITE_CLERK_PUBLISHABLE_KEY`
- **Secret key** → backend `CLERK_SECRET_KEY`

Under **Configure → Domains**, add `http://localhost:5173` so local sign-in works.

### 4. Backend

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env`:

```env
EMBEDDING_BACKEND=api
HF_TOKEN=hf_...                    # Hugging Face token with Inference API access

SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

CLERK_SECRET_KEY=sk_test_...

CORS_ORIGINS=http://localhost:5173

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
```

Start the API (from `backend/` with the venv active):

```bash
uvicorn main:app --reload --port 8000
```

Verify it is running: [http://localhost:8000/health](http://localhost:8000/health) should return `{"status":"ok"}`.

**Local embeddings (optional)** — skip the Hugging Face API and run embeddings on your machine:

```bash
pip install -r requirements-local.txt
```

Then set `EMBEDDING_BACKEND=local` in `.env`. The first `/score` request downloads the model and may take a minute.

### 5. Frontend

In a second terminal:

```bash
cd frontend
npm install
```

Create `frontend/.env`:

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_API_URL=http://localhost:8000
```

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### 6. First run

1. Make sure **Ollama is running** (`ollama serve` starts automatically on most installs).
2. Sign in via Clerk on the landing page.
3. Answer the five onboarding questions — this calls Ollama to build your taste profile (can take up to a few minutes).
4. Pick a city and wait while places are fetched, embedded, and scored.

If profile creation fails, check that Ollama is up and `llama3.1:8b` is pulled. If scoring fails, check your `HF_TOKEN` (or switch to `EMBEDDING_BACKEND=local`).

### Project layout

```
Terroir/
├── frontend/     React + Vite app (port 5173)
└── backend/      FastAPI API (port 8000)
    ├── main.py
    ├── llm.py          Ollama calls (profile + match reasons)
    ├── embeddings.py   Hugging Face or local embeddings
    └── overpass.py     OpenStreetMap place fetching
└── .gitignore
└── README.md
└── render.yaml
```
