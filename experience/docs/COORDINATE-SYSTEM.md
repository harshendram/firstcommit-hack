# Coordinate system and calibration

## Spaces

There are three spaces you must not confuse:

1. **GLB local space** — coordinates inside `world.glb` as authored / exported.  
2. **Map group space** — after Map’s internal hierarchy (including the gallery subgroup).  
3. **World / physics space** — what `playerPosition` and hotspots use (the space `CharacterController` lives in).

Hotspots are always authored in **world XZ** (`pos: [x, z]`, y ignored).

## Map placement

From `Medieval.tsx`:

```ts
maps.medieval_fantasy_book = {
  scale: 0.4,
  position: [-4, -3, -6],
};
```

Approximation for a point expressed in Map-root local coordinates `(lx, ly, lz)`:

```
world = Map.position + Map.scale * (lx, ly, lz)
world.x = -4 + 0.4 * lx
world.y = -3 + 0.4 * ly
world.z = -6 + 0.4 * lz
```

## Gallery subgroup

Inside `Map.tsx`, poster meshes sit under:

```tsx
<group position={[-15.5, 0, -5.4]}>
  {/* poster meshes with their own local positions */}
</group>
```

For a poster local to the gallery group `(gx, gy, gz)`:

```
mapLocal = (-15.5 + gx, 0 + gy, -5.4 + gz)
world = Map.position + 0.4 * mapLocal
```

### Example — gallery entrance poster

Poster `Escape_RoomSquar-1` at gallery-local `[-4.698, 1.151, -3.57]`:

```
mapLocal ≈ (-20.198, 1.151, -8.97)
world.xz ≈ (-12.08, -9.59)
```

That is why docs hotspots also exist near `[-11.2, -8.6]` / `[-10.4, -9.4]` — they catch the gallery mouth, not only the outer arch.

### Example — RULEBOOK Text mesh (trap)

`Text` at gallery-local `[5.845, 4.329, -9.904]`:

```
mapLocal ≈ (-9.655, 4.329, -15.304)
world.xz ≈ (-7.86, -12.12)
```

This XZ **fires at the museum approach** when used as a proximity center. It is **not** a safe Tudor-door anchor despite the mesh historically saying RULEBOOK.

### Example — EVENTS Text001

`Text001` at gallery-local `[22.804, 3.06, 22.442]`:

```
world.xz ≈ (-1.08, 0.82)
```

Near the rulebook location `[-1, -1]`. The AWS logo board replaces the EVENTS letters here; this is **not** the museum interior.

## Player spawn and fail-safes

- Spawn RigidBody position: `[0.4, 8, -3]` (falls onto the map).  
- Respawn if `playerPosition.y < -9`.  
- Camera child offsets on the character group: look target `z=1`, camera seat `y=0.5, z=-1.5` (local to the yaw container).

## Portal visual vs hotspot

- Portal GLB is placed near the teal gate (see `Portal.tsx` for exact props).  
- Interaction circle is `portal` hotspot `[-4, -2.8]`.  
Keep visual and hotspot within ~1 m of each other or players will feel the modal is “wrong.”

## How to convert a new mesh into a hotspot (safe method)

1. Note the mesh’s local position and parent chain in `Map.tsx`.  
2. Accumulate parent translates (gallery group, Map root).  
3. Apply Map `scale` and `position` to get world XZ.  
4. **Do not ship yet.** Open `?debug=1`, walk to the interactable doorway, compare chip vs computed value.  
5. Prefer the **player feet reading** over the mesh center if they disagree (doors are walked into; mesh pivots may sit in walls or above porches).  
6. Choose radius so the circle covers the porch but does not reach a different building’s door.

## Debug UX

`Medieval` reads `?debug` (or `?debug=1`) from the query string and renders:

```
xz 12.34, -5.67
```

This is the only approved calibration instrument. Do not add permanent on-screen coords for production demos unless the user asks.

## Why guessing fails here

The map is dense: museum arch, gallery interior, timber houses, and portal sit within a small absolute XZ range. A 3–4 meter mistake (one wrong Text transform) swaps entire buildings’ meanings. That is exactly how Teammates ended up on the museum entrance.
