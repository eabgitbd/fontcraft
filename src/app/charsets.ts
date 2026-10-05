// Character sets ported from FontCraft v3 (`CS`, `BN`, `PG`). Do not edit by hand: the Bengali
// data was extracted from the v3 source so every code point matches exactly.

export const LATIN: readonly string[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"];
export const BENGALI: readonly string[] = ["অ", "আ", "ই", "ঈ", "উ", "ঊ", "ঋ", "এ", "ঐ", "ও", "ঔ", "ক", "খ", "গ", "ঘ", "ঙ", "চ", "ছ", "জ", "ঝ", "ঞ", "ট", "ঠ", "ড", "ঢ", "ণ", "ত", "থ", "দ", "ধ", "ন", "প", "ফ", "ব", "ভ", "ম", "য", "র", "ল", "শ", "ষ", "স", "হ", "ড়", "ঢ়", "য়", "ৎ", "ং", "ঃ", "ঁ", "া", "ি", "ী", "ু", "ূ", "ৃ", "ে", "ৈ", "ো", "ৌ", "্", "০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯", "ক্ষ", "জ্ঞ", "ত্র", "ন্ত", "স্ত"];
export const DIGITS: readonly string[] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
/** v3 listed the backslash twice; duplicates are removed because glyphs are keyed by character. */
export const PUNCT: readonly string[] = [".", ",", ";", ":", "!", "?", "@", "#", "$", "%", "&", "*", "(", ")", "-", "_", "=", "+", "[", "]", "{", "}", "|", "\\", "/", "'", "\"", "<", ">", "~"];

/** Bengali display names shown on the character map. */
export const BENGALI_NAMES: Readonly<Record<string, string>> = {
  "অ": "স্বর অ",
  "আ": "স্বর আ",
  "ই": "স্বর ই",
  "ঈ": "স্বর ঈ",
  "উ": "স্বর উ",
  "ঊ": "স্বর ঊ",
  "এ": "স্বর এ",
  "ও": "স্বর ও",
  "ক": "ব্যঞ্জন ক",
  "খ": "ব্যঞ্জন খ",
  "গ": "ব্যঞ্জন গ",
  "ঘ": "ব্যঞ্জন ঘ",
  "চ": "ব্যঞ্জন চ",
  "ত": "ব্যঞ্জন ত",
  "দ": "ব্যঞ্জন দ",
  "ন": "ব্যঞ্জন ন",
  "প": "ব্যঞ্জন প",
  "ব": "ব্যঞ্জন ব",
  "ম": "ব্যঞ্জন ম",
  "য": "ব্যঞ্জন য",
  "র": "ব্যঞ্জন র",
  "ল": "ব্যঞ্জন ল",
  "স": "ব্যঞ্জন স",
  "হ": "ব্যঞ্জন হ",
  "া": "মাত্রা আ",
  "ি": "মাত্রা ই",
  "ী": "মাত্রা ঈ",
  "ু": "মাত্রা উ",
  "ূ": "মাত্রা ঊ",
  "ে": "মাত্রা এ",
  "ো": "মাত্রা ও",
  "্": "হসন্ত",
  "ং": "অনুস্বার",
  "ঃ": "বিসর্গ",
  "ঁ": "চন্দ্রবিন্দু"
};

/** Sample paragraphs for the preview screen. */
export const PREVIEW_SAMPLES: readonly string[] = ["The quick brown fox jumps over the lazy dog.", "Pack my box with five dozen liquor jugs.", "আমার সোনার বাংলা আমি তোমায় ভালোবাসি।", "কবি নজরুলের লেখায় শক্তি ও সাহসের কথা।", "Handwriting gives a font its soul. 0123456789"];

export type CharSetId = 'latin' | 'bengali' | 'bengali-ext' | 'latin-ext' | 'all';
export type ScriptTab = 'latin' | 'bengali' | 'digits' | 'punct';

export const CHAR_SET_IDS: readonly CharSetId[] = ['latin', 'bengali', 'bengali-ext', 'latin-ext', 'all'];

/** The characters a new project of the given set starts with (v3 `mkChars`). */
export function charsForSet(set: CharSetId): string[] {
  const keys =
    set === 'latin' ? LATIN
    : set === 'bengali' ? BENGALI
    : set === 'bengali-ext' ? [...BENGALI, ...DIGITS]
    : set === 'latin-ext' ? [...LATIN, ...DIGITS, ...PUNCT]
    : [...LATIN, ...BENGALI, ...DIGITS, ...PUNCT];
  return [...new Set(keys)];
}

export function charsForTab(tab: ScriptTab): readonly string[] {
  return tab === 'latin' ? LATIN : tab === 'bengali' ? BENGALI : tab === 'digits' ? DIGITS : PUNCT;
}
