# Known issues and residual risks

Living list of things that are **not fully closed**, **intentionally stubbed**, or **easy to break**. Check here before assuming the world is “done.”

---

## Residual risk R1 — Tudor door calibration

**Status:** Mitigated with evidence, not proven pixel-perfect.

Team hotspot sits at Incridea rulebook point `[-1, -1]`. That is the best in-repo anchor and is far from the museum arch. If the user’s timber door is 1–2 meters away, Teammates may open slightly early/late on the porch.

**Resolution path:** User stands in doorway with `?debug=1`, reports xz, agent nudges only the `team` entry.

---

## Residual risk R2 — Fast Refresh / camera constants

**Status:** Fixed pattern (`CAMERA_OCCLUSION` object), but Next overlays can lie after hot edits.

If you see `CAMERA_* is not defined` again:

1. Confirm the object exists at module top of `characterController.tsx`  
2. Hard-refresh the browser  
3. Restart `next dev` if needed  

---

## Residual risk R3 — Stale README

`experience/README.md` still describes shrines / entry gate / `world.ts`. Agents that only read README will make wrong plans.

**Resolution path:** Point README at `docs/` in a future cleanup edit.

---

## Intentional stub S1 — Team photos

Names are real (Team StarBugs — Harshendra, Naomi, Shashwath); portraits are still initials avatars. Not a bug. Swapping in photos means replacing the avatar div in `WorldModals.TeamBody`; the card layout already centres a square.

---

## Residual risk R4 — The wardstone's size and seat on the wrist

**Status:** Derived, not eyeballed. Needs one look in a browser.

`WristWatch.tsx` portals a band onto `mixamorigLeftForeArm`. It does **not** hard-code a scale — it reads the bone's world scale and its child bone's offset at mount, so it survives the 0.18 × 0.035 armature chain. Two knobs if it looks wrong:

- `TARGET_WORLD_SIZE` (0.035) — too big / too small
- `WRIST_ALONG_BONE` (0.82) — sitting at the elbow or floating past the hand

If the bone is ever missing, the component is simply not rendered (`Character.tsx` guards it). It cannot break the world.

---

## Residual risk R5 — The fall is done in code, not by the clip

**Status:** Corrected. An earlier version of this file claimed the dive pose was prone. **It is not.**

`dive_fall_guys` is a single-keyframe pose (99 channels, `count: 1`, duration 0) whose hips are **byte-identical to the rest pose** — rotation `-0.707, 0, 0, 0.707` and translation `0, 11.42, -67.56` in both. It moves the limbs only (arms forward, superman dive) and never touches the root, so on its own she stands upright with her arms out. The earlier reading compared that quaternion against identity instead of against the rest pose and drew the wrong conclusion.

Going down is therefore done in `characterController.tsx`:

- `FALL_PITCH` (−π/2) with `rotation.order = "YXZ"` so yaw and pitch compose like a body. She faces +Z, so rotating about −X is the face-down direction.
- `FALL_SINK` (0.2) because the rig pivots about the rigid-body centre, ~0.2 above her feet, so lying flat would otherwise leave her hovering by exactly that much.
- `fallHold` keeps her down for as long as the panel is open.

Knobs if it looks wrong: flip the sign of `FALL_PITCH` if she falls backwards; raise `FALL_SINK` if she hovers, lower it if a limb clips the floor. The capsule collider stays upright by design.

---

## Residual risk R6 — Gallery plaques: measured, and why

**Status:** Fixed, with a guard. Read this before moving anything in the gallery.

The first attempt placed four wall plaques and two door signs by typing numbers that looked about right. Every one was wrong, in four ways at once:

1. **All four rotations were inverted.** A `planeGeometry` faces +Z. `signal`/`understand` got `[0,0,0]` when inward is −Z; `find` got `[0,PI,0]` when inward is +Z; `remember` got `[0,−PI/2,0]` when inward is +X. With `DoubleSide` you then see the back face, which renders the canvas **mirrored** — that was the backwards text.
2. **Mis-centred by up to 2 world units** (`understand` sat at x −10.88; its wall centre is −12.08), so plaques floated over the wrong stretch of wall.
3. **Too tall.** At 2.2 local the bottom edge landed at world −2.58, *below* the board centres at −2.539 — hence the overlap.
4. The walls are **not flat**. The room is a rounded rectangle; boards splay around the corners, so a wide flat plaque cuts into the wall unless it sits on the flat run.

Now: constants live in `src/lib/gallery.ts`, derived by `scripts/measure-gallery.mjs`, which fails if they drift from the scene. The inward normal comes from the board's own rotation — `(-sin theta, 0, cos theta)` — not from trying signs. And `Plaque` renders **two back-to-back faces**, the back one pre-mirrored, so a wrong rotation can no longer produce backwards text.

`GallerySigns` mounts in world space as a **sibling of `Map`**. Inside `Map` it would inherit `scale 0.4` and `position [-4,-3,-6]`.

---

## Residual risk R7 — The market stone's assumptions are ours

`LORE_STONES.market` in `src/lib/museum.ts` is a bottom-up estimate. The population figures are attributed to the **UNFPA India Ageing Report 2023** and should be **verified before anyone presents them**. The two conversion rates — "~1 in 5 without an adult child nearby" and "~10% in smartphone-equipped urban homes" — are **ours**, and are tagged `assumption` so they render visually distinct from the published ones.

Replace them with real figures when you have them. Do not quietly delete the tags to make the number look firmer than it is: showing the arithmetic is the thing that makes the panel credible.

---

## Residual risk R8 — react-pageflip on React 19

`react-pageflip@2.0.3` declares **no** React peer range, so npm raises no warning and `npm run build` passes against React 19.2.8. That is not the same as being supported. If page flipping misbehaves after a React or Next upgrade, the fallback is a framer-motion page turn — framer-motion is already a dependency.

It also pulls `page-flip: latest`, an unpinned transitive dependency. Worth pinning if a broken release ever appears.

---

## Intentional stub S2 — Theme music unused

`ASSETS.THEME` / `THEME_END` mp3s exist. Medieval does not play them. Sound toggle currently covers SFX.

---

## Intentional stub S3 — `Instructions.tsx`

Empty component, unused. Safe to ignore or delete in a cleanup pass.

---

## Intentional stub S4 — Classic vs museum service counts

`/classic` scroll story historically highlights four AWS beats (Lambda, Bedrock, DynamoDB, Step Functions). Museum/docs modal show seven (adds Nova, Polly, Transcribe). Not automatically kept in lockstep with `levels.ts`.

---

## Drift D1 — Dual stone visibility systems

`CharacterController` and `Stone.tsx` / `Poi` both care about `localStorage` `stoneVisibility`. If stone collectibles desync (visible but uncollectible or reverse), check both writers/readers.

---

## Drift D2 — Unused dependencies

`ecctrl`, `leva`, and possibly others may remain in `package.json` without being on the Medieval boot path. Do not assume they are active systems.

---

## Drift D3 — `DOC_FEATURES` deprecated alias

Still exported from `hotspots.ts` as a mapped view of `ALLY_SERVICES`. Prefer `ALLY_SERVICES` in new code.

---

## Operational O1 — Port 3002 busy

Previous `next dev` left running → `EADDRINUSE`. Kill the process; not an application defect.

---

## Operational O2 — WebGL gate

Users with reduced motion or no WebGL never see the world; they get `/classic`. That is intentional.

---

## Open product questions (do not invent answers)

Record answers here when the user decides:

1. Should Explore ever play theme music by default?  
2. Production URL for Main Website (`NEXT_PUBLIC_ALLY_APP_URL`)?  
3. ~~Real teammate names/photos/roles?~~ **Answered:** Team **StarBugs** — Harshendra, Naomi, Shashwath. Names only, **no role lines** (the user was offered git-derived roles and declined them). Photos still outstanding — see S1.  
4. Should docs modal deep-link to specific `/classic` anchors per service?  
5. When to reintroduce live AWS / agent panels into the world?  
6. Should the wardstone sequence ever call the real Suraksha API instead of the local script? Today it is deliberately offline (D1/D8).  

Until answered, keep local-only static modals.

---

## Regression test script (manual)

Run after any hotspot, museum, HUD, or controller change:

1. `npm run dev` → http://localhost:3002  
2. Wait for loader to clear; confirm no runtime overlay  
3. WASD walk; Shift run; Space jump — no white bar  
4. Sound toggle mutes jump SFX  
5. Main website opens `/classic` (or configured URL)  
6. Walk to museum stone arch → **Documentation** only  
7. Enter museum → four wall headings (I–IV) flat on their walls above the boards; each logo appears once with its placard beside it; nothing mirrored from either side; no TECHNICAL/SPECIAL taxonomy  
8. Walk to Tudor timber door → **Team StarBugs**, three names, no role lines  
9. Walk to teal portal → Leave the world?  
10. Optional: `?debug=1` shows xz updating while moving  

If step 6 or 8 fails, stop and calibrate with debug xz before any other feature work.

Story / wardstone additions:

11. Loader clears → she drops → **the intro opens on landing**, not before  
12. Tick "Don't show this again", reload → straight into the world. `localStorage.removeItem("ally.intro.hidden")` brings it back  
13. **Stumble** is a pill (not bare text) → she lands **face-down** and stays down until the panel closes; wrist pulses amber  
14. Branch A ("I'm okay") ends silent; Branch B (wait out the ring, or "Say nothing") runs gate → judge → policy → Rahul → Priya  
15. Press Stumble again while the panel is still open — the sequence must restart, not stall (`runId`)  
16. Walk into a door mid-sequence — no second modal may open  
17. End card: "See the stack" opens the docs modal; "Read the written story" loads `/classic`

Round 2 additions:

18. Scroll the wardstone panel — the rail scrolls, the watch does **not** move, the panel itself never scrolls. Repeat at 800px and 400px wide  
19. Comic balloon tracks her, types its line, and shows the Hindi question with the English under it  
20. Watch face: `SURAKSHA` brand, step readout I…V with pips, no `—:—` placeholder, only the ring animates  
21. Museum arch reads **AWS ARCHITECTURE GALLERY**; Tudor door reads **TEAMMATES**; both legible from any angle and not mirrored  
22. No "aws" board on any house — it is deleted, not moved  
23. All five modals: carved Cinzel titles, ✦ rule, corner filigree; Devanagari still renders; code rows still mono  
24. `node scripts/measure-gallery.mjs` exits 0 after any gallery change  
25. Museum centre: table upright and on the floor, walk around it not through it  
26. Each of the five stones glows, bobs, and opens its own panel on click — and nothing opens by walking  
27. Clicking the tome opens the flip-book; pages turn by drag and corner click; both textures render

## Boards in the sky, and the three bugs behind them

Symptom: the *AWS Architecture Gallery* and *Teammates* boards floated far above the rooftops, at a height that changed between page loads.

`WorldSign` measured its own height: a ray straight down from y = 30 on its first frame, first hit wins, plus 1.7. Three separate faults, all three confirmed by reading the live hit column rather than reasoning about it:

1. **Frame one is too early.** Nothing has been through `updateMatrixWorld` yet, so the ray meets the map at its authoring transform — the untransformed village is ~50 units across — and the board settles at y ≈ 21. Being a race, it looked different on every reload, which is why the reports were inconsistent.
2. **It hit whatever was in the way.** The filter checked `userData.camIgnore` on the hit object only, never its parents, and `camIgnore` lives on the character's *container*. One run measured the Teammates board off the spawning character's torso at y = 19.2. `QuestMarker` had copied the same code, so it then measured off the board and hovered at 2.76, standing on a sign standing on nothing.
3. **The first hit is not the ground.** Every door has something over it — the cottage eave at −1.299 over ground at −2.954, the gatehouse vault at −0.679 over a floor at −3.077. Even with the race fixed, "first hit + 1.7" puts the board above the roof.

Fixed by deleting the runtime raycast: heights live in `src/lib/landmarks.ts`, measured once in the running scene, with `assertLandmarkGround()` warning in dev if the map ever moves under them. See D14.

**Do not** re-derive these from `world.glb` offline. `Map.tsx` re-declares the glTF node transforms in JSX and the two trees disagree by about 2.2 in Y — an offline probe of the GLB returns confident, wrong numbers.

## The tome opened as one loose page

Symptom: the book flipped correctly but showed a single leaf — no facing page, no gutter, nothing that read as bound.

`FLIP_SETTINGS` had `usePortrait: true` with `width: 300` and a `.book-stage` that shrink-wrapped to it. **StPageFlip drops to portrait — one leaf at a time — whenever the block it is handed cannot fit two pages side by side**, so it was portrait every time. The working animation is what made this look like a styling problem: portrait flips perfectly, it just flips one page.

Fixed by deciding orientation when the tome mounts (`window.innerWidth < 760`, read once — react-pageflip builds StPageFlip once and never re-reads its settings) and giving the stage two pages' width. Three things learned in the process, all easy to trip over again:

- **Orientation classes are on the wrapper, not the parent.** `--landscape` / `--portrait` go on `.stf__wrapper`; `--left` / `--right` go on each `.stf__item`. A selector rooted at `.stf__parent.--landscape` matches nothing. (page-flip's own stylesheet also has a typo, `.sft__wrapper`, which is why that rule never applied to anything.)
- **`showCover` does not make a cover hard.** Density comes from `data-density="hard"` on the page element; without it a leather cover bends like paper when it turns.
- **With `showCover`, hard covers stand alone and soft leaves pair up**, so an odd number of inner leaves strands the back cover against the last page. `BOOK_PAGES` is kept even for this reason — see the comment on its closing leaf.

Related, same component: the pages had no texture at all until page-flip's stylesheet was inlined here. Both traps live in `BookModal.tsx` and `globals.css`.
