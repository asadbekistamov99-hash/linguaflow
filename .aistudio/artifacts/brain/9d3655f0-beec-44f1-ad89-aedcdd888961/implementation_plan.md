# Implementation Plan: Vocabulary Flashcards with Spaced Repetition

## Confirmed Decisions from Phase 1 Clarification

| Question | User Decision | Architecture Response |
| :--- | :--- | :--- |
| **Review Session Structure** | **"hammasi" (All modes)** | Implement a unified review interface supporting 3 selectable modes: <br>1. **SM-2 Multi-Rating** (Again, Hard, Good, Easy with interval estimates)<br>2. **Binary Quick Flip** (Forgot vs. Remembered)<br>3. **Interactive Quiz Mode** (Multiple choice recognition & typing self-test) |
| **Lesson Button Placement** | **Next to vocabulary items in exercises AND in lesson summaries** | 1. Add interactive bookmark/card button (`🎴 Saqlash` / `+ Flashcard`) in `renderExercise`<br>2. Add a dedicated "Dars so'zlari" card strip in `renderLessonSummary` with quick toggles to save all or individual words into the flashcard deck |
| **Navigation Placement** | **Dedicated Flashcards tab in main navigation** | Add `['/cards', '🎴', 'Flashcards']` to `NAV` and `TABS` in `public/app.js`, with route handler `renderFlashcards` |

---

## 1. Overview
The **Vocabulary Flashcards** system empowers learners to systematically build long-term memory for words encountered in lessons or added manually. It connects LinguaFlow's existing SM-2 spaced repetition engine (`src/srs.js`) with persistent user decks in SQLite, providing:
- Real-time deck statistics (Due Today, Learning, Mastered).
- Multi-mode review sessions (SM-2, Quick Binary, Quiz mode).
- Immediate audio pronunciation (Web Speech TTS) and contextual example sentences.
- Seamless addition from any exercise or lesson completion screen.

---

## 2. UX & Visual Design

### A. Color Budget & Aesthetic Alignment (60-30-10)
- **60% Surface Canvas**: Clean dark slate (`#0b0f19` / `var(--bg)`) and card backdrops (`var(--surface)` / `#121826`).
- **30% Structural Panels & Cards**: Distinct 3D card borders (`var(--border)` / `#232d42`), soft glassmorphism accents, and subtle elevation shadows (`0 8px 30px rgba(0,0,0,0.25)`).
- **10% Semantic Action Accents**:
  - `Again` (Red / Coral): `#ef4444` (reset interval to 10m)
  - `Hard` (Amber): `#f59e0b` (interval × 1.2)
  - `Good` (Emerald / Primary Green): `#10b981` (interval × ease)
  - `Easy` (Vibrant Cyan / Blue): `#06b6d4` (interval × ease × 1.3)
  - Flashcard Brand Accent (Purple Gradient): `linear-gradient(135deg, #7c5cff, #a855f7)`

### B. Flashcard 3D Flip & Interface Anatomy
- **Interactive 3D Perspective**: Smooth CSS `transform: rotateY(180deg)` with `preserve-3d` and `backface-visibility: hidden`.
- **Card Front**: Target word in foreign language, language flag badge, audio speaker button, part of speech / category, and a prompt ("Bosing yoki [Space] bosing").
- **Card Back**: Uzbek definition, romanized transcription/phonetics, contextual example sentence with highlight, and SRS rating buttons.
- **Keyboard Shortcuts**: `Space` / `Enter` to flip; `1`, `2`, `3`, `4` or `←` / `→` for rapid review ratings.

### C. The 3 Review Modes
1. **SM-2 Classic Flip**:
   - Flip the card to reveal translation.
   - 4 rating buttons display calculated next due interval (e.g. `Qayta (<10m)`, `Qiyin (1 kun)`, `Yaxshi (3 kun)`, `Oson (6 kun)`).
2. **Binary Quick Flip**:
   - Ultra-fast review: `❌ Unutdim` vs `✅ Esda bor`.
3. **Interactive Quiz Practice**:
   - Front reveals word; 4 multiple-choice options or type-the-answer field to test active recall before revealing the card.

### D. In-Lesson Integration Points
1. **Exercise Screen (`renderExercise`)**:
   - Each vocabulary prompt displays a lightweight `[+ 🎴 Saqlash]` pill button.
   - Clicking immediately saves to the user's flashcards via `POST /api/flashcards`, transitions to a green `[✓ Saqlangan]` state, and fires a non-intrusive toast notification.
2. **Lesson Summary Screen (`renderLessonSummary`)**:
   - A dedicated "Darsda o'rganilgan so'zlar" (Words learned in this lesson) module.
   - Shows all vocabulary items with audio triggers and a "Barchasini Flashcardsga qo'shish" (Add All to Deck) bulk action.

---

## 3. Technical Architecture & Data Strategy

```
+-----------------------------------------------------------------------------------+
|                                  CLIENT (public/app.js)                           |
|                                                                                   |
|  [ Main Nav: 🎴 Flashcards ]       [ Exercise: [+🎴] ]     [ Summary: Add All ]   |
|            |                                |                       |             |
|            v                                v                       v             |
|  renderFlashcards()                POST /api/flashcards    POST /api/flashcards   |
|  - Deck Hub & Stats Bar                     |                       |             |
|  - Review Session (3 modes)                 |                       |             |
|  - Vocabulary Browser & Search              |                       |             |
+---------------------------------------------+-----------------------+-------------+
                                              |
                                              v
+-----------------------------------------------------------------------------------+
|                                  SERVER (src/app.js)                              |
|                                                                                   |
|  GET  /api/flashcards?lang=en         --> Returns user deck, due counts, stats    |
|  POST /api/flashcards                 --> Adds word (concept or custom) to deck   |
|  POST /api/flashcards/:id/review      --> Computes SM-2 state & updates DB        |
|  POST /api/flashcards/bulk            --> Bulk adds vocabulary from lesson        |
|  DELETE /api/flashcards/:id           --> Removes card from user's deck           |
+-----------------------------------------------------------------------------------+
                                              |
                                              v
+-----------------------------------------------------------------------------------+
|                            DATABASE (SQLite via node:sqlite)                      |
|                                                                                   |
|  TABLE: user_flashcards                                                           |
|  - id (INTEGER PRIMARY KEY)                                                       |
|  - user_id (INTEGER REFERENCES users)                                             |
|  - lang (TEXT)                                                                    |
|  - concept_id (TEXT, optional reference to concepts table)                        |
|  - front (TEXT, target word)                                                      |
|  - back (TEXT, Uzbek translation)                                                 |
|  - hint (TEXT, phonetics/transcription)                                           |
|  - example (TEXT, sample sentence)                                                |
|  - reps (INTEGER, repetition count)                                               |
|  - ease (REAL, SM-2 ease factor, default 2.3)                                     |
|  - interval_days (REAL, current review interval)                                  |
|  - due_at (INTEGER, timestamp ms when card is next due)                           |
|  - lapses (INTEGER, times forgotten)                                              |
|  - created_at (INTEGER)                                                           |
+-----------------------------------------------------------------------------------+
```

---

## 4. Step-by-Step Implementation Tasks

### Task 1: Database Schema & Migration (`src/db.js`)
- Add `CREATE TABLE IF NOT EXISTS user_flashcards (...)` with indexes on `(user_id, lang, due_at)` and `(user_id, lang, concept_id)`.
- If a concept is already added, prevent duplicate entries per `(user_id, lang, concept_id)`.

### Task 2: SRS Engine Extension (`src/srs.js`)
- Ensure SM-2 ratings map smoothly:
  - Rating 0 / `again`: resets interval to 0, ease -0.2, due in 10 minutes.
  - Rating 2 / `hard`: reps + 1, interval = max(1, interval * 1.2), ease -0.15, due in days.
  - Rating 4 / `good`: reps + 1, standard SM-2 progression (1d -> 3d -> interval * ease).
  - Rating 5 / `easy`: reps + 1, interval = max(2, interval * ease * 1.3), ease +0.15.

### Task 3: Backend API Endpoints (`src/app.js`)
- `GET /api/flashcards`: Fetch all cards for `(user_id, lang)`, with breakdown counters (`due_count`, `learning_count`, `mastered_count`, `total_count`).
- `POST /api/flashcards`: Add single card (either linked to a `concept_id` or custom word/translation).
- `POST /api/flashcards/bulk`: Add multiple concept IDs from a lesson at once.
- `POST /api/flashcards/:id/review`: Process review rating, update `user_flashcards` and sync with `word_progress` table, award XP (+2 XP per review).
- `DELETE /api/flashcards/:id`: Delete card.

### Task 4: Frontend Flashcards View & Review Controller (`public/app.js`)
- Register `/cards` in `NAV`, `TABS`, and `routes`.
- Implement `renderFlashcards`:
  - **Overview Header**: Language badge, Progress Ring / Stats (Due Today, In Progress, Mastered).
  - **Action Bar**: "Hozir takrorlash" (Start Review), Mode selector tabs ("SM-2 Kartochkalar", "Tezkor Ha/Yo'q", "Test Mashqi"), and Search/Filter input.
  - **Interactive Flashcard Stage**:
    - Animated 3D flip card with clean typography, audio pronunciation button, and translation reveal.
    - Rating bar with keyboard shortcut labels.
    - Session progress bar (`5 / 20 kartochka`) and end-of-session celebration summary.
  - **Word Bank Table/List**: Filterable list of all saved cards with audio test and remove button.

### Task 5: In-Lesson Integration (`public/app.js`)
- **In `renderExercise`**: In prompt rendering, query or check if word is in deck; render a stylish bookmark button `🎴 Saqlash` that toggles `Saqlangan` on click.
- **In `renderLessonSummary`**: Add "Ushbu darsdagi so'zlar" section with interactive card chips and a "Barchasini Flashcardsga qo'shish" button.

### Task 6: Visual Styling (`public/style.css`)
- 3D perspective flip CSS (`transform-style: preserve-3d`, `rotateY`, `backface-visibility: hidden`).
- Responsive card sizing (optimal touch targets on mobile, comfortable desktop staging).
- Mode toggle pills and rating button color themes.

---

## 5. Verification & Testing
- Run `npm test` to ensure existing 33 tests continue passing.
- Add unit/integration tests for flashcards API endpoints (`POST /api/flashcards`, `GET /api/flashcards`, `POST /api/flashcards/:id/review`).
- Verify dev server build and hot routing on port 3000.
