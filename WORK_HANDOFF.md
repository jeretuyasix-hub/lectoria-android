# Lectoria — Work Handoff

## Purpose

This repository contains **Lectoria**, a premium Android EPUB reader with an AI tutor, reading memory, annotations, study tools, TTS/STT, habits, and local-first persistence.

This document is the canonical handoff for continuing the project in **ChatGPT Work**.

## Repository

- Repository: `jeretuyasix-hub/lectoria-android`
- Default branch: `main`
- Android build workflow: `.github/workflows/construir-apk.yml`
- Build command: `npm run build` -> Capacitor sync -> `./gradlew assembleDebug`
- APK artifact name: `Lectoria-APK`

## Current verified state

Latest recovery line after the v15 regression:
- v15.1 recovery commit: `afc03daee12713cf6039931656102d314874f6c4`
- v15.2 EPUB navigation fix commit: `1a8450b201d77a764cc67d1f10c9bcd38b759a21`
- v15.2 GitHub Actions run: #127
- Build status: success through TypeScript/Vite, Capacitor, Android SDK and Gradle.

### Current user-visible issue being tested

A book opened successfully but remained visually blank on the first EPUB section:
- HUD displayed: `Cubierta · 1 / 1 · 0%`
- Reader controls were visible.
- The app did not advance naturally to the next spine item.

The diagnosis was narrowed to EPUB navigation/rendering, not import failure.

### v15.2 corrections

1. Removed location generation during an active reading session.
2. Reader no longer preprocesses the whole EPUB before allowing navigation.
3. Progress can fall back to spine position when a location map is unavailable.
4. `navigatePage(next/prev)` has a fallback that explicitly advances to the adjacent EPUB spine item when EPUB.js `next()` / `prev()` does not leave a 1-page cover/front-matter section.
5. Experimental WebGL/html2canvas page curl remains disabled for now.
6. Tutor indexing yields completely while `.reader-shell` exists.
7. Tutor indexing no longer generates a second redundant location map.

## Product direction

Lectoria should feel like a serious premium reading application, not a chatbot wrapped around an EPUB renderer.

Primary references:
- Apple Books: quiet reading surface, contextual controls, typography, restrained chrome.
- Kobo: reading customization and navigation.
- Readwise Reader: annotations, semantic retrieval, TTS, contextual copilot.
- Motion / Framer Motion: spring motion, layout transitions, gestures and microinteractions.

Do not copy another product's visual identity.

## Core UX rules

### Reading surface
- Reader should be visually quiet.
- No permanent bottom action bar.
- Bottom area contains only compact chapter/page/progress information.
- The EPUB text must never be covered by the progress HUD.
- A reserved bottom region is preferable to floating over the text.
- Top chrome should remain minimal.
- A floating settings/control button may be moved by the user and should persist its position.
- When opened, the control dock uses icons rather than long labels.
- Closing the dock with X must always return to the small floating control button.

### Selection toolbar
Use icons only:
- Highlight
- Ask Tutor
- Listen
- Note
- Close

### Highlight editor
- Must be a stable bottom sheet.
- Must not float over the selected paragraph unpredictably.
- While open, competing overlays/HUD should recede.
- Supports color, opacity and intellectual category.

### Bottom progress HUD
- Follows screen geometry with symmetric margins.
- Compact height.
- Rounded proportionally to device geometry.
- Never covers the last readable line.
- Current chapter + location + percentage.
- Progress should remain usable even before full location indexing exists.

## Current reader architecture

Key files:
- `src/components/ReaderV9.tsx`
- `src/components/useReaderEngine.ts`
- `src/components/ReaderControls.tsx`
- `src/reader-minimal.css`
- `src/premium-v15.css`

### Important rule

**Never block opening/rendering an EPUB on indexing, RAG, location generation, Tutor memory preparation, screenshot capture or animation preparation.**

Priority must remain:

1. Open EPUB.
2. Render first readable section.
3. Enable navigation immediately.
4. Restore annotations/progress.
5. Perform optional indexing only when it cannot affect reading responsiveness.

## EPUB compatibility requirements

Support EPUB 2/3 pragmatically through EPUB.js.

When an EPUB opens:
- Treat cover/front matter as a valid section.
- If its local displayed page count is 1/1, Next must still advance to the next linear spine item.
- Never assume `rendition.next()` alone is sufficient at a section boundary.
- Use the spine as a fallback navigation source.
- Do not skip covers automatically unless explicitly designed as a user preference.
- Broken XHTML sections should not invalidate the full book.

## Tutor / RAG

Key files:
- `src/lib/rag.ts`
- `src/components/TutorPanel.tsx`
- `src/lib/ai.ts`

Epistemic provenance must distinguish:
- BOOK / AUTHOR
- USER
- AI
- MIXED / external where needed

Rule: **Primero texto, después mediación.**

Anti-spoiler must be based on actual reading progress, including intra-chapter progress when possible.

The Tutor should be able to:
- Explain
- Simplify
- Deepen
- Define
- Give examples/analogies
- Contextualize
- Contrast
- Connect concepts
- Ask Socratic questions
- Translate

The Tutor must never be allowed to make the reader unusable because indexing is happening.

## Reading memory

Persist locally:
- CFI / reading location
- progress
- chapter
- reading sessions
- notes
- highlights
- Tutor questions
- recurring difficulties
- unresolved issues
- reentry context

Features:
- "Dónde estabas"
- chapter close summaries
- concept maps
- flashcards
- history timeline
- exact navigation back to reading locations

## Voice

Android native recognition uses:
- `@capgo/capacitor-speech-recognition`

Native Android recognition must not depend on an OpenAI API key.

TTS should use local speech where possible.

## Privacy and API key

- Local-first application.
- Core reading works offline.
- API usage is optional.
- Do not persist secrets unnecessarily.
- Keep AI failures isolated from the reader.

## Android navigation

Back priority inside reader:
1. Close note/highlight sheet.
2. Close Tutor.
3. Close Settings.
4. Close Study.
5. Close Notebook.
6. Close Navigation.
7. Close History.
8. Close control dock.
9. Clear active selection.
10. Return to Library.
11. Only exit app from Library root.

## Library

Key file:
- `src/components/Library.tsx`

Features include:
- local EPUB import
- cover extraction
- collections/tags/favorites/status
- habits
- backup/restore
- indexing status
- continue reading / reentry card

Import requirements:
- Imported book must become readable before Tutor indexing matters.
- Indexing failures must not be reported as import failures.
- Avoid simultaneous heavy EPUB parsing processes.
- Duplicate detection should not reduce EPUB compatibility.

## Backups

Portable `.lectoria` backup should contain:
- EPUBs
- annotations
- notes
- progress
- reading memory
- goals/reminders
- settings

Backup is not cloud sync.

## Design language

Name: **Lectoria**

Palette:
- deep forest green
- mint / bright green
- warm cream
- restrained gold accents

Use:
- rounded cards
- soft elevation
- translucent controls
- premium editorial typography
- restrained gloss

Reader itself should remain quieter than Home, Habits and Tutor.

## Motion system

Use Motion / Framer Motion deliberately:
- spring panel entrance/exit
- tactile button feedback
- shared layout only when stable
- subtle stagger where useful
- reduced-motion support

Avoid:
- animation that delays reading
- page screenshots on every turn
- heavy effects competing with EPUB rendering
- gratuitous motion

### Page curl

The WebGL/html2canvas experimental curl caused or contributed to a serious regression in v15 and is currently disabled.

Do not re-enable it until:
1. EPUB opening/navigation is stable across several books.
2. It has a separate test harness.
3. It does not capture the whole reader during startup.
4. It cannot consume resources while a page/section is loading.
5. Fallback to normal slide is automatic.

## Known regression history

### v14
Most recent broadly stable baseline before the large premium refactor.

### v15
Large 50-point premium/architecture refactor.
Regression: EPUB files did not load/navigate reliably on-device.

Likely contributing factors:
- WebGL curl + html2canvas capture.
- location generation while reader was active.
- Tutor indexing competing for EPUB parsing.
- multiple heavy operations on the same book.

### v15.1
Recovery:
- removed curl startup integration.
- delayed locations.
- paused RAG while reader visible.

Still observed:
- book remained at `Cubierta 1/1 0%`.

### v15.2
Further recovery:
- removed active-session location generation entirely.
- added spine navigation fallback.

This is the next device-test target.

## Required next test before adding more features

Do not continue feature expansion until the following passes on the user's Android device:

### Test A — existing problematic EPUB
1. Open the exact book that previously stopped at `Cubierta 1/1 0%`.
2. Confirm cover/front matter renders if present.
3. Tap/right-swipe Next.
4. Confirm the reader advances to the next spine section.
5. Continue at least 5 sections/pages.
6. Go back at least 2 sections/pages.
7. Close and reopen book.
8. Confirm position restoration.

### Test B — newly imported EPUB
1. Import a fresh EPUB.
2. Open immediately while Tutor index is pending.
3. Confirm immediate readability.
4. Confirm navigation remains responsive.
5. Exit to Library.
6. Allow Tutor indexing to continue.
7. Reopen and verify no regression.

### Test C — EPUB diversity
Use at least:
- EPUB with image cover.
- EPUB with text-only front matter.
- EPUB with long chapter XHTML.
- EPUB with many short spine items.

## Release discipline

From this point onward:
- Treat v15.2 as a recovery branch state even though it is on `main`.
- Do not bundle large reader-engine changes with visual redesign.
- Make one reader-engine change at a time.
- Compile after each change.
- Prefer device reproduction evidence over speculative optimization.
- No new page-turn engine until basic EPUB compatibility is stable.

## Build validation

Before giving the user any APK:
1. TypeScript succeeds.
2. Vite succeeds.
3. Capacitor sync succeeds.
4. Gradle succeeds.
5. Artifact exists.
6. APK is extracted and hash checked.
7. State explicitly what was and was not device-tested.

## User expectation

The user wants a highly polished premium application, but **reliability of reading is the first invariant**.

Never sacrifice EPUB compatibility or reading responsiveness for animations, AI indexing, visual effects or ambitious refactors.
