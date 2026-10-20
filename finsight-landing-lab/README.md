# FinSight

## Requirements

- Node.js 20.19+ (Node.js 22 LTS or newer recommended)
- Python 3.14 recommended for the FastAPI backend
- A Supabase project for sign-in and saved financial uploads

## Frontend setup (Windows PowerShell)

From the repository folder:

```powershell
npm ci
Copy-Item .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. Then start Vite:

```powershell
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

## Backend setup (Windows PowerShell)

In a second terminal, from the repository folder:

```powershell
py -3.14 -m venv backend/.venv
backend/.venv/Scripts/python -m pip install --upgrade pip
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
```

Fill in the Supabase URL, publishable key, and service role key in `backend/.env`. Keep the service role key private and out of frontend variables. Run the database migrations in order as documented in [backend/README.md](backend/README.md).

Start the API from the repository folder:

```powershell
backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

The health check is `http://127.0.0.1:8000/health`; interactive API docs are at `http://127.0.0.1:8000/docs`.

The frontend and backend are separate processes. Keep both terminals open while developing. Without Supabase credentials, public pages can be developed, but sign-in and saved uploads will not work.
