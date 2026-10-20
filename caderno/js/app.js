import {
  KEYS,
  STYLES,
  TIME_SIGNATURES,
  formatCell,
  normalizeKey,
  parseChartText,
  signedInterval,
  transposeSections,
} from "./chords.js";
import { loadPdfDocument, savePdfDocument, deletePdfDocument, bufferToBase64, base64ToBuffer } from "./files.js";
import { FORMS, findForm } from "./forms.js";
import { chartFromCifraHtml, chartFromCifraPlain, pastedCifraLink } from "./cifra.js";
import { analyzeSamples } from "./listen.js";
import { inspectPdf, paintPdf, releasePdf } from "./pdfview.js";
import {
  blankMeasure,
  blankPlaylist,
  blankSection,
  blankSetItem,
  blankSetlist,
  blankSong,
  clampTempo,
  findSong,
  loadLibrary,
  measureCount,
  nextSectionLabel,
  normalizeLibrary,
  saveLibrary,
  uid,
  countPdfDocumentReferences,
  removePdfDocument,
  pdfRangeSize,
  relativeToPhysicalPage,
} from "./store.js";

const main = document.querySelector("#main");
const list = document.querySelector("#list");
const modalRoot = document.querySelector("#modal-root");
const search = document.querySelector("#search");
const createBtn = document.querySelector("#create-btn");

const state = {
  library: loadLibrary(),
  route: parseHash(),
  query: "",
  previewKey: null,
  loadedSongId: null,
  activeSectionId: null,
  stageIndex: 0,
  stagePage: 1,
  stageChart: false,
  stageRouteId: "",
  songRouteId: "",
  clean: false,
  confirm: null,
};

const REPEAT_CYCLE = ["", "start", "end", "both"];
const ENDING_CYCLE = ["", "1", "2", "3"];
const REPEAT_LABEL = { "": "|", start: "|:", end: ":|", both: ":|:" };

let saveTimer = 0;

search.addEventListener("input", () => {
  state.query = search.value.trim().toLowerCase();
  renderList();
  if (state.route.name === "songs" || state.route.name === "playlists" || state.route.name === "setlists") renderMain();
});

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-nav]");
  if (nav) {
    go(`#/${nav.dataset.nav}`);
    return;
  }
  const destination = event.target.closest("[data-go]");
  if (destination) {
    go(destination.dataset.go);
    return;
  }
  const element = event.target.closest("[data-action]");
  if (!element || !actions[element.dataset.action]) return;
  event.preventDefault();
  actions[element.dataset.action](element);
});

let orderDrag = null;

document.addEventListener("pointerdown", (event) => {
  const grip = event.target.closest?.("[data-drag-index]");
  if (!grip || event.button !== 0) return;
  const row = grip.closest(".order-row");
  if (!row) return;
  event.preventDefault();
  orderDrag = {
    index: Number(grip.dataset.dragIndex),
    pointerId: event.pointerId,
    startY: event.clientY,
    row,
    over: null,
  };
  grip.setPointerCapture(event.pointerId);
});

document.addEventListener("pointermove", (event) => {
  if (!orderDrag || event.pointerId !== orderDrag.pointerId) return;
  if (Math.abs(event.clientY - orderDrag.startY) < 8 && !orderDrag.over) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".order-row");
  document.querySelectorAll(".order-row").forEach((row) => row.classList.toggle("drop-target", row === target && row !== orderDrag.row));
  orderDrag.over = target && target !== orderDrag.row ? target : null;
});

document.addEventListener("pointerup", (event) => {
  if (!orderDrag || event.pointerId !== orderDrag.pointerId) return;
  const from = orderDrag.index;
  const over = orderDrag.over;
  orderDrag = null;
  document.querySelectorAll(".order-row").forEach((row) => row.classList.remove("drop-target"));
  if (!over) return;
  commitOrder(from, Number(over.dataset.orderIndex));
});

document.addEventListener("pointercancel", () => {
  orderDrag = null;
  document.querySelectorAll(".order-row").forEach((row) => row.classList.remove("drop-target"));
});

function commitOrder(from, to) {
  if (state.route.name === "playlist") {
    const playlist = findPlaylist(state.route.id);
    if (!playlist) return;
    moveToIndex(playlist.songIds, from, to);
    touchPlaylist(playlist, true);
    renderAll();
    return;
  }
  const setlist = state.route.name === "setlist" ? findSetlist(state.route.id) : null;
  if (!setlist) return;
  moveToIndex(setlist.items, from, to);
  touchSetlist(setlist, true);
  renderAll();
}

document.addEventListener("input", (event) => {
  const field = event.target;
  if (field.id === "search") return;
  const song = currentSong();
  if (field.dataset.field && song) {
    if (field.dataset.field === "style" || field.dataset.field === "composer") fitHeaderFields();
    writeSongField(song, field);
    return;
  }
  if (field.dataset.sectionLabel && song) {
    const section = song.sections.find((item) => item.id === field.dataset.sectionLabel);
    if (section) section.label = field.value.slice(0, 40);
    persist(false);
    return;
  }
  if (field.dataset.chordId && song && !state.previewKey) {
    const measure = findMeasure(song, field.dataset.chordId);
    if (measure) measure.chords = field.value;
    persist(false);
    return;
  }
  writeCollectionField(field);
});

document.addEventListener("focusout", (event) => {
  const field = event.target;
  if (!field.dataset?.chordId || state.previewKey) return;
  const song = currentSong();
  const measure = song && findMeasure(song, field.dataset.chordId);
  if (!measure) return;
  const formatted = formatCell(field.value);
  measure.chords = formatted;
  if (field.isConnected) {
    field.value = formatted;
    const glyphs = field.parentElement?.querySelector(".glyphs");
    if (glyphs) glyphs.innerHTML = glyphRow(formatted);
  }
  persist(false);
});

document.addEventListener("change", (event) => {
  const field = event.target;
  const song = currentSong();
  if (field.dataset.field && song) {
    writeSongField(song, field);
    if (field.dataset.field === "barsPerRow" || field.dataset.field === "key") paintPaper();
    return;
  }
  if (field.hasAttribute("data-preview-key") && song) {
    state.previewKey = field.value && field.value !== song.key ? field.value : null;
    const banner = document.querySelector("#preview-banner");
    if (banner) {
      banner.hidden = !state.previewKey;
      const label = banner.querySelector("[data-preview-label]");
      if (label && state.previewKey) label.textContent = `Visualização em ${state.previewKey}. A cifra salva continua em ${song.key}.`;
    }
    paintPaper();
    return;
  }
  if (field.hasAttribute("data-file-song") && song) {
    fileSong(song, field.value);
    field.value = "";
    return;
  }
  if (field.dataset.itemKey) {
    const item = currentSetItem(field.dataset.itemKey);
    if (item) {
      item.key = normalizeKey(field.value) || "";
      touchSetlist(currentSetlist());
    }
    return;
  }
  if (field.id === "stage-picker") {
    state.stageIndex = Number(field.value) || 0;
    state.stagePage = 1;
    renderMain();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.confirm) {
      closeConfirm(false);
      return;
    }
    if (modalRoot.childElementCount) {
      closeModal();
      return;
    }
    if (state.clean && !document.body.classList.contains("stage")) {
      state.clean = false;
      renderAll();
      return;
    }
    if (document.body.classList.contains("stage")) go(`#/setlists/${state.route.id}`);
    return;
  }
  if (event.key === "Enter" && event.target.classList?.contains("chord-input")) {
    event.preventDefault();
    focusNeighbor(event.target, event.shiftKey ? -1 : 1);
    return;
  }
  if (event.target.matches?.("input, textarea, select")) return;
  const readingPdf = state.clean && currentSong()?.pdfName && state.route.name === "song";
  const stagePdf = state.route.name === "stage" && currentSong()?.pdfName && !state.stageChart;
  if ((readingPdf || stagePdf) && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
    event.preventDefault();
    stepPerformance(event.key === "ArrowRight" ? 1 : -1);
    return;
  }
  if (!document.body.classList.contains("stage")) return;
  if (event.key === "ArrowRight") actions["stage-next"]();
  if (event.key === "ArrowLeft") actions["stage-prev"]();
});

document.addEventListener("focusin", (event) => {
  const section = event.target.closest?.("[data-section-id]");
  if (section) state.activeSectionId = section.dataset.sectionId;
});

window.addEventListener("hashchange", () => {
  state.route = parseHash();
  if (state.confirm) closeConfirm(false);
  else closeModal();
  renderAll();
});

window.addEventListener("beforeunload", () => {
  clearTimeout(saveTimer);
  saveLibrary(state.library);
});

window.addEventListener("resize", () => fitPerformanceSheet());
window.addEventListener("beforeprint", () => {
  clearSheetFit(document.querySelector(".paper.sheet"));
  fitGlyphs();
});
window.addEventListener("afterprint", () => fitPerformanceSheet());

document.querySelector("#pdf-input")?.addEventListener("change", (event) => {
  const input = event.target;
  const file = input.files?.[0];
  input.value = "";
  if (file) attachPdf(file);
});

document.querySelector("#audio-input")?.addEventListener("change", (event) => {
  const input = event.target;
  const file = input.files?.[0];
  input.value = "";
  if (file) readAudio(file);
});

const actions = {
  "new-song": () => {
    const song = blankSong();
    state.library.songs.unshift(song);
    persist(true);
    go(`#/musicas/${song.id}`);
  },
  "new-playlist": () => {
    const playlist = blankPlaylist();
    state.library.playlists.unshift(playlist);
    persist(true);
    go(`#/playlists/${playlist.id}`);
  },
  "new-setlist": () => {
    const setlist = blankSetlist();
    state.library.setlists.unshift(setlist);
    persist(true);
    go(`#/setlists/${setlist.id}`);
  },
  "delete-song": async (element) => {
    const song = findSong(state.library, element.dataset.id);
    if (!song) return;
    const ok = await ask(`Apagar “${song.title}”? Ela sai das playlists e das setlists.`);
    if (!ok) return;
    state.library.songs = state.library.songs.filter((item) => item.id !== song.id);
    for (const playlist of state.library.playlists) {
      playlist.songIds = playlist.songIds.filter((id) => id !== song.id);
    }
    for (const setlist of state.library.setlists) {
      setlist.items = setlist.items.filter((item) => item.songId !== song.id);
    }
    persist(true);
    const docId = song.pdfRef?.documentId || (song.pdfName ? song.id : null);
    if (docId && countPdfDocumentReferences(state.library, docId) === 0) {
      removePdfDocument(state.library, docId);
      deletePdfDocument(docId).catch(() => {});
      releasePdf(docId);
    }
    persist(true);
    go("#/musicas");
  },
  "duplicate-song": (element) => {
    const song = findSong(state.library, element.dataset.id);
    if (!song) return;
    const copy = structuredClone(song);
    copy.id = uid();
    copy.title = `${song.title} (cópia)`;
    copy.createdAt = copy.updatedAt = new Date().toISOString();
    for (const section of copy.sections) {
      section.id = uid();
      for (const measure of section.measures) measure.id = uid();
    }
    state.library.songs.unshift(copy);
    persist(true);
    if (song.pdfRef) copy.pdfRef = structuredClone(song.pdfRef);
    go(`#/musicas/${copy.id}`);
  },
  "delete-playlist": async (element) => {
    const playlist = findPlaylist(element.dataset.id);
    if (!playlist) return;
    const ok = await ask(`Apagar a playlist “${playlist.name}”? As cifras continuam na biblioteca.`);
    if (!ok) return;
    state.library.playlists = state.library.playlists.filter((item) => item.id !== playlist.id);
    persist(true);
    go("#/playlists");
  },
  "delete-setlist": async (element) => {
    const setlist = findSetlist(element.dataset.id);
    if (!setlist) return;
    const ok = await ask(`Apagar a setlist “${setlist.name}”? As cifras continuam na biblioteca.`);
    if (!ok) return;
    state.library.setlists = state.library.setlists.filter((item) => item.id !== setlist.id);
    persist(true);
    go("#/setlists");
  },
  "add-section": () => {
    const song = currentSong();
    if (!song || state.previewKey) return;
    song.sections.push(blankSection(nextSectionLabel(song), song.barsPerRow));
    touchSong(song, true);
    paintPaper(song.sections.at(-1).measures[0].id);
  },
  "open-form": () => {
    const buttons = FORMS.map((form) => `<button class="btn ghost" type="button" data-action="apply-form" data-form="${esc(form.id)}">${esc(form.name)}</button>`).join("");
    openModal(`<div class="modal" role="dialog" aria-modal="true">
      <h2>Forma da música</h2>
      <p>Escolha um mapa. Os compassos nascem vazios, com intro, estrofe, refrão e as outras partes no lugar. Você escreve os acordes.</p>
      <div class="picker">${buttons}</div>
    </div>`);
  },
  "apply-form": async (element) => {
    const form = findForm(element.dataset.form);
    const song = currentSong();
    closeModal();
    if (!form || !song || state.previewKey) return;
    const dirty = song.sections.some((section) => section.measures.some((measure) => measure.chords.trim()));
    if (dirty) {
      const ok = await ask("Aplicar esta forma substitui as seções e apaga os acordes desta cifra.");
      if (!ok) return;
    }
    song.style = form.style;
    song.timeSignature = form.timeSignature;
    song.tempo = form.tempo;
    song.barsPerRow = 4;
    if (form.note && !song.notes.trim()) song.notes = form.note;
    song.sections = form.sections.map(([label, bars]) => blankSection(label, bars));
    touchSong(song, true);
    renderAll();
    toast(`${form.name} pronta para os acordes.`);
  },
  "pick-audio": () => document.querySelector("#audio-input")?.click(),
  "find-shared": () => findSharedChart(true),
  "share-chart": () => shareChart(),
  "add-line": () => {
    const song = currentSong();
    if (!song || state.previewKey) return;
    const section = activeSection(song);
    const first = blankMeasure();
    for (let index = 0; index < song.barsPerRow; index += 1) {
      section.measures.push(index === 0 ? first : blankMeasure());
    }
    touchSong(song, true);
    paintPaper(first.id);
  },
  "add-measure": (element) => {
    const song = currentSong();
    if (!song || state.previewKey) return;
    const section = song.sections.find((item) => item.id === element.dataset.section) || activeSection(song);
    const measure = blankMeasure();
    section.measures.push(measure);
    touchSong(song, true);
    paintPaper(measure.id);
  },
  "delete-measure": (element) => {
    const song = currentSong();
    if (!song || state.previewKey) return;
    const box = element.closest("[data-measure-id]");
    for (const section of song.sections) {
      if (section.measures.length === 1 && section.measures[0].id === box.dataset.measureId) {
        section.measures[0].chords = "";
        section.measures[0].ending = "";
        section.measures[0].repeat = "";
        break;
      }
      const index = section.measures.findIndex((measure) => measure.id === box.dataset.measureId);
      if (index >= 0) {
        section.measures.splice(index, 1);
        break;
      }
    }
    touchSong(song, true);
    paintPaper();
  },
  "delete-section": (element) => {
    const song = currentSong();
    if (!song || state.previewKey || song.sections.length === 1) return;
    song.sections = song.sections.filter((section) => section.id !== element.dataset.section);
    touchSong(song, true);
    paintPaper();
  },
  "move-section": (element) => {
    const song = currentSong();
    if (!song || state.previewKey) return;
    moveInArray(song.sections, (section) => section.id === element.dataset.section, Number(element.dataset.dir));
    touchSong(song, true);
    paintPaper();
  },
  "cycle-ending": (element) => cycleMeasure(element, "ending", ENDING_CYCLE),
  "cycle-repeat": (element) => cycleMeasure(element, "repeat", REPEAT_CYCLE),
  "open-paste": () => openPaste(),
  "apply-paste": () => applyPaste(),
  "commit-key": () => commitPreviewKey(),
  "clear-preview": () => {
    state.previewKey = null;
    history.replaceState(null, "", `#/musicas/${state.route.id}`);
    state.route = parseHash();
    renderMain();
  },
  "open-picker": (element) => openPicker(element.dataset.kind, element.dataset.id),
  "pick-song": (element) => pickSong(element.dataset.id),
  "remove-item": (element) => {
    const playlist = findPlaylist(state.route.id);
    if (playlist && state.route.name === "playlist") {
      playlist.songIds.splice(Number(element.dataset.index), 1);
      touchPlaylist(playlist, true);
      renderAll();
      return;
    }
    const setlist = currentSetlist();
    if (setlist) {
      setlist.items.splice(Number(element.dataset.index), 1);
      touchSetlist(setlist, true);
      renderAll();
    }
  },
  "move-item": (element) => {
    const index = Number(element.dataset.index);
    const direction = Number(element.dataset.dir);
    const playlist = state.route.name === "playlist" ? findPlaylist(state.route.id) : null;
    if (playlist) {
      moveInArray(playlist.songIds, (_, itemIndex) => itemIndex === index, direction);
      touchPlaylist(playlist, true);
      renderAll();
      return;
    }
    const setlist = currentSetlist();
    if (!setlist) return;
    moveInArray(setlist.items, (_, itemIndex) => itemIndex === index, direction);
    touchSetlist(setlist, true);
    renderAll();
  },
  "setlist-from-playlist": (element) => {
    const playlist = findPlaylist(element.dataset.id);
    if (!playlist) return;
    const setlist = blankSetlist();
    setlist.name = playlist.name;
    setlist.note = playlist.note;
    setlist.items = playlist.songIds.map((songId) => blankSetItem(songId));
    state.library.setlists.unshift(setlist);
    persist(true);
    go(`#/setlists/${setlist.id}`);
  },
  "enter-stage": (element) => {
    state.stageIndex = 0;
    go(`#/setlists/${element.dataset.id}/palco`);
  },
  "exit-stage": () => go(`#/setlists/${state.route.id}`),
  "stage-prev": () => stepPerformance(-1),
  "stage-next": () => stepPerformance(1),
  "stage-step": (element) => stepPerformance(Number(element.dataset.dir) || 1),
  "toggle-clean": () => {
    const song = currentSong();
    if (state.route.name === "stage" && song?.pdfName) {
      state.stageChart = !state.stageChart;
      renderAll();
      return;
    }
    state.clean = !state.clean;
    if (song?.pdfName) {
      if (state.clean) state.stagePage = state.stagePage || 1;
      renderAll();
      return;
    }
    document.body.classList.toggle("clean", state.clean);
    const button = document.querySelector("[data-action='toggle-clean']");
    if (button) button.textContent = readLabel(song);
    const paper = document.querySelector(".paper.sheet");
    if (paper && !state.clean) paper.style.zoom = "";
    requestAnimationFrame(fitPerformanceSheet);
  },
  "read-pdf": () => {
    state.clean = true;
    state.stagePage = 1;
    renderAll();
  },
  "pick-pdf": () => document.querySelector("#pdf-input")?.click(),
  "remove-pdf": async () => {
    const song = currentSong();
    if (!song) return;
    const docId = song.pdfRef?.documentId || (song.pdfName ? song.id : null);
    song.pdfName = "";
    song.pdfPages = 0;
    song.pdfRef = null;
    touchSong(song, true);
    if (docId && countPdfDocumentReferences(state.library, docId) === 0) {
      removePdfDocument(state.library, docId);
      await deletePdfDocument(docId).catch(() => {});
      releasePdf(docId);
    }
    renderAll();
  },
  export: () => exportLibrary(),
  import: () => openImport(),
  "close-modal": () => closeModal(),
  "confirm-yes": () => closeConfirm(true),
  "confirm-no": () => closeConfirm(false),
  "merge-import": () => readImport("merge"),
  "replace-import": () => readImport("replace"),
};

function parseHash() {
  const raw = (location.hash || "#/musicas").slice(1);
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  const params = new URLSearchParams(query);
  const tom = normalizeKey(params.get("tom") || "");
  if (parts[0] === "musicas" && parts[1]) return { name: "song", id: decodeURIComponent(parts[1]), tom };
  if (parts[0] === "playlists" && parts[1]) return { name: "playlist", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "playlists") return { name: "playlists" };
  if (parts[0] === "setlists" && parts[1] && parts[2] === "palco") return { name: "stage", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "setlists" && parts[1]) return { name: "setlist", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "setlists") return { name: "setlists" };
  return { name: "songs" };
}

function go(hash) {
  if (location.hash === hash) {
    state.route = parseHash();
    renderAll();
    return;
  }
  location.hash = hash;
}

function family() {
  if (state.route.name === "playlist" || state.route.name === "playlists") return "playlists";
  if (state.route.name === "setlist" || state.route.name === "setlists" || state.route.name === "stage") return "setlists";
  return "musicas";
}

function renderAll() {
  if (state.route.name === "stage") {
    if (state.stageRouteId !== state.route.id) {
      state.stageRouteId = state.route.id;
      state.stageChart = false;
      state.stagePage = 1;
    }
  } else {
    state.stageRouteId = "";
  }
  if (state.route.name === "song") {
    if (state.songRouteId !== state.route.id) {
      state.songRouteId = state.route.id;
      state.clean = false;
      state.stagePage = 1;
    }
  } else {
    state.songRouteId = "";
  }
  if (state.route.name !== "song" && state.route.name !== "stage") state.clean = false;
  document.body.classList.toggle("stage", state.route.name === "stage");
  document.body.classList.toggle("sheet", state.route.name === "song" || state.route.name === "stage");
  document.body.classList.toggle("clean", state.clean && (state.route.name === "song" || state.route.name === "stage"));
  renderNav();
  renderList();
  renderMain();
}

function renderNav() {
  const section = family();
  for (const button of document.querySelectorAll("[data-nav]")) {
    button.classList.toggle("active", button.dataset.nav === section);
  }
  const labels = { musicas: ["Nova cifra", "new-song"], playlists: ["Nova playlist", "new-playlist"], setlists: ["Nova setlist", "new-setlist"] };
  createBtn.textContent = labels[section][0];
  createBtn.dataset.action = labels[section][1];
  createBtn.hidden = state.route.name === "stage";
}

function renderList() {
  const query = state.query;
  const section = family();
  let rows;
  if (section === "musicas") {
    rows = state.library.songs.filter((song) => matches(query, song.title, song.composer, song.style, song.key));
    list.innerHTML = rows.map((song) => itemButton(`#/musicas/${song.id}`, song.id, song.title, metaLine([song.key, song.style, song.composer]))).join("")
      || `<p class="meta">Nenhuma cifra encontrada.</p>`;
    return;
  }
  if (section === "playlists") {
    rows = state.library.playlists.filter((playlist) => matches(query, playlist.name, playlist.note));
    list.innerHTML = rows.map((playlist) => itemButton(`#/playlists/${playlist.id}`, playlist.id, playlist.name, `${playlist.songIds.length} cifra(s)`)).join("")
      || `<p class="meta">Nenhuma playlist encontrada.</p>`;
    return;
  }
  rows = state.library.setlists.filter((setlist) => matches(query, setlist.name, setlist.place, setlist.note));
  list.innerHTML = rows.map((setlist) => itemButton(`#/setlists/${setlist.id}`, setlist.id, setlist.name, metaLine([formatDate(setlist.date), setlist.place, `${setlist.items.length} música(s)`]))).join("")
    || `<p class="meta">Nenhuma setlist encontrada.</p>`;
}

function itemButton(hash, id, title, detail) {
  const active = state.route.id === id ? "active" : "";
  return `<button class="item ${active}" type="button" data-go="${esc(hash)}"><strong>${esc(title)}</strong><small>${esc(detail)}</small></button>`;
}

function renderMain() {
  const route = state.route;
  const enteringSong = route.name === "song" && !(state.lastRoute?.name === "song" && state.lastRoute.id === route.id);
  if (route.name !== "song" && route.name !== "stage") state.loadedSongId = null;
  if (enteringSong) {
    const song = findSong(state.library, route.id);
    state.previewKey = song && route.tom && route.tom !== song.key ? route.tom : null;
    state.loadedSongId = song?.id || null;
    state.activeSectionId = song?.sections[0]?.id || null;
  }
  state.lastRoute = { name: route.name, id: route.id || "" };
  const views = { songs: viewSongs, song: viewSong, playlists: viewPlaylists, playlist: viewPlaylist, setlists: viewSetlists, setlist: viewSetlist, stage: viewStage };
  main.innerHTML = (views[state.route.name] || viewSongs)();
  if (state.route.name === "song" || state.route.name === "stage") {
    paintPaper();
    requestAnimationFrame(() => {
      fitPerformanceSheet();
      mountPdfFrame();
    });
  }
  const song = currentSong();
  document.title = song ? `${song.title} · Caderno` : "Caderno";
}

function viewSongs() {
  const songs = filteredSongs();
  return `<section class="desk">
    <header class="desk-head"><div><h1>Músicas</h1><p class="lede">Escreva a cifra, guarde o tom e o andamento, e depois junte as músicas numa playlist ou numa setlist.</p></div>
    <button class="btn primary" type="button" data-action="new-song">Nova cifra</button></header>
    ${songs.length ? `<div class="cards">${songs.map(songCard).join("")}</div>` : empty("Nenhuma cifra ainda.", "Crie a primeira e digite um acorde por compasso. Enter avança para o próximo.")}
  </section>`;
}

function songCard(song) {
  return `<article class="card">
    <a href="#/musicas/${esc(song.id)}"><h2>${esc(song.title)}</h2>
    <p>${esc(metaLine([song.composer, song.key, song.style, `${song.tempo} bpm`, `${measureCount(song)} compassos`, song.pdfName ? "PDF" : ""]))}</p></a>
    <div class="inline-actions no-print">
      <button class="btn ghost" type="button" data-action="duplicate-song" data-id="${esc(song.id)}">Duplicar</button>
      <button class="btn danger" type="button" data-action="delete-song" data-id="${esc(song.id)}">Apagar</button>
    </div>
  </article>`;
}

function viewSong() {
  const song = currentSong();
  if (!song) return missing("Essa cifra não está na biblioteca.", "#/musicas");
  return `<section class="editor">
    ${readToggle(song)}
    <div class="editor-top no-print">
      <div><a class="text-link" href="#/musicas">Músicas</a><p id="save-state" class="status">Salvo</p></div>
      <div class="inline-actions">
        <button class="btn ghost" type="button" data-action="duplicate-song" data-id="${esc(song.id)}">Duplicar</button>
        <button class="btn danger" type="button" data-action="delete-song" data-id="${esc(song.id)}">Apagar</button>
      </div>
    </div>
    <div class="sheet-tools no-print">
      ${fieldSelect("key", "Tom", keyOptions(song.key), song.key)}
      ${fieldInput("tempo", "Tempo", song.tempo, "class=\"tempo\" inputmode=\"numeric\"")}
      ${fieldSelect("timeSignature", "Compasso", `<option value=""${!song.timeSignature ? " selected" : ""}>Sem compasso</option>` + TIME_SIGNATURES.map((value) => `<option${value === song.timeSignature ? " selected" : ""}>${esc(value)}</option>`).join(""), song.timeSignature)}
      ${fieldSelect("barsPerRow", "Barra", [[8, "Meia"], [4, "Normal"], [2, "Dupla"]].map(([value, label]) => `<option value="${value}"${value === song.barsPerRow ? " selected" : ""}>${label}</option>`).join(""))}
      <button class="btn ghost" type="button" data-action="add-line">Linha</button>
      <button class="btn ghost" type="button" data-action="add-section">Seção</button>
      <button class="btn ghost" type="button" data-action="open-form">Forma</button>
      <button class="btn ghost" type="button" data-action="open-paste">Colar</button>
      <button class="btn ghost" type="button" data-action="pick-pdf">${song.pdfName ? "Trocar PDF" : "Anexar PDF"}</button>
      ${song.pdfName ? `<span class="pdf-chip" title="${esc(song.pdfName)}">${esc(song.pdfName)} · ${song.pdfPages || 1} pág.</span>` : ""}
      ${song.pdfName ? `<button class="btn ghost" type="button" data-action="read-pdf">Ler PDF</button>` : ""}
      <button class="btn ghost" type="button" data-action="pick-audio">Analisar áudio</button>
      <button class="btn ghost" type="button" data-action="find-shared">Buscar aprovada</button>
      <button class="btn ghost" type="button" data-action="share-chart">Aprovar e compartilhar</button>
      ${song.pdfName ? `<button class="btn ghost" type="button" data-action="remove-pdf">Tirar PDF</button>` : ""}
      <label class="field">Ver em
        <select data-preview-key>${previewOptions(song)}</select>
      </label>
      <label class="field">Incluir em
        <select data-file-song><option value="">Escolher…</option>${fileOptions()}</select>
      </label>
    </div>
    <datalist id="styles">${STYLES.map((style) => `<option value="${esc(style)}"></option>`).join("")}</datalist>
    <datalist id="section-names">${["Intro", "Estrofe", "Pré", "Refrão", "Ponte", "Solo", "Vamp", "Break", "Fim"].map((name) => `<option value="${name}"></option>`).join("")}</datalist>
    <div id="preview-banner" class="banner no-print" ${state.previewKey ? "" : "hidden"}>
      <span data-preview-label>Visualização em ${esc(state.previewKey || song.key)}. A cifra salva continua em ${esc(song.key)}.</span>
      <span class="inline-actions">
        <button class="btn ghost" type="button" data-action="commit-key">Gravar neste tom</button>
        <button class="btn ghost" type="button" data-action="clear-preview">Voltar</button>
      </span>
    </div>
    ${showingPdf(song) ? pdfStage(song, state.stagePage) : `<article class="paper sheet">
      <div class="lead">
      <input class="sheet-title" data-field="title" value="${esc(song.title)}" aria-label="Título" autocomplete="off" spellcheck="false">
      <div class="sheet-sub">
        <label class="style-wrap"><span>(</span><input data-field="style" size="${Math.max(song.style.length, 1)}" value="${esc(song.style)}" placeholder="Medium Swing" list="styles" aria-label="Estilo" autocomplete="off"><span>)</span></label>
        <input class="sheet-composer" data-field="composer" size="${Math.max(song.composer.length, 1)}" value="${esc(song.composer)}" placeholder="Compositor" aria-label="Compositor" autocomplete="off">
      </div>
      <div id="paper-body"></div>
      <textarea class="sheet-notes" data-field="notes" placeholder="Forma, coda, observação">${esc(song.notes)}</textarea>
      </div>
    </article>`}
    <p class="sheet-hint no-print">Analisar áudio lê um arquivo de som e escreve um rascunho de tríades. Confira cada compasso. Quando a cifra estiver certa, aprove e compartilhe: a próxima pessoa que buscar a mesma música recebe essa versão.</p>
  </section>`;
}

function splitRoot(token) {
  const match = String(token).match(/^([A-G])([#bx])?(.*)$/);
  if (!match) return { letter: token, accidental: "", quality: "" };
  return { letter: match[1], accidental: match[2] || "", quality: match[3] || "" };
}

function noteStack(part) {
  const accidental = part.accidental ? `<span class="acc">${esc(part.accidental)}</span>` : "";
  const quality = part.quality ? `<span class="qual">${esc(part.quality)}</span>` : "";
  return `<span class="stack"><span class="root">${esc(part.letter)}${accidental}</span>${quality}</span>`;
}

function glyphToken(token) {
  const [head, bass] = token.split("/");
  const main = splitRoot(head);
  const low = bass ? splitRoot(bass) : null;
  return `${noteStack(main)}${low ? `<span class="slash">/</span>${noteStack(low)}` : ""}`;
}

function glyphRow(text) {
  const tokens = String(text).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  return tokens.map((token, index) => {
    const left = tokens.length === 1 ? 3 : (index / tokens.length) * 100;
    return `<span class="glyph" style="left:${left}%">${glyphToken(token)}</span>`;
  }).join("");
}

function fitHeaderFields() {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
  document.body.appendChild(probe);
  for (const field of document.querySelectorAll(".paper.sheet [data-field='style'], .paper.sheet [data-field='composer']")) {
    const computed = getComputedStyle(field);
    probe.style.fontFamily = computed.fontFamily;
    probe.style.fontSize = computed.fontSize;
    probe.style.fontWeight = computed.fontWeight;
    probe.textContent = field.value || field.placeholder || "";
    const textWidth = probe.getBoundingClientRect().width;
    field.style.fieldSizing = "fixed";
    field.style.minWidth = "0";
    field.size = 1;
    field.style.width = "20px";
    field.style.width = `${field.scrollWidth + 2}px`;
    const paren = field.nextElementSibling;
    if (paren && field.dataset.field === "style") {
      const slack = field.clientWidth - textWidth;
      paren.style.marginLeft = `${-Math.max(0, slack - 4)}px`;
    }
  }
  probe.remove();
}

function paintPaper(focusId) {
  const song = currentSong();
  const paper = document.querySelector("#paper-body");
  if (!song || !paper) return;
  const editable = state.route.name === "song" && !state.previewKey;
  const sections = editable ? song.sections : transposeSections(song.sections, song.key, state.previewKey);
  const hasTime = Boolean(song.timeSignature && /^\d+\/\d+$/.test(song.timeSignature));
  const [beats, unit] = hasTime ? song.timeSignature.split("/") : ["", ""];
  let bar = 1;
  let firstLine = true;
  const lastSection = sections[sections.length - 1];
  paper.innerHTML = sections.map((section) => {
    const rows = chunk(section.measures, song.barsPerRow);
    const source = song.sections.find((item) => item.id === section.id) || section;
    const named = source.label.trim().length > 1;
    const letter = editable
      ? `<input class="rehearsal" data-section-label="${esc(source.id)}" value="${esc(source.label)}" maxlength="24" list="section-names" aria-label="Seção" autocomplete="off" spellcheck="false">`
      : `<div class="rehearsal static">${esc(source.label)}</div>`;
    const tools = editable
      ? `<div class="section-tools">
           <button type="button" tabindex="-1" data-action="add-measure" data-section="${esc(source.id)}" title="Compasso">+</button>
           <button type="button" tabindex="-1" data-action="move-section" data-section="${esc(source.id)}" data-dir="-1" title="Subir seção">↑</button>
           <button type="button" tabindex="-1" data-action="move-section" data-section="${esc(source.id)}" data-dir="1" title="Descer seção">↓</button>
           <button type="button" tabindex="-1" data-action="delete-section" data-section="${esc(source.id)}" title="Apagar seção">×</button>
         </div>`
      : "";
    const lines = rows.map((row, rowIndex) => {
      const showTime = firstLine && hasTime;
      firstLine = false;
      const isLastLine = section === lastSection && rowIndex === rows.length - 1;
      const cells = row.map((measure, index) => {
        const last = index === row.length - 1;
        const fullRow = row.length === song.barsPerRow;
        return measureCell(measure, bar++, editable, isLastLine && last, last && fullRow && !(isLastLine && last));
      }).join("");
      return `<div class="staff-line" style="--bars:${song.barsPerRow}">
        ${rowIndex === 0 && !named ? letter + tools : ""}
        ${rowIndex === 0 && named ? tools : ""}
        ${showTime ? `<div class="time-sig" aria-hidden="true"><span>${esc(beats)}</span><span>${esc(unit)}</span></div>` : ""}
        ${cells}
      </div>`;
    }).join("");
    return `<div class="system${named ? " named" : ""}" data-section-id="${esc(source.id)}">${named ? `<div class="section-head">${letter}</div>` : ""}${lines}</div>`;
  }).join("");
  fitHeaderFields();
  fitGlyphs();
  if (focusId) {
    const input = document.querySelector(`[data-chord-id="${cssEscape(focusId)}"]`);
    input?.focus();
    input?.select();
  }
}

function measureCell(measure, number, editable, isFinal, isRowEnd) {
  const classes = ["bar"];
  if (measure.repeat === "start" || measure.repeat === "both") classes.push("repeat-start");
  if (measure.repeat === "end" || measure.repeat === "both") classes.push("repeat-end");
  if (measure.ending) classes.push("has-ending");
  if (isFinal && measure.repeat !== "end" && measure.repeat !== "both") classes.push("final");
  else if (isRowEnd) classes.push("close");
  const shown = formatCell(measure.chords);
  const ending = measure.ending ? `${measure.ending}.` : "";
  const dots = `${measure.repeat === "start" || measure.repeat === "both" ? `<span class="rdots start"></span>` : ""}${measure.repeat === "end" || measure.repeat === "both" ? `<span class="rdots end"></span>` : ""}`;
  const endingHtml = measure.ending ? `<span class="ending-rule"></span><span class="ending-mark">${esc(ending)}</span>` : "";
  const tools = editable
    ? `<div class="bar-tools">
         <button type="button" tabindex="-1" data-action="cycle-ending" title="Casa de final">${ending || "1."}</button>
         <button type="button" tabindex="-1" data-action="cycle-repeat" title="Barra de repetição">${REPEAT_LABEL[measure.repeat] || "|"}</button>
         <button type="button" tabindex="-1" data-action="delete-measure" title="Apagar compasso">×</button>
       </div>`
    : "";
  const field = editable
    ? `<input class="chord-input" data-chord-id="${esc(measure.id)}" value="${esc(shown)}" aria-label="Compasso ${number}" autocomplete="off" spellcheck="false">`
    : "";
  return `<div class="${classes.join(" ")}" data-measure-id="${esc(measure.id)}">${endingHtml}${dots}<div class="glyphs" aria-hidden="true">${glyphRow(shown)}</div>${field}${tools}</div>`;
}

function viewPlaylists() {
  const playlists = state.library.playlists.filter((playlist) => matches(state.query, playlist.name, playlist.note));
  return `<section class="desk">
    <header class="desk-head"><div><h1>Playlists</h1><p class="lede">Uma playlist guarda um repertório: por banda, por estilo ou por pasta. A ordem é a sua.</p></div>
    <button class="btn primary" type="button" data-action="new-playlist">Nova playlist</button></header>
    ${playlists.length ? `<div class="cards">${playlists.map((playlist) => `<article class="card"><a href="#/playlists/${esc(playlist.id)}"><h2>${esc(playlist.name)}</h2><p>${playlist.songIds.length} cifra(s)</p></a></article>`).join("")}</div>` : empty("Nenhuma playlist ainda.", "Crie uma e acrescente as cifras que já estão na biblioteca.")}
  </section>`;
}

function viewPlaylist() {
  const playlist = findPlaylist(state.route.id);
  if (!playlist) return missing("Essa playlist não está na biblioteca.", "#/playlists");
  const rows = playlist.songIds.map((songId, index) => {
    const song = findSong(state.library, songId);
    if (!song) return "";
    return `<div class="table-row order-row" data-order-index="${index}">
      ${orderCell(index, playlist.songIds.length)}
      <a class="order-main" href="#/musicas/${esc(song.id)}"><h2>${esc(song.title)}</h2><p class="meta">${esc(metaLine([song.composer, song.key, song.style]))}</p></a>
      <span>${esc(song.key)}</span>
      <span>${esc(song.style)}</span>
      <div class="inline-actions">${removeButton(index)}</div>
    </div>`;
  }).join("");
  return `<section class="desk">
    <header class="desk-head"><div><a class="text-link" href="#/playlists">Playlists</a><h1><input class="naked" data-collection="playlist-name" value="${esc(playlist.name)}" aria-label="Nome da playlist"></h1></div>
    <div class="inline-actions">
      <button class="btn ghost" type="button" data-action="setlist-from-playlist" data-id="${esc(playlist.id)}">Criar setlist</button>
      <button class="btn primary" type="button" data-action="open-picker" data-kind="playlist" data-id="${esc(playlist.id)}">Adicionar cifra</button>
      <button class="btn danger" type="button" data-action="delete-playlist" data-id="${esc(playlist.id)}">Apagar</button>
    </div></header>
    <label class="field">Nota<textarea data-collection="playlist-note" placeholder="Para que serve este repertório">${esc(playlist.note)}</textarea></label>
    <p class="meta">Arraste ☰ ou use as setas para mudar a ordem.</p>
    <div class="collection">${rows || empty("Essa playlist está vazia.", "Adicione cifras que você já escreveu.")}</div>
  </section>`;
}

function viewSetlists() {
  const setlists = state.library.setlists.filter((setlist) => matches(state.query, setlist.name, setlist.place, setlist.note));
  return `<section class="desk">
    <header class="desk-head"><div><h1>Setlists</h1><p class="lede">A setlist é a ordem da noite. Cada música pode ter o tom do dia, sem alterar a cifra original.</p></div>
    <button class="btn primary" type="button" data-action="new-setlist">Nova setlist</button></header>
    ${setlists.length ? `<div class="cards">${setlists.map((setlist) => `<article class="card"><a href="#/setlists/${esc(setlist.id)}"><h2>${esc(setlist.name)}</h2><p>${esc(metaLine([formatDate(setlist.date), setlist.place, `${setlist.items.length} música(s)`]))}</p></a>
      <button class="btn ghost" type="button" data-action="enter-stage" data-id="${esc(setlist.id)}">Modo palco</button></article>`).join("")}</div>` : empty("Nenhuma setlist ainda.", "Monte a ordem do show e abra o modo palco na hora de tocar.")}
  </section>`;
}

function viewSetlist() {
  const setlist = findSetlist(state.route.id);
  if (!setlist) return missing("Essa setlist não está na biblioteca.", "#/setlists");
  const rows = setlist.items.map((item, index) => {
    const song = findSong(state.library, item.songId);
    if (!song) return "";
    const tom = item.key || song.key;
    return `<div class="table-row set-row order-row" data-order-index="${index}">
      ${orderCell(index, setlist.items.length)}
      <div class="order-main"><a href="#/musicas/${esc(song.id)}?tom=${esc(tom)}"><h2>${esc(song.title)}</h2></a><p class="meta">${esc(song.composer || "Sem compositor")} · cifra em ${esc(song.key)}</p></div>
      <label class="field">Tom do dia<select data-item-key="${esc(item.id)}">${keyOptions(tom, song.key)}</select></label>
      <input class="night-note" data-collection="item-note" data-item-id="${esc(item.id)}" value="${esc(item.note)}" placeholder="Nota da noite" aria-label="Nota da noite">
      <div class="inline-actions">${removeButton(index)}</div>
    </div>`;
  }).join("");
  return `<section class="desk">
    <header class="desk-head"><div><a class="text-link" href="#/setlists">Setlists</a><h1><input class="naked" data-collection="setlist-name" value="${esc(setlist.name)}" aria-label="Nome da setlist"></h1></div>
    <div class="inline-actions">
      <button class="btn primary" type="button" data-action="enter-stage" data-id="${esc(setlist.id)}">Modo palco</button>
      <button class="btn ghost" type="button" data-action="open-picker" data-kind="setlist" data-id="${esc(setlist.id)}">Adicionar cifra</button>
      <button class="btn danger" type="button" data-action="delete-setlist" data-id="${esc(setlist.id)}">Apagar</button>
    </div></header>
    <div class="meta-row">
      <label class="field">Data<input type="date" data-collection="setlist-date" value="${esc(setlist.date)}"></label>
      <label class="field">Local<input data-collection="setlist-place" value="${esc(setlist.place)}" placeholder="Casa, ensaio, evento"></label>
    </div>
    <label class="field">Nota<textarea data-collection="setlist-note">${esc(setlist.note)}</textarea></label>
    <p class="meta">Arraste ☰ ou use as setas para mudar a ordem.</p>
    <div class="collection">${rows || empty("Essa setlist está vazia.", "Adicione as cifras na ordem em que vão ser tocadas.")}</div>
  </section>`;
}

function viewStage() {
  const setlist = findSetlist(state.route.id);
  if (!setlist) return missing("Essa setlist não está na biblioteca.", "#/setlists");
  if (!setlist.items.length) {
    return `<section class="desk"><h1>Modo palco</h1>${empty("A setlist está vazia.", "Volte e adicione as músicas da noite.")}
      <button class="btn ghost" type="button" data-action="exit-stage">Voltar</button></section>`;
  }
  state.stageIndex = Math.min(state.stageIndex, setlist.items.length - 1);
  const item = setlist.items[state.stageIndex];
  const song = findSong(state.library, item.songId);
  if (!song) return missing("Uma cifra desta setlist não está mais na biblioteca.", `#/setlists/${setlist.id}`);
  const tom = item.key || song.key;
  state.previewKey = tom === song.key ? null : tom;
  state.loadedSongId = song.id;
  const options = setlist.items.map((entry, index) => {
    const entrySong = findSong(state.library, entry.songId);
    const label = `${index + 1}. ${entrySong?.title || "Cifra ausente"}`;
    return `<option value="${index}"${index === state.stageIndex ? " selected" : ""}>${esc(label)}</option>`;
  }).join("");
  const next = setlist.items[state.stageIndex + 1];
  const nextSong = next ? findSong(state.library, next.songId) : null;
  const page = Math.min(state.stagePage, song.pdfPages || 1);
  return `<section>
    <div class="stage-bar no-print">
      <button class="btn ghost" type="button" data-action="exit-stage">Sair do palco</button>
      <select id="stage-picker" aria-label="Música da setlist">${options}</select>
      <div class="inline-actions">
        <button class="btn ghost" type="button" data-action="stage-prev">Anterior</button>
        <button class="btn ghost" type="button" data-action="stage-next">Próxima</button>
      </div>
    </div>
    ${readToggle(song)}
    ${tapLayer()}
    ${showingPdf(song) ? pdfStage(song, page) : `<article class="paper sheet" id="stage-paper">
      <div class="lead">
      <h1 class="sheet-title">${esc(song.title)}</h1>
      <div class="sheet-sub">
        <p class="sheet-style">${song.style ? `(${esc(song.style)})` : ""}</p>
        <p class="sheet-composer">${esc(song.composer)}</p>
      </div>
      <div id="paper-body"></div>
      ${song.notes ? `<p class="sheet-notes static">${esc(song.notes)}</p>` : ""}
      <p class="hint">${nextSong ? `A seguir: ${esc(nextSong.title)} · ${esc(next?.key || nextSong.key)}` : "Última música da setlist."}</p>
      </div>
    </article>`}
  </section>`;
}

function filteredSongs() {
  return state.library.songs.filter((song) => matches(state.query, song.title, song.composer, song.style, song.key));
}

function writeSongField(song, field) {
  const name = field.dataset.field;
  if (name === "tempo") {
    const tempo = Number(field.value);
    if (tempo >= 20 && tempo <= 400) song.tempo = Math.round(tempo);
  } else if (name === "key") song.key = normalizeKey(field.value) || song.key;
  else if (name === "timeSignature") song.timeSignature = field.value;
  else if (name === "barsPerRow") song.barsPerRow = Number(field.value) || 4;
  else if (name === "title") {
    song.title = field.value.slice(0, 160) || "Sem título";
    document.title = `${song.title} · Caderno`;
  }
  else song[name] = field.value;
  touchSong(song, false);
  if (name === "title" || name === "key" || name === "style" || name === "composer") renderList();
}

function writeCollectionField(field) {
  const kind = field.dataset.collection;
  if (!kind) return;
  if (kind.startsWith("playlist")) {
    const playlist = currentPlaylist();
    if (!playlist) return;
    if (kind === "playlist-name") playlist.name = field.value.slice(0, 160) || "Nova playlist";
    if (kind === "playlist-note") playlist.note = field.value;
    touchPlaylist(playlist, false);
    return;
  }
  const setlist = currentSetlist();
  if (!setlist) return;
  if (kind === "setlist-name") setlist.name = field.value.slice(0, 160) || "Nova setlist";
  if (kind === "setlist-place") setlist.place = field.value.slice(0, 160);
  if (kind === "setlist-date") setlist.date = field.value;
  if (kind === "setlist-note") setlist.note = field.value;
  if (kind === "item-note") {
    const item = setlist.items.find((entry) => entry.id === field.dataset.itemId);
    if (item) item.note = field.value.slice(0, 240);
  }
  touchSetlist(setlist, false);
}

function fileSong(song, value) {
  const [kind, id] = value.split(":");
  if (kind === "playlist") {
    const playlist = findPlaylist(id);
    if (!playlist) return;
    if (!playlist.songIds.includes(song.id)) playlist.songIds.push(song.id);
    touchPlaylist(playlist, true);
    toast(`Incluída em ${playlist.name}`);
    return;
  }
  if (kind === "setlist") {
    const setlist = findSetlist(id);
    if (!setlist) return;
    setlist.items.push(blankSetItem(song.id));
    touchSetlist(setlist, true);
    toast(`Incluída em ${setlist.name}`);
  }
}

function cycleMeasure(element, key, cycle) {
  const song = currentSong();
  if (!song || state.previewKey) return;
  const box = element.closest("[data-measure-id]");
  const measure = findMeasure(song, box.dataset.measureId);
  if (!measure) return;
  measure[key] = cycle[(cycle.indexOf(measure[key]) + 1) % cycle.length];
  touchSong(song, true);
  paintPaper(measure.id);
}

function focusNeighbor(input, direction) {
  const inputs = [...document.querySelectorAll(".chord-input")];
  const next = inputs[inputs.indexOf(input) + direction];
  if (next) {
    next.focus();
    next.select();
    return;
  }
  if (direction < 0) return;
  const song = currentSong();
  const section = activeSection(song);
  const measure = blankMeasure();
  section.measures.push(measure);
  touchSong(song, true);
  paintPaper(measure.id);
}

function commitPreviewKey() {
  const song = currentSong();
  if (!song || !state.previewKey || signedInterval(song.key, state.previewKey) === 0) {
    if (song && state.previewKey) song.key = state.previewKey;
    state.previewKey = null;
    if (song) touchSong(song, true);
    history.replaceState(null, "", `#/musicas/${song?.id || ""}`);
    state.route = parseHash();
    renderMain();
    return;
  }
  song.sections = transposeSections(song.sections, song.key, state.previewKey).map((section) => ({
    ...section,
    id: section.id,
    measures: section.measures.map((measure) => ({ ...measure })),
  }));
  song.key = state.previewKey;
  state.previewKey = null;
  touchSong(song, true);
  history.replaceState(null, "", `#/musicas/${song.id}`);
  state.route = parseHash();
  renderMain();
  toast(`Cifra gravada em ${song.key}`);
}

function isYoutubeUrl(value) {
  let text = String(value || "").trim();
  if (!text) return false;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.length > 1;
    if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
      return Boolean(url.searchParams.get("v") || /^\/(shorts|embed|live)\//.test(url.pathname));
    }
  } catch {
    return false;
  }
  return false;
}

function openPaste() {
  openModal(`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="paste-title">
    <h2 id="paste-title">Colar cifra</h2>
    <p>Cole um link do Cifra Club, os acordes da cifra ou um mapa com barras. A letra não entra na cifra. <code>|:</code> e <code>:|</code> marcam repetição, <code>[1]</code> e <code>[2]</code> marcam as casas.</p>
    <textarea id="paste-text" placeholder="https://www.cifraclub.com.br/artista/musica/&#10;&#10;Tom: C&#10;A&#10;| Cmaj7 | Dm7 G7 | Cmaj7 |"></textarea>
    <p id="paste-error" class="status" hidden></p>
    <div class="inline-actions"><button class="btn primary" type="button" data-action="apply-paste">Aplicar</button><button class="btn ghost" type="button" data-action="close-modal">Cancelar</button></div>
  </div>`);
  document.querySelector("#paste-text")?.focus();
}

function chartHasChords(song) {
  return song.sections.some((section) => section.measures.some((measure) => measure.chords.trim()));
}

function writeParsedChart(song, parsed, replaceNotes) {
  if (parsed.title) song.title = parsed.title;
  if (parsed.composer) song.composer = parsed.composer;
  if (parsed.style) song.style = parsed.style;
  if (parsed.key) song.key = parsed.key;
  if (parsed.tempo) song.tempo = clampTempo(parsed.tempo);
  if (parsed.timeSignature) song.timeSignature = parsed.timeSignature;
  if ([2, 4, 8].includes(Number(parsed.barsPerRow))) song.barsPerRow = Number(parsed.barsPerRow);
  if (replaceNotes) song.notes = parsed.notes || "";
  song.sections = parsed.sections.map((section) => ({
    id: uid(),
    label: section.label,
    measures: section.measures.map((measure) => ({ id: uid(), ...measure, chords: formatCell(measure.chords) })),
  }));
  touchSong(song, true);
  closeModal();
  renderMain();
}

function pasteError(message) {
  const note = document.querySelector("#paste-error");
  if (note) {
    note.hidden = false;
    note.textContent = message;
  }
  toast(message);
}

async function chartFromLink(link) {
  try {
    const response = await fetch(`/api/cifra?url=${encodeURIComponent(link)}`);
    const body = await response.json();
    if (response.ok && body.sections?.length) return body;
  } catch {
    /* a leitura direta falhou; tenta a página pelo mesmo endereço */
  }
  const path = new URL(link).pathname.replace(/^\/+/, "");
  const page = await fetch(`/leitura/${path}`, { headers: { Accept: "text/html" } });
  if (!page.ok) return null;
  const html = await page.text();
  if (!html.includes("data-chord-name") || html.length > 1500000) return null;
  const chart = chartFromCifraHtml(html);
  return chart.sections.length ? chart : null;
}

async function applyCifraLink(song, link) {
  if (chartHasChords(song)) {
    const ok = await ask("Substituir os compassos desta cifra pela leitura do link?");
    if (!ok) return;
  }
  toast("Lendo a cifra…");
  try {
    const body = await chartFromLink(link);
    if (!body) {
      pasteError("Não consegui ler esse link. Copie a cifra na página e cole o texto aqui.");
      return;
    }
    writeParsedChart(song, body, true);
    const shared = await findSharedRecord(song.title, song.composer);
    if (shared && await ask(`Há uma cifra já corrigida de “${shared.title}”. Usar a versão aprovada?`)) {
      writeParsedChart(song, shared, true);
      toast("Cifra aprovada do acervo.");
      return;
    }
    const bars = body.sections.reduce((sum, section) => sum + section.measures.length, 0);
    toast(`Cifra com ${bars} compassos. Confira a repetição.`);
  } catch {
    pasteError("Não consegui ler esse link. Copie a cifra na página e cole o texto aqui.");
  }
}

async function applyPaste() {
  const song = currentSong();
  if (!song) return;
  const raw = document.querySelector("#paste-text")?.value || "";
  const parsed = parseChartText(raw);
  const plain = parsed.sections.length ? null : chartFromCifraPlain(raw);
  if (parsed.sections.length || plain?.sections.length) {
    if (chartHasChords(song)) {
      const ok = await ask("Substituir os compassos desta cifra pelo texto colado?");
      if (!ok) return;
    }
    writeParsedChart(song, parsed.sections.length ? parsed : plain, false);
    return;
  }
  const link = pastedCifraLink(raw);
  if (link) {
    await applyCifraLink(song, link);
    return;
  }
  if (isYoutubeUrl(raw.trim())) {
    toast("O YouTube não entrega o áudio para o Caderno. Use um arquivo da música em Analisar áudio.");
    return;
  }
  toast("Não encontrei compassos. Cole o link do Cifra Club, os acordes ou um mapa com barras.");
}

function openPicker(kind, id) {
  state.picker = { kind, id };
  const songs = state.library.songs;
  openModal(`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="picker-title">
    <h2 id="picker-title">Adicionar cifra</h2>
    <input id="picker-search" type="search" placeholder="Buscar cifra" autocomplete="off">
    <div id="picker-list" class="picker"></div>
    <button class="btn ghost" type="button" data-action="close-modal">Fechar</button>
  </div>`);
  const filter = () => {
    const query = document.querySelector("#picker-search").value.trim().toLowerCase();
    const found = songs.filter((song) => matches(query, song.title, song.composer, song.key));
    document.querySelector("#picker-list").innerHTML = found.map((song) => `<button type="button" data-action="pick-song" data-id="${esc(song.id)}">${esc(song.title)} <small>${esc(song.key)}</small></button>`).join("")
      || "<p>Nenhuma cifra na biblioteca.</p>";
  };
  document.querySelector("#picker-search").addEventListener("input", filter);
  filter();
  document.querySelector("#picker-search").focus();
}

function pickSong(songId) {
  if (state.picker?.kind === "playlist") {
    const playlist = findPlaylist(state.picker.id);
    if (!playlist) return;
    if (playlist.songIds.includes(songId)) {
      toast("Essa cifra já está na playlist");
      return;
    }
    playlist.songIds.push(songId);
    touchPlaylist(playlist, true);
  } else {
    const setlist = findSetlist(state.picker?.id);
    if (!setlist) return;
    setlist.items.push(blankSetItem(songId));
    touchSetlist(setlist, true);
  }
  renderAll();
  toast("Cifra adicionada");
}

function openImport() {
  openModal(`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
    <h2 id="import-title">Importar biblioteca</h2>
    <p>Escolha um arquivo exportado pelo Caderno. Mesclar junta com o que já existe. Substituir troca a biblioteca deste navegador.</p>
    <input id="import-file" type="file" accept="application/json,.json">
    <div class="inline-actions"><button class="btn primary" type="button" data-action="merge-import">Mesclar</button><button class="btn danger" type="button" data-action="replace-import">Substituir tudo</button><button class="btn ghost" type="button" data-action="close-modal">Cancelar</button></div>
  </div>`);
}

async function readImport(mode) {
  const file = document.querySelector("#import-file")?.files?.[0];
  if (!file) {
    toast("Escolha um arquivo.");
    return;
  }
  if (mode === "replace") {
    const ok = await ask("Substituir toda a biblioteca deste navegador?");
    if (!ok) return;
  }
  let incoming;
  let pdfs;
  try {
    const parsed = JSON.parse(await file.text());
    pdfs = parsed?.pdfs && typeof parsed.pdfs === "object" ? parsed.pdfs : {};
    incoming = normalizeLibrary(parsed);
  } catch {
    toast("Esse arquivo não é uma biblioteca do Caderno.");
    return;
  }
  if (mode === "replace") state.library = incoming;
  else state.library = mergeLibraries(state.library, incoming);
  persist(true);
  await restorePdfs(pdfs);
  closeModal();
  renderAll();
  toast(mode === "replace" ? "Biblioteca substituída" : "Biblioteca mesclada");
}

function mergeLibraries(current, incoming) {
  const songs = new Map(current.songs.map((song) => [song.id, song]));
  for (const song of incoming.songs) songs.set(song.id, song);
  const playlists = new Map(current.playlists.map((playlist) => [playlist.id, playlist]));
  for (const playlist of incoming.playlists) playlists.set(playlist.id, playlist);
  const setlists = new Map(current.setlists.map((setlist) => [setlist.id, setlist]));
  for (const setlist of incoming.setlists) setlists.set(setlist.id, setlist);
  return normalizeLibrary({ version: 1, songs: [...songs.values()], playlists: [...playlists.values()], setlists: [...setlists.values()] });
}

async function exportLibrary() {
  const pdfs = {};
  for (const doc of state.library.pdfDocuments || []) {
    const record = await loadPdfDocument(doc.id).catch(() => null);
    if (!record?.buffer) continue;
    pdfs[doc.id] = { name: doc.name, pageCount: doc.pageCount, pages: doc.pageCount, data: bufferToBase64(record.buffer) };
  }
  for (const song of state.library.songs) {
    const docId = song.pdfRef?.documentId || (song.pdfName ? song.id : null);
    if (docId && !pdfs[docId]) {
      const record = await loadPdfDocument(docId).catch(() => null);
      if (record?.buffer) {
        pdfs[docId] = { name: record.name, pageCount: record.pageCount, pages: record.pageCount, data: bufferToBase64(record.buffer) };
      }
    }
  }
  const blob = new Blob([JSON.stringify({ ...state.library, pdfs }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "caderno-biblioteca.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  toast("Biblioteca exportada. Guarde esse arquivo: ele é a cópia das cifras, playlists e PDFs.");
}

function shiftStage(direction) {
  const setlist = currentSetlist();
  if (!setlist?.items.length) return null;
  const next = state.stageIndex + direction;
  if (next < 0 || next >= setlist.items.length) return null;
  state.stageIndex = next;
  return setlist.items[next];
}

function stepPerformance(direction) {
  const song = currentSong();
  const pages = song?.pdfRef ? pdfRangeSize(song.pdfRef) : (song?.pdfPages || 0);
  if (pages > 1) {
    const nextPage = state.stagePage + direction;
    if (nextPage >= 1 && nextPage <= pages) {
      state.stagePage = nextPage;
      renderMain();
      return;
    }
  }
  if (state.route.name !== "stage") return;
  const item = shiftStage(direction);
  if (!item) return;
  const arrived = findSong(state.library, item.songId);
  const arrivedPages = arrived?.pdfRef ? pdfRangeSize(arrived.pdfRef) : (arrived?.pdfPages || 1);
  state.stagePage = direction < 0 ? arrivedPages : 1;
  renderMain();
}

function pdfStage(song, page) {
  const pages = song.pdfRef ? pdfRangeSize(song.pdfRef) : (song.pdfPages || 1);
  const safePage = Math.min(Math.max(page || 1, 1), pages);
  const physicalPage = song.pdfRef ? relativeToPhysicalPage(song.pdfRef, safePage) : safePage;
  const onStage = state.route.name === "stage";
  const setlist = onStage ? currentSetlist() : null;
  const canPrev = safePage > 1 || (onStage && state.stageIndex > 0);
  const canNext = safePage < pages || (onStage && setlist && state.stageIndex < setlist.items.length - 1);
  const docId = song.pdfRef?.documentId || song.id;
  return `<div class="pdf-read">
    <canvas class="pdf-canvas" data-doc-id="${esc(docId)}" data-song-id="${esc(song.id)}" data-page="${safePage}" data-physical-page="${physicalPage}" aria-label="${esc(song.title)}, página ${safePage}"></canvas>
    <p class="pdf-status" hidden>Não consegui abrir o PDF desta cifra.</p>
    <div class="pdf-bar">
      <button class="btn ghost" type="button" data-action="toggle-clean">${readLabel(song)}</button>
      <button class="btn ghost" type="button" data-action="stage-step" data-dir="-1" ${canPrev ? "" : "disabled"}>Anterior</button>
      <p class="pdf-caption">${esc(song.title)} · página ${safePage} de ${pages}</p>
      <button class="btn ghost" type="button" data-action="stage-step" data-dir="1" ${canNext ? "" : "disabled"}>Próxima</button>
    </div>
  </div>`;
}

function tapLayer() {
  return `<div class="tap-layer no-print">
    <button type="button" class="tap-zone prev" data-action="stage-step" data-dir="-1" aria-label="Anterior"></button>
    <button type="button" class="tap-zone next" data-action="stage-step" data-dir="1" aria-label="Próxima"></button>
  </div>`;
}

async function findSharedChart(announce) {
  const song = currentSong();
  if (!song) return;
  const shared = await findSharedRecord(song.title, song.composer);
  if (!shared) {
    if (announce) toast("Ainda não há cifra aprovada desta música.");
    return;
  }
  const ok = await ask(`Já existe uma cifra aprovada de “${shared.title}”. Usar essa?`);
  if (!ok) return;
  writeParsedChart(song, shared, true);
  toast("Cifra aprovada do acervo.");
}

async function findSharedRecord(title, composer) {
  if (!title?.trim() || !composer?.trim() || title.trim() === "Sem título") return null;
  try {
    const params = new URLSearchParams({ title, composer });
    const response = await fetch(`/api/acervo?${params}`);
    if (!response.ok) return null;
    const chart = await response.json();
    return chart?.sections?.length ? chart : null;
  } catch {
    return null;
  }
}

async function shareChart() {
  const song = currentSong();
  if (!song) return;
  try {
    const response = await fetch("/api/acervo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: song.title,
        composer: song.composer,
        style: song.style,
        key: song.key,
        tempo: song.tempo,
        timeSignature: song.timeSignature,
        barsPerRow: song.barsPerRow,
        notes: song.notes,
        sections: song.sections.map((section) => ({
          label: section.label,
          measures: section.measures.map((measure) => ({
            chords: measure.chords,
            ending: measure.ending,
            repeat: measure.repeat,
          })),
        })),
      }),
    });
    const body = await response.json().catch(() => ({}));
    toast(body.message || body.error || "Não consegui compartilhar.");
  } catch {
    toast("Não consegui compartilhar.");
  }
}

async function readAudio(file) {
  const song = currentSong();
  if (!song || state.previewKey) return;
  const shared = await findSharedRecord(song.title, song.composer);
  if (shared && await ask(`Já existe uma cifra aprovada de “${shared.title}”. Usar essa em vez de analisar o áudio?`)) {
    writeParsedChart(song, shared, true);
    toast("Cifra aprovada do acervo.");
    return;
  }
  const dirty = song.sections.some((section) => section.measures.some((measure) => measure.chords.trim()));
  if (dirty) {
    const ok = await ask("A análise substitui as seções e apaga os acordes desta cifra.");
    if (!ok) return;
  }
  toast("Lendo o áudio…");
  try {
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    await context.close();
    const mono = new Float32Array(decoded.length);
    const channels = decoded.numberOfChannels;
    for (let channel = 0; channel < channels; channel += 1) {
      const data = decoded.getChannelData(channel);
      for (let index = 0; index < decoded.length; index += 1) mono[index] += data[index] / channels;
    }
    const beats = Number(String(song.timeSignature).split("/")[0]) || 4;
    const heard = analyzeSamples(mono, decoded.sampleRate, { beatsPerBar: beats });
    if (!heard.sections.length || heard.bars.every((chord) => chord === "NC")) {
      toast("Não encontrei acordes nesse áudio.");
      return;
    }
    song.tempo = clampTempo(heard.tempo);
    song.key = normalizeKey(heard.key) || song.key;
    song.barsPerRow = 4;
    if (!song.notes.trim()) song.notes = "Rascunho do áudio. Só reconhece tríades maiores e menores. Confira os acordes antes de tocar.";
    song.sections = heard.sections.map((section) => {
      const next = blankSection(section.label, section.chords.length);
      next.measures.forEach((measure, index) => {
        measure.chords = formatCell(section.chords[index] || "");
      });
      return next;
    });
    touchSong(song, true);
    renderAll();
    toast(`Rascunho com ${heard.bars.length} compassos a ${song.tempo} bpm. Confira os acordes.`);
  } catch {
    toast("Não consegui ler esse áudio.");
  }
}

function clearSheetFit(paper) {
  if (!paper) return;
  paper.style.zoom = "";
  paper.style.transform = "";
  paper.style.marginBottom = "";
}

function fitGlyphs() {
  for (const box of document.querySelectorAll(".glyphs")) {
    const glyphs = [...box.querySelectorAll(".glyph")];
    const width = box.clientWidth;
    if (!width || !glyphs.length) continue;
    const slot = width / glyphs.length;
    glyphs.forEach((glyph, index) => {
      const need = glyph.scrollWidth;
      const scale = need > slot - 1 ? Math.max(0.42, (slot - 1) / need) : 1;
      glyph.style.left = `${(100 / glyphs.length) * index}%`;
      glyph.style.transformOrigin = "left top";
      glyph.style.transform = scale < 0.99 ? `scale(${scale})` : "";
    });
  }
}

function fitPerformanceSheet() {
  const paper = document.querySelector(".paper.sheet");
  if (!paper) return;
  const performance = document.body.classList.contains("stage") || document.body.classList.contains("clean");
  clearSheetFit(paper);
  if (!performance || document.querySelector(".pdf-read")) {
    fitGlyphs();
    return;
  }
  const top = paper.getBoundingClientRect().top;
  const availableH = Math.max(120, window.innerHeight - top - 52);
  const availableW = Math.max(160, window.innerWidth - 16);
  const naturalW = paper.offsetWidth;
  const naturalH = paper.offsetHeight;
  let scale = Math.min(availableW / naturalW, availableH / naturalH);
  if (!Number.isFinite(scale) || scale <= 0) return;
  scale = Math.min(scale, 1.65);
  if (scale < 0.995) {
    paper.style.transformOrigin = "top center";
    paper.style.transform = `scale(${scale})`;
    paper.style.marginBottom = `${(scale - 1) * naturalH}px`;
  }
  fitGlyphs();
}

async function mountPdfFrame() {
  const canvas = document.querySelector(".pdf-canvas");
  if (!canvas) return;
  const docId = canvas.dataset.docId || canvas.dataset.songId;
  const status = canvas.parentElement?.querySelector(".pdf-status");
  const record = await loadPdfDocument(docId).catch(() => null);
  if (!record?.buffer || !canvas.isConnected) {
    if (status) {
      status.textContent = "PDF não encontrado neste dispositivo.";
      status.hidden = false;
    }
    return;
  }
  const physicalPage = Number(canvas.dataset.physicalPage || canvas.dataset.page) || 1;
  try {
    const res = await paintPdf(canvas, docId, new Uint8Array(record.buffer), physicalPage);
    if (!res.ok) {
      if (status && canvas.isConnected) {
        status.textContent = res.message || "Não consegui abrir o PDF desta cifra.";
        status.hidden = false;
      }
    } else {
      if (status) status.hidden = true;
      if (canvas.isConnected) canvas.dataset.rendered = "true";
    }
  } catch {
    if (status && canvas.isConnected) {
      status.textContent = "Erro ao renderizar o PDF.";
      status.hidden = false;
    }
  }
}

async function attachPdf(file) {
  const song = currentSong();
  if (!song) return;
  if (file.size > 25 * 1024 * 1024) {
    toast("Esse PDF passa de 25 MB.");
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const inspection = await inspectPdf(bytes);
    if (!inspection.ok) {
      toast(inspection.message || "Não foi possível abrir o arquivo PDF.");
      return;
    }
    const pageCount = inspection.pageCount;
    const documentId = uid();
    await savePdfDocument(documentId, {
      name: file.name,
      pageCount,
      buffer,
      createdAt: new Date().toISOString(),
    });

    const oldDocId = song.pdfRef?.documentId || (song.pdfName ? song.id : null);

    if (!state.library.pdfDocuments) state.library.pdfDocuments = [];
    state.library.pdfDocuments.push({
      id: documentId,
      name: file.name,
      pageCount,
      createdAt: new Date().toISOString(),
    });

    song.pdfRef = { documentId, firstPage: 1, lastPage: pageCount };
    song.pdfName = file.name;
    song.pdfPages = pageCount;
    touchSong(song, true);

    if (oldDocId && countPdfDocumentReferences(state.library, oldDocId) === 0) {
      removePdfDocument(state.library, oldDocId);
      await deletePdfDocument(oldDocId).catch(() => {});
      releasePdf(oldDocId);
    }

    toast(`PDF anexado — ${pageCount} página(s)`);
    renderAll();
  } catch {
    toast("Não foi possível guardar o PDF neste navegador.");
  }
}

async function restorePdfs(pdfs) {
  const entries = Object.entries(pdfs || {});
  for (const [docId, pdf] of entries) {
    if (!pdf?.data) continue;
    try {
      await savePdfDocument(docId, {
        name: String(pdf.name || "cifra.pdf"),
        pageCount: Number(pdf.pageCount ?? pdf.pages ?? 1),
        buffer: base64ToBuffer(pdf.data),
      });
    } catch {
      /* a damaged PDF in the backup does not block the rest of the library */
    }
  }
}

function ask(message) {
  return new Promise((resolve) => {
    state.confirm = resolve;
    openModal(`<div class="modal" role="dialog" aria-modal="true">
      <h2>Confirmar</h2>
      <p>${esc(message)}</p>
      <div class="inline-actions"><button class="btn danger" type="button" data-action="confirm-yes">Confirmar</button><button class="btn ghost" type="button" data-action="confirm-no">Cancelar</button></div>
    </div>`);
  });
}

function closeConfirm(value) {
  const resolve = state.confirm;
  state.confirm = null;
  closeModal();
  resolve?.(value);
}

function openModal(html) {
  modalRoot.innerHTML = `<div class="modal-back">${html}</div>`;
  modalRoot.querySelector(".modal-back").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      if (state.confirm) closeConfirm(false);
      else closeModal();
    }
  });
}

function closeModal() {
  modalRoot.innerHTML = "";
}

function currentSong() {
  return state.route.name === "song" || state.route.name === "stage" ? findSong(state.library, state.loadedSongId || state.route.id) : null;
}

function currentPlaylist() {
  return state.route.name === "playlist" ? findPlaylist(state.route.id) : null;
}

function currentSetlist() {
  return state.route.name === "setlist" || state.route.name === "stage" ? findSetlist(state.route.id) : null;
}

function currentSetItem(id) {
  return currentSetlist()?.items.find((item) => item.id === id) || null;
}

function findPlaylist(id) {
  return state.library.playlists.find((playlist) => playlist.id === id) || null;
}

function findSetlist(id) {
  return state.library.setlists.find((setlist) => setlist.id === id) || null;
}

function findMeasure(song, id) {
  for (const section of song.sections) {
    const measure = section.measures.find((item) => item.id === id);
    if (measure) return measure;
  }
  return null;
}

function activeSection(song) {
  return song.sections.find((section) => section.id === state.activeSectionId) || song.sections.at(-1);
}

function touchSong(song, immediate) {
  song.updatedAt = new Date().toISOString();
  if (!song.title.trim()) song.title = "Sem título";
  persist(immediate);
}

function touchPlaylist(playlist, immediate) {
  playlist.updatedAt = new Date().toISOString();
  persist(immediate);
  if (immediate) renderList();
}

function touchSetlist(setlist, immediate) {
  setlist.updatedAt = new Date().toISOString();
  persist(immediate);
  if (immediate) renderList();
}

function persist(immediate) {
  const status = document.querySelector("#save-state");
  if (immediate) {
    clearTimeout(saveTimer);
    saveLibrary(state.library);
    if (status) status.textContent = "Salvo";
    return;
  }
  if (status) status.textContent = "Salvando…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveLibrary(state.library);
    const current = document.querySelector("#save-state");
    if (current) current.textContent = "Salvo";
    renderList();
  }, 200);
}

function orderCell(index, length) {
  return `<div class="order-cell">
    <button class="grip" type="button" data-drag-index="${index}" aria-label="Arrastar para mudar a ordem">☰</button>
    <span class="index-no">${index + 1}</span>
    <button class="btn ghost icon-btn" type="button" data-action="move-item" data-index="${index}" data-dir="-1" ${index === 0 ? "disabled" : ""} aria-label="Subir">↑</button>
    <button class="btn ghost icon-btn" type="button" data-action="move-item" data-index="${index}" data-dir="1" ${index === length - 1 ? "disabled" : ""} aria-label="Descer">↓</button>
  </div>`;
}

function removeButton(index) {
  return `<button class="btn danger" type="button" data-action="remove-item" data-index="${index}">Tirar</button>`;
}

function readToggle(song) {
  if (showingPdf(song)) return "";
  return `<button class="btn ghost read-toggle no-print" type="button" data-action="toggle-clean">${readLabel(song)}</button>`;
}

function readLabel(song) {
  if (song?.pdfName && state.route.name === "stage") return state.stageChart ? "Ler PDF" : "Ver cifra";
  if (song?.pdfName) return state.clean ? "Voltar à cifra" : "Ler PDF";
  return state.clean ? "Mostrar barras" : "Leitura limpa";
}

function showingPdf(song) {
  if (!song?.pdfName) return false;
  if (state.route.name === "stage") return !state.stageChart;
  return state.clean;
}

function fieldInput(name, label, value, extra = "") {
  return `<label class="field">${label}<input data-field="${name}" value="${esc(value)}" aria-label="${esc(label)}" autocomplete="off" ${extra}></label>`;
}

function fieldSelect(name, label, options, value) {
  const html = String(options).includes("<option") ? options : "";
  return `<label class="field">${label}<select data-field="${name}" aria-label="${esc(label)}">${html || keyOptions(value)}</select></label>`;
}

function keyOptions(selected, fallback) {
  const keys = KEYS.includes(selected) || !selected ? KEYS : [selected, ...KEYS];
  const current = selected || fallback || "C";
  return keys.map((key) => `<option value="${esc(key)}"${key === current ? " selected" : ""}>${esc(key)}</option>`).join("");
}

function previewOptions(song) {
  const selected = state.previewKey || "";
  const options = [`<option value="">${esc(song.key)} · original</option>`];
  for (const key of KEYS) {
    if (key === song.key) continue;
    options.push(`<option value="${esc(key)}"${key === selected ? " selected" : ""}>${esc(key)}</option>`);
  }
  return options.join("");
}

function fileOptions() {
  const playlists = state.library.playlists.map((playlist) => `<option value="playlist:${esc(playlist.id)}">${esc(playlist.name)}</option>`).join("");
  const setlists = state.library.setlists.map((setlist) => `<option value="setlist:${esc(setlist.id)}">${esc(setlist.name)}</option>`).join("");
  return `${playlists ? `<optgroup label="Playlists">${playlists}</optgroup>` : ""}${setlists ? `<optgroup label="Setlists">${setlists}</optgroup>` : ""}`;
}

function moveInArray(items, predicate, direction) {
  const index = items.findIndex(predicate);
  moveToIndex(items, index, index + direction);
}

function moveToIndex(items, from, to) {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return;
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
}

function chunk(items, size) {
  const rows = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

function matches(query, ...parts) {
  if (!query) return true;
  return parts.join(" ").toLowerCase().includes(query);
}

function metaLine(parts) {
  return parts.filter(Boolean).join(" · ");
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function empty(title, text) {
  return `<div class="empty"><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;
}

function missing(text, href) {
  return `<section class="desk">${empty(text, "")}<p><a class="text-link" href="${esc(href)}">Voltar</a></p></section>`;
}

function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.hidden = true; }, 2400);
}

if (!location.hash) history.replaceState(null, "", "#/musicas");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

function cssEscape(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/"/g, "");
}

renderAll();
