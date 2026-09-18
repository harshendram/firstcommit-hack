"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { GALLERY_BOARDS } from "@/lib/gallery";
import { ALLY_SERVICES } from "@/lib/hotspots";

const SERVICE_ICONS = ALLY_SERVICES.map((s) => ({
  file: s.icon,
  label: s.service.replace(/^AWS |^Amazon /, ""),
}));

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Canvas → texture oriented for Incridea poster UVs (readable from inside). */
function canvasTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = -1;
  tex.offset.x = 1;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Same canvas, no mirror.
 *
 * `canvasTexture` flips X to match Incridea's inward-facing poster UVs. Any
 * geometry we create ourselves has ordinary UVs, so reusing that helper on a
 * sign renders every word backwards. Headings and plaques use this instead.
 */
function plainTexture(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w = 512,
  h = 512,
) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Largest font size at which `text` fits `maxWidth`, never below `min`. */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  start: number,
  weight = 700,
  min = 10,
) {
  let size = start;
  const font = (s: number) =>
    `${weight} ${Math.round(s)}px Georgia, 'Times New Roman', serif`;
  ctx.font = font(size);
  while (ctx.measureText(text).width > maxWidth && size > min) {
    size -= 1;
    ctx.font = font(size);
  }
  return size;
}

/**
 * Carved wooden plaque for door signs and gallery wall headings.
 *
 * The canvas is generated at the plane's own aspect ratio so nothing stretches,
 * and the title auto-shrinks to fit the padded box, so a long heading can never
 * overflow the board. `mirrored` draws the same plaque flipped in X — see
 * `Plaque` in `WorldSign.tsx`, which puts one on each face so the text reads
 * from either side and a wrong rotation can no longer produce mirrored words.
 */
export function signTexture(
  title: string,
  opts: { subtitle?: string; aspect?: number; mirrored?: boolean } = {},
) {
  const { subtitle, aspect = 4, mirrored = false } = opts;
  const W = 1024;
  const H = Math.max(128, Math.round(W / aspect));

  return plainTexture(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      if (mirrored) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }

      const inset = Math.round(h * 0.05);
      const r = Math.round(h * 0.14);

      ctx.fillStyle = "#6b5235";
      ctx.beginPath();
      ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, r);
      ctx.fill();

      const inset2 = Math.round(h * 0.12);
      ctx.fillStyle = "#7d6140";
      ctx.beginPath();
      ctx.roundRect(inset2, inset2, w - inset2 * 2, h - inset2 * 2, r * 0.7);
      ctx.fill();
      ctx.strokeStyle = "#caa76f";
      ctx.lineWidth = Math.max(2, h * 0.018);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Flourishes claim their own margin so the title never collides.
      const flourish = Math.round(h * 0.3);
      const sideGap = Math.round(h * 0.42);
      const boxWidth = w - sideGap * 2 - inset2 * 2;
      const mid = subtitle ? h * 0.4 : h * 0.5;

      ctx.fillStyle = "#f6e9cf";
      const size = fitFont(ctx, title.toUpperCase(), boxWidth, h * 0.42);
      ctx.font = `700 ${Math.round(size)}px Georgia, 'Times New Roman', serif`;
      ctx.fillText(title.toUpperCase(), w / 2, mid);

      if (subtitle) {
        ctx.fillStyle = "#d7bd90";
        const s2 = fitFont(ctx, subtitle, boxWidth, h * 0.2, 500);
        ctx.font = `500 ${Math.round(s2)}px Georgia, 'Times New Roman', serif`;
        ctx.fillText(subtitle, w / 2, h * 0.72);
      }

      ctx.fillStyle = "#caa76f";
      ctx.font = `${flourish}px Georgia, serif`;
      ctx.fillText("✦", inset2 + sideGap * 0.5, mid);
      ctx.fillText("✦", w - inset2 - sideGap * 0.5, mid);
    },
    W,
    H,
  );
}

async function serviceBoard(file: string, label: string) {
  const img = await loadImage(`/aws/${file}`);
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = "#f7f1e8";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "#c9b79a";
    ctx.lineWidth = 12;
    ctx.strokeRect(14, 14, size - 28, size - 28);
    const pad = 70;
    ctx.drawImage(img, pad, pad - 20, size - pad * 2, size - pad * 2 - 40);
    ctx.fillStyle = "#3a3228";
    ctx.font = "700 36px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, size / 2, size - 42);
  });
}

/**
 * The placard beside a logo: what that service does, in the words already
 * written in `ALLY_SERVICES` and already shown in the docs modal.
 *
 * Uses `canvasTexture` — the mirrored one — because a placard is one of the
 * Incridea poster meshes, so it must follow their inward-facing UV convention
 * exactly as the logo boards do.
 */
function placardBoard(title: string, body: string) {
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = "#f7f1e8";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "#c9b79a";
    ctx.lineWidth = 12;
    ctx.strokeRect(14, 14, size - 28, size - 28);

    ctx.textAlign = "center";
    ctx.fillStyle = "#3a3228";
    ctx.font = "700 52px Georgia, 'Times New Roman', serif";
    ctx.fillText(title, size / 2, 128);

    ctx.strokeStyle = "#c9b79a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(size * 0.26, 158);
    ctx.lineTo(size * 0.74, 158);
    ctx.stroke();

    // Wrap the body by hand; canvas has no line breaking.
    ctx.fillStyle = "#5c5245";
    ctx.font = "400 34px Georgia, 'Times New Roman', serif";
    const max = size - 96;
    const lines: string[] = [];
    let line = "";
    for (const word of body.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > max && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    lines.slice(0, 7).forEach((l, i) => {
      ctx.fillText(l, size / 2, 214 + i * 44);
    });
  });
}

export type GalleryMats = {
  /** Logo boards, keyed by ALLY_SERVICES id. */
  byId: Record<string, THREE.MeshStandardMaterial>;
  /** Placard boards, keyed by the same ids. */
  placards: Record<string, THREE.MeshStandardMaterial>;
  services: THREE.MeshStandardMaterial[];
};

export function useGalleryMaterials() {
  const [mats, setMats] = useState<GalleryMats | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const serviceTex = await Promise.all(
        SERVICE_ICONS.map((s) => serviceBoard(s.file, s.label)),
      );
      if (!alive) return;
      const toMat = (map: THREE.CanvasTexture) =>
        new THREE.MeshStandardMaterial({
          map,
          roughness: 0.72,
          metalness: 0.04,
          side: THREE.DoubleSide,
        });
      const services = serviceTex.map(toMat);
      const byId: Record<string, THREE.MeshStandardMaterial> = {};
      const placards: Record<string, THREE.MeshStandardMaterial> = {};
      ALLY_SERVICES.forEach((svc, i) => {
        byId[svc.id] = services[i]!;
        placards[svc.id] = toMat(placardBoard(svc.title, svc.body));
      });
      setMats({ byId, placards, services });
    })();
    return () => {
      alive = false;
    };
  }, []);

  return mats;
}

/**
 * What a given board shows, straight from the assignment table — no cycling
 * index. The old `services[i % n]` is what put six identical Lambda boards in
 * a row on the one-service wall.
 *
 * Returns `null` for a board that should be hidden.
 */
export function pickBoard(
  mats: GalleryMats | null,
  meshName: string,
  fallback: THREE.Material,
): THREE.Material | null {
  const a = GALLERY_BOARDS[meshName];
  if (!a || a.role === "hidden") return null;
  if (!mats || !a.service) return fallback;
  const table = a.role === "placard" ? mats.placards : mats.byId;
  return table[a.service] ?? fallback;
}
