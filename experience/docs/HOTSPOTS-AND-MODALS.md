# Hotspots and modals

## Source of truth

[`src/lib/hotspots.ts`](../src/lib/hotspots.ts) — coordinates, radii, priority, `TEAM_NAME` / `TEAM`, `ALLY_SERVICES`.

[`src/components/world/WorldModals.tsx`](../src/components/world/WorldModals.tsx) — DOM UI.

[`src/components/world/Medieval.tsx`](../src/components/world/Medieval.tsx) — dwell / dismiss / SFX on open.

## Current hotspot table (world XZ)

| id | pos `[x, z]` | radius | Intent |
|----|--------------|--------|--------|
| `portal` | `[-4.0, -2.8]` | `1.15` | Leave world → `APP_URL` |
| `docs` | `[-7.86, -12.12]` | `1.6` | Museum stone arch / approach |
| `docs` | `[-7.4, -11.5]` | `1.4` | Museum approach band |
| `docs` | `[-11.2, -8.6]` | `1.55` | Gallery mouth |
| `docs` | `[-10.4, -9.4]` | `1.35` | Gallery mouth |
| `team` | `[-1.0, -1.0]` | `1.25` | Tudor / rulebook house door |

Multiple entries may share an `id`. That is intentional: one logical interaction can cover a walkway with several circles.

## Priority rule

```ts
hotspotAt(x, z):
  collect all HOTSPOTS where distance <= radius
  if any docs among hits → return nearest docs
  else → return nearest hit (portal or team)
```

Museum path must **never** surface Teammates even if a future team circle is drawn too large.

## Dwell / dismiss state machine

States in `Medieval`:

- `hotspot: HotspotId | null` — currently shown modal  
- `dismissed: HotspotId | null` — closed while still inside zone  
- `dwellRef: { id, since }` — time entered current id  

Behavior:

1. No hit → clear dwell, clear dismissed, clear hotspot.  
2. Hit but `hit.id === dismissed` → do nothing (stay closed).  
3. Hit id changed → reset dwell timer; do not open yet.  
4. Same id for ≥ 200 ms → `setHotspot(id)`, play `sfxModal()` once per open.  
5. User closes → `setDismissed(id)`, `setHotspot(null)`.

Escape / backdrop / ✕ all call the same `onClose`.

## Modal content contracts

### Portal

- Eyebrow: Stone portal  
- Title: Leave the world?  
- Primary: Visit main website → `APP_URL`  
- Secondary: Stay here → close  

### Documentation

- Driven by `ALLY_SERVICES` (7 entries)  
- Icon chips + list of title/body  
- CTA: `Link` to `/classic` (“Read full documentation”)  
- Must **not** show Well-Architected pillar pills  

### Teammates

- Driven by `TEAM_NAME` + `TEAM` (3 entries)  
- Eyebrow: The cottage · Title: **Team StarBugs**  
- Crest on the hero strip, then three name-only cards with initials avatars  
- **No role lines** — see decision D6. Do not add them back without asking.  
- Closing line about Amma is copy, not a fourth card  

---

## Overlays that are not hotspots

Two modals live next to `WorldModals` and are deliberately **outside** the hotspot system, because `HotspotId` is frozen at `portal | docs | team` (D3):

| Component | Trigger | Notes |
|---|---|---|
| `StoryIntro` | `CharacterController`'s `onLanded`, once per run, plus a 2.5 s fallback timer after the loader clears | Skippable; `ally.intro.hidden` in `localStorage` |
| `WardstoneOverlay` | The **Stumble** HUD pill, or the intro's "Show me the fall" | Script lives in `src/lib/wardstone.ts` |

Both reuse `.world-modal-*` styling, including the shared medieval frame (Cinzel titles, `.world-rule` ornament, `.world-corner` filigree) — add those to any new modal so the set stays one language.

While either is open, `Medieval.onMove` returns early, so **no door modal can open underneath them**. If you add a third overlay, extend that same guard.

## Door signs

Three hanging plaques (`WorldSign.tsx`): *AWS Architecture Gallery* over the gatehouse arch, *Teammates* at the cottage, *The Way Out* over the stone portal. They are billboarded, so facing solves itself and only position matters.

Position and height both come from **`src/lib/landmarks.ts`**, measured in the running scene. `WorldSign` does not raycast — it used to, and the first hit at a doorway is the roof over that doorway (D14).

A board's XZ is close to its hotspot but **not always equal to it**: the cottage eave and the gatehouse vault both sit where a board wants to be, so those two are pulled out into the open air on the approach side. Never take a position from a GLB text-mesh transform — Mistake B below, in physical form. The `aws` board that used to hang on `Text.001` resolved to world (5.12, 2.98), a building nowhere near the gallery; it is deleted.

## Historical mistakes (do not repeat)

### Mistake A — Team on museum coords

Someone set:

```ts
{ id: "team", pos: [-7.86, -12.12], radius: 1.3 }
```

because the RULEBOOK `Text` mesh’s transformed world XZ landed there. User screenshot proved the museum arch opens Teammates. Those positions are now `docs`.

### Mistake B — Treating mesh names as UX truth

Mesh name `Text` / “RULEBOOK” ≠ “stand here for teammates.” Interaction truth is:

1. User screenshot of desired door  
2. `?debug=1` player xz  
3. Incridea `data.json` location ids as historical anchors  

### Mistake C — Guessing a porch offset

If `[-1, -1]` is slightly wrong for the timber door, **measure** — do not invent `[-1.2, -0.7]` plus a second circle from imagination. One calibrated point beats three guessed ones.

## Calibration procedure

1. Open `http://localhost:3002/?debug`  
2. Walk until feet are centered in the doorway the user cares about  
3. Read the `xz a.bb, c.dd · y e.ff` chip (y is there for sign and heading heights)  
4. Edit only that hotspot’s `pos` / `radius` in `hotspots.ts`  
5. Verify museum arch still opens docs only  
6. Record the final numbers in this doc if they change  

## Relationship to `data.json`

```json
"locations": [
  { "id": 1, "pos": [-1, -1], "href": "" },
  { "id": 4, "pos": [-4, -2.8], "href": "" }
]
```

- id 1 → team hotspot  
- id 4 → portal hotspot  
- `href` empty → local-only (no navigation side effects from data file)  

Stones array is unrelated to modals; it feeds collectible POIs.
