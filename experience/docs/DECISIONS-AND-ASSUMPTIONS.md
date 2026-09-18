# Decisions and assumptions — UI / product / engineering

This document records **intentional choices** and the **assumptions** that justified them. If a future change contradicts a decision here, update this file in the same PR/edit so the next agent does not reverse course blindly.

---

## Product decisions

### D1 — Local-only Explore first; AWS cloud panels later

**Decision:** The 3D world must run entirely in the browser with no GraphQL / explore backend / LevelPanel wiring unless the user explicitly asks to reconnect cloud.

**Assumption:** Demo reliability matters more than live agent calls. Cloud pieces belong to the written story and real Suraksha backend, not the medieval walkthrough.

**Implication:** `data.json` location `href` fields are empty. Stone progress is `localStorage` only. Modals are static React content.

### D2 — Incridea look is sacred; Suraksha meaning is an overlay

**Decision:** Port Incridea’s Map, Character (Ryoko), CharacterController, Portal, Loader, UI pad, Medieval shell as faithfully as App Router allows (`"use client"`, `@/lib/assets`, local Draco).

**Assumption:** The user’s reference screenshots are Incridea’s world. Hand-rolled low-poly substitutes were rejected as “not the same world.”

**Implication:** Do not replace the GLB with a simpler plane. Suraksha branding appears as HUD, modals, museum materials, and hotspot semantics — not as a different map.

### D3 — Three interaction types only

**Decision:** Hotspot IDs are exactly `portal` | `docs` | `team`.

| Place | Meaning |
|-------|---------|
| Teal stone portal | Leave world → main website |
| Museum stone arch / gallery | Documentation (Suraksha AWS stack) |
| Tudor timber / rulebook house door | Teammates |

**Assumption:** Crowding more interaction types into the medieval map will recreate Incridea’s festival booth UX, which is not Suraksha’s story.

### D4 — Museum walls = Suraksha AWS service logos only

**Decision:** Poster meshes cycle Lambda, Bedrock, Nova, DynamoDB, Step Functions, Polly, Transcribe. Hide TECHNICAL / NON TECHNICAL / Special heading meshes. Do not paint Well-Architected pillars or CARE LOOP boards on the walls.

**Assumption:** Judges/viewers walking the museum should see “what Suraksha uses,” not festival event posters or generic WA framework posters. Fewer boards is acceptable; wrong labels are not.

**Implication:** Polly / Transcribe / Nova may use simple local SVGs if official Architecture Icons are not on disk. Labels must still be correct.

**Superseded in part (user request):** headings are back — see **D9**. What D4 banned was *festival taxonomy* (TECHNICAL / NON TECHNICAL / SPECIAL) and Well-Architected marketing boards. Naming the architecture itself was never the problem; the room being unlabelled is.

### D5 — Main Website points at `/classic` locally

**Decision:** `NEXT_PUBLIC_ALLY_APP_URL=/classic` and `APP_URL` fallback is `/classic`, not `http://localhost:3000`.

**Assumption:** Developers often run only the experience app. A hard-coded `:3000` link produces a dead tab and looks broken in demos.

**Implication:** In production, set `NEXT_PUBLIC_ALLY_APP_URL` to the real marketing site origin.

### D6 — Teammates are real, and roles are not listed

**Decision:** The cottage door shows **Team StarBugs** — Harshendra, Naomi, Shashwath — as three name-only cards with initials avatars. `TEAM_NAME` / `TEAM` in `hotspots.ts`. No `role` field.

**Assumption:** The user was offered role lines derived from git history and chose names only. Credit on a three-person hackathon team is shared; carving it into lanes invents a division of labour that did not exist. Photos can still replace initials later without touching layout.

**Implication:** The old fourth card ("Amma — the reason it exists") is gone. A fictional person sitting in a row of real ones read as a real teammate. That line survives as the modal's closing sentence instead, which is where it always belonged.

### D7 — Theme music, quiet, on the mute flag (reversed by request)

**Decision:** A single looping track (`ASSETS.MUSIC`) plays under the world at **volume 0.072**, fading in over 2.5s. The Incridea `THEME` / `THEME_END` mp3s stay unused.

**Assumption:** The original D7 refused music because it fights demo narration. The user asked for it explicitly and specified low volume, which addresses that objection; quiet enough to stop noticing is the whole spec.

**Implication / the rules it must keep:**
- Started from the **same first-gesture unlock** as the SFX — browsers refuse autoplay before one. `startMusic` is idempotent and nulls itself if `play()` is rejected, so the next gesture retries. The unlock listeners are therefore **no longer `{ once: true }`**.
- The **Sound pill mutes it**, via `setSfxMuted`. That was already the standing rule in `UI-AND-HUD.md` for any music added later.
- It is an `HTMLAudioElement`, not a Web Audio buffer: a 5.7 MB file should stream, not be decoded into memory.

### D8 — The world explains itself: the wardstone opening and the Stumble demo

**Decision:** Two new DOM overlays, both outside the hotspot system:

1. **`StoryIntro`** — fires once per run when the spawn drop lands. Names the wrist device **the wardstone**, states the argument (a village with no cameras is where Suraksha's "care without watching" is obviously right), and points at the three doors.
2. **`WardstoneOverlay`** — the **Stumble** HUD pill trips the character with the GLB's `dive_fall_guys` pose, then plays Suraksha's real fall pipeline on the watch: impact → *it asks her first* → branch. Answer and nothing is sent; stay silent and it runs gate → judge → tier policy → Step Functions care chain.

**Assumption:** A visitor who walks in cold has no idea why a care product built a medieval village. The museum shows *what* the stack is and the cottage shows *who* built it, but nothing showed *what it does*. The pieces to show it were already in the repo unused: a spawn that is literally a fall, a dive pose in the character GLB, and a fully styled Galaxy Watch in `landing/WatchMockup.tsx` that this app never rendered.

**Implication / guard rails:**

- These are **not hotspots**. `HotspotId` stays `portal | docs | team` (D3). They are siblings of `WorldModals` in `Medieval.tsx`, reusing `.world-modal-*` so there is still one modal language (not a second design system).
- Still local-only (D1). Nothing calls the Suraksha backend; the sequence is scripted from constants in `src/lib/wardstone.ts`.
- Every step's copy, severity and tier name is lifted from `ally/` — the Hindi question is the one `on_possible_fall()` actually sends, `after_fall + no_response → critical` is what `tiers.decide()` actually returns. **If the backend's behaviour changes, this script is wrong and must be updated.**
- Timings are compressed (12s to answer vs `FALL_WINDOW_MIN=2`; ~2s per contact vs `ESCALATION_CONTACT_TIMEOUT=180`). The panel says so on screen, permanently. Do not remove that line — it is what keeps the demo honest.
- `onMove` suppresses hotspot detection while either overlay is open, so a door modal can never open underneath one.

### D9 — The gallery is grouped and headed; the doors are named

**Decision:** The 25 boards no longer cycle all seven services in mesh order. Each wall carries one stage of the product, with a carved heading above it:

| Wall | Boards | Heading | Services |
|------|--------|---------|----------|
| Front, right of the mouth | 6 | **I · The Signal** | Lambda |
| Front, left | 7 | **II · Understanding Her** | Transcribe, Bedrock, Nova |
| Back (z ≈ −15.1) | 8 | **III · Finding Someone** | Step Functions, Polly |
| Left column (x ≈ −14.4) | 4 | **IV · What It Remembers** | DynamoDB |

Three hanging boards name the doors: **AWS Architecture Gallery** over the gatehouse arch, **Teammates** at the Tudor cottage, **The Way Out** over the stone portal. Their positions and heights are measured and committed in `lib/landmarks.ts` — see D14.

**Assumption:** "Scattered logos" was the complaint, and it was accurate — with `pickService(gallery, i)` running 0…25 there was no relationship between neighbouring boards. Grouping by wall makes each heading true of everything under it, and the four stages are the same ones the wardstone sequence walks through, so the museum and the demo stop being separate exhibits.

**Implication:**
- Signs are placed at **hotspot coordinates**, never at GLB text-mesh transforms. `Text.001` resolves to world (5.12, 2.98) — a building on the far side of the map — which is how an "aws" board ended up looking like graffiti on a house. That board is deleted and `pickLogo()` with it.
- `pickGrouped(mats, group, n, fallback)` replaces `pickService`. Adding a board means giving it a group, not an index.
- Signs and headings use `signTexture()` → `plainTexture()`, **not** `canvasTexture()`. The latter mirrors X for Incridea's inward-facing poster UVs; on our own geometry that renders every word backwards.

### D10 — One name: Suraksha

**Decision:** The product is **Suraksha** — the band on the wrist and the voice that speaks through it. Every visible mention in `experience/` says Suraksha; the watch face already did.

**History:** this used to be a split — Suraksha the device, Ally the agent speaking through it — on the reasoning that both names were real and described different things. The user collapsed it: one product, one name.

**Not renamed:** the `ally/` package, `ALLY_SERVICES`, `NEXT_PUBLIC_ALLY_APP_URL` and the code paths quoted as evidence in the wardstone panel (`ally/app.py · watch()`). Those are identifiers and real file paths, not the product name, and the panel's claim to be showing real code depends on them staying true. Other packages — `web/`, `dashboard/`, the `ally/` backend — are untouched.

### D11 — The museum is furnished; the stones are click targets

**Decision:** The middle of the gallery holds `arabic_table.glb` with a closed tome on it, and five crystal standing stones (`stone.glb`) sit on a radius-2.0 ring around it. Clicking the tome opens the architecture book; clicking a stone opens its lore panel.

**Assumption:** A room that explains the stack on its walls but holds nothing you can touch reads as a corridor. The questions a visitor would otherwise have to ask out loud — why this exists, who it is for, how big it gets, what is real, what it costs — are worth answering in the room itself.

**Implication / guard rails:**

- **Click, not proximity.** Proximity would mean new `HotspotId` values, which D3 freezes at `portal | docs | team`, and would fire modals at anyone crossing the room. Stones use the `onPointerDown`/`onClick` pattern `Stone.tsx` already established.
- The stones **must not** touch the `stoneVisibility` localStorage key. Drift D1 already records two systems fighting over it; `Monolith.tsx` is deliberately not a third.
- **No new lights.** The glow is an additive sprite. Five point lights would add five shader permutations to a scene running one directional and one ambient.
- Positions come from `lib/museum.ts` and are checked by `scripts/measure-gallery.mjs`, which fails if a stone drifts off its own ring angle or gets within 0.3 of a wall. Floor height is raycast, never typed.
- `arabic_table.glb` is **Z-up** (1.126 × 1.126 × 0.905, X and Y equal) and needs `rotation-x = -PI/2`. Its scale is derived from a `Box3` so swapping the model does not mean re-deriving numbers.
- The table carries one cuboid collider so you walk around it. The stones carry none — five thin colliders near walls risk pinching the player.

### D12 — Incridea's "book" is a react-pageflip modal, not a mesh

**Decision:** The architecture tome is a DOM flip-book (`react-pageflip`), opened by clicking the closed book on the table. `bookCoverTexture.jpg` dresses the covers; `pageTexture.jpg` backs every inner page; the diagrams are inline SVG.

**Assumption (settled by evidence):** Two rounds were spent hunting for a book GLB. There is not one, and there never was. The repo holds exactly four models — character, portal, stone, world. `world.glb` contains `Scene_Book-tittle_0`, but that is a **zero-thickness title decal** lying at world y −7.7, about 4.5 units *below* the ground you walk on: the village is built on the Sketchfab "Medieval Fantasy Book", which is why the map key is `medieval_fantasy_book`. The pages are the terrain. Incridea's actual book was `BookModal.tsx`, an `HTMLFlipBook`.

**Implication:** Do not go looking for `book.glb` again. If the tome needs to change, it is a React component. `react-pageflip@2.0.3` declares no React peer range and builds clean against React 19; `IFlipSetting` has no optional members, so every setting must be passed.

### D13 — A five-step guided quest, advisory not gated

**Decision:** A route through the world — cottage → gallery → the tome → the fall → portal — with a beacon over the active objective, a brass compass in a new top-left cluster, and a card naming the current step. `lib/quest.ts` holds the steps.

**Assumption:** Visitors wandered, found one or two doors, and left without ever pressing Stumble — the only part that shows what Suraksha does. A guided route fixes that without taking anything away.

**Implication / guard rails:**

- **`HotspotId` is not extended.** D3 freezes it at `portal | docs | team`; the quest only *reads* those coordinates. A step does not need a hotspot at all — the tome and the fall have none.
- **The tome step** sits between the gallery and the fall, and keeps you in the room you just walked into instead of sending you straight back out. It ticks when `BookModal` closes, over the table at `ROOM_CENTRE` on the measured `GALLERY_FLOOR`. Opening the tome early does nothing, the same way reading a door modal out of order does: `completeStep` only advances when the id matches the *current* step.
- **Nothing is gated.** No modal is blocked and no door changes. Ignore the quest entirely and the world behaves exactly as it did before.
- **Steps complete on close, not on arrival** — "you read it", not "you walked past". The ✕ and the backdrop both call `onClose`, so no step can be left un-completable.
- The fall step needed **no new plumbing**: `WardstoneOverlay` already reports `resolvedOkay` / `resolvedHelp` through `onSay`, and both endings count.
- The fall step has **no world position**, so the compass dims and the Stumble pill pulses instead of the needle pointing somewhere arbitrary. Any future step without a target must do the same.
- **In memory, resets on reload**, matching `StoryIntro` so the tour is repeatable for demos.
- The beacon does **not** raycast at all any more. Its ground comes from `lib/landmarks.ts` — see D14.

---

## UI / UX decisions

### U1 — Absolute HUD, not document flow

**Decision:** Top actions and touch pad are `position: absolute` (or fixed) over the canvas. Body overflow is locked while the world is mounted.

**Assumption:** Any normal document scroll (especially Space / arrows) creates a white strip under the WebGL canvas — a highly visible “broken page” artifact.

### U2 — Sound and Main Website share one stacked cluster

**Decision:** `.world-top-actions` stacks Sound above Main Website in the top-right with consistent pill styling and gap, so they never overlap the canvas chrome awkwardly.

**Assumption:** Earlier layouts let Sound and Main Website collide or sit on opposite corners inconsistently with the medieval aesthetic.

### U3 — Modal open requires a short dwell (200 ms)

**Decision:** Player must remain in a hotspot for ~200 ms before the modal opens.

**Assumption:** Walking past a door should not spam modals. Doors are still responsive enough that a stand-still opens quickly.

### U4 — Dismiss sticks until you leave the zone

**Decision:** Closing a modal sets `dismissed` to that hotspot id; it will not reopen until `hotspotAt` returns null (player left), then re-enter.

**Assumption:** Without this, closing immediately re-triggers on the next frame.

### U5 — Prefer Documentation over Teammates on overlap

**Decision:** `hotspotAt` returns the nearest matching `docs` hotspot if any docs match, even if a team hotspot is closer.

**Assumption:** Museum approach and cottage coords can brush each other after calibration. Showing Teammates at the museum was the highest-anger user bug; docs-priority is a safety rail.

### U6 — Touch controls mutate keyboard state

**Decision:** On-screen buttons set the same drei `KeyboardControls` channels as WASD / Shift / Space.

**Assumption:** One movement code path for desktop and mobile reduces drift between input modes (Incridea pattern).

### U7 — Jump / land / footstep / UI / modal SFX via Web Audio

**Decision:** Procedural / buffer SFX in `sfx.ts` with master gain ~0.85, unlock on first pointer/key, mute toggle in HUD.

**Assumption:** Shipping mp3 for every micro-interaction is heavier than needed; Web Audio unlocks cleanly after a user gesture.

---

## Graphics / camera decisions

### G1 — Soft shadows that follow the player

**Decision:** `PCFSoftShadowMap`, directional light `mapSize` 2048, bias `-0.0002`, normalBias `0.035`, orthographic frustum ±28, light position updated each frame relative to `playerPosition`.

**Assumption:** A static shadow camera over a large map causes texel crawling / flicker as the player walks (reported by user). Following the player keeps shadow resolution where it matters.

### G2 — Camera near = 0.1

**Decision:** Perspective camera `near` is `0.1`, not `0.01`.

**Assumption:** Extremely small near planes punch through building interiors when the camera is clipped close to walls.

### G3 — Occlusion ray from player head, ignore player meshes

**Decision:** Ray originates at `playerPosition + rayHeight`, targets desired camera seat; objects with `userData.camIgnore` (player group) are skipped.

**Assumption:** Casting from the look-at point in front of the character always hits the skinned mesh first and collapses the camera.

### G4 — Gallery texture UV flip

**Decision:** Canvas textures use `flipY = false` and horizontal `repeat.x = -1` / `offset.x = 1`.

**Assumption:** Incridea poster UVs face inward in a way that makes naive canvas textures appear mirrored from the walkable interior.

---

## Coordinate / hotspot assumptions

### A1 — Incridea `locations[id=1] = [-1, -1]` is the Tudor / rulebook door

**Assumption:** In the original festival client, that proximity opened the rulebook for the timber house. Suraksha reuses it for Teammates. This is the best **in-repo** non-guess anchor. If the user’s door is off by 1–2 m, calibrate with `?debug=1` — do not invent a new cluster from Text mesh world transforms.

### A2 — RULEBOOK `Text` mesh world ≈ `(-7.86, -12.12)` is museum-adjacent, not the cottage door

**Assumption (proven by user screenshot):** Standing at the museum arch fired Teammates when `team` used those coords. Therefore that XZ is museum approach, regardless of the mesh name “RULEBOOK.”

**Implication:** Never place `team` there again.

### A3 — Portal interaction XZ matches `locations[id=4] = [-4, -2.8]`

Aligned with Portal GLB placement and historical Incridea exit point.

### A4 — Map world transform

```
worldPoint ≈ Map.position + Map.scale * localPoint
Map.position = [-4, -3, -6]
Map.scale = 0.4
Gallery local origin = [-15.5, 0, -5.4] inside Map
```

Use this when converting poster local positions to world XZ. See [COORDINATE-SYSTEM.md](./COORDINATE-SYSTEM.md).

---

## Engineering assumptions

### E1 — `"use client"` on every R3F entry

App Router requires client boundaries for Canvas, physics, and browser APIs.

### E2 — No `ecctrl` / `leva` in the live path

They may remain in `package.json` from experiments; movement is the ported Incridea controller.

### E3 — `levels.ts` is for `/classic`, not the museum

Do not drive museum posters from scroll ranges. Drive them from `ALLY_SERVICES`.

### E4 — Stale README is expected until rewritten

Agents must prefer `docs/` over `experience/README.md`.

### D14 — Landmark heights are measured and committed, not raycast at runtime

**Decision:** `src/lib/landmarks.ts` holds, for each of the three places, where its board hangs (XZ + world Y) and where the quest beacon stands (XZ + the ground under it). `WorldSign` and `QuestMarker` are handed those numbers. Neither casts a ray.

**Why:** the boards used to measure their own height — a ray straight down from y = 30 on the sign's first frame, first hit wins, plus 1.7 — and every part of that was wrong. Observed in the running scene, not theorised:

1. **The first frame is too early.** World matrices are not current yet, so the ray hits the map at its *authoring* transform and the board locks in at y ≈ 21. That is what "the boards are too high in the sky" was.
2. **The ray hits whatever is in the way.** `camIgnore` was only checked on the hit object, never its parents, so the Teammates board once measured off the spawning character's torso at y = 19 — and the beacon, which copied the same pattern, then measured off the board and stood on top of it at y = 2.76.
3. **The first hit is not the ground.** Both doors have something over them: the cottage eave at −1.299 over ground at −2.954, the gatehouse vault at −0.679 over a floor at −3.077.

**How the numbers were taken:** by casting down through the *running* scene and reading the whole hit column at each XZ. `world.glb`'s own node tree is not a faithful model — `Map.tsx` re-declares those transforms in JSX and the two disagree by about 2.2 in Y — so an offline probe of the GLB gives the wrong answer. This is why there is no `measure-landmarks.mjs` next to `measure-gallery.mjs`.

**Guard rail:** `assertLandmarkGround()` runs in dev four seconds after mount and warns if the live scene no longer has a surface within 0.3 of a committed ground. It deliberately tests *any* hit in the column, not the first — the first is a roof at two of the three, which is the confusion the file exists to end.

**Implication:** a board's XZ is no longer forced to equal its hotspot's. Two of the three doors are *under* something, so each board is pulled out into the open air on its approach side, close enough that walking to the board still walks you into the hotspot.

### D15 — One Documentation modal, and it is inside the gallery

**Decision:** the two `docs` hotspots at the gatehouse arch (−7.86,−12.12 and −7.4,−11.5) are gone. The stack now opens only from the two inside the room, by the bookshelf.

**Why:** asked for directly — the arch and the bookshelf opened the identical panel, so you read the whole stack on the doorstep and had no reason to walk into the room that exists to show it.

**Implication:** the gate keeps its board and its quest beacon; the quest step still completes on closing the same modal, just after you have gone in. The hint already reads "through the stone arch", which is now literally true.

### D16 — Stumble is an action, not navigation

**Decision:** the Stumble pill left the top-right cluster and became a captioned control above Run and Jump, bound to `F`.

**Assumption:** where a control sits says what kind of thing it is. Next to Sound and Main website it read as chrome — something about the page. Next to Run and Jump it reads as something she does, which is what it is.

**Implication:** the quest hint names the control and the key, `.is-objective` pulses it in place, and `stumble` now refuses to fire while a story is on screen (`blocked.current`) instead of restarting the fall under its own panel.
