/**
 * @typedef {Object} ViewportCase
 * @property {string} name
 * @property {number} width
 * @property {number} height
 * @property {boolean} hasTouch
 * @property {boolean} isMobile
 */

/** @type {ViewportCase[]} */
export const VIEWPORT_CASES = [
  { name: "mobile-portrait", width: 390, height: 844, hasTouch: true, isMobile: true },
  { name: "mobile-landscape", width: 844, height: 390, hasTouch: true, isMobile: true },
  { name: "tablet-portrait", width: 768, height: 1024, hasTouch: true, isMobile: false },
  { name: "tablet-landscape", width: 1024, height: 768, hasTouch: true, isMobile: false },
  { name: "desktop", width: 1366, height: 768, hasTouch: false, isMobile: false },
];

/**
 * Biblioteca minima deterministica para testes comportamentais e visuais.
 */
export const TEST_LIBRARY = {
  version: 1,
  songs: [
    {
      id: "song-cifra-test",
      title: "Garota de Ipanema",
      composer: "Tom Jobim",
      style: "Bossa Nova",
      key: "F",
      tempo: 125,
      timeSignature: "4/4",
      barsPerRow: 4,
      notes: "Introducao suave no violao",
      videoUrl: "",
      sections: [
        {
          id: "sec-a",
          label: "A",
          measures: [
            { id: "m-1", chords: "F7M", ending: "", repeat: "start" },
            { id: "m-2", chords: "G7", ending: "", repeat: "" },
            { id: "m-3", chords: "Gm7", ending: "", repeat: "" },
            { id: "m-4", chords: "Gb7", ending: "", repeat: "end" },
          ],
        },
        {
          id: "sec-b",
          label: "B",
          measures: [
            { id: "m-5", chords: "F#7M", ending: "", repeat: "" },
            { id: "m-6", chords: "B7", ending: "", repeat: "" },
            { id: "m-7", chords: "F#m7", ending: "", repeat: "" },
            { id: "m-8", chords: "D7", ending: "", repeat: "" },
          ],
        },
      ],
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
    },
    {
      id: "song-pdf-test",
      title: "Wave",
      composer: "Tom Jobim",
      style: "Bossa Nova",
      key: "D",
      tempo: 130,
      timeSignature: "4/4",
      barsPerRow: 4,
      notes: "Partitura em PDF com tema principal",
      pdfName: "wave.pdf",
      pdfPages: 2,
      sections: [
        {
          id: "sec-w1",
          label: "A",
          measures: [
            { id: "mw-1", chords: "D7M", ending: "", repeat: "" },
            { id: "mw-2", chords: "Bbo", ending: "", repeat: "" },
            { id: "mw-3", chords: "Am7", ending: "", repeat: "" },
            { id: "mw-4", chords: "D7", ending: "", repeat: "" },
          ],
        },
      ],
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
    },
  ],
  playlists: [
    {
      id: "playlist-1",
      name: "Bossa Essencial",
      note: "Musicas para ensaio",
      songIds: ["song-cifra-test", "song-pdf-test"],
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
    },
  ],
  setlists: [
    {
      id: "setlist-1",
      name: "Show Acustico",
      place: "Teatro Municipal",
      date: "2026-10-25",
      note: "Setlist oficial do show",
      items: [
        { id: "item-1", songId: "song-cifra-test", key: "F", note: "Tom original" },
        { id: "item-2", songId: "song-pdf-test", key: "D", note: "Seguir direto" },
      ],
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
    },
  ],
};
