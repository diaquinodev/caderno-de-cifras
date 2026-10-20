export const FORMS = [
  {
    id: "pop",
    name: "Pop",
    style: "Pop",
    timeSignature: "4/4",
    tempo: 100,
    sections: [
      ["Intro", 4], ["Estrofe", 8], ["Pré", 4], ["Refrão", 8],
      ["Estrofe", 8], ["Pré", 4], ["Refrão", 8], ["Ponte", 8], ["Refrão", 8], ["Fim", 4],
    ],
  },
  {
    id: "pop-solo",
    name: "Pop com solo",
    style: "Pop",
    timeSignature: "4/4",
    tempo: 108,
    sections: [
      ["Intro", 4], ["Estrofe", 8], ["Pré", 4], ["Refrão", 8],
      ["Estrofe", 8], ["Refrão", 8], ["Solo", 16], ["Refrão", 8], ["Fim", 4],
    ],
  },
  {
    id: "rock",
    name: "Rock",
    style: "Rock",
    timeSignature: "4/4",
    tempo: 120,
    sections: [
      ["Intro", 4], ["Estrofe", 8], ["Refrão", 8], ["Estrofe", 8],
      ["Refrão", 8], ["Solo", 16], ["Refrão", 8], ["Fim", 4],
    ],
  },
  {
    id: "rnb",
    name: "R&B",
    style: "R&B",
    timeSignature: "4/4",
    tempo: 86,
    sections: [
      ["Intro", 4], ["Estrofe", 8], ["Pré", 4], ["Refrão", 8],
      ["Estrofe", 8], ["Pré", 4], ["Refrão", 8], ["Ponte", 8], ["Refrão", 8], ["Fim", 4],
    ],
  },
  {
    id: "funk",
    name: "Funk",
    style: "Funk",
    timeSignature: "4/4",
    tempo: 104,
    sections: [
      ["Vamp", 8], ["Estrofe", 8], ["Refrão", 8], ["Vamp", 8], ["Break", 4], ["Refrão", 8], ["Vamp", 8],
    ],
  },
  {
    id: "blues",
    name: "Blues de 12",
    style: "Blues",
    timeSignature: "4/4",
    tempo: 96,
    note: "Volta de 12: I · IV · I · I · IV · IV · I · I · V · IV · I · V.",
    sections: [
      ["Intro", 4], ["Blues", 12], ["Blues", 12], ["Solo", 12], ["Blues", 12], ["Fim", 4],
    ],
  },
  {
    id: "standard",
    name: "Standard AABA",
    style: "Medium Swing",
    timeSignature: "4/4",
    tempo: 140,
    note: "A volta de 32 é o tema. O solo percorre a mesma volta.",
    sections: [
      ["A", 8], ["A", 8], ["Ponte", 8], ["A", 8],
    ],
  },
  {
    id: "rhythm",
    name: "Rhythm changes",
    style: "Medium Swing",
    timeSignature: "4/4",
    tempo: 180,
    note: "A: I–vi–ii–V. Ponte: ciclo de dominantes, III7–VI7–II7–V7.",
    sections: [
      ["A", 8], ["A", 8], ["Ponte", 8], ["A", 8],
    ],
  },
  {
    id: "ballad",
    name: "Balada",
    style: "Ballad",
    timeSignature: "4/4",
    tempo: 68,
    sections: [
      ["Intro", 4], ["A", 8], ["A", 8], ["Ponte", 8], ["A", 8],
    ],
  },
  {
    id: "waltz",
    name: "Valsa",
    style: "Jazz Waltz",
    timeSignature: "3/4",
    tempo: 150,
    sections: [
      ["A", 8], ["A", 8], ["Ponte", 8], ["A", 8],
    ],
  },
  {
    id: "modal",
    name: "Modal",
    style: "Swing",
    timeSignature: "4/4",
    tempo: 120,
    note: "Um motivo repetido. O solo fica em cima do mesmo motivo.",
    sections: [
      ["Motivo", 16], ["Solo", 16], ["Motivo", 16],
    ],
  },
  {
    id: "bossa",
    name: "Bossa",
    style: "Bossa Nova",
    timeSignature: "4/4",
    tempo: 128,
    sections: [
      ["A", 8], ["A", 8], ["Ponte", 8], ["A", 8],
    ],
  },
  {
    id: "mpb",
    name: "MPB",
    style: "MPB",
    timeSignature: "4/4",
    tempo: 96,
    sections: [
      ["Intro", 4], ["A", 8], ["B", 8], ["A", 8], ["Ponte", 8], ["B", 8], ["Fim", 4],
    ],
  },
];

export function findForm(id) {
  return FORMS.find((form) => form.id === id) || null;
}
