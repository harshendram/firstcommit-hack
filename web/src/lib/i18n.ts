import type { SurakshaLanguage } from "./surakshaTypes";

const STRINGS = {
  talk: { "hi-IN": "बोलिए", "en-IN": "Talk" },
  listening: { "hi-IN": "सुन रही हूँ… बोलकर फिर से दबाएँ", "en-IN": "Listening… tap again when you're done" },
  thinking: { "hi-IN": "सोच रही हूँ…", "en-IN": "Thinking…" },
  typeHere: { "hi-IN": "यहाँ लिखें…", "en-IN": "Type here…" },
  send: { "hi-IN": "भेजें", "en-IN": "Send" },
  imOkay: { "hi-IN": "मैं ठीक हूँ", "en-IN": "I'm okay" },
  done: { "hi-IN": "हो गया", "en-IN": "Done" },
  yes: { "hi-IN": "हाँ", "en-IN": "Yes" },
  no: { "hi-IN": "नहीं", "en-IN": "No" },
  okay: { "hi-IN": "ठीक है", "en-IN": "Okay" },
  startAlly: { "hi-IN": "Suraksha शुरू करें", "en-IN": "Start Suraksha" },
  startHint: {
    "hi-IN": "एक बार दबाएँ ताकि Suraksha बोल सके।",
    "en-IN": "Tap once so Suraksha can speak out loud.",
  },
  tapToHear: { "hi-IN": "सुनने के लिए दबाएँ", "en-IN": "Tap to hear" },
  privacy: { "hi-IN": "Suraksha ने मेरे बारे में क्या बताया", "en-IN": "What Suraksha shared about me" },
  confirmRule: { "hi-IN": "क्या यह सही है?", "en-IN": "Is this right?" },
  notHeard: {
    "hi-IN": "माफ़ कीजिए, सुनाई नहीं दिया। फिर से बोलिए या लिख दीजिए।",
    "en-IN": "Sorry, I didn't catch that. Please try again or type.",
  },
  micBlocked: { "hi-IN": "माइक की अनुमति नहीं मिली।", "en-IN": "Microphone permission was denied." },
  goodMorning: { "hi-IN": "सुप्रभात", "en-IN": "Good morning" },
  reminder: { "hi-IN": "याद दिलाना", "en-IN": "Reminder" },
  checkingIn: { "hi-IN": "Suraksha पूछ रही है", "en-IN": "Suraksha is checking in" },
  question: { "hi-IN": "Suraksha का सवाल", "en-IN": "A question from Suraksha" },
  noteFromFamily: { "hi-IN": "परिवार का संदेश", "en-IN": "A note from family" },
  update: { "hi-IN": "खबर", "en-IN": "Update" },
  allowed: { "hi-IN": "बताया", "en-IN": "Shared" },
  blocked: { "hi-IN": "रोका", "en-IN": "Blocked" },
  yourRules: { "hi-IN": "आपके नियम", "en-IN": "Your rules" },
  alwaysRules: { "hi-IN": "हमेशा लागू", "en-IN": "Always in place" },
  revoke: { "hi-IN": "हटाएँ", "en-IN": "Remove" },
  nothingShared: { "hi-IN": "अभी तक किसी को कुछ नहीं बताया गया।", "en-IN": "Nothing has been shared with anyone yet." },
  back: { "hi-IN": "वापस", "en-IN": "Back" },
} as const;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: SurakshaLanguage | undefined): string {
  return STRINGS[key][lang ?? "hi-IN"];
}
