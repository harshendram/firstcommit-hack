/**
 * Measure the AWS gallery and derive every plaque transform.
 *
 * Run this BEFORE changing anything about gallery placement:
 *
 *   node scripts/measure-gallery.mjs
 *
 * It reads the board transforms straight out of `Map.tsx`, applies the same
 * transform chain the renderer does, and prints each wall's flat run, inward
 * normal and the plaque transform that follows from them. It then checks those
 * against the constants committed in `src/lib/gallery.ts` and exits non-zero if
 * they have drifted.
 *
 * This exists because plaques were once placed by typing numbers that looked
 * about right. All four faced into their own wall — which renders the canvas
 * mirrored — sat up to 2 world units off centre, and overlapped the boards they
 * were supposed to label.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const MAP_POSITION = [-4, -3, -6];
const MAP_SCALE = 0.4;
const GALLERY_OFFSET = [-15.5, 0, -5.4];

/** Evaluate a JSX numeric array like `[Math.PI / 2, 0, -0.14]`. */
const evalTriple = (src) =>
  Function("\"use strict\"; return ([" + src + "]);")();

function readBoards() {
  const src = fs.readFileSync(
    path.join(root, "src/components/world/Map.tsx"),
    "utf8",
  );
  const gallery = src.slice(
    src.indexOf("Gallery wall"),
    src.indexOf('name="Text"'),
  );

  const boards = [];
  for (const block of gallery.split("<mesh").slice(1)) {
    const name = block.match(/name="([^"]+)"/)?.[1];
    const pos = block.match(
      /position=\{\[([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\]\}/,
    );
    const rot = block.match(/rotation=\{\[([^\]]+)\]\}/);
    if (!name || !pos) continue;
    // Skip the old festival category signs (Non_technical / Special /
    // technical): they live in the same group but are permanently hidden.
    if (/visible=\{false\}/.test(block)) continue;

    const theta = rot ? evalTriple(rot[1])[2] : 0;
    const local = [Number(pos[1]), Number(pos[2]), Number(pos[3])];
    boards.push({
      name,
      theta,
      x: MAP_POSITION[0] + MAP_SCALE * (GALLERY_OFFSET[0] + local[0]),
      y: MAP_POSITION[1] + MAP_SCALE * local[1],
      z: MAP_POSITION[2] + MAP_SCALE * (GALLERY_OFFSET[2] + local[2]),
      // A quad flat in XZ has normal +Y; Rz(theta) then Rx(PI/2) sends it here.
      inward: [-Math.sin(theta), Math.cos(theta)],
    });
  }
  return boards;
}

function readAssignments() {
  const src = fs.readFileSync(path.join(root, "src/lib/gallery.ts"), "utf8");
  const table = src.slice(src.indexOf("GALLERY_BOARDS"));
  const out = {};
  const re =
    /["']?([A-Za-z0-9_@.\-]+)["']?:\s*\{\s*wall:\s*"(\w+)",\s*role:\s*"(\w+)"(?:,\s*service:\s*"(\w+)")?/g;
  let m;
  while ((m = re.exec(table))) {
    out[m[1]] = { wall: m[2], role: m[3], service: m[4] };
  }
  return out;
}

function readCommittedWalls() {
  const src = fs.readFileSync(path.join(root, "src/lib/gallery.ts"), "utf8");
  const body = src.slice(src.indexOf("GALLERY_WALLS"), src.indexOf("plaqueTransform"));
  const out = {};
  const re =
    /(\w+):\s*\{[^}]*?centre:\s*\[([-\d.]+),\s*([-\d.]+)\][^}]*?width:\s*([\d.]+)/gs;
  let m;
  while ((m = re.exec(body))) {
    out[m[1]] = { centre: [Number(m[2]), Number(m[3])], width: Number(m[4]) };
  }
  return out;
}

const round = (n, p = 3) => Number(n.toFixed(p));
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

const boards = readBoards();
const assign = readAssignments();
const committed = readCommittedWalls();

console.log(`boards parsed: ${boards.length}`);
const unassigned = boards.filter((b) => !assign[b.name]);
if (unassigned.length) {
  console.log(
    `\n!! ${unassigned.length} board(s) with no entry in GALLERY_BOARDS:`,
    unassigned.map((b) => b.name).join(", "),
  );
}

const byWall = {};
for (const b of boards) {
  const a = assign[b.name];
  if (!a) continue;
  (byWall[a.wall] ??= []).push({ ...b, ...a });
}

let failures = 0;

for (const [wall, list] of Object.entries(byWall)) {
  // The flat run is the largest set sharing one theta; plaques only sit there,
  // because the corners splay and a flat plaque would cut into the wall.
  const byTheta = {};
  for (const b of list) (byTheta[round(b.theta, 3)] ??= []).push(b);
  const flat = Object.values(byTheta).sort((a, b) => b.length - a.length)[0];
  const theta = flat[0].theta;
  const inward = flat[0].inward;

  // Run along whichever horizontal axis actually varies.
  const spanX = Math.max(...flat.map((b) => b.x)) - Math.min(...flat.map((b) => b.x));
  const axis = spanX > 0.05 ? "x" : "z";
  const vals = flat.map((b) => b[axis]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const centreAlong = (lo + hi) / 2;
  const wallCoord = axis === "x" ? flat[0].z : flat[0].x;

  const centre =
    axis === "x" ? [round(centreAlong), round(wallCoord)] : [round(wallCoord), round(centreAlong)];
  const width = round(hi - lo + 0.34, 2);

  const shown = list.filter((b) => b.role !== "hidden");
  const services = [...new Set(shown.map((b) => b.service))];

  console.log(`\n[${wall}] ${list.length} boards, ${shown.length} shown, ${list.length - shown.length} hidden`);
  console.log(`  flat run : ${flat.length} boards, ${axis} ${round(lo)} .. ${round(hi)}`);
  console.log(`  theta    : ${round(theta)}  inward (${round(inward[0], 2)}, ${round(inward[1], 2)})`);
  console.log(`  rotationY: ${round(Math.atan2(inward[0], inward[1]))}`);
  console.log(`  centre   : [${centre[0]}, ${centre[1]}]`);
  console.log(`  width    : ${width} (uncapped)`);
  console.log(`  services : ${services.join(", ") || "-"}`);

  const dupes = services.filter(
    (s) => shown.filter((b) => b.service === s && b.role === "logo").length > 1,
  );
  if (dupes.length) {
    console.log(`  !! duplicate logo(s): ${dupes.join(", ")}`);
    failures++;
  }
  for (const s of services) {
    const roles = shown.filter((b) => b.service === s).map((b) => b.role).sort();
    if (roles.join(",") !== "logo,placard") {
      console.log(`  !! ${s} should be exactly one logo + one placard, got: ${roles.join(",")}`);
      failures++;
    }
  }

  const c = committed[wall];
  if (!c) {
    console.log("  !! no committed entry in GALLERY_WALLS");
    failures++;
  } else if (!near(c.centre[0], centre[0]) || !near(c.centre[1], centre[1])) {
    console.log(
      `  !! GALLERY_WALLS.centre is [${c.centre}] but the flat run measures [${centre}]`,
    );
    failures++;
  } else if (c.width > width + 0.001) {
    console.log(`  !! committed width ${c.width} exceeds the flat run's ${width}`);
    failures++;
  }
}

const topY = -2.539 + 0.4 / 2;
console.log(
  `\nboard top y ${round(topY)} -> plaque centre y ${round(topY + 0.1 + 0.3 / 2)}`,
);

// Two plaques share the front wall; they must not touch.
const front = ["signal", "understand"]
  .map((id) => committed[id])
  .filter(Boolean);
if (front.length === 2) {
  const [a, b] = front.sort((p, q) => p.centre[0] - q.centre[0]);
  const gap = b.centre[0] - b.width / 2 - (a.centre[0] + a.width / 2);
  console.log(`front-wall plaque gap: ${round(gap)}`);
  if (gap <= 0) {
    console.log("  !! the two front-wall plaques overlap");
    failures++;
  }
}

/* ---- museum furniture ------------------------------------------------- */

// The room centre is the mid-range of the board extents, NOT their centroid:
// the centroid skews left because the east side is the open entrance.
const xs = boards.map((b) => b.x);
const zs = boards.map((b) => b.z);
const bounds = {
  x: [Math.min(...xs), Math.max(...xs)],
  z: [Math.min(...zs), Math.max(...zs)],
};
const centre = [
  round((bounds.x[0] + bounds.x[1]) / 2),
  round((bounds.z[0] + bounds.z[1]) / 2),
];

console.log(
  `
room bounds: x ${round(bounds.x[0])} .. ${round(bounds.x[1])}   z ${round(bounds.z[0])} .. ${round(bounds.z[1])}`,
);
console.log(`room centre: [${centre[0]}, ${centre[1]}]`);

const museum = fs.readFileSync(path.join(root, "src/lib/museum.ts"), "utf8");
const cm = museum.match(/ROOM_CENTRE:\s*\[number,\s*number\]\s*=\s*\[([-\d.]+),\s*([-\d.]+)\]/);
const ring = Number(museum.match(/STONE_RING\s*=\s*([\d.]+)/)?.[1] ?? 0);

if (!cm) {
  console.log("  !! could not read ROOM_CENTRE from lib/museum.ts");
  failures++;
} else if (!near(Number(cm[1]), centre[0], 0.05) || !near(Number(cm[2]), centre[1], 0.05)) {
  console.log(`  !! museum.ts ROOM_CENTRE is [${cm[1]}, ${cm[2]}] but the room measures [${centre}]`);
  failures++;
}

// Each stone's stored XZ must match its own angle on the ring, and sit inside
// the room with clearance from the walls.
const stoneRe = /angle:\s*(-?[\d.]+),\s*at:\s*\[([-\d.]+),\s*([-\d.]+)\]/g;
let sm;
let stones = 0;
while ((sm = stoneRe.exec(museum.replace(/\s+/g, " ")))) {
  stones++;
  const a = (Number(sm[1]) * Math.PI) / 180;
  const want = [centre[0] + Math.cos(a) * ring, centre[1] + Math.sin(a) * ring];
  const got = [Number(sm[2]), Number(sm[3])];
  if (!near(want[0], got[0], 0.05) || !near(want[1], got[1], 0.05)) {
    console.log(
      `  !! stone at ${sm[1]}deg is [${got}] but the ring puts it at [${round(want[0])}, ${round(want[1])}]`,
    );
    failures++;
  }
  const margin = 0.3;
  if (
    got[0] < bounds.x[0] + margin ||
    got[0] > bounds.x[1] - margin ||
    got[1] < bounds.z[0] + margin ||
    got[1] > bounds.z[1] - margin
  ) {
    console.log(`  !! stone [${got}] is outside the room, or too close to a wall`);
    failures++;
  }
}
console.log(`stones on the ring (r=${ring}): ${stones}`);

console.log(failures ? `\nFAILED (${failures})` : "\nOK — committed constants match the scene");
process.exit(failures ? 1 : 0);
