import {
  suggestChart,
  verifyDraftInvariants as verifyDraftInvariantsOriginal,
  updateDraftTimeSignature,
  evaluateMeasureBeats,
  splitMeasure,
  splitMeasureAtChord,
  canMoveChordBetweenMeasures,
  moveChordBetweenMeasures,
  mergeMeasures,
  moveMeasure,
  splitSection,
  createDraftHistory,
  pushDraftHistoryState,
  undoDraftHistoryState,
  convertDraftToSong,
  validateDraftForConfirmation,
} from "./draft.js";
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
import { loadPdfDocument, savePdfDocument, deletePdfDocument } from "./files.js";
import { createBackupV2, executeRestore } from "./backup.js";
import { FORMS, findForm } from "./forms.js";
import { chartFromCifraPlain, pastedCifraLink } from "./cifra.js";
import { parseCifraSource, verifyCifraSourceInvariants } from "./source.js";
import { ALL_SIX_FIXTURES } from "./fixtures/cifras.js";
import { analyzeSamples } from "./listen.js";
import { inspectPdf, paintPdf, releasePdf } from "./pdfview.js";
import { getChartPageCount, paginateChart } from "./chart-pages.js";
import {
  blankMeasure,
  blankPlaylist,
  blankSection,
  blankSetItem,
  blankSetlist,
  blankSong,
  clampTempo,
  findSong,
  findPdfDocument,
  loadLibrary,
  measureCount,
  nextSectionLabel,
  saveLibrary,
  uid,
  countPdfDocumentReferences,
  removePdfDocument,
  relativeToPhysicalPage,
  createPdfSplitDraft,
  addSplitRange,
  updateSplitRange,
  removeSplitRange,
  validateSplitDraft,
  applyPdfSplitDraft,
  getSongPageCount,
  stepPerformancePosition,
  canStepPerformance,
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
  wizard: null,
  currentDraft: null,
  draftHistory: createDraftHistory(),
  draftActiveTab: "chart",
  selectedDraftChord: null,
  draggedDraftChord: null,
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

document.addEventListener("dragstart", (event) => {
  const token = event.target.closest?.(".measure-chord-token[draggable='true']");
  if (!token) return;
  state.draggedDraftChord = {
    sectionId: token.dataset.sectionId,
    measureId: token.dataset.measureId,
    chordIndex: Number(token.dataset.chordIndex),
  };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", token.dataset.chordRaw || "");
  }
});

document.addEventListener("dragover", (event) => {
  if (!state.draggedDraftChord || !state.currentDraft) return;
  const box = event.target.closest?.(".draft-measure-box");
  if (!box) return;
  const secCard = box.closest(".draft-section-card");
  if (!secCard || secCard.dataset.sectionId !== state.draggedDraftChord.sectionId) return;
  const sec = state.currentDraft.sections.find((s) => s.id === state.draggedDraftChord.sectionId);
  if (!sec) return;
  const fromIdx = sec.measures.findIndex((m) => m.id === state.draggedDraftChord.measureId);
  const toIdx = sec.measures.findIndex((m) => m.id === box.dataset.measureId);
  const dir = toIdx - fromIdx;
  if (
    (dir === -1 || dir === 1) &&
    canMoveChordBetweenMeasures(
      state.currentDraft,
      state.draggedDraftChord.sectionId,
      state.draggedDraftChord.measureId,
      state.draggedDraftChord.chordIndex,
      dir
    )
  ) {
    event.preventDefault();
    box.classList.add("drop-target");
  }
});

document.addEventListener("dragleave", (event) => {
  const box = event.target.closest?.(".draft-measure-box");
  if (box) box.classList.remove("drop-target");
});

document.addEventListener("drop", (event) => {
  if (!state.draggedDraftChord || !state.currentDraft) return;
  const box = event.target.closest?.(".draft-measure-box");
  const dragged = state.draggedDraftChord;
  state.draggedDraftChord = null;
  document.querySelectorAll(".draft-measure-box.drop-target").forEach((el) => el.classList.remove("drop-target"));
  if (!box) return;
  const sec = state.currentDraft.sections.find((s) => s.id === dragged.sectionId);
  if (!sec) return;
  const fromIdx = sec.measures.findIndex((m) => m.id === dragged.measureId);
  const toIdx = sec.measures.findIndex((m) => m.id === box.dataset.measureId);
  const dir = toIdx - fromIdx;
  if (dir === -1 || dir === 1) {
    event.preventDefault();
    handleDraftMoveChord(dragged.sectionId, dragged.measureId, dragged.chordIndex, dir);
  }
});

document.addEventListener("dragend", () => {
  state.draggedDraftChord = null;
  document.querySelectorAll(".draft-measure-box.drop-target").forEach((el) => el.classList.remove("drop-target"));
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
  const inPerformanceReading = state.route.name === "stage" || (state.route.name === "song" && state.clean);
  if (inPerformanceReading && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
    event.preventDefault();
    stepPerformance(event.key === "ArrowRight" ? 1 : -1);
    return;
  }
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

let resizeDebounce = 0;
window.addEventListener("resize", () => {
  fitPerformanceSheet();
  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(() => {
    if (document.querySelector(".pdf-canvas")) {
      mountPdfFrame();
      return;
    }
    const song = currentSong();
    if (isReadingChart(song)) {
      renderMain();
    }
  }, 100);
});
window.addEventListener("beforeprint", () => {
  clearSheetFit(document.querySelector(".paper.sheet"));
  fitGlyphs();
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!state.wizard || !target.dataset.wizardInput) return;
  const field = target.dataset.wizardInput;
  const idx = Number(target.dataset.rangeIndex ?? 0);
  const draft = state.wizard.draft;
  if (field === "single-title") {
    if (draft.ranges[0]) draft.ranges[0].title = target.value;
  } else if (field === "range-title") {
    updateSplitRange(draft, idx, { title: target.value });
  } else if (field === "range-first") {
    updateSplitRange(draft, idx, { firstPage: Number(target.value) });
  } else if (field === "range-last") {
    updateSplitRange(draft, idx, { lastPage: Number(target.value) });
  }
  updateWizardFeedback();
});

window.addEventListener("afterprint", () => fitPerformanceSheet());

document.querySelector("#pdf-input")?.addEventListener("change", (event) => {
  const input = event.target;
  const file = input.files?.[0];
  input.value = "";
  if (file) startPdfSplitWizard(file);
});

document.querySelector("#audio-input")?.addEventListener("change", (event) => {
  const input = event.target;
  const file = input.files?.[0];
  input.value = "";
  if (file) readAudio(file);
});

const actions = {
  "wizard-set-mode": (element) => {
    if (!state.wizard) return;
    const mode = element.dataset.mode || "single";
    state.wizard.draft.mode = mode;
    if (mode === "single") {
      const firstTitle = state.wizard.draft.ranges[0]?.title || state.wizard.file.name.replace(/\.pdf$/i, "");
      state.wizard.draft.ranges = [
        {
          id: uid(),
          title: firstTitle,
          firstPage: 1,
          lastPage: state.wizard.draft.pageCount,
        },
      ];
    }
    renderPdfWizardModal();
  },
  "wizard-add-range": () => {
    if (!state.wizard) return;
    addSplitRange(state.wizard.draft);
    renderPdfWizardModal();
  },
  "wizard-remove-range": (element) => {
    if (!state.wizard) return;
    const idx = Number(element.dataset.rangeIndex);
    removeSplitRange(state.wizard.draft, idx);
    renderPdfWizardModal();
  },
  "wizard-toggle-overlap": () => {
    if (!state.wizard) return;
    state.wizard.allowOverlap = !state.wizard.allowOverlap;
    updateWizardFeedback();
  },
  "wizard-toggle-gaps": () => {
    if (!state.wizard) return;
    state.wizard.allowGaps = !state.wizard.allowGaps;
    updateWizardFeedback();
  },
  "wizard-cancel": () => {
    state.wizard = null;
    closeModal();
  },
  "wizard-commit": async () => {
    if (!state.wizard) return;
    const { file, buffer, draft, targetSongId, allowOverlap, allowGaps } = state.wizard;
    const validation = validateSplitDraft(draft);
    if (!validation.valid) {
      toast("Corrija os erros do assistente antes de concluir.");
      return;
    }
    if (validation.hasOverlap && !allowOverlap) {
      toast("Confirme a sobreposição de páginas para continuar.");
      return;
    }
    if (validation.hasGaps && !allowGaps) {
      toast("Confirme as páginas não atribuídas para continuar.");
      return;
    }

    const targetSong = targetSongId ? findSong(state.library, targetSongId) : null;
    const oldDocId = targetSong?.pdfRef?.documentId || (targetSong?.pdfName ? targetSong.id : null);

    try {
      await savePdfDocument(draft.documentId, {
        name: file.name,
        pageCount: draft.pageCount,
        buffer,
        createdAt: new Date().toISOString(),
      });

      const result = applyPdfSplitDraft(state.library, draft, {
        allowOverlap,
        allowGaps,
        targetSongId,
      });

      if (oldDocId && countPdfDocumentReferences(state.library, oldDocId) === 0) {
        removePdfDocument(state.library, oldDocId);
        await deletePdfDocument(oldDocId).catch(() => {});
        releasePdf(oldDocId);
      }

      persist(true);
      state.wizard = null;
      closeModal();

      const firstSong = result.songs[0];
      if (firstSong) go(`#/musicas/${firstSong.id}`);
      else renderAll();

      toast(`PDF importado — ${result.songs.length} música(s) configurada(s)`);
    } catch {
      toast("Não foi possível concluir a importação do PDF.");
    }
  },
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
  "open-draft": () => openDraft(),
  "draft-set-timesig": (btn) => handleDraftTimeSig(btn.dataset.timesig),
  "draft-clear-timesig": () => handleDraftTimeSig(""),
  "draft-select-chord": (btn) =>
    handleDraftSelectChord(
      btn.dataset.sectionId,
      btn.dataset.measureId,
      Number(btn.dataset.chordIndex)
    ),
  "draft-move-chord": (btn) =>
    handleDraftMoveChord(
      btn.dataset.sectionId,
      btn.dataset.measureId,
      Number(btn.dataset.chordIndex),
      Number(btn.dataset.dir) || 0
    ),
  "draft-split-chord": (btn) =>
    handleDraftSplitMeasure(
      btn.dataset.sectionId,
      btn.dataset.measureId,
      Number(btn.dataset.chordIndex)
    ),
  "draft-split-measure": (btn) => handleDraftSplitMeasure(btn.dataset.sectionId, btn.dataset.measureId),
  "draft-merge-measure": (btn) => handleDraftMergeMeasure(btn.dataset.sectionId, btn.dataset.measureId, btn.dataset.nextId),
  "draft-split-section": (btn) => handleDraftSplitSection(btn.dataset.sectionId),
  "draft-move-measure": (btn) => handleDraftMoveMeasure(btn.dataset.sectionId, btn.dataset.measureId, Number(btn.dataset.dir) || 0),
  "draft-switch-tab": (btn) => handleDraftSwitchTab(btn.dataset.tab),
  "draft-undo": () => handleDraftUndo(),
  "draft-confirm": () => confirmDraft(),
  "draft-cancel": () => cancelDraft(),
  "apply-paste": () => applyPaste(),
  "inspect-source": () => inspectSource(),
  "load-fixture": (btn) => loadFixture(btn.dataset.fixtureId),
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
      state.stagePage = 1;
      renderAll();
      return;
    }
    state.clean = !state.clean;
    if (state.route.name === "song") {
      state.stagePage = 1;
    }
    renderAll();
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
    ${showingPdf(song) ? pdfStage(song, state.stagePage) : isReadingChart(song) ? `${tapLayer()}<div class="reading-viewport" id="chart-reading-viewport">
      <article class="paper sheet" id="clean-paper">
        <div class="lead">
          <h1 class="sheet-title">${esc(song.title)}</h1>
          <div class="sheet-sub">
            <p class="sheet-style">${song.style ? `(${esc(song.style)})` : ""}</p>
            <p class="sheet-composer">${esc(song.composer)}</p>
          </div>
          <div id="paper-body"></div>
        </div>
      </article>
      ${chartReadingBar(song)}
    </div>` : `<article class="paper sheet">
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

/**
 * @typedef {Object} ChartReadingPosition
 * @property {number} songIndex
 * @property {number} pageIndex
 */

function isReadingChart(song) {
  if (!song || showingPdf(song)) return false;
  return state.route.name === "stage" || Boolean(state.clean);
}

function resolveChartLayoutProfile(song) {
  const barsPerRow = Number(song?.barsPerRow) || 4;
  const rowsPerPage = typeof window !== "undefined" && window.innerHeight < 500 ? 4 : 8;
  return {
    barsPerRow,
    rowsPerPage,
    pageSpan: 1,
  };
}

function getRuntimeChartPageCount(song) {
  if (!song) return 1;
  const sections = transposeSections(song.sections || [], song.key, state.previewKey);
  return getChartPageCount({ ...song, sections }, resolveChartLayoutProfile(song));
}

function performancePageOptions(song) {
  const hasPdf = Boolean(song?.pdfRef || song?.pdfName || Number(song?.pdfPages) > 1);
  const forceChart = Boolean(song && !showingPdf(song) && hasPdf);
  return {
    representation: forceChart ? "chart" : "auto",
    chartPageCount: getRuntimeChartPageCount,
  };
}

/**
 * @param {any} song
 * @returns {ChartReadingPosition}
 */
function getChartReadingPosition(song) {
  const pages = getSongPageCount(song, performancePageOptions(song));
  const pageIndex = Math.min(Math.max(1, Number(state.stagePage) || 1), pages);
  const songIndex = state.route.name === "stage" ? Math.max(0, Number(state.stageIndex) || 0) : 0;
  return { songIndex, pageIndex };
}

function chartReadingBar(song) {
  const onStage = state.route.name === "stage";
  const setlist = onStage ? currentSetlist() : null;
  const items = setlist?.items || (song ? [{ songId: song.id }] : []);
  const pageOptions = performancePageOptions(song);
  const pages = getSongPageCount(song, pageOptions);
  const { songIndex, pageIndex } = getChartReadingPosition(song);
  const currentPos = { itemIndex: songIndex, page: pageIndex };
  const canPrev = canStepPerformance(currentPos, -1, { items, library: state.library, ...pageOptions });
  const canNext = canStepPerformance(currentPos, 1, { items, library: state.library, ...pageOptions });
  return `<div class="chart-reading-bar no-print" role="region" aria-label="Navegação de páginas da cifra">
    <button class="btn ghost" type="button" data-action="toggle-clean">${readLabel(song)}</button>
    <button class="btn ghost" type="button" data-action="stage-step" data-dir="-1" aria-label="Página anterior" ${canPrev ? "" : "disabled"}>Anterior</button>
    <p class="chart-page-caption" id="chart-page-indicator" aria-live="polite">${esc(song.title)} · Página ${pageIndex} de ${pages}</p>
    <button class="btn ghost" type="button" data-action="stage-step" data-dir="1" aria-label="Próxima página" ${canNext ? "" : "disabled"}>Próxima</button>
  </div>`;
}

function paintPaper(focusId) {
  const song = currentSong();
  const paper = document.querySelector("#paper-body");
  if (!song || !paper) return;
  const reading = isReadingChart(song);
  const editable = state.route.name === "song" && !state.clean && !state.previewKey;
  const sections = editable ? song.sections : transposeSections(song.sections, song.key, state.previewKey);
  const hasTime = Boolean(song.timeSignature && /^\d+\/\d+$/.test(song.timeSignature));
  const [beats, unit] = hasTime ? song.timeSignature.split("/") : ["", ""];

  if (reading) {
    const profile = resolveChartLayoutProfile(song);
    const pages = paginateChart({ ...song, sections }, profile);
    const totalPages = pages.length;
    const { pageIndex } = getChartReadingPosition(song);
    state.stagePage = pageIndex;
    const activePage = pages[pageIndex - 1] || pages[0];
    const sheetEl = paper.closest(".paper.sheet");
    if (sheetEl) {
      sheetEl.dataset.page = String(pageIndex);
      sheetEl.dataset.totalPages = String(totalPages);
    }

    let bar = 1 + pages
      .slice(0, pageIndex - 1)
      .reduce((sum, p) => sum + p.sections.reduce((sSum, sec) => sSum + sec.rows.reduce((rSum, r) => rSum + r.measures.length, 0), 0), 0);
    let firstLine = pageIndex === 1;
    const lastFragment = activePage.sections[activePage.sections.length - 1];

    paper.innerHTML = activePage.sections.map((fragment) => {
      const named = fragment.label.trim().length > 1;
      const shownLabel = fragment.continued && named ? `${fragment.label} (cont.)` : fragment.label;
      const letter = `<div class="rehearsal static">${esc(shownLabel)}</div>`;
      const lines = fragment.rows.map((row, rowIndex) => {
        const showTime = firstLine && hasTime;
        firstLine = false;
        const isLastLineOfSong =
          pageIndex === totalPages &&
          fragment === lastFragment &&
          rowIndex === fragment.rows.length - 1;
        const cells = row.measures.map((measure, index) => {
          const last = index === row.measures.length - 1;
          const fullRow = row.measures.length === profile.barsPerRow;
          return measureCell(measure, bar++, false, isLastLineOfSong && last, last && fullRow && !(isLastLineOfSong && last));
        }).join("");
        return `<div class="staff-line" style="--bars:${profile.barsPerRow}">
          ${rowIndex === 0 && !named ? letter : ""}
          ${showTime ? `<div class="time-sig" aria-hidden="true"><span>${esc(beats)}</span><span>${esc(unit)}</span></div>` : ""}
          ${cells}
        </div>`;
      }).join("");
      return `<div class="system${named ? " named" : ""}" data-section-id="${esc(fragment.sectionId)}" data-continued="${fragment.continued ? "true" : "false"}">${named ? `<div class="section-head">${letter}</div>` : ""}${lines}</div>`;
    }).join("");

    fitHeaderFields();
    fitGlyphs();
    return;
  }

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


function renderSetlistOfflineStatus(setlist) {
  if (!setlist || !setlist.items.length) return "";
  const allSongsReady = setlist.items.every((item) => {
    const song = findSong(state.library, item.songId);
    if (!song) return false;
    if (song.pdfName && song.pdfRef?.documentId) {
      if (!findPdfDocument(state.library, song.pdfRef.documentId)) return false;
    }
    return true;
  });
  if (allSongsReady) {
    return `<div class="offline-badge" id="setlist-offline-badge">✓ Músicas e partituras prontas para tocar offline</div>`;
  }
  return "";
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
    ${renderSetlistOfflineStatus(setlist)}
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
  const pageOptions = performancePageOptions(song);
  const pages = getSongPageCount(song, pageOptions);
  const page = Math.min(Math.max(1, state.stagePage || 1), pages);
  state.stagePage = page;
  const canPrev = canStepPerformance({ itemIndex: state.stageIndex, page }, -1, { items: setlist.items, library: state.library, ...pageOptions });
  const canNext = canStepPerformance({ itemIndex: state.stageIndex, page }, 1, { items: setlist.items, library: state.library, ...pageOptions });
  return `<section>
    <div class="stage-bar no-print">
      <button class="btn ghost" type="button" data-action="exit-stage">Sair do palco</button>
      <span class="offline-indicator-stage" id="stage-offline-badge">✓ Palco offline</span>
      <select id="stage-picker" aria-label="Música da setlist">${options}</select>
      <div class="inline-actions">
        <button class="btn ghost" type="button" data-action="stage-prev"${canPrev ? "" : " disabled"}>Anterior</button>
        <button class="btn ghost" type="button" data-action="stage-next"${canNext ? "" : " disabled"}>Próxima</button>
      </div>
    </div>
    ${readToggle(song)}
    ${tapLayer()}
    ${showingPdf(song) ? pdfStage(song, page) : `<div class="reading-viewport" id="chart-reading-viewport">
      <article class="paper sheet" id="stage-paper">
        <div class="lead">
        <h1 class="sheet-title">${esc(song.title)}</h1>
        <div class="sheet-sub">
          <p class="sheet-style">${song.style ? `(${esc(song.style)})` : ""}</p>
          <p class="sheet-composer">${esc(song.composer)}</p>
        </div>
        <div id="paper-body"></div>
        ${song.notes && page === pages ? `<p class="sheet-notes static">${esc(song.notes)}</p>` : ""}
        <p class="hint">${nextSong ? `A seguir: ${esc(nextSong.title)} · ${esc(next?.key || nextSong.key)}` : "Última música da setlist."}</p>
        </div>
      </article>
      ${chartReadingBar(song)}
    </div>`}
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

function clearPasteError() {
  const note = document.querySelector("#paste-error");
  if (note) {
    note.hidden = true;
    note.textContent = "";
  }
}

function explainIsolatedUrl(trimmed) {
  const link = pastedCifraLink(trimmed);
  if (link) {
    pasteError(
      "A importação direta por URL foi substituída pela extensão local Caderno Clipper (o servidor recebe bloqueio automatizado). Abra a cifra no navegador, clique no ícone da extensão Caderno Clipper — ou copie os acordes da página — e cole o texto aqui."
    );
    return;
  }
  if (isYoutubeUrl(trimmed)) {
    pasteError("O YouTube não entrega o áudio para o Caderno. Use um arquivo da música em Analisar áudio.");
    return;
  }
  pasteError(
    "O endereço informado não é um link válido do Cifra Club. Abra uma cifra no navegador, use a extensão Caderno Clipper (ou copie os acordes) e cole o texto aqui."
  );
}

function openPaste() {
  const fixturesHtml = ALL_SIX_FIXTURES.map(
    (f) => `<button type="button" class="btn ghost small" data-action="load-fixture" data-fixture-id="${esc(f.id)}">${esc(f.name)}</button>`
  ).join(" ");

  openModal(`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="paste-title">
    <h2 id="paste-title">Colar cifra</h2>
    <p>Use a extensão local <strong>Caderno Clipper</strong> na aba aberta do Cifra Club para copiar a estrutura musical em um clique, ou copie e cole manualmente os acordes da página (ou um mapa com barras). A letra não entra na cifra. <code>|:</code> e <code>:|</code> marcam repetição, <code>[1]</code> e <code>[2]</code> marcam as casas.</p>
    <div class="fixtures-row">
      <span class="meta">Amostras reais do corpus (fonte literal):</span>
      ${fixturesHtml}
    </div>
    <textarea id="paste-text" placeholder="Título: Oba Lá Vem Ela&#10;Artista: Jorge Ben Jor&#10;Tom: Bm&#10;&#10;[Refrão]&#10;Bm7 Em7&#10;&#10;Ou um mapa com barras:&#10;| Cmaj7 | Dm7 G7 | Cmaj7 |"></textarea>
    <div id="source-preview" class="source-preview" hidden></div>
    <p id="paste-error" class="status" hidden></p>
    <div class="inline-actions">
      <button class="btn secondary" type="button" data-action="inspect-source">Inspecionar fonte</button>
      <button class="btn primary" type="button" data-action="open-draft">Gerar rascunho</button>
      <button class="btn ghost" type="button" data-action="close-modal">Cancelar</button>
    </div>
  </div>`);
  document.querySelector("#paste-text")?.focus();
}

function loadFixture(fixtureId) {
  const fixture = ALL_SIX_FIXTURES.find((f) => f.id === fixtureId);
  if (!fixture) return;
  const textarea = document.querySelector("#paste-text");
  if (textarea) {
    textarea.value = fixture.raw;
  }
  inspectSource();
}

function inspectSource() {
  const raw = document.querySelector("#paste-text")?.value || "";
  const previewEl = document.querySelector("#source-preview");
  if (!previewEl) return;
  const trimmed = raw.trim();
  if (!trimmed) {
    previewEl.hidden = true;
    previewEl.innerHTML = "";
    return;
  }
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    previewEl.hidden = true;
    previewEl.innerHTML = "";
    explainIsolatedUrl(trimmed);
    return;
  }

  clearPasteError();
  const source = parseCifraSource(raw);
  const inv = verifyCifraSourceInvariants(source);

  const metaParts = [];
  if (source.metadata.title) metaParts.push(`<strong>Título:</strong> ${esc(source.metadata.title)}`);
  if (source.metadata.artist) metaParts.push(`<strong>Artista:</strong> ${esc(source.metadata.artist)}`);
  if (source.metadata.composer) metaParts.push(`<strong>Compositor:</strong> ${esc(source.metadata.composer)}`);
  if (source.metadata.key) metaParts.push(`<strong>Tom:</strong> ${esc(source.metadata.key)}`);

  const blocksHtml = source.blocks.map((block) => {
    let badgeClass = "badge";
    let badgeLabel = `Seção: ${esc(block.label || "")}`;
    if (block.kind === "tab") {
      badgeClass = "badge tab";
      badgeLabel = `Tablatura: ${esc(block.label || "Tab")}`;
    } else if (block.kind === "anonymous") {
      badgeClass = "badge anon";
      badgeLabel = "Bloco anônimo";
    }

    const chordsInBlock = block.lines.flatMap((l) => l.chords);
    const chordsStr = chordsInBlock.map((c) => esc(c.raw)).join(" ");

    return `<div class="source-block-card">
      <div><span class="${badgeClass}">${badgeLabel}</span> <small class="meta">${block.lines.length} linha(s), ${chordsInBlock.length} acorde(s)</small></div>
      ${chordsStr ? `<div class="source-chords-list">${chordsStr}</div>` : ""}
    </div>`;
  }).join("");

  previewEl.hidden = false;
  previewEl.innerHTML = `
    <h3>Fonte Literal Extraída</h3>
    <p class="meta">${metaParts.join(" · ") || "Metadados não informados"}</p>
    <p class="meta"><strong>Total:</strong> ${source.blocks.length} bloco(s), ${source.allChords.length} acorde(s) literais. ${inv.valid ? "✓ Invariantes válidos" : "⚠ Invariantes com aviso"}</p>
    <div>${blocksHtml}</div>
  `;
}


async function openDraft() {
  const raw = document.querySelector("#paste-text")?.value || "";
  if (!raw.trim()) {
    pasteError("Cole o texto da cifra (via Caderno Clipper ou cópia manual) antes de gerar o rascunho.");
    return;
  }
  const trimmed = raw.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    explainIsolatedUrl(trimmed);
    return;
  }
  clearPasteError();
  try {
    const source = parseCifraSource(raw);
    if (!source.allChords.length) {
      pasteError("Nenhum acorde reconhecível foi encontrado no texto colado.");
      return;
    }
    state.draftHistory = createDraftHistory();
    state.draftActiveTab = "chart";
    state.selectedDraftChord = null;
    state.currentDraft = suggestChart(source);
    renderDraftModal();
  } catch (err) {
    pasteError(err.message || "Erro ao processar a fonte da cifra.");
  }
}

function pushDraftHistory() {
  if (!state.currentDraft) return;
  state.draftHistory = pushDraftHistoryState(state.draftHistory, state.currentDraft);
}

function handleDraftSwitchTab(tab) {
  state.draftActiveTab = tab === "source" ? "source" : "chart";
  renderDraftModal();
}

function handleDraftUndo() {
  if (!state.currentDraft) return;
  const res = undoDraftHistoryState(state.draftHistory, state.currentDraft);
  if (!res.undone) return;
  state.currentDraft = res.draft;
  state.draftHistory = res.history;
  state.selectedDraftChord = null;
  renderDraftModal();
  toast("Ação desfeita.");
}

function handleDraftSelectChord(sectionId, measureId, chordIndex) {
  if (!state.currentDraft || !Number.isInteger(chordIndex)) return;
  const cur = state.selectedDraftChord;
  if (
    cur &&
    cur.sectionId === sectionId &&
    cur.measureId === measureId &&
    cur.chordIndex === chordIndex
  ) {
    state.selectedDraftChord = null;
  } else {
    state.selectedDraftChord = { sectionId, measureId, chordIndex };
  }
  renderDraftModal();
}

function handleDraftMoveChord(sectionId, measureId, chordIndex, dir) {
  if (!state.currentDraft) return;
  if (!canMoveChordBetweenMeasures(state.currentDraft, sectionId, measureId, chordIndex, dir)) {
    return;
  }
  const secBefore = state.currentDraft.sections.find((s) => s.id === sectionId);
  const measureIdxBefore = secBefore ? secBefore.measures.findIndex((m) => m.id === measureId) : -1;
  const neighborMeasureBefore =
    secBefore && measureIdxBefore !== -1 ? secBefore.measures[measureIdxBefore + dir] : null;
  const neighborId = neighborMeasureBefore ? neighborMeasureBefore.id : null;
  const neighborLenBefore = neighborMeasureBefore?.sourceChords?.length || 0;

  pushDraftHistory();
  state.currentDraft = moveChordBetweenMeasures(
    state.currentDraft,
    sectionId,
    measureId,
    chordIndex,
    dir
  );

  if (neighborId) {
    const newChordIndex = dir === -1 ? neighborLenBefore : 0;
    state.selectedDraftChord = {
      sectionId,
      measureId: neighborId,
      chordIndex: newChordIndex,
    };
  } else {
    state.selectedDraftChord = null;
  }
  renderDraftModal();
}

function handleDraftTimeSig(newSig) {
  if (!state.currentDraft) return;
  pushDraftHistory();
  state.currentDraft = updateDraftTimeSignature(state.currentDraft, newSig);
  renderDraftModal();
}

function handleDraftSplitMeasure(sectionId, measureId, explicitChordIndex) {
  if (!state.currentDraft) return;
  const selectedInMeasure =
    Number.isInteger(explicitChordIndex) && explicitChordIndex >= 0
      ? explicitChordIndex
      : state.selectedDraftChord &&
          state.selectedDraftChord.sectionId === sectionId &&
          state.selectedDraftChord.measureId === measureId
        ? state.selectedDraftChord.chordIndex
        : null;

  pushDraftHistory();
  state.currentDraft =
    selectedInMeasure !== null
      ? splitMeasureAtChord(state.currentDraft, sectionId, measureId, selectedInMeasure)
      : splitMeasure(state.currentDraft, sectionId, measureId);
  state.selectedDraftChord = null;
  renderDraftModal();
}

function handleDraftMergeMeasure(sectionId, measureId, nextId) {
  if (!state.currentDraft) return;
  pushDraftHistory();
  state.currentDraft = mergeMeasures(state.currentDraft, sectionId, measureId, nextId);
  state.selectedDraftChord = null;
  renderDraftModal();
}

function handleDraftMoveMeasure(sectionId, measureId, dir) {
  if (!state.currentDraft) return;
  const sec = state.currentDraft.sections.find((s) => s.id === sectionId);
  if (!sec) return;
  const idx = sec.measures.findIndex((m) => m.id === measureId);
  if (idx === -1) return;
  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= sec.measures.length) return;
  pushDraftHistory();
  state.currentDraft = moveMeasure(state.currentDraft, sectionId, measureId, sectionId, targetIdx);
  renderDraftModal();
}

function handleDraftSplitSection(sectionId) {
  if (!state.currentDraft) return;
  const sec = state.currentDraft.sections.find((s) => s.id === sectionId);
  if (!sec || sec.measures.length < 2) return;
  const at = Math.floor(sec.measures.length / 2);
  pushDraftHistory();
  state.currentDraft = splitSection(state.currentDraft, sectionId, at, "Parte B");
  renderDraftModal();
}

function confirmDraft() {
  if (!state.currentDraft) return;
  const draft = state.currentDraft;
  const validation = validateDraftForConfirmation(draft);
  if (!validation.valid) {
    const errorEl = document.querySelector("#draft-time-sig-error");
    const bannerEl = document.querySelector("#draft-time-sig-banner");
    const msg = validation.errors.join(" ");
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = msg;
    }
    if (bannerEl) {
      bannerEl.classList.add("pulse-error");
      bannerEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    toast(msg);
    return;
  }

  const song = convertDraftToSong(draft);
  const cur = currentSong();

  if (cur && (cur.title === "Sem título" || !chartHasChords(cur))) {
    cur.title = song.title;
    cur.composer = song.composer;
    cur.key = song.key;
    cur.timeSignature = song.timeSignature;
    cur.tempo = song.tempo;
    cur.barsPerRow = song.barsPerRow;
    cur.notes = song.notes;
    cur.sections = song.sections;
    cur.sourceSnapshot = song.sourceSnapshot;
    touchSong(cur, true);
    toast(`Música "${cur.title}" atualizada com o rascunho.`);
  } else {
    state.library.songs.unshift(song);
    persist(true);
    go(`#/musicas/${song.id}`);
    toast(`Música "${song.title}" criada a partir do rascunho.`);
  }

  state.currentDraft = null;
  state.draftHistory = createDraftHistory();
  state.selectedDraftChord = null;
  closeModal();
  renderMain();
}

function cancelDraft() {
  state.currentDraft = null;
  state.draftHistory = createDraftHistory();
  state.selectedDraftChord = null;
  closeModal();
  toast("Rascunho cancelado. Nenhuma alteração salva.");
}

function renderDraftSourceContent(source) {
  if (!source) {
    return `<p class="meta">Fonte literal não disponível.</p>`;
  }
  const blocksHtml = source.blocks.map((block) => {
    let badgeClass = "badge";
    let badgeLabel = `Seção: ${esc(block.label || "")}`;
    if (block.kind === "tab") {
      badgeClass = "badge tab";
      badgeLabel = `Tablatura: ${esc(block.label || "Tab")}`;
    } else if (block.kind === "anonymous") {
      badgeClass = "badge anon";
      badgeLabel = "Bloco anônimo";
    }

    const chordsInBlock = block.lines.flatMap((l) => l.chords);
    const chordsStr = chordsInBlock.map((c) => esc(c.raw)).join(" ");

    return `<div class="source-block-card" style="margin-bottom:8px;">
      <div><span class="${badgeClass}">${badgeLabel}</span> <small class="meta">${block.lines.length} linha(s), ${chordsInBlock.length} acorde(s)</small></div>
      ${chordsStr ? `<div class="source-chords-list">${chordsStr}</div>` : ""}
    </div>`;
  }).join("");

  return `<div>
    <p class="meta"><strong>Total:</strong> ${source.blocks.length} bloco(s), ${source.allChords.length} acorde(s) literais.</p>
    <div style="margin-top:8px;">${blocksHtml}</div>
  </div>`;
}

function renderDraftModal() {
  const draft = state.currentDraft;
  if (!draft) return;

  const prevModal = modalRoot.querySelector(".modal");
  const prevChartCol = modalRoot.querySelector(".draft-chart-column");
  const prevModalScroll = prevModal ? prevModal.scrollTop : 0;
  const prevChartScroll = prevChartCol ? prevChartCol.scrollTop : 0;

  const inv = verifyDraftInvariantsOriginal(draft);
  const activeTab = state.draftActiveTab || "chart";
  const hasHistory = Boolean(state.draftHistory?.past?.length);

  const timeSigBanner = !draft.timeSignature
    ? `<div class="draft-warning-banner" id="draft-time-sig-banner">
        <strong>⚠ Fórmula de compasso não definida:</strong>
        <p class="meta" style="margin:4px 0 8px;">A fonte não especificou a métrica. Escolha uma fórmula antes de confirmar:</p>
        <div class="inline-actions">
          <button type="button" class="btn small draft-set-timesig" data-action="draft-set-timesig" data-timesig="4/4">4/4</button>
          <button type="button" class="btn small draft-set-timesig" data-action="draft-set-timesig" data-timesig="2/4">2/4</button>
          <button type="button" class="btn small draft-set-timesig" data-action="draft-set-timesig" data-timesig="3/4">3/4</button>
          <button type="button" class="btn small draft-set-timesig" data-action="draft-set-timesig" data-timesig="6/8">6/8</button>
        </div>
      </div>`
    : `<div class="status" style="margin:8px 0;" id="draft-time-sig-banner">
        Fórmula de compasso selecionada: <strong id="selected-timesig">${esc(draft.timeSignature)}</strong>
        <button type="button" class="btn ghost micro" style="margin-left:8px;" data-action="draft-clear-timesig">Alterar</button>
      </div>`;

  const errorBanner = `<div id="draft-time-sig-error" class="draft-error-banner" hidden></div>`;

  const warningsHtml = draft.warnings.length
    ? `<div class="draft-warnings-list" id="draft-warnings-list">
        <strong>Avisos de heurística:</strong>
        <ul>${draft.warnings.map((w) => `<li>${esc(w.message)}</li>`).join("")}</ul>
      </div>`
    : "";

  const sectionsHtml = draft.sections.map((sec) => {
    let contentHtml;
    if (sec.kind === "tab") {
      contentHtml = `<pre class="tab-view">${esc(sec.tabContent || "")}</pre>`;
    } else {
      const measuresHtml = sec.measures.map((m, mIdx) => {
        const chordsList =
          Array.isArray(m.sourceChords) && m.sourceChords.length > 0
            ? m.sourceChords
            : String(m.chords || "")
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .map((tok) => ({ raw: tok, normalized: tok }));
        const canSplit = chordsList.length > 1;
        const nextMeasure = sec.measures[mIdx + 1];
        const beatEval = evaluateMeasureBeats(m, draft.timeSignature);
        const selectedIdx =
          state.selectedDraftChord &&
          state.selectedDraftChord.sectionId === sec.id &&
          state.selectedDraftChord.measureId === m.id &&
          state.selectedDraftChord.chordIndex < chordsList.length
            ? state.selectedDraftChord.chordIndex
            : null;
        const selectedChordObj = selectedIdx !== null ? chordsList[selectedIdx] : null;
        const selectedChordLabel = selectedChordObj
          ? selectedChordObj.raw || selectedChordObj.normalized
          : "";

        const chordTokensHtml = chordsList.length
          ? chordsList
              .map((c, cIdx) => {
                const chordLabel = c.raw || c.normalized;
                const isSelected = selectedIdx === cIdx;
                const canDrag =
                  canMoveChordBetweenMeasures(draft, sec.id, m.id, cIdx, -1) ||
                  canMoveChordBetweenMeasures(draft, sec.id, m.id, cIdx, 1);
                return `<button type="button" class="measure-chord-token ${isSelected ? "is-selected" : ""}" data-action="draft-select-chord" data-section-id="${esc(sec.id)}" data-measure-id="${esc(m.id)}" data-chord-index="${cIdx}" data-chord-raw="${esc(chordLabel)}" data-chord-normalized="${esc(c.normalized || chordLabel)}" aria-pressed="${isSelected ? "true" : "false"}" draggable="${canDrag ? "true" : "false"}" title="Selecionar acorde ${esc(chordLabel)}">${esc(chordLabel)}</button>`;
              })
              .join(" ")
          : "—";

        const beatMetaHtml = beatEval.summaryLabel
          ? `<div class="measure-beat-meta ${beatEval.needsReview ? "measure-beat-warning" : ""}" data-beat-status="${beatEval.needsReview ? "review" : "ok"}">${beatEval.needsReview ? `⚠ ${esc(beatEval.summaryLabel)} (${beatEval.chordCount} acordes)` : esc(beatEval.summaryLabel)}</div>`
          : "";

        let chordActionsHtml = "";
        if (selectedIdx !== null) {
          const canChordLeft = canMoveChordBetweenMeasures(draft, sec.id, m.id, selectedIdx, -1);
          const canChordRight = canMoveChordBetweenMeasures(draft, sec.id, m.id, selectedIdx, 1);
          const moveLeftBtn = `<button type="button" class="btn ghost micro" data-action="draft-move-chord" data-section-id="${esc(sec.id)}" data-measure-id="${esc(m.id)}" data-chord-index="${selectedIdx}" data-dir="-1" ${canChordLeft ? "" : "disabled"} title="${canChordLeft ? `Mover acorde ${esc(selectedChordLabel)} para o compasso anterior` : "Apenas o primeiro acorde do compasso pode ir para o compasso anterior sem alterar a ordem musical"}" aria-label="Mover acorde ${esc(selectedChordLabel)} para o compasso anterior">← Acorde</button>`;
          const splitAtChordBtn = canSplit
            ? `<button type="button" class="btn ghost micro" data-action="draft-split-chord" data-section-id="${esc(sec.id)}" data-measure-id="${esc(m.id)}" data-chord-index="${selectedIdx}" title="Dividir compasso usando ${esc(selectedChordLabel)} como fronteira" aria-label="Dividir no acorde ${esc(selectedChordLabel)}">✂ Dividir aqui</button>`
            : "";
          const moveRightBtn = `<button type="button" class="btn ghost micro" data-action="draft-move-chord" data-section-id="${esc(sec.id)}" data-measure-id="${esc(m.id)}" data-chord-index="${selectedIdx}" data-dir="1" ${canChordRight ? "" : "disabled"} title="${canChordRight ? `Mover acorde ${esc(selectedChordLabel)} para o compasso seguinte` : "Apenas o último acorde do compasso pode ir para o compasso seguinte sem alterar a ordem musical"}" aria-label="Mover acorde ${esc(selectedChordLabel)} para o compasso seguinte">Acorde →</button>`;
          chordActionsHtml = `<div class="measure-chord-actions" role="group" aria-label="Ações do acorde ${esc(selectedChordLabel)}">${moveLeftBtn}${splitAtChordBtn}${moveRightBtn}</div>`;
        }

        const prevBtn = mIdx > 0
          ? `<button type="button" class="btn ghost micro" data-action="draft-move-measure" data-section-id="${esc(sec.id)}" data-measure-id="${esc(m.id)}" data-dir="-1" title="Mover compasso inteiro para esquerda" aria-label="Mover compasso para esquerda">◀</button>`
          : "";
        const nextBtn = mIdx < sec.measures.length - 1
          ? `<button type="button" class="btn ghost micro" data-action="draft-move-measure" data-section-id="${esc(sec.id)}" data-measure-id="${esc(m.id)}" data-dir="1" title="Mover compasso inteiro para direita" aria-label="Mover compasso para direita">▶</button>`
          : "";
        const splitBtn = canSplit
          ? `<button type="button" class="btn ghost micro" data-action="draft-split-measure" data-section-id="${esc(sec.id)}" data-measure-id="${esc(m.id)}" title="${selectedIdx !== null ? `Dividir compasso usando ${esc(selectedChordLabel)} como fronteira` : "Dividir compasso"}">✂ Dividir</button>`
          : "";
        const mergeBtn = nextMeasure
          ? `<button type="button" class="btn ghost micro" data-action="draft-merge-measure" data-section-id="${esc(sec.id)}" data-measure-id="${esc(m.id)}" data-next-id="${esc(nextMeasure.id)}" title="Unir com próximo">🔗 Unir</button>`
          : "";

        return `<div class="draft-measure-box ${beatEval.needsReview ? "measure-needs-review" : ""} ${selectedIdx !== null ? "has-selected-chord" : ""}" data-measure-id="${esc(m.id)}" data-needs-review="${beatEval.needsReview ? "true" : "false"}">
          <div class="measure-chords" role="group" aria-label="Acordes do compasso ${mIdx + 1}">${chordTokensHtml}</div>
          ${beatMetaHtml}
          ${chordActionsHtml}
          <div class="measure-actions" role="group" aria-label="Ações do compasso ${mIdx + 1}">${prevBtn}${nextBtn}${splitBtn}${mergeBtn}</div>
        </div>`;
      }).join("");

      const splitSecBtn = sec.measures.length >= 2
        ? `<div style="margin-top:8px;"><button type="button" class="btn ghost small" data-action="draft-split-section" data-section-id="${esc(sec.id)}">Dividir seção ao meio</button></div>`
        : "";

      contentHtml = `<div class="draft-measures-grid">${measuresHtml}</div>${splitSecBtn}`;
    }

    const badgeClass = sec.kind === "tab" ? "badge tab" : "badge";
    return `<div class="draft-section-card" data-section-id="${esc(sec.id)}">
      <h4>${esc(sec.label)} <span class="${badgeClass}">${esc(sec.kind)}</span> <small class="meta">(${sec.measures.length} compassos)</small></h4>
      ${contentHtml}
    </div>`;
  }).join("");

  const totalMeasures = draft.sections.reduce((acc, s) => acc + s.measures.length, 0);
  const sourceContent = renderDraftSourceContent(draft.sourceSnapshot);

  const tabSwitcher = `
    <div class="draft-view-tabs" role="tablist">
      <button type="button" class="btn ${activeTab === 'chart' ? 'primary small' : 'ghost small'}" data-action="draft-switch-tab" data-tab="chart" role="tab" aria-selected="${activeTab === 'chart'}">Compassos Sugeridos</button>
      <button type="button" class="btn ${activeTab === 'source' ? 'primary small' : 'ghost small'}" data-action="draft-switch-tab" data-tab="source" role="tab" aria-selected="${activeTab === 'source'}">Fonte Literal Original</button>
    </div>
  `;

  openModal(`<div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="draft-title" style="max-height: min(92dvh, 880px); overflow-y: auto;">
    <h2 id="draft-title">Rascunho Musical</h2>
    <p class="meta"><strong>Título:</strong> ${esc(draft.title)} · <strong>Tom:</strong> ${esc(draft.key)} · <strong>Artista:</strong> ${esc(draft.artist || "Não informado")}</p>
    ${tabSwitcher}
    <div class="draft-review-layout ${activeTab === 'source' ? 'show-source-tab' : 'show-chart-tab'}">
      <div class="draft-source-column">
        <h3>Fonte Literal Original</h3>
        ${sourceContent}
      </div>
      <div class="draft-chart-column">
        ${timeSigBanner}
        ${errorBanner}
        ${warningsHtml}
        <div style="margin: 12px 0;">
          <p class="meta"><strong>Estrutura:</strong> ${draft.sections.length} seção(ões), ${totalMeasures} compasso(s). ${inv.valid ? "✓ Invariantes conferidos" : "⚠ Atenção aos invariantes"} · <span class="draft-chord-hint">Toque em um acorde para movê-lo entre compassos ou dividir a partir dele.</span></p>
          ${sectionsHtml}
        </div>
      </div>
    </div>
    <div class="inline-actions draft-footer-actions" style="margin-top: 16px;">
      <button class="btn primary" type="button" data-action="draft-confirm" id="btn-draft-confirm">Confirmar e criar música</button>
      <button class="btn ghost" type="button" data-action="draft-undo" id="btn-draft-undo" ${hasHistory ? "" : "disabled"}>↩ Desfazer</button>
      <button class="btn ghost" type="button" data-action="draft-cancel">Cancelar rascunho</button>
    </div>
  </div>`);

  const nextModal = modalRoot.querySelector(".modal");
  const nextChartCol = modalRoot.querySelector(".draft-chart-column");
  if (nextModal && prevModalScroll) nextModal.scrollTop = prevModalScroll;
  if (nextChartCol && prevChartScroll) nextChartCol.scrollTop = prevChartScroll;
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

async function applyPaste() {
  const song = currentSong();
  if (!song) return;
  const raw = document.querySelector("#paste-text")?.value || "";
  const trimmed = raw.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    explainIsolatedUrl(trimmed);
    return;
  }
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
  toast("Não encontrei compassos. Use a extensão Caderno Clipper, cole os acordes ou um mapa com barras.");
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
  let fileText;
  try {
    fileText = await file.text();
  } catch {
    toast("Não foi possível ler o arquivo.");
    return;
  }

  let result;
  try {
    result = await executeRestore(state.library, fileText, {
      mode,
      savePdfRecord: savePdfDocument,
    });
  } catch {
    toast("Esse arquivo não é uma biblioteca do Caderno.");
    return;
  }

  state.library = result.library;
  persist(true);
  closeModal();
  renderAll();

  if (result.missing.length > 0) {
    toast(
      mode === "replace"
        ? `Biblioteca substituída (${result.missing.length} partitura(s) não recuperadas)`
        : `Biblioteca mesclada (${result.missing.length} partitura(s) não recuperadas)`
    );
  } else {
    toast(mode === "replace" ? "Biblioteca substituída" : "Biblioteca mesclada");
  }
}

async function exportLibrary() {
  const backup = await createBackupV2(state.library, loadPdfDocument);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "caderno-biblioteca.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  toast("Biblioteca exportada. Guarde esse arquivo: ele é a cópia das cifras, playlists e PDFs.");
}

function stepPerformance(direction) {
  const onStage = state.route.name === "stage";
  const setlist = onStage ? currentSetlist() : null;
  const song = currentSong();
  const items = setlist?.items || (song ? [{ songId: song.id }] : []);
  const pageOptions = performancePageOptions(song);

  const currentPos = {
    itemIndex: onStage ? state.stageIndex : 0,
    page: state.stagePage || 1,
  };

  const nextPos = stepPerformancePosition(currentPos, direction, {
    items,
    library: state.library,
    ...pageOptions,
  });

  if (onStage) {
    if (nextPos.changedSong) {
      state.stageChart = false;
    }
    state.stageIndex = nextPos.itemIndex;
    state.stagePage = nextPos.page;
  } else {
    state.stagePage = nextPos.page;
  }

  renderMain();
}

function pdfStage(song, page) {
  const pages = getSongPageCount(song);
  const safePage = Math.min(Math.max(page || 1, 1), pages);
  const physicalPage = song.pdfRef ? relativeToPhysicalPage(song.pdfRef, safePage) : safePage;
  const onStage = state.route.name === "stage";
  const setlist = onStage ? currentSetlist() : null;
  const items = setlist?.items || (song ? [{ songId: song.id }] : []);
  const currentPos = { itemIndex: onStage ? state.stageIndex : 0, page: safePage };
  const canPrev = canStepPerformance(currentPos, -1, { items, library: state.library });
  const canNext = canStepPerformance(currentPos, 1, { items, library: state.library });
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
  clearSheetFit(paper);
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

async function startPdfSplitWizard(file) {
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
    const song = currentSong();
    const defaultTitle = song ? song.title : file.name.replace(/.pdf$/i, "");
    state.wizard = {
      file,
      buffer,
      draft: createPdfSplitDraft({
        documentId: uid(),
        fileName: file.name,
        pageCount,
        defaultTitle,
      }),
      targetSongId: song?.id || null,
      allowOverlap: false,
      allowGaps: false,
    };
    renderPdfWizardModal();
  } catch {
    toast("Não foi possível carregar o PDF selecionado.");
  }
}

function renderPdfWizardModal() {
  if (!state.wizard) return;
  const { draft, allowOverlap, allowGaps } = state.wizard;
  const isSingle = draft.mode === "single";
  const singleTitle = draft.ranges[0]?.title || "";

  const rangesHtml = draft.ranges.map((range, idx) => {
    const rangeNum = idx + 1;
    const removeBtn = draft.ranges.length > 1
      ? '<button class="btn ghost danger" type="button" data-action="wizard-remove-range" data-range-index="' + idx + '" aria-label="Remover música #' + rangeNum + '">Excluir</button>'
      : "";
    return '<div class="wizard-range-row" data-range-index="' + idx + '">' +
      '<span class="range-badge">M' + rangeNum + '</span>' +
      '<input type="text" class="field range-title" value="' + esc(range.title) + '" data-wizard-input="range-title" data-range-index="' + idx + '" placeholder="Título da música #' + rangeNum + '" aria-label="Título da música #' + rangeNum + '">' +
      '<div class="range-pages">' +
        '<label>De: <input type="number" class="field page-num" min="1" max="' + draft.pageCount + '" value="' + range.firstPage + '" data-wizard-input="range-first" data-range-index="' + idx + '" aria-label="Página inicial música #' + rangeNum + '"></label>' +
        '<label>Até: <input type="number" class="field page-num" min="1" max="' + draft.pageCount + '" value="' + range.lastPage + '" data-wizard-input="range-last" data-range-index="' + idx + '" aria-label="Página final música #' + rangeNum + '"></label>' +
      '</div>' +
      removeBtn +
    '</div>';
  }).join("");

  const panelHtml = isSingle
    ? '<div class="wizard-panel wizard-single-panel">' +
        '<label class="wizard-field-label">Título da cifra: ' +
          '<input type="text" class="field" value="' + esc(singleTitle) + '" data-wizard-input="single-title" placeholder="Nome da música">' +
        '</label>' +
        '<p class="meta">O arquivo inteiro (páginas 1 a ' + draft.pageCount + ') será vinculado a esta cifra.</p>' +
      '</div>'
    : '<div class="wizard-panel wizard-split-panel">' +
        '<div class="wizard-range-list">' + rangesHtml + '</div>' +
        '<div><button class="btn ghost" type="button" data-action="wizard-add-range">+ Adicionar música</button></div>' +
      '</div>';

  const gridHtml = renderWizardGridHtml(draft);
  const messagesHtml = renderWizardMessagesHtml(draft, allowOverlap, allowGaps);
  const validation = validateSplitDraft(draft);
  const canCommit = validation.valid && (!validation.hasOverlap || allowOverlap) && (!validation.hasGaps || allowGaps);

  const html = '<div class="modal wizard-modal" role="dialog" aria-modal="true" aria-labelledby="wizard-title" id="pdf-wizard-modal">' +
    '<div class="wizard-header">' +
      '<h2 id="wizard-title">Assistente de PDF</h2>' +
      '<p class="meta"><strong>' + esc(draft.fileName) + '</strong> — ' + draft.pageCount + ' página(s)</p>' +
    '</div>' +
    '<div class="wizard-modes inline-actions">' +
      '<button class="btn ' + (isSingle ? "primary" : "ghost") + '" type="button" data-action="wizard-set-mode" data-mode="single">Música única (arquivo inteiro)</button>' +
      '<button class="btn ' + (!isSingle ? "primary" : "ghost") + '" type="button" data-action="wizard-set-mode" data-mode="split">Dividir em músicas (vários intervalos)</button>' +
    '</div>' +
    panelHtml +
    '<div>' +
      '<p class="meta" style="margin-bottom: 6px;"><strong>Mapa de páginas:</strong></p>' +
      '<div class="wizard-page-grid" id="wizard-page-grid">' + gridHtml + '</div>' +
    '</div>' +
    '<div id="wizard-messages">' + messagesHtml + '</div>' +
    '<div class="inline-actions wizard-footer">' +
      '<button class="btn ghost" type="button" data-action="wizard-cancel">Cancelar</button>' +
      '<button class="btn primary" type="button" data-action="wizard-commit" ' + (canCommit ? "" : "disabled") + '>Concluir importação</button>' +
    '</div>' +
  '</div>';

  openModal(html);
}

function renderWizardGridHtml(draft) {
  const pageCount = Math.max(1, Number(draft.pageCount) || 1);
  const pageUsage = new Map();
  draft.ranges.forEach((range, idx) => {
    const rangeNum = idx + 1;
    const first = Number(range.firstPage);
    const last = Number(range.lastPage);
    if (Number.isInteger(first) && Number.isInteger(last) && first <= last) {
      for (let p = Math.max(1, first); p <= Math.min(pageCount, last); p += 1) {
        if (!pageUsage.has(p)) pageUsage.set(p, []);
        pageUsage.get(p).push(rangeNum);
      }
    }
  });

  const cards = [];
  for (let p = 1; p <= pageCount; p += 1) {
    const usages = pageUsage.get(p) || [];
    let statusClass;
    let ownerLabel;
    if (usages.length === 0) {
      statusClass = "page-gap";
      ownerLabel = "—";
    } else if (usages.length === 1) {
      statusClass = "page-assigned";
      ownerLabel = "M" + usages[0];
    } else {
      statusClass = "page-overlap";
      ownerLabel = "M" + usages.join("+");
    }
    cards.push('<div class="page-card ' + statusClass + '" data-page="' + p + '">' +
      '<span class="page-num">' + p + '</span>' +
      '<span class="page-owner">' + ownerLabel + '</span>' +
    '</div>');
  }
  return cards.join("");
}

function renderWizardMessagesHtml(draft, allowOverlap, allowGaps) {
  const validation = validateSplitDraft(draft);
  const parts = [];
  if (!validation.valid) {
    parts.push('<div class="wizard-callout error"><strong>Atenção:</strong><ul>' +
      validation.errors.map((e) => "<li>" + esc(e) + "</li>").join("") +
      '</ul></div>');
  }
  if (validation.hasOverlap) {
    parts.push('<div class="wizard-callout warning"><label>' +
      '<input type="checkbox" data-action="wizard-toggle-overlap" ' + (allowOverlap ? "checked" : "") + '> ' +
      'Confirmar páginas sobrepostas em mais de uma música (' + validation.overlaps.join(", ") + ')' +
      '</label></div>');
  }
  if (validation.hasGaps) {
    parts.push('<div class="wizard-callout warning"><label>' +
      '<input type="checkbox" data-action="wizard-toggle-gaps" ' + (allowGaps ? "checked" : "") + '> ' +
      'Confirmar páginas não atribuídas a nenhuma música (' + validation.gaps.join(", ") + ')' +
      '</label></div>');
  }
  return parts.join("");
}

function updateWizardFeedback() {
  if (!state.wizard) return;
  const { draft, allowOverlap, allowGaps } = state.wizard;
  const gridEl = document.querySelector("#wizard-page-grid");
  if (gridEl) gridEl.innerHTML = renderWizardGridHtml(draft);
  const msgEl = document.querySelector("#wizard-messages");
  if (msgEl) msgEl.innerHTML = renderWizardMessagesHtml(draft, allowOverlap, allowGaps);
  const commitBtn = document.querySelector('[data-action="wizard-commit"]');
  if (commitBtn) {
    const validation = validateSplitDraft(draft);
    const canCommit = validation.valid && (!validation.hasOverlap || allowOverlap) && (!validation.hasGaps || allowGaps);
    commitBtn.disabled = !canCommit;
  }
}

async function _attachPdf(file) {
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
  if (state.wizard) state.wizard = null;
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
  if (showingPdf(song) || isReadingChart(song)) return "";
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

function registerServiceWorker() {
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then((registration) => {
          updateOfflineIndicator();
          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                toast("Caderno atualizado. Pronto para uso offline.");
              }
            });
          });
        })
        .catch(() => {
          // SW não suportado ou bloqueado no ambiente
        });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      updateOfflineIndicator();
    });
  }
}

function updateOfflineIndicator() {
  const isControlled = Boolean(navigator.serviceWorker?.controller);
  const pill = document.querySelector("#offline-pill");
  if (pill) {
    if (!navigator.onLine) {
      pill.hidden = false;
      pill.textContent = "Offline (Cache ativo)";
      pill.classList.add("offline-now");
    } else if (isControlled) {
      pill.hidden = false;
      pill.textContent = "✓ Pronto para uso offline";
      pill.classList.remove("offline-now");
    } else {
      pill.hidden = true;
    }
  }
}

window.addEventListener("online", updateOfflineIndicator);
window.addEventListener("offline", updateOfflineIndicator);
registerServiceWorker();
