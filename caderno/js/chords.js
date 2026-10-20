const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const C_ROW = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const SHARP_ROW = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_ROW = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const CB_ROW = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "Cb"];

const ROOT_INDEX = new Map();
for (let i = 0; i < 12; i += 1) {
  ROOT_INDEX.set(SHARP[i], i);
  ROOT_INDEX.set(FLAT[i], i);
}
ROOT_INDEX.set("Cb", 11);
ROOT_INDEX.set("Fb", 4);
ROOT_INDEX.set("B#", 0);
ROOT_INDEX.set("E#", 5);

export const KEYS = [
  "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
  "Cm", "Dbm", "Dm", "Ebm", "Em", "Fm", "Gbm", "Gm", "Abm", "Am", "Bbm", "Bm",
];

export const TIME_SIGNATURES = ["4/4", "3/4", "2/4", "6/8", "5/4", "12/8"];

export const STYLES = [
  "Swing",
  "Medium Swing",
  "Ballad",
  "Bossa Nova",
  "Samba",
  "Samba-canção",
  "Choro",
  "Frevo",
  "Baião",
  "Forró",
  "MPB",
  "Pop",
  "Rock",
  "Blues",
  "Funk",
  "R&B",
  "Latin",
  "Jazz Waltz",
  "Bolero",
  "Reggae",
];

export function splitKey(key) {
  const match = String(key || "").trim().match(/^([A-G](?:#|b)?)(m?)$/);
  if (!match || !ROOT_INDEX.has(match[1])) return null;
  return { root: match[1], minor: match[2] === "m" };
}

export function normalizeKey(raw) {
  const match = String(raw || "").trim().match(/^([A-Ga-g])([#b]?)(m?)$/);
  if (!match) return null;
  const root = match[1].toUpperCase() + match[2];
  if (!ROOT_INDEX.has(root)) return null;
  return root + (match[3] ? "m" : "");
}

export function spellingFor(key) {
  const parsed = splitKey(normalizeKey(key) || "");
  if (!parsed) return C_ROW;
  const name = parsed.root + (parsed.minor ? "m" : "");
  if (name === "C" || name === "Am") return C_ROW;
  if (name === "Gb" || name === "Ebm" || name === "Abm") return CB_ROW;
  if (parsed.root.includes("b") || ["F", "Dm", "Gm", "Cm", "Fm"].includes(name)) return FLAT_ROW;
  if (parsed.root.includes("#") || ["G", "D", "A", "E", "B", "Em", "Bm"].includes(name)) return SHARP_ROW;
  return C_ROW;
}

export function signedInterval(fromKey, toKey) {
  const from = splitKey(normalizeKey(fromKey) || "");
  const to = splitKey(normalizeKey(toKey) || "");
  if (!from || !to) return 0;
  let delta = (ROOT_INDEX.get(to.root) - ROOT_INDEX.get(from.root) + 12) % 12;
  if (delta > 6) delta -= 12;
  return delta;
}

const PASSTHROUGH = /^(?:NC|N\.C\.|%+|\/\/)$/i;

export function transposeToken(token, semitones, spelling) {
  if (!token || PASSTHROUGH.test(token)) return token;
  const match = token.match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match || !ROOT_INDEX.has(match[1])) return token;
  const next = (ROOT_INDEX.get(match[1]) + semitones + 1200) % 12;
  return spelling[next] + match[2];
}

const SUFFIXES = [
  ["major7", "Δ7"],
  ["maj7", "Δ7"],
  ["ma7", "Δ7"],
  ["Maj7", "Δ7"],
  ["M7", "Δ7"],
  ["major9", "Δ9"],
  ["maj9", "Δ9"],
  ["ma9", "Δ9"],
  ["M9", "Δ9"],
  ["min7b5", "-7b5"],
  ["mi7b5", "-7b5"],
  ["m7b5", "-7b5"],
  ["min11", "-11"],
  ["min13", "-13"],
  ["min9", "-9"],
  ["mi9", "-9"],
  ["m11", "-11"],
  ["m13", "-13"],
  ["m9", "-9"],
  ["min7", "-7"],
  ["mi7", "-7"],
  ["m7", "-7"],
  ["min", "-"],
  ["mi", "-"],
  ["maj", "Δ"],
  ["dim7", "o7"],
  ["dim", "o"],
  ["aug", "+"],
  ["m", "-"],
  ["°", "o"],
  ["ø", "-7b5"],
];

function formatSuffix(suffix) {
  let formatted = "";
  let index = 0;
  while (index < suffix.length) {
    const rest = suffix.slice(index);
    const rule = SUFFIXES.find(([from]) => rest.startsWith(from));
    if (!rule) {
      formatted += suffix[index];
      index += 1;
      continue;
    }
    formatted += rule[1];
    index += rule[0].length;
  }
  return formatted;
}

export function formatChordToken(token) {
  if (!token || PASSTHROUGH.test(token)) return token;
  const match = token.match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match || !ROOT_INDEX.has(match[1])) return token;
  return match[1] + formatSuffix(match[2]);
}

export function formatCell(text) {
  if (!text) return "";
  return String(text).split(/(\s+)/).map((part) => {
    if (!part || /^\s+$/.test(part)) return part;
    return part.split("/").map((token) => formatChordToken(token)).join("/");
  }).join("");
}

export function transposeCell(text, semitones, spelling) {
  if (!text || !semitones) return text || "";
  return String(text).split(/(\s+)/).map((part) => {
    if (!part || /^\s+$/.test(part)) return part;
    return part.split("/").map((token) => transposeToken(token, semitones, spelling)).join("/");
  }).join("");
}

export function transposeSections(sections, fromKey, toKey) {
  const semitones = signedInterval(fromKey, toKey);
  if (!semitones) return sections;
  const spelling = spellingFor(toKey);
  return sections.map((section) => ({
    ...section,
    measures: section.measures.map((measure) => ({
      ...measure,
      chords: transposeCell(measure.chords, semitones, spelling),
    })),
  }));
}

function parseCell(raw) {
  let chords = raw;
  let repeat = "";
  let ending = "";
  if (chords.startsWith(":")) {
    repeat = "start";
    chords = chords.slice(1);
  }
  if (chords.endsWith(":")) {
    repeat = repeat === "start" ? "both" : "end";
    chords = chords.slice(0, -1);
  }
  chords = chords.trim();
  const endingMatch = chords.match(/^\[([123])\]\s*(.*)$/) || chords.match(/^([123])\.\s+(.*)$/);
  if (endingMatch) {
    ending = endingMatch[1];
    chords = endingMatch[2].trim();
  }
  return { chords, repeat, ending };
}

export function parseChartText(text) {
  const result = {
    title: null,
    composer: null,
    style: null,
    key: null,
    tempo: null,
    timeSignature: null,
    sections: [],
  };
  let current = null;

  const pushCurrent = () => {
    if (current && current.measures.length) result.sections.push(current);
    current = null;
  };

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const title = line.match(/^(?:t[ií]tulo|title)\s*:\s*(.+)$/i);
    if (title) {
      result.title = title[1].trim();
      continue;
    }
    const composer = line.match(/^(?:compositor|composer)\s*:\s*(.+)$/i);
    if (composer) {
      result.composer = composer[1].trim();
      continue;
    }
    const style = line.match(/^(?:estilo|style)\s*:\s*(.+)$/i);
    if (style) {
      result.style = style[1].trim();
      continue;
    }
    const key = line.match(/^(?:tom|key)\s*:\s*([A-Ga-g](?:#|b)?m?)$/i);
    if (key) {
      result.key = normalizeKey(key[1]);
      continue;
    }
    const tempo = line.match(/^(?:andamento|tempo|bpm)\s*:\s*(\d{2,3})$/i);
    if (tempo) {
      const value = Number(tempo[1]);
      if (value >= 20 && value <= 400) result.tempo = value;
      continue;
    }
    const timeSignature = line.match(/^(?:compasso|f[oó]rmula|formula)\s*:\s*(\d+)\s*\/\s*(\d+)$/i);
    if (timeSignature) {
      result.timeSignature = `${timeSignature[1]}/${timeSignature[2]}`;
      continue;
    }

    if (!line.includes("|")) {
      pushCurrent();
      current = { label: line.replace(/:$/, "").trim() || "A", measures: [] };
      continue;
    }

    if (!current) current = { label: "A", measures: [] };
    const trimmed = line.trim();
    const bits = trimmed.split("|");
    const from = trimmed.startsWith("|") ? 1 : 0;
    const to = trimmed.endsWith("|") ? bits.length - 1 : bits.length;
    for (let index = from; index < to; index += 1) {
      current.measures.push(parseCell(bits[index]));
    }
  }

  pushCurrent();
  return result;
}
