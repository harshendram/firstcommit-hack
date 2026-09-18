import {
  Cinzel,
  EB_Garamond,
  Instrument_Sans,
  JetBrains_Mono,
  Noto_Sans_Devanagari,
  Syne,
} from "next/font/google";

/**
 * Carved Roman capitals — the world's medieval voice. Titles and eyebrows only;
 * body copy stays Instrument Sans because Cinzel is miserable to read at length.
 */
export const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["500", "700", "900"],
  variable: "--font-carved",
  display: "swap",
});

/**
 * The tome's face.
 *
 * EB Garamond is a revival of a 16th-century type — old enough to belong in a
 * book on a table in this village, and cut for continuous reading, which the
 * alternatives are not. Cinzel is carved Roman capitals and unreadable below a
 * heading; the genuinely antique faces (IM Fell and friends) keep their worn
 * inking, which is charming for three words and punishing for a paragraph.
 */
export const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-grimoire",
  display: "swap",
});

export const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-instrument",
  display: "swap",
});

export const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-syne",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

// Instrument Sans has no Devanagari glyphs; Hindi text falls through to Noto.
export const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-devanagari",
  display: "swap",
});
