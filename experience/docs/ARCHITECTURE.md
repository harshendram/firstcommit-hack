# Architecture — Suraksha Explore frontend

## Stack

- **Next.js 15** App Router (`next dev -p 3002`)
- **React Three Fiber** + **drei** + **@react-three/rapier**
- **Three.js** (shadows: `PCFSoftShadowMap`)
- **gsap** for loader fade-out
- **framer-motion** for modal enter/exit
- **Web Audio API** for SFX (`src/lib/sfx.ts`) — no Howler dependency for UI sounds
- Draco decoder self-hosted at `public/draco/`

Package name: `ally-experience` in `package.json`.

## Boot sequence

### `src/app/page.tsx`

1. Detect WebGL support and `prefers-reduced-motion`.
2. If OK: dynamically import `Medieval` with `{ ssr: false }` so R3F never runs on the server.
3. If not OK: show a simple message with a link to `/classic`.

There is **no** separate “Enter the world” gate anymore. Loading the home route *is* entering the world (loader covers until GLTF progress hits 100%).

### `src/app/classic/page.tsx`

Written Suraksha landing (scroll levels from `levels.ts`, marketing components under `components/landing/`). Used as:

- Accessibility / no-WebGL fallback  
- Local target for **Main website** HUD button  
- Docs modal CTA (“Read full documentation”)

### `src/app/layout.tsx` + `fonts.ts` + `globals.css`

App shell, fonts, and all world HUD/modal CSS. World-specific classes are prefixed `world-` (e.g. `.world-top-actions`, `.world-modal-root`).

## Component ownership

### `Medieval.tsx` — world shell

Owns:

- Loading overlay (`Loader` + `useProgress` + gsap)
- Landscape detection for control layout
- Keyboard map for drei `KeyboardControls`
- Canvas settings (shadows, camera fov 60 landscape / 100 portrait, near `0.1`, fog)
- Physics world
- Hotspot dwell state machine (`hotspot`, `dismissed`, `dwellRef`)
- Sound mute toggle + Main website link
- `?debug` xz chip
- Touch control buttons from `UI.tsx`
- Renders `WorldModals`

Does **not** own movement physics (that is `CharacterController`) or poster materials (that is `Map` + `AwsGallery`).

### `characterController.tsx` — player + camera

Owns:

- Rapier `RigidBody` + capsule collider  
- Walk / run / jump velocities  
- Animation state for `Character`  
- Third-person camera follow + **occlusion ray** (`CAMERA_OCCLUSION`)  
- `playerPosition` module singleton updated each frame (used by `SunLight` and hotspot `onMove`)  
- Fall respawn when `y < -9`  
- Stone pickup distance checks + `localStorage` key `stoneVisibility`  
- Touch pad integration by mutating drei keyboard state  

Character visual: `Character.tsx` (Ryoko / assassin GLB from Incridea assets).

### `Map.tsx` — static world collision + gallery

- Loads `ASSETS.WORLD` (`/world/world.glb`) via `useGLTF`  
- Fixed `RigidBody` trimesh for walking surfaces  
- Large gltfjsx mesh tree (ported from Incridea)  
- Nested gallery group at local `position={[-15.5, 0, -5.4]}` with poster meshes  
- Applies `pickService` / `pickLogo` materials from `AwsGallery`  
- Hides heading / old text meshes with `visible={false}`  

Outer placement comes from Medieval:

```ts
scale: 0.4
position: [-4, -3, -6]
```

### `Portal.tsx`

Teal portal GLB near world XZ `[-4, -2.8]` (visual). Interaction is **not** mesh click — it is the `portal` hotspot in `hotspots.ts`.

### `Stone.tsx` (`Poi`)

Floating blue stones for collectibles. Visibility synced through `localStorage` (`stoneVisibility`). Controller also tracks distance with empty meshes; keep both in sync if you change stone IDs.

### `AwsGallery.tsx`

Builds `THREE.CanvasTexture` boards at runtime:

- Loads `/aws/{file}.svg` into a parchment frame with label  
- UV correction for Incridea posters: `flipY = false`, `repeat.x = -1`, `offset.x = 1` (otherwise logos appear mirrored)  
- Exposes `useGalleryMaterials`, `pickService`, `pickLogo`  

### `WorldModals.tsx`

DOM overlay (not in Canvas). Three bodies:

- `portal` — leave world / visit `APP_URL`  
- `docs` — Suraksha AWS services from `ALLY_SERVICES`  
- `team` — placeholder teammates  

### `Loader.tsx` / `UI.tsx`

Incridea loading art and on-screen control buttons. `Instructions.tsx` exists but is an empty stub and unused.

## Data flow — player position → modal

```
CharacterController.useFrame
  → updates playerPosition (Vector3)
  → onMove?.(playerPosition)

Medieval.onMove
  → if ?debug: setDebugPos(`${x}, ${z}`)
  → hotspotAt(x, z)
  → dwell 200ms on same HotspotId
  → setHotspot(id); sfxModal()
  → WorldModals active={hotspot}

Dismiss
  → setDismissed(id); setHotspot(null)
  → while still inside zone, stay dismissed
  → leave zone → clear dismissed so re-enter works
```

## Asset paths (`src/lib/assets.ts`)

| Key | Path |
|-----|------|
| WORLD | `/world/world.glb` |
| CHARACTER | character GLB under `/world/` |
| PORTAL | portal GLB |
| STONE | stone GLB |
| LOADING_* | webp loading art |
| THEME / THEME_END | mp3 present but **not wired** in Medieval |
| DRACO | `/draco/` |

## Local storage

| Key | Purpose |
|-----|---------|
| `stoneVisibility` | JSON boolean array for collected stones |

No auth cookies. No explore backend session.

## What was deliberately removed from the first Suraksha attempt

Before the Incridea port, the experience app had hand-rolled:

- `Player.tsx`, `Shrines.tsx`, `EnterGate.tsx`, `World.tsx`, `Stones.tsx`, `world.ts`

Those were deleted and replaced by the Incridea component set so the look matched the user’s reference screenshots. Do not resurrect shrine billboards as the primary AWS storytelling device; the museum walls + docs modal are the Suraksha overlay.
