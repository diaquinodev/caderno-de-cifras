import { normalizeKey } from "./chords.js";

const TIME_SIGNATURES = new Set(["4/4", "3/4", "2/4", "6/8", "5/4", "12/8"]);

export function chartKey(title, composer) {
  const left = fold(title);
  const right = fold(composer);
  if (left.length < 2 || right.length < 2) return "";
  return `${left}::${right}`;
}

export function toSharedChart(input) {
  const title = clean(input?.title, 160);
  const composer = clean(input?.composer, 240);
  const id = chartKey(title, composer);
  if (!id) return null;
  const sections = sectionsOf(input?.sections);
  if (!sections.length) return null;
  const bars = sections.flatMap((section) => section.measures);
  const named = bars.filter((measure) => namedChord(measure.chords));
  if (named.length < 4 || named.length / bars.length < 0.7) return null;
  const tempo = Number(input?.tempo);
  const barsPerRow = Number(input?.barsPerRow);
  return {
    id,
    title,
    composer,
    style: clean(input?.style, 80),
    key: normalizeKey(input?.key) || "C",
    tempo: tempo >= 20 && tempo <= 400 ? Math.round(tempo) : 120,
    timeSignature: TIME_SIGNATURES.has(input?.timeSignature) ? input.timeSignature : "4/4",
    barsPerRow: [2, 4, 8].includes(barsPerRow) ? barsPerRow : 4,
    notes: clean(input?.notes, 500),
    sections,
    updatedAt: new Date().toISOString(),
  };
}

function sectionsOf(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((section) => {
    const measures = Array.isArray(section?.measures) ? section.measures.slice(0, 64) : [];
    return {
      label: clean(section?.label, 40) || "A",
      measures: measures.map((measure) => ({
        chords: clean(measure?.chords, 80),
        ending: ["", "1", "2", "3"].includes(measure?.ending) ? measure.ending : "",
        repeat: ["", "start", "end", "both"].includes(measure?.repeat) ? measure.repeat : "",
      })),
    };
  }).filter((section) => section.measures.length);
}

function namedChord(value) {
  const chord = String(value || "").trim();
  return Boolean(chord) && !/^n\.?c\.?$/i.test(chord);
}

function clean(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function fold(value) {
  return clean(value, 240)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
