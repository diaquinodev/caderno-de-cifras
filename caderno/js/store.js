import { normalizeKey } from "./chords.js";

export const STORAGE_KEY = "caderno.library.v1";

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function blankLibrary() {
  return { version: 2, pdfDocuments: [], songs: [], playlists: [], setlists: [] };
}

export function blankMeasure() {
  return { id: uid(), chords: "", ending: "", repeat: "" };
}

export function blankSection(label = "A", bars = 8) {
  return {
    id: uid(),
    label,
    measures: Array.from({ length: bars }, () => blankMeasure()),
  };
}

export function blankSong() {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: "Sem título",
    composer: "",
    style: "",
    key: "C",
    tempo: 120,
    timeSignature: "4/4",
    barsPerRow: 4,
    notes: "",
    videoUrl: "",
    pdfRef: null,
    pdfName: "",
    pdfPages: 0,
    sourceSnapshot: null,
    sections: [blankSection("A", 8)],
    createdAt: now,
    updatedAt: now,
  };
}

export function blankPlaylist() {
  const now = new Date().toISOString();
  return { id: uid(), name: "Nova playlist", note: "", songIds: [], createdAt: now, updatedAt: now };
}

export function blankSetlist() {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name: "Nova setlist",
    place: "",
    date: "",
    note: "",
    items: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function blankSetItem(songId) {
  return { id: uid(), songId, key: "", note: "" };
}

function normalizeMeasure(measure) {
  return {
    id: measure?.id || uid(),
    chords: typeof measure?.chords === "string" ? measure.chords : "",
    ending: ["", "1", "2", "3"].includes(measure?.ending) ? measure.ending : "",
    repeat: ["", "start", "end", "both"].includes(measure?.repeat) ? measure.repeat : "",
  };
}

function normalizeSection(section) {
  const measures = Array.isArray(section?.measures) ? section.measures.map(normalizeMeasure) : [];
  return {
    id: section?.id || uid(),
    label: String(section?.label || "A").slice(0, 40),
    measures: measures.length ? measures : [blankMeasure()],
  };
}

export function normalizePdfDocument(doc) {
  return {
    id: String(doc?.id || uid()),
    name: String(doc?.name || "Documento.pdf").slice(0, 180),
    pageCount: Math.max(1, Math.min(200, Number(doc?.pageCount) || 1)),
  };
}

export function pdfRangeSize(ref) {
  if (!ref || typeof ref !== "object") return 0;
  const first = Number(ref.firstPage);
  const last = Number(ref.lastPage);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return 0;
  return Math.max(0, last - first + 1);
}

export function normalizePdfRef(ref, doc) {
  if (!ref || typeof ref !== "object") return null;
  const documentId = String(ref.documentId || "").trim();
  if (!documentId) return null;
  const maxPages = doc?.pageCount || 200;
  let first = Math.max(1, Math.min(maxPages, Number(ref.firstPage) || 1));
  let last = Math.max(1, Math.min(maxPages, Number(ref.lastPage) || first));
  if (last < first) {
    last = first;
  }
  return {
    documentId,
    firstPage: first,
    lastPage: last,
  };
}

export function relativeToPhysicalPage(ref, relativePage) {
  const rel = Math.max(1, Number(relativePage) || 1);
  if (!ref || typeof ref !== "object") return rel;
  const first = Math.max(1, Number(ref.firstPage) || 1);
  const last = Math.max(first, Number(ref.lastPage) || first);
  const physical = first + (rel - 1);
  return Math.min(last, Math.max(first, physical));
}

export function physicalToRelativePage(ref, physicalPage) {
  const phys = Math.max(1, Number(physicalPage) || 1);
  if (!ref || typeof ref !== "object") return phys;
  const first = Math.max(1, Number(ref.firstPage) || 1);
  const size = pdfRangeSize(ref);
  const rel = phys - first + 1;
  return Math.min(size, Math.max(1, rel));
}

export function normalizeSong(song, documentsMap = new Map()) {
  const now = new Date().toISOString();
  const bars = Number(song?.barsPerRow);
  const id = String(song?.id || uid());

  let timeSignature = "";
  if (typeof song?.timeSignature === "string") {
    const trimmed = song.timeSignature.trim();
    if (/^\d+\/\d+$/.test(trimmed)) {
      timeSignature = trimmed;
    } else if (trimmed === "") {
      timeSignature = "";
    }
  }

  let pdfRef = null;
  if (song?.pdfRef) {
    const doc = documentsMap.get(song.pdfRef.documentId);
    pdfRef = normalizePdfRef(song.pdfRef, doc);
  } else if (song?.pdfName) {
    const doc = documentsMap.get(id);
    const pages = Number(song.pdfPages) || doc?.pageCount || 1;
    pdfRef = normalizePdfRef({ documentId: id, firstPage: 1, lastPage: pages }, doc);
  }

  const doc = pdfRef ? documentsMap.get(pdfRef.documentId) : null;
  const pdfName = doc?.name || String(song?.pdfName || "").slice(0, 180);
  const pdfPages = pdfRangeSize(pdfRef) || Math.max(0, Math.min(200, Number(song?.pdfPages) || 0));

  return {
    id,
    title: String(song?.title || "Sem título").slice(0, 160),
    composer: String(song?.composer || "").slice(0, 160),
    style: String(song?.style || "").slice(0, 80),
    key: normalizeKey(song?.key) || "C",
    tempo: clampTempo(song?.tempo),
    timeSignature,
    barsPerRow: [2, 4, 8].includes(bars) ? bars : 4,
    notes: String(song?.notes || "").slice(0, 4000),
    pdfRef,
    pdfName,
    pdfPages,
    sourceSnapshot: typeof song?.sourceSnapshot === "string" ? song.sourceSnapshot.slice(0, 100000) : null,
    videoUrl: sanitizeVideoUrl(song?.videoUrl),
    sections: Array.isArray(song?.sections) && song.sections.length
      ? song.sections.map(normalizeSection)
      : [blankSection("A", 8)],
    createdAt: song?.createdAt || now,
    updatedAt: song?.updatedAt || now,
  };
}

export function sanitizeVideoUrl(value) {
  const text = String(value || "").trim().slice(0, 400);
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  const canonical = canonicalMediaUrl(url);
  return canonical || url.toString();
}

function canonicalMediaUrl(url) {
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] || "";
    return youtubeWatch(id);
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = url.searchParams.get("v") || (["embed", "shorts", "live"].includes(parts[0]) ? parts[1] : "");
    return youtubeWatch(id);
  }
  if (host === "open.spotify.com") {
    const [kind, id] = url.pathname.split("/").filter(Boolean);
    if (!["track", "episode"].includes(kind) || !/^[\w]+$/.test(id || "")) return "";
    return `https://open.spotify.com/${kind}/${id}`;
  }
  return "";
}

function youtubeWatch(id) {
  return /^[\w-]{11}$/.test(id || "") ? `https://www.youtube.com/watch?v=${id}` : "";
}

export function clampTempo(value) {
  const tempo = Number(value);
  if (!Number.isFinite(tempo)) return 120;
  return Math.min(400, Math.max(20, Math.round(tempo)));
}

export function migrateLibraryV1toV2(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const pdfDocuments = [];
  const docMap = new Map();

  if (Array.isArray(source.pdfDocuments)) {
    for (const d of source.pdfDocuments) {
      const doc = normalizePdfDocument(d);
      if (!docMap.has(doc.id)) {
        docMap.set(doc.id, doc);
        pdfDocuments.push(doc);
      }
    }
  }

  if (Array.isArray(source.songs)) {
    for (const s of source.songs) {
      if (s?.pdfName && !s?.pdfRef && s?.id && !docMap.has(s.id)) {
        const doc = normalizePdfDocument({
          id: s.id,
          name: s.pdfName,
          pageCount: s.pdfPages || 1,
        });
        docMap.set(doc.id, doc);
        pdfDocuments.push(doc);
      }
    }
  }

  const songs = Array.isArray(source.songs)
    ? source.songs.map((song) => normalizeSong(song, docMap))
    : [];
  const known = new Set(songs.map((song) => song.id));

  const playlists = Array.isArray(source.playlists)
    ? source.playlists.map((playlist) => ({
        id: playlist?.id || uid(),
        name: String(playlist?.name || "Nova playlist").slice(0, 160),
        note: String(playlist?.note || "").slice(0, 1000),
        songIds: Array.isArray(playlist?.songIds) ? playlist.songIds.filter((id) => known.has(id)) : [],
        createdAt: playlist?.createdAt || new Date().toISOString(),
        updatedAt: playlist?.updatedAt || new Date().toISOString(),
      }))
    : [];

  const setlists = Array.isArray(source.setlists)
    ? source.setlists.map((setlist) => ({
        id: setlist?.id || uid(),
        name: String(setlist?.name || "Nova setlist").slice(0, 160),
        place: String(setlist?.place || "").slice(0, 160),
        date: /^\d{4}-\d{2}-\d{2}$/.test(setlist?.date || "") ? setlist.date : "",
        note: String(setlist?.note || "").slice(0, 1000),
        items: Array.isArray(setlist?.items)
          ? setlist.items
              .filter((item) => known.has(item?.songId))
              .map((item) => ({
                id: item.id || uid(),
                songId: item.songId,
                key: normalizeKey(item.key) || "",
                note: String(item.note || "").slice(0, 240),
              }))
          : [],
        createdAt: setlist?.createdAt || new Date().toISOString(),
        updatedAt: setlist?.updatedAt || new Date().toISOString(),
      }))
    : [];

  return {
    version: 2,
    pdfDocuments,
    songs,
    playlists,
    setlists,
  };
}

export function normalizeLibrary(raw) {
  return migrateLibraryV1toV2(raw);
}

export function loadLibrary(storage = localStorage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return blankLibrary();
  try {
    const parsed = JSON.parse(raw);
    const lib = normalizeLibrary(parsed);
    if (parsed && typeof parsed === "object" && parsed.version !== 2) {
      saveLibrary(lib, storage);
    }
    return lib;
  } catch {
    storage.setItem(`${STORAGE_KEY}.corrupt`, raw);
    return blankLibrary();
  }
}

export function saveLibrary(library, storage = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(library));
}

export function measureCount(song) {
  return song.sections.reduce((total, section) => total + section.measures.length, 0);
}

export function findSong(library, id) {
  return library.songs.find((song) => song.id === id) || null;
}

export function findPdfDocument(library, id) {
  return library.pdfDocuments?.find((doc) => doc.id === id) || null;
}

export function nextSectionLabel(song) {
  const labels = song.sections.map((section) => section.label);
  for (const letter of ["A", "B", "C", "D", "E", "F"]) {
    if (!labels.includes(letter)) return letter;
  }
  return `Seção ${song.sections.length + 1}`;
}
