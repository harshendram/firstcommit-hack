# Agent handoff — Suraksha Explore (`experience/`)

## What you are maintaining

A Next.js 15 App Router app named `ally-experience` that runs on **port 3002**. Route `/` loads a WebGL medieval world. Route `/classic` is the written Suraksha story page used as a fallback and as the Main Website target locally.

Upstream visual source: Incridea client  
`C:\Users\Harsh\Desktop\topfrontend\incridea-client\src\components\explore_2025\`

Suraksha product lives in the parent monorepo `firstcommit/` (`web/`, `backend/`, `wear-os/`, etc.). Explore does **not** currently call those backends for the 3D world.

## How to run

```bash
cd firstcommit/experience
npm run dev
# → http://localhost:3002
# → http://localhost:3002/?debug   # live player xz chip
```

Environment:

- `.env.local` → `NEXT_PUBLIC_ALLY_APP_URL=/classic`
- Resolved by `src/lib/config.ts` as `APP_URL` (fallback also `/classic`)

## Mental model

```
page.tsx
  ├─ WebGL + motion OK → Medieval (dynamic, ssr:false)
  └─ else → CTA to /classic

Medieval
  ├─ Loader (Incridea art + gsap fade)
  ├─ HUD: Sound + Main website
  ├─ Canvas + Physics
  │    ├─ SunLight (follows player)
  │    ├─ Map (world.glb, scale 0.4, pos [-4,-3,-6])
  │    ├─ CharacterController (Ryoko + camera occlusion)
  │    └─ Portal GLB
  ├─ Poi / stones (outside Physics)
  ├─ touch pad (WASD / run / jump)
  └─ WorldModals (portal | docs | team)
```

Interaction is **proximity hotspots** in XZ (`src/lib/hotspots.ts`), not clickable meshes and not Incridea’s old GraphQL locations.

## Files you will almost always touch

| Concern | File |
|--------|------|
| Door / arch triggers | `src/lib/hotspots.ts` |
| Modal copy / layout | `src/components/world/WorldModals.tsx` |
| World shell / HUD / dwell | `src/components/world/Medieval.tsx` |
| Movement / camera / jump | `src/components/world/characterController.tsx` |
| Museum posters | `src/components/world/AwsGallery.tsx`, `Map.tsx` |
| AWS icon list | `public/aws/*`, `ALLY_SERVICES` in hotspots.ts |
| Main website URL | `src/lib/config.ts`, `.env.local` |
| SFX | `src/lib/sfx.ts` |
| HUD CSS | `src/app/globals.css` (`.world-top-actions`, `.world-modal-*`) |

## Files that look important but are not the interaction source of truth

- `src/components/world/data/data.json` — stone positions + historical Incridea location points. Hotspots were **derived** from location id 1 `[-1,-1]` (rulebook/team) and id 4 `[-4,-2.8]` (portal). Empty `href` fields are intentional for local-only.
- `src/lib/levels.ts` — classic landing scroll beats, **not** museum walls.
- `experience/README.md` — outdated; ignore vs `docs/`.

## Hard-won rules (do not violate)

1. **Museum arch ≠ teammates.** A previous agent put `team` at world XZ near `[-7.86, -12.12]` because that matched a RULEBOOK Text mesh transform. Standing at the museum arch fired Teammates. Those coords are now `docs`. Team is at Incridea rulebook point `[-1, -1]`.
2. **Prefer docs on overlap.** `hotspotAt` returns docs if both docs and team match.
3. **Never invent a third hotspot cluster** without a `?debug=1` xz reading from the user standing at the door.
4. **Heading meshes stay hidden:** `Non_technical`, `Special`, `technical` in `Map.tsx` use `visible={false}`.
5. **Poster materials are Suraksha AWS services only** (Lambda, Bedrock, Nova, DynamoDB, Step Functions, Polly, Transcribe). No Well-Architected pillar boards, no CARE LOOP boards, no TECHNICAL titles.
6. **Camera near plane is `0.1`**, not `0.01` (interior punch-through).
7. **Space must `preventDefault`** while the world is focused, or the page scrolls and shows a white bar under the canvas.
8. **Camera occlusion constants** live in `CAMERA_OCCLUSION` object in `characterController.tsx`. Do not resurrect bare `CAMERA_RAY_HEIGHT` module bindings that Fast Refresh can desync.

## When the user sends screenshots

- Stone castle / portcullis / museum approach → should open **Documentation**.
- Timber Tudor house door → should open **Teammates**.
- Teal/glow portal → **Leave the world?** / Main website.
- If team or docs is wrong, ask for `?debug=1` xz at the feet position; nudge radius/pos by <1 m only.

## Out of scope unless asked

- Wiring real AWS panels / GraphQL / live agent backend into the world  
- Replacing character model or remaking the GLB  
- Theme music (`ASSETS.THEME` exists but is not wired in Medieval)  
- Real team photos (placeholders are intentional)  
- Commits / PRs unless the user asks  

## Related transcript

Prior session work is in Cursor agent transcript  
`d22be80c-cc92-4cd3-8bd6-d4dda0210f51` under the user’s Cursor projects folder. Prefer `docs/` over re-deriving from chat.
