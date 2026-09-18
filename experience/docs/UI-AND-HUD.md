# UI and HUD — frontend chrome around the world

The 3D canvas is not the whole UI. Suraksha Explore has a DOM layer that must stay aligned with the medieval scene without fighting it.

## Layers (bottom → top)

1. Full-viewport `Canvas` (WebGL)  
2. Touch control pad (bottom) from `UI.tsx`  
3. Top-right actions: Sound + Main website + Stumble  
3b. Top-left: quest card + compass (`.quest-hud`)  
4. Optional `?debug` xz chip  
5. Loading overlay (until progress 100%, then gsap fade)  
6. `WorldModals` portal/docs/team (z-index 70)  
7. `StoryIntro` — the opening beat, fired on the spawn drop's landing (same `.world-modal-*` shell)  
8. `WardstoneOverlay` — the Stumble sequence (`.wardstone-*`, z-index 75, sits above everything else)  

All of these are coordinated from `Medieval.tsx` and styled primarily in `src/app/globals.css`.

## Top actions

Container class: `.world-top-actions`

- Positioned top-right, column flex, gap between pills  
- **Sound** is an icon button (`.world-sound-toggle`), not a word: `UIButtons.Volume` when on, `UIButtons.Volume3` when muted, both already in `UI.tsx`. It toggles mute via `setSfxMuted` / local `muted` state and plays `sfxUi` on click. The state it reports lives in `aria-label` and `title` — keep both if you touch it.  
- **Main website** is an `<a href={APP_URL}>` pill — not a React Router hard navigation that unloads mid-frame carelessly, but a normal link is fine  

Earlier bug: the two controls overlapped or sat inconsistently. Keep them in **one** stacked cluster; do not place Sound top-left and Main Website top-right unless redesigning deliberately.

**Stumble used to be a third pill here and is not any more.** It is something she *does*, like running and jumping, so it belongs with those — see below.

## The Stumble control (bottom-right, with Run and Jump)

`.world-fall-btn`, above Run and Jump in the same cluster. Alert-washed, because it is still the one control in the world that makes something happen, and `.is-objective` pulses it while the quest is on the fall step.

- **It carries a caption**, unlike its icon-only neighbours. Deliberate: it is the control that demonstrates the product, and a visitor should not have to read the quest card to find it.
- It calls `Medieval`'s `stumble` callback directly — same component, so nothing goes through the character controller's `document` id listeners the way `w`/`a`/`s`/`d`/`jump`/`shift` do.
- `stumble` returns early on `blocked.current`. The old pill had no such guard and would restart the fall underneath its own panel.
- **`F` is bound with a plain `keydown` listener, NOT a `keyboardMap` entry.** drei's `KeyboardControls` models a key being *held*, which `CharacterController` samples once per frame via `get()`. A one-shot action read that way fires on every frame the key is down.

## Quest HUD (top-left)

`.quest-hud` is a **separate** cluster in the opposite corner: the quest card and the brass compass. Both the "Quest n of N" line and the pip row read `QUEST_STEPS.length`, so adding a step needs no HUD change. U2 above forbids splitting Sound / Main website / Stumble apart from each other — it does not forbid a distinct element elsewhere.

**The compass is ref-driven, never state-driven.** The needle rotation and the distance are written straight to DOM refs inside a `requestAnimationFrame` loop that reads `playerPosition` and `cameraYaw` (both module state exported from `characterController.tsx`). Putting either through `useState` would re-render the card sixty times a second. If you add anything else live to this HUD, do it the same way.

Bearing maths, if it ever needs revisiting:

```
cameraYaw = atan2(dir.x, dir.z)                  // camera.getWorldDirection()
bearing   = atan2(target.x - player.x, target.z - player.z)
needle    = -(bearing - cameraYaw)               // CSS rotate is clockwise
```

`.compass-needle` intentionally carries **no CSS transition** — it is set every frame, and a transition makes it lag and overshoot.

## Main website URL resolution

```ts
// src/lib/config.ts
export const APP_URL =
  process.env.NEXT_PUBLIC_ALLY_APP_URL?.trim() || "/classic";
```

Local `.env.local`:

```
NEXT_PUBLIC_ALLY_APP_URL=/classic
```

Production should set an absolute https origin when the marketing site is separate.

## Scroll and focus behavior

While the world is active:

- `document.body` overflow hidden (prevent page rubber-banding)  
- Space / arrows prevented from scrolling the document  
- Canvas should feel like a game view, not a tall webpage  

Failure mode if broken: **white bar** under the canvas after jump (Space scrolls the page). See Problems P3.

## Touch pad

Bottom on-screen controls for forward / back / left / right / run / jump. They write into drei `KeyboardControls` state so `CharacterController` stays input-agnostic.

Landscape vs portrait adjusts layout (`isLandscape` state in Medieval). Camera FOV also changes (60 vs 100).

## Loader

Incridea-style loading art (`ASSETS.LOADING_BACKGROUND` / `LOADING_FOREGROUND`). `useProgress` from drei tracks GLTF loads. When progress completes, gsap fades the overlay and reveals the world.

Do not remove the loader for “faster demos” without a replacement — first paint of an unloaded GLB is a broken experience.

## Modals visual language

CSS under `.world-modal-*`:

- Parchment / stone glass card  
- Soft sheen overlay  
- Distinct hero strips per type (`.portal`, `.docs`, `.team`)  
- framer-motion opacity + slight y/scale  

Copy tone: calm, care-oriented, short. Avoid festival hype language (“EVENTS!!!”, booths, tickets).

## Sound system UX

- First pointerdown / keydown unlocks AudioContext (`unlockSfx`)  
- Mute is a user control, not an automatic browser policy  
- A looping background theme plays at 0.072 and is muted by the same Sound pill (see D7)  
- The Incridea `THEME` / `THEME_END` mp3s remain unused  

Music respects the same mute flag and never starts before a gesture. The unlock
listeners are not `{ once: true }`, because a refused autoplay needs a later
gesture to retry on.

## CSS ownership rules

- Prefer editing existing `.world-*` classes over introducing a second HUD design system  
- Avoid purple-glow “AI default” aesthetics; the world is warm medieval stone + parchment  
- Do not put large marketing stats / schedules into the first viewport of `/classic` without checking the landing design rules in the user ruleset  

## `/classic` relationship

`/classic` is part of the same Next app:

- Fallback when WebGL unavailable  
- Target for Main Website and docs CTA  
- Uses `levels.ts` scroll storytelling (Lambda → Bedrock → DynamoDB → Step Functions) — note this classic list is **four** services historically; the **museum** list is **seven** (adds Nova, Polly, Transcribe). That divergence is OK as long as museum/docs modal stay in sync with each other. If asked to unify, update both deliberately.

## Accessibility notes

- Modal backdrop button has `aria-label="Close"`  
- Dialog has `role="dialog"` and `aria-modal="true"`  
- Reduced motion users never enter Canvas (page.tsx gate)  
- Keyboard: WASD + Shift + Space; Escape should close modal if wired (verify if missing — add if user requests)  

## Do not

- Put HUD buttons inside the R3F tree as HTML via drei `Html` unless there is a strong reason — current DOM overlay is simpler for click reliability  
- Let modal content grow so tall it requires page scroll underneath the canvas  
- Reintroduce an “Enter the world” interstitial unless the user asks; home route already is the world  
  - **Exception, asked for explicitly:** `StoryIntro` is a story beat *after* the drop lands, not a gate before the world. It never blocks loading, it is skippable, and `ally.intro.hidden` in `localStorage` turns it off for good. Do not turn it into an enter-gate.  
- Remove the “simulated locally · the real window is 2 minutes…” line from the wardstone panel. The sequence is a compressed re-enactment and has to say so.  
