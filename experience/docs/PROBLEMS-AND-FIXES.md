# Problems and fixes — full incident log

Each entry is a real issue from the Suraksha Explore work. Read these before “fixing” symptoms that were already solved — many look like new bugs but are regressions of the same mistakes.

---

## P1 — Hand-rolled world did not look like Incridea

**Symptom:** User provided screenshots of a rich medieval town; the Suraksha experience had a simplified/custom scene (shrines, custom player, entry gate).

**Root cause:** First pass invented geometry and UX instead of porting Incridea `explore_2025`.

**Fix:** Deleted `Player`, `Shrines`, `EnterGate`, `World`, custom stones, `world.ts`. Copied/adapted Incridea `Medieval`, `Map`, `Character`, `characterController`, `Portal`, `Stone`/`Poi`, `Loader`, `UI`, `data.json`. Wired App Router (`"use client"`, `@/lib/assets`, local Draco).

**Do not regress by:** Rebuilding a “simpler” map for Suraksha branding.

---

## P2 — User required local-only; AWS panels later

**Symptom:** Plan included GraphQL / LevelPanel / remote location hrefs.

**Root cause:** Faithful Incridea port still talked to festival backends.

**Fix:** Strip network calls; empty `href`s; stone state in `localStorage`; no LevelPanel. User repeated this constraint explicitly more than once.

**Do not regress by:** Re-adding fetch/GraphQL without an explicit ask.

---

## P3 — Jump caused a white bar under the canvas

**Symptom:** Pressing Space scrolled the page; a white strip appeared below the WebGL view.

**Root cause:** Browser default scroll on Space / arrows while focus was on the document; canvas did not consume the key event for scrolling purposes.

**Fix:** Lock body overflow while Medieval is mounted; `preventDefault` on Space / arrow keys when appropriate; keep HUD as absolute overlay so layout height does not grow with content.

**Related files:** `Medieval.tsx`, `globals.css`.

---

## P4 — Main Website button dead or wrong

**Symptom:** Button pointed at `localhost:3000` when only experience (`3002`) was running.

**Root cause:** Assumed sibling `web/` app always up.

**Fix:** `APP_URL` from `NEXT_PUBLIC_ALLY_APP_URL` with fallback `/classic`. `.env.local` sets `/classic`.

---

## P5 — Need proximity modals (portal / docs / team)

**Symptom:** World was walkable but had no Suraksha-specific stops.

**Root cause:** Incridea locations opened festival pages; those hrefs were cleared for local-only.

**Fix:** Introduced `hotspots.ts` + dwell logic in `Medieval` + `WorldModals` for three intents.

---

## P6 — Museum needed AWS gallery

**Symptom:** Festival event posters still on walls; user wanted Suraksha AWS storytelling inside the museum.

**Fix:** `AwsGallery.tsx` canvas materials applied to poster meshes in `Map.tsx`. Later refined to **services only** (see P14).

---

## P7 — Missing teammates interaction / jump-run SFX

**Symptom:** No team modal; movement felt silent.

**Fix:** Team hotspot + modal; Web Audio jump / land / footstep / UI / modal sounds in `sfx.ts`; unlock on first gesture; mute toggle.

---

## P8 — Shadow flicker / crawling

**Symptom:** Shadows shimmered as the player walked.

**Root cause:** Large static shadow camera; low map size earlier (256) and hard shadow edges.

**Fix:** Soft PCF shadows, 2048 map, bias tuning, **directional light follows `playerPosition`** so the shadow frustum tracks the player.

---

## P9 — Sound and Main Website overlapped

**Symptom:** Top-right controls collided or fought for space.

**Fix:** Single `.world-top-actions` flex column with consistent gap and pill styles.

---

## P10 — SFX too quiet

**Symptom:** Jump/run barely audible.

**Fix:** Raised master gain (around `0.85`) and per-sound gains in `sfx.ts`.

---

## P11 — EVENTS text should become AWS branding

**Symptom:** Large “EVENTS” 3D letters on a castle face.

**Fix:** Hide `Text001` mesh; place an AWS logo canvas board on the same transform (`pickLogo`).

---

## P12 — Museum posters mirrored

**Symptom:** Logos/text unreadable / flipped from inside the gallery.

**Root cause:** Default `CanvasTexture` orientation vs Incridea UV layout.

**Fix:** `flipY = false`, `wrapS = RepeatWrapping`, `repeat.x = -1`, `offset.x = 1`.

---

## P13 — Teammates opened at the museum entrance (critical)

**Symptom:** User rage: standing at the museum stone arch opened **Teammates**. Tudor timber door did not.

**Root cause:** Agent computed RULEBOOK `Text` mesh world XZ ≈ `(-7.86, -12.12)` and assumed that was the cottage door. Empirically that XZ is on the **museum approach**. Naming of the mesh did not equal the interaction the user wanted.

**Fix (evidence-based):**

1. Reclassify `[-7.86, -12.12]` and `[-7.4, -11.5]` as **`docs`**.  
2. Keep gallery-mouth docs at `[-11.2, -8.6]` / `[-10.4, -9.4]`.  
3. Place **`team` only** at Incridea `data.json` location id 1: `[-1.0, -1.0]`, radius `1.25`.  
4. `hotspotAt` **prefers docs** if both match.  
5. Keep `?debug=1` for fine-tuning.

**Do not regress by:** Using Text mesh world positions for team again, or inventing a new porch offset without a debug reading.

---

## P14 — TECHNICAL / NON TECHNICAL headings + wrong wall mix

**Symptom:** Museum still showed festival category headings and/or Well-Architected / CARE LOOP boards instead of Suraksha services (including Polly, Transcribe, Nova).

**Fix:**

- `visible={false}` on `Non_technical`, `Special`, `technical`  
- Remove pillar/care/heading material paths from `AwsGallery`  
- `ALLY_SERVICES` list of 7; add `polly.svg`, `transcribe.svg`, `nova.svg`  
- All posters `pickService` with sequential indices  
- Docs modal lists the same seven services; remove WA pillar pills  

---

## P15 — Runtime `ReferenceError: CAMERA_RAY_HEIGHT is not defined`

**Symptom:** Next.js overlay: `CAMERA_RAY_HEIGHT is not defined` inside `CharacterController.useFrame` (reported at ~line 320).

**Root cause:** Camera occlusion constants were introduced as individual module-level `const` bindings (`CAMERA_RAY_HEIGHT`, etc.). Under Fast Refresh / partial HMR, the browser could execute a `useFrame` closure that referenced the name while the binding was missing or out of sync with an older compiled module shape. The constant existed on disk in later saves, but the running bundle still threw.

**Fix:** Collapse into a single module object:

```ts
const CAMERA_OCCLUSION = {
  rayHeight: 0.3,
  wallPadding: 0.15,
  minDistance: 0.35,
} as const;
```

Reference `CAMERA_OCCLUSION.rayHeight` (etc.) inside `useFrame`. Hard-refresh the tab if an old overlay persists.

**Do not regress by:** Reintroducing bare `CAMERA_RAY_HEIGHT` identifiers scattered across HMR boundaries.

---

## P16 — Port EADDRINUSE on 3002

**Symptom:** `next dev -p 3002` fails because a previous process still holds the port.

**Fix:** Kill the old Node process listening on 3002, then restart. Not an app logic bug.

---

## P17 — Map TypeScript friction after port

**Symptom:** gltfjsx node access / material typing errors.

**Fix:** Cast through `unknown` / `as THREE.Mesh` where needed; avoid fighting generated mesh names like `Roadies_Posters@2x`.

---

## P18 — Stale `experience/README.md`

**Symptom:** README still documents shrines, entry gate, `world.ts`, Temple Run on explore.

**Fix:** This `docs/` folder is the living handoff. README should be treated as outdated until rewritten to point here.

---

## Pattern: how these bugs cluster

1. **Visual fidelity bugs** → fix by staying closer to Incridea.  
2. **Meaning bugs** (wrong modal at right place) → fix by evidence (screenshot + debug xz + `data.json`), never mesh-name folklore.  
3. **Chrome bugs** (white bar, overlap, mute) → fix in DOM/CSS around the canvas, not in the GLB.  
4. **Runtime HMR bugs** → prefer stable object constants and full reload when overlays lie.
