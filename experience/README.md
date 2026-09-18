# Suraksha — Explore (`experience/`)

Walkable medieval 3D world (Incridea `explore_2025` port) with Suraksha overlays: museum = AWS docs, Tudor door = teammates, portal = main website.

```powershell
npm install
npm run dev          # http://localhost:3002
# http://localhost:3002/?debug  → live player xz for hotspot calibration
```

## Agent / maintainer documentation

**Start here:** [`docs/README.md`](./docs/README.md)

| Doc | Contents |
|-----|----------|
| [docs/AGENT-HANDOFF.md](./docs/AGENT-HANDOFF.md) | How to work in this app without repeating old mistakes |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Boot path, components, data flow |
| [docs/DECISIONS-AND-ASSUMPTIONS.md](./docs/DECISIONS-AND-ASSUMPTIONS.md) | Product/UI decisions and assumptions |
| [docs/PROBLEMS-AND-FIXES.md](./docs/PROBLEMS-AND-FIXES.md) | Full incident log (hotspots, white bar, camera, etc.) |
| [docs/HOTSPOTS-AND-MODALS.md](./docs/HOTSPOTS-AND-MODALS.md) | Portal / docs / team interaction |
| [docs/COORDINATE-SYSTEM.md](./docs/COORDINATE-SYSTEM.md) | World space math and calibration |
| [docs/MUSEUM-AND-AWS-GALLERY.md](./docs/MUSEUM-AND-AWS-GALLERY.md) | Museum service boards |
| [docs/UI-AND-HUD.md](./docs/UI-AND-HUD.md) | Sound, Main Website, scroll lock, CSS |
| [docs/KNOWN-ISSUES.md](./docs/KNOWN-ISSUES.md) | Residual risks and stubs |

## Routes

| Route | What |
|-------|------|
| `/` | Medieval world (loader → walk). No separate enter-gate. |
| `/classic` | Written Suraksha landing; also Main Website / no-WebGL fallback |

## Hotspots (summary)

Source of truth: `src/lib/hotspots.ts`

- **Portal** `[-4, -2.8]` → leave world  
- **Docs** museum arch / gallery → Suraksha AWS stack (7 services)  
- **Team** `[-1, -1]` → teammates (Tudor / rulebook door)  

Docs win on overlap. Calibrate with `?debug` — do not guess coords from mesh names.

## Main website URL

`NEXT_PUBLIC_ALLY_APP_URL` (default `/classic` via `.env.local` / `src/lib/config.ts`).
