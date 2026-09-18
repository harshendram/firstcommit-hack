/** Static asset paths. Mirrors Incridea's CONSTANT.ASSETS pattern — plain public/ paths, no CDN. */
export const ASSETS = {
  WORLD: "/world/world.glb",
  CHARACTER: "/world/character.glb",
  PORTAL: "/world/portal.glb",
  STONE: "/world/stone.glb",
  LOADING_BACKGROUND: "/world/loading_background.webp",
  LOADING_FOREGROUND: "/world/loading_foreground.webp",
  STONE_IMG: "/world/stone.webp",
  /** Round table for the middle of the gallery. Z-up, ~0.9m, one baked material. */
  TABLE: "/world/arabic_table.glb",
  /** Already Y-up with its base on y=0; front (cabinet doors) faces -Z. */
  BOOKSHELF: "/world/old_bookshelf_low_poly.glb",
  /** Wall sconce. Already Y-up; base sits at y -0.317, so it needs seating. */
  TORCH: "/world/torch.glb",
  /** Incridea's tome art, reused for the architecture book. */
  BOOK_COVER: "/world/bookCoverTexture.jpg",
  BOOK_PAGE: "/world/pageTexture.jpg",
  /** The Temple Run track from Incridea's level 2 — the vibe, verbatim. */
  THEME: "/world/templerun.mp3",
  /** Swapped in at the final shrine, the way Incridea swapped stings. */
  THEME_END: "/world/nether.mp3",
  /**
   * Background theme. Parentheses are legal in a URL but encoded anyway so the
   * path survives any stricter consumer.
   */
  MUSIC: "/Assassin_s_Creed_2_-_Ezio_s_Family_Theme_%28mp3.pm%29.mp3",
  /** Self-hosted so the world never depends on the gstatic CDN to decode Draco. */
  DRACO: "/draco/",
} as const;
