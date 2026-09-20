# Museum and AWS gallery

## Intent

When the player walks into the stone museum / gallery, the walls should read as **Suraksha’s AWS stack**, not Incridea festival events, not AWS Well-Architected marketing posters, and not TECHNICAL / NON TECHNICAL category signs.

Documentation modal content must match the walls.

## Files

| File | Role |
|------|------|
| `src/lib/gallery.ts` | **Measured constants**: wall transforms + per-board assignments |
| `scripts/measure-gallery.mjs` | Re-derives them from the scene; run before any placement change |
| `src/components/world/AwsGallery.tsx` | Build canvas textures + materials |
| `src/components/world/GallerySigns.tsx` | Wall headings + door signs, in world space |
| `src/components/world/WorldSign.tsx` | Two-sided `Plaque`, `WorldSign` at a measured height |
| `src/lib/landmarks.ts` | **Measured** board and beacon placement for the three doors |
| `src/components/world/Map.tsx` | Assign materials/visibility to poster meshes |
| `src/lib/hotspots.ts` → `ALLY_SERVICES` | Canonical service list + copy |
| `public/aws/*.svg` | Icon artwork |
| `src/components/world/WorldModals.tsx` | Docs modal consumes `ALLY_SERVICES` |

## Canonical service set

Order matters for cycling (`pickService(mats, i)` uses `i % length`):

1. AWS Lambda — `lambda.svg`  
2. Amazon Bedrock — `bedrock.svg`  
3. Amazon Nova — `nova.svg`  
4. Amazon DynamoDB — `dynamodb.svg`  
5. AWS Step Functions — `stepfunctions.svg`  
6. Amazon Polly — `polly.svg`  
7. Amazon Transcribe — `transcribe.svg`  
8. Amazon Textract — `textract.svg`  
9. Amazon Comprehend Medical — `comprehend-medical.svg`  
10. Amazon SNS — `sns.svg`  
11. Amazon Connect — `connect.svg`  
12. Amazon S3 — `s3.svg`  

Lambda / Bedrock / DynamoDB / Step Functions icons were copied in the official Architecture Icons style earlier. The rest are simplified local SVGs with correct names and brand-adjacent colors (teal for the ML services, pink for the messaging ones, green for storage). Prefer swapping in official icons later without changing labels or `ALLY_SERVICES` ids.

This is the subset the gallery shows, chosen because each one is visible in the story a visitor walks through. The full service map — 17 services, 63 CloudFormation resources — is in [`docs/AWS-ARCHITECTURE.md`](../../docs/AWS-ARCHITECTURE.md).

## Wall grouping and plaques — measured, never typed

**Run `node scripts/measure-gallery.mjs` before touching gallery placement.** It reads the board transforms out of `Map.tsx`, applies the same transform chain the renderer does, prints each wall's flat run / inward normal / plaque transform, and fails if the committed constants in `src/lib/gallery.ts` have drifted from the scene.

This exists because plaques were once placed by typing numbers that looked right. All four faced into their own wall, up to 2 world units off centre, and hung low enough to cover the boards they labelled.

### Geometry facts

- A board is a **1×1 quad flat in XZ**, rotated `[PI/2, 0, theta]`.
- Its **inward normal is `(-sin theta, 0, cos theta)`** — derive facing from this, never by trying signs until it looks right.
- Under Map's `position [-4,-3,-6] scale 0.4` a board is **0.4 world** across, sits at world **y −2.539**, top edge **−2.339**.
- The room is a **rounded rectangle**: each wall has a flat middle run with boards splaying around the corners. Plaques only sit on the flat run.

### The four walls

| Wall | Boards | Flat run (world) | Inward | Plaque rotation | Plaque width |
|---|---|---|---|---|---|
| `signal` — I · The Signal | 6 | x −11.23…−10.37 @ z −9.59 | (0,0,−1) | `[0, PI, 0]` | 1.05 |
| `understand` — II · Understanding Her | 7 | x −12.50…−11.66 @ z −9.59 | (0,0,−1) | `[0, PI, 0]` | 1.05 |
| `find` — III · Finding Someone | 8 | x −12.62…−10.86 @ z −15.16 | (0,0,+1) | `[0, 0, 0]` | 2.10 |
| `remember` — IV · What It Remembers | 4 | z −13.23…−11.91 @ x −14.385 | (+1,0,0) | `[0, PI/2, 0]` | 1.66 |

`signal` and `understand` share **one** front wall, centres 1.28 apart, so both plaques are capped at 1.05 to leave a 0.23 gap. The script checks this.

All plaques sit at **world y −2.089** (board top + 0.1 gap + half of 0.3 height) with a 0.03 standoff along the inward normal.

Plaques and door signs are mounted by `GallerySigns.tsx` as a **sibling of `Map`**, in world space. Do not move them inside `Map` — it carries `scale 0.4` and `position [-4,-3,-6]`, which would silently transform world coordinates.

### Board content — one logo each, with a placard

`GALLERY_BOARDS` in `src/lib/gallery.ts` states per mesh what it shows. There is **no cycling index**: `services[i % n]` is what put six identical Lambda boards in a row on the one-service wall.

| Wall | Shown | Pairs | Hidden |
|---|---|---|---|
| `signal` | 2 of 6 | Lambda | 4 |
| `understand` | 6 of 7 | Transcribe, Bedrock, Nova | 1 |
| `find` | 4 of 8 | Step Functions, Polly | 4 |
| `remember` | 2 of 4 | DynamoDB | 2 |

14 shown, 11 hidden. Every visible service appears **exactly once**, as a logo with its placard (its `title` + `body` from `ALLY_SERVICES`) on the next board along. Surplus boards are `visible={false}` — bare stone between sections is the spacing, not a gap to fill. The script fails if a logo repeats or a service loses its placard.

## The furniture in the middle

Mounted by `GallerySigns.tsx` in **world space** (a sibling of `Map`, which carries `scale 0.4`). Constants in `src/lib/museum.ts`, checked by `scripts/measure-gallery.mjs`.

| Piece | Where | Notes |
|---|---|---|
| Table | room centre **(−11.79, −12.38)** | `arabic_table.glb`. **Z-up** (1.126 × 1.126 × 0.905, X = Y), so `rotation-x = -PI/2` or it lies on its side. Scale derived from a `Box3`, one cuboid collider. |
| Tome | on the table | A closed box wearing `bookCoverTexture.jpg`. Click target only — the book itself is a DOM modal. |
| Five stones | radius-2.0 ring | `stone.glb`, emissive, additive glow sprite (**no new lights**). Click to open. |

The room centre is the **mid-range** of the board extents, not their centroid — the centroid skews left because the east side is the open entrance. The ring skips the ~48° arc the entrance occupies. Floor height is raycast at mount, never typed.

`measure-gallery.mjs` fails if `ROOM_CENTRE` drifts, if a stone's stored XZ stops matching its own ring angle, or if one comes within 0.3 of a wall.

## The book is not a mesh

`bookCoverTexture.jpg` (575×360) and `pageTexture.jpg` (450×800) are Incridea's tome art, and their book was `BookModal.tsx` — an `HTMLFlipBook` from **`react-pageflip`**. Ours is the same, with the architecture on the pages instead of sponsors and the diagrams as inline SVG.

**There is no book GLB and there never was.** `world.glb` has `Scene_Book-tittle_0`, but it is a zero-thickness title decal at world y −7.7 — about 4.5 units below the walkable ground. The village is built *on* the Sketchfab "Medieval Fantasy Book", which is why the map key is `medieval_fantasy_book`; the pages are the terrain. See D12.

## Material pipeline

1. `useGalleryMaterials()` loads each SVG, draws a parchment board (cream fill, border, icon, label).  
2. Creates `MeshStandardMaterial` with that map (`roughness` ~0.72, `DoubleSide`).  
3. Keys logos into `mats.byId` and placards into `mats.placards`, both by `ALLY_SERVICES` id.  
4. `pickBoard(gallery, meshName, fallback)` returns the material that mesh is assigned, or `null` if it should be hidden.

### UV correction (mandatory)

Without this, boards appear mirrored from inside:

```ts
tex.flipY = false;
tex.wrapS = THREE.RepeatWrapping;
tex.repeat.x = -1;
tex.offset.x = 1;
```

## Heading meshes — hidden

These festival category signs remain in the GLB but must stay invisible:

- `Non_technical`  
- `Special`  
- `technical`  

In `Map.tsx` each has `visible={false}`. Do not re-enable them to “fill empty space.” Empty air is better than wrong taxonomy.

Also hidden:

- `Text` (old RULEBOOK letters) — world (−1.66, −9.96)  
- `Text001` (old EVENTS letters) — world (5.12, 2.98). **Nothing replaces it.** The plane that used to hang here is gone; the gallery is named by a `WorldSign` on its arch hotspot instead.  

## What was removed from the gallery path

Earlier Suraksha overlay experimented with:

- `WA_PILLARS` Well-Architected boards  
- `CARE_BOARDS` care-loop slogan boards  
- `HEADINGS` (“WELL-ARCHITECTED”, “ALLY STACK”, “CARE LOOP”)  

Those code paths were deleted from `AwsGallery.tsx`. Do not resurrect them on the walls. If WA content is needed, put it in `/classic` prose, not the museum GLB.

## Poster assignment

All 25 square poster meshes call `pickBoard(gallery, meshName, fallback)`, which looks the mesh up in `GALLERY_BOARDS` and returns its logo material, its placard material, or `null` for hidden. No service is ever drawn twice.

## Docs modal alignment

`WorldModals` `DocsBody`:

- Hero row of all seven icons  
- Chip row of service names  
- List of `title` + `body` from `ALLY_SERVICES`  
- CTA to `/classic`  

If you add/remove a service, change **one** place: `ALLY_SERVICES` (and add/remove the SVG). Gallery and modal both derive from it.

## Out of scope for museum walls

- Live CloudWatch metrics  
- Clickable posters that open external AWS docs  
- Per-poster unique art beyond the cycling service set  
- Restoring festival event artwork for nostalgia  

## Verification checklist

- [ ] No visible “TECHNICAL” / “NON TECHNICAL” / “SPECIAL” words in the museum  
- [ ] `node scripts/measure-gallery.mjs` exits 0  
- [ ] Four wall headings visible (I–IV), flat against their wall, above the boards, not overlapping them  
- [ ] The two front-wall plaques do not touch  
- [ ] Headings and door signs read left-to-right from **either** side  
- [ ] No logo appears twice anywhere; each visible logo has its placard beside it  
- [ ] No `aws` wordmark board anywhere, least of all on a house  
- [ ] Logos readable (not mirrored) from the walkable floor  
- [ ] Polly, Transcribe, and Nova each appear at least once on a wall  
- [ ] Standing at museum arch opens Documentation, not Teammates  
- [ ] Docs modal lists the same seven services as the walls  
