import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSamples } from "./listen.js";

const ROOTS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function hz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function chordFrequencies(symbol) {
  const minor = symbol.endsWith("m");
  const root = ROOTS[symbol.replace(/m$/, "")];
  const third = minor ? 3 : 4;
  const base = 60 + root;
  return [hz(base - 12), hz(base), hz(base + third), hz(base + 7)];
}

function synth(bars, bpm = 120, sampleRate = 22050) {
  const beat = sampleRate * 60 / bpm;
  const data = new Float32Array(Math.ceil(bars.length * 4 * beat));
  bars.forEach((symbol, barIndex) => {
    const start = Math.round(barIndex * 4 * beat);
    const end = Math.round((barIndex + 1) * 4 * beat);
    const frequencies = chordFrequencies(symbol);
    for (let index = start; index < end && index < data.length; index += 1) {
      const intoBeat = (index - start) % beat;
      const attack = Math.exp(-intoBeat / (sampleRate * 0.06));
      const time = index / sampleRate;
      let sample = 0;
      for (const frequency of frequencies) sample += Math.sin(2 * Math.PI * frequency * time);
      data[index] = (sample / frequencies.length) * (0.2 + 0.8 * attack);
    }
  });
  return data;
}

test("marca tempo, acordes e a volta das seções", () => {
  const score = ["C", "C", "C", "C", "F", "F", "F", "F", "C", "C", "C", "C", "G", "G", "G", "G"];
  const heard = analyzeSamples(synth(score), 22050, { beatsPerBar: 4 });
  assert.ok(Math.abs(heard.tempo - 120) <= 4, `tempo ${heard.tempo}`);
  assert.deepEqual(heard.bars, score);
  assert.deepEqual(heard.sections.map((section) => section.label), ["A", "B", "A", "C"]);
  assert.equal(heard.key, "C");
});
