# MCacademy — Development Plan

## Status Legend
- [ ] Not started
- [x] Done
- [~] In progress

---

## Phase 0 — Dev Environment
- [x] Install Git
- [x] Create GitHub account
- [x] Install GitHub CLI (`gh`) and authenticate
- [x] Push MCacademy project to GitHub

---

## Phase 1 — Data Modeling
Define the structure of all data before writing any code.

- [x] Define lesson/schedule entry structure (day, time, duration, lesson name, skip_next_week)
- [x] Define court preference structure (venue from Lazuz API, ordered court list)
- [x] Define coach profile structure (name, email, phone, lazuz phone, lazuz password)

---

## Phase 2 — Database Setup
- [x] Create Supabase account (free tier)
- [x] Create project in Supabase
- [x] Build tables based on Phase 1 data model (coaches, schedules, court_preferences)
- [x] Set up RLS policies for all three tables
- [x] Test that data can be read and written

---

## Phase 3 — Frontend (React PWA)
Build the coach-facing app. Does not depend on Lazuz API.

- [x] Scaffold React app
- [x] Google OAuth login screen
- [x] Weekly schedule screen (set/edit recurring lessons)
- [x] Court preference screen (venue + ranked court list)
- [x] Deploy to Netlify

---

## Phase 4 — Lazuz API (parallel track, waiting on coach)
- [x] Install HTTP Toolkit on computer
- [x] Connect coach's Android phone
- [x] Attempt live traffic interception — blocked by certificate pinning in the Lazuz app
- [x] Get screen recording from coach of full booking flow (login → court selection → payment → confirmation)
- [x] Download Lazuz APK and decompile to find hardcoded API endpoints
- [x] Use coach credentials to test authentication against discovered endpoints
- [x] Map and document all API requests for the full booking + payment flow
- [x] Wire venue search in Courts screen to Lazuz API (Netlify Function proxy + 2-step UI)
- [x] Update court picker to use real court names from Lazuz
- [x] Add court_1_id / court_2_id / court_3_id columns to court_preferences (SQL ready, needs running in Supabase)

---

## Phase 5 — Booking Script (Python)
Depends on Phase 4.

- [x] Build Python script to replicate Lazuz booking API call
- [x] Test one real end-to-end booking
- [x] Add court preference fallback logic (try courts in ranked order)
- [x] Add error handling and result collection

---

## Phase 6 — Notifications
- [x] Set up email service (Gmail SMTP with App Password)
- [x] Thursday reminder email (planned bookings for the week + link to app)
- [x] Friday post-run summary email (booked + failed)

---

## Phase 7 — Scheduling & Hosting
- [ ] Set up weekly Friday cloud function (Netlify Functions or similar)
- [ ] Wire booking script into cloud function
- [ ] Test full automated run end-to-end

---

## Phase 8 — Tests & Pipeline
- [x] Set up Python security scan (`bandit`, `pip-audit`)
- [x] Set up JS security scan (`npm audit`)
- [x] Write unit tests for booking logic (court fallback, error handling)
- [x] Wire commit pipeline: security scans → tests → commit → push → deploy

---

## Current Focus
**MVP complete — ready for real coach onboarding**
