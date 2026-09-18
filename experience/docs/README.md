# Suraksha Experience — documentation index for agents

This folder is the **source of truth** for the 3D Explore frontend under [`firstcommit/experience/`](../). Read these files **before** changing UI, hotspots, museum walls, camera, audio, or HUD behavior.

The root [`README.md`](../README.md) in this app is **stale** (it still describes shrines, an entry gate, and `world.ts`). Prefer this `docs/` folder.

## Read order for a new agent

1. [AGENT-HANDOFF.md](./AGENT-HANDOFF.md) — how to work in this codebase without repeating old mistakes  
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — boot path, component ownership, data flow  
3. [DECISIONS-AND-ASSUMPTIONS.md](./DECISIONS-AND-ASSUMPTIONS.md) — every intentional product/UI decision and the assumptions behind it  
4. [PROBLEMS-AND-FIXES.md](./PROBLEMS-AND-FIXES.md) — every bug that was hit during the Incridea port and Suraksha overlay work, with root cause and fix  
5. [HOTSPOTS-AND-MODALS.md](./HOTSPOTS-AND-MODALS.md) — portal / docs / team interaction design  
6. [COORDINATE-SYSTEM.md](./COORDINATE-SYSTEM.md) — world space, Map transforms, how to calibrate doors without guessing  
7. [MUSEUM-AND-AWS-GALLERY.md](./MUSEUM-AND-AWS-GALLERY.md) — gallery posters, headings, AWS service boards  
8. [UI-AND-HUD.md](./UI-AND-HUD.md) — Sound, Main Website, touch pad, scroll lock, CSS  
9. [KNOWN-ISSUES.md](./KNOWN-ISSUES.md) — residual risks and intentional stubs  

## Product context (one paragraph)

Suraksha is a quiet-care product story. The Explore app at **http://localhost:3002** is a medieval 3D walkable world ported from Incridea’s `explore_2025` (Ryoko character, fantasy map, portal, stones). Suraksha-specific meaning is layered on top: museum = AWS documentation, Tudor cottage door = teammates, teal portal = leave to the written site. The written landing lives at `/classic` in the same Next app. The separate `web/` app on port 3000 is optional; locally Main Website points at `/classic` so the button never dies.

## Non-negotiables

- Do **not** invent new world geometry or replace Incridea Map/Character/Controller with hand-rolled substitutes. Overlay Suraksha meaning; keep the ported look.  
- Do **not** put Teammates on the museum stone arch. Museum = Documentation. Team = Tudor/rulebook door.  
- Do **not** guess hotspot coordinates. Use `?debug=1` xz or Incridea `data.json` locations.  
- Do **not** reintroduce TECHNICAL / NON TECHNICAL / WELL-ARCHITECTED heading boards inside the museum. Service logos only.  
- Do **not** edit plan files as a substitute for code; implement in the source tree.  
- Local-first: no GraphQL / remote explore backend unless the user explicitly asks to wire cloud again.
