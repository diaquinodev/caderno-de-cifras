const NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const MAJOR = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0];
const MINOR = [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0];

export function analyzeSamples(samples, sampleRate, options = {}) {
  const prepared = prepare(samples, sampleRate);
  const beatsPerBar = Math.min(12, Math.max(2, Number(options.beatsPerBar) || 4));
  const { flux, hop, rate } = onsetEnvelope(prepared.samples, prepared.rate);
  const tempo = estimateTempo(flux, rate / hop);
  if (!tempo) return empty();
  const beats = beatGrid(flux, rate / hop, hop, tempo);
  const chords = chordsOnGrid(prepared.samples, prepared.rate, beats, beatsPerBar);
  if (chords.length < 2) return empty();
  const sections = phraseSections(chords);
  return {
    tempo: Math.round(tempo),
    key: keyOf(chords),
    bars: chords,
    sections,
  };
}

function empty() {
  return { tempo: 0, key: "C", bars: [], sections: [] };
}

function prepare(samples, sampleRate) {
  let data = samples;
  let rate = sampleRate;
  if (rate >= 40000) {
    const down = new Float32Array(Math.floor(data.length / 2));
    for (let index = 0; index < down.length; index += 1) {
      down[index] = (data[index * 2] + data[index * 2 + 1]) * 0.5;
    }
    data = down;
    rate /= 2;
  }
  const limit = Math.floor(rate * 60 * 8);
  if (data.length > limit) data = data.subarray(0, limit);
  return { samples: data, rate };
}

function onsetEnvelope(samples, sampleRate) {
  const size = 1024;
  const hop = 512;
  const flux = [];
  let previous = 0;
  for (let start = 0; start + size <= samples.length; start += hop) {
    let energy = 0;
    for (let index = 0; index < size; index += 1) energy += samples[start + index] ** 2;
    energy /= size;
    flux.push(Math.max(0, energy - previous));
    previous = energy;
  }
  return { flux, hop, rate: sampleRate };
}

function estimateTempo(flux, frameRate) {
  if (flux.length < 8) return 0;
  const minLag = Math.max(1, Math.round(frameRate * 60 / 180));
  const maxLag = Math.min(flux.length - 2, Math.round(frameRate * 60 / 70));
  const scores = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let index = 0; index + lag < flux.length; index += 1) sum += flux[index] * flux[index + lag];
    scores[lag] = sum;
  }
  let bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag += 1) if (scores[lag] > scores[bestLag]) bestLag = lag;
  const half = Math.round(bestLag / 2);
  if (half >= minLag && scores[half] > scores[bestLag] * 0.8) bestLag = half;
  const left = scores[bestLag - 1] || 0;
  const mid = scores[bestLag];
  const right = scores[bestLag + 1] || 0;
  const denom = left - 2 * mid + right;
  const shift = denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denom));
  return 60 * frameRate / (bestLag + shift);
}

function beatGrid(flux, frameRate, hop, tempo) {
  const period = frameRate * 60 / tempo;
  const step = Math.max(1, Math.round(period));
  let phase = 0;
  let best = -1;
  for (let candidate = 0; candidate < step; candidate += 1) {
    let score = 0;
    for (let index = candidate; index < flux.length; index += step) score += flux[index];
    if (score > best) {
      best = score;
      phase = candidate;
    }
  }
  const beats = [];
  for (let frame = phase; frame < flux.length; frame += period) beats.push(Math.round(frame * hop));
  return beats;
}

function chordsOnGrid(samples, sampleRate, beats, beatsPerBar) {
  const chords = [];
  for (let index = 0; index + beatsPerBar <= beats.length; index += beatsPerBar) {
    const start = beats[index];
    const end = index + beatsPerBar < beats.length ? beats[index + beatsPerBar] : samples.length;
    if (end - start < sampleRate * 0.35) continue;
    chords.push(chordBetween(samples, sampleRate, start, end));
  }
  return chords;
}

function chordBetween(samples, sampleRate, start, end) {
  const chroma = new Float64Array(12);
  const size = 2048;
  const hop = 1024;
  const frame = new Float32Array(size);
  for (let offset = start; offset + size <= end; offset += hop) {
    for (let index = 0; index < size; index += 1) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
      frame[index] = samples[offset + index] * window;
    }
    addChroma(fftMagnitude(frame), sampleRate, chroma);
  }
  return matchChord(chroma);
}

function addChroma(magnitudes, sampleRate, chroma) {
  const width = magnitudes.length * 2;
  for (let bin = 1; bin < magnitudes.length; bin += 1) {
    const frequency = bin * sampleRate / width;
    if (frequency < 70 || frequency > 1400) continue;
    const midi = 69 + 12 * Math.log2(frequency / 440);
    const nearest = Math.round(midi);
    if (Math.abs(midi - nearest) > 0.35) continue;
    chroma[((nearest % 12) + 12) % 12] += magnitudes[bin];
  }
}

function matchChord(chroma) {
  let total = 0;
  for (const value of chroma) total += value;
  if (total <= 0) return "NC";
  let best = 0;
  let symbol = "NC";
  for (let root = 0; root < 12; root += 1) {
    const major = similarity(chroma, MAJOR, root);
    const minor = similarity(chroma, MINOR, root);
    if (major > best) {
      best = major;
      symbol = NAMES[root];
    }
    if (minor > best + 0.02) {
      best = minor;
      symbol = `${NAMES[root]}m`;
    }
  }
  return best >= 0.72 ? symbol : "NC";
}

function similarity(chroma, template, root) {
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < 12; index += 1) {
    const value = chroma[(index + root) % 12];
    const weight = template[index];
    dot += value * weight;
    left += value * value;
    right += weight * weight;
  }
  return dot / Math.sqrt(left * right || 1);
}

function phraseSections(chords) {
  const size = 4;
  const seen = new Map();
  const letters = "ABCDEFGH";
  const sections = [];
  for (let index = 0; index < chords.length; index += size) {
    const slice = chords.slice(index, index + size);
    const key = slice.join("|");
    if (!seen.has(key)) seen.set(key, letters[seen.size] || `Seção ${seen.size + 1}`);
    sections.push({ label: seen.get(key), chords: slice });
  }
  return sections;
}

function keyOf(chords) {
  const count = new Map();
  for (const chord of chords) {
    if (!chord || chord === "NC") continue;
    const root = chord.replace(/m$/, "");
    count.set(root, (count.get(root) || 0) + 1);
  }
  let best = "C";
  let amount = 0;
  for (const [root, value] of count) {
    if (value > amount) {
      amount = value;
      best = root;
    }
  }
  return best;
}

function fftMagnitude(realInput) {
  const n = realInput.length;
  const real = Float32Array.from(realInput);
  const imag = new Float32Array(n);
  for (let index = 1, reversed = 0; index < n; index += 1) {
    let bit = n >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      const swap = real[index];
      real[index] = real[reversed];
      real[reversed] = swap;
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let turnReal = 1;
      let turnImag = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const evenReal = real[start + offset];
        const evenImag = imag[start + offset];
        const oddIndex = start + offset + length / 2;
        const oddReal = real[oddIndex] * turnReal - imag[oddIndex] * turnImag;
        const oddImag = real[oddIndex] * turnImag + imag[oddIndex] * turnReal;
        real[start + offset] = evenReal + oddReal;
        imag[start + offset] = evenImag + oddImag;
        real[oddIndex] = evenReal - oddReal;
        imag[oddIndex] = evenImag - oddImag;
        const nextReal = turnReal * stepReal - turnImag * stepImag;
        turnImag = turnReal * stepImag + turnImag * stepReal;
        turnReal = nextReal;
      }
    }
  }
  const magnitude = new Float32Array(n / 2);
  for (let index = 0; index < magnitude.length; index += 1) magnitude[index] = Math.hypot(real[index], imag[index]);
  return magnitude;
}
