import { formatCell, normalizeKey } from "./chords.js";

const HOST = /^(?:www\.)?cifraclub\.com\.br$/i;

export function cifraClubUrl(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (!HOST.test(url.hostname)) return "";
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return "";
  if (parts.some((part) => /^(?:letra|letras)(?:\.html)?$/i.test(part))) return "";
  if (!parts.every((part) => /^[\w.-]+$/.test(part))) return "";
  url.protocol = "https:";
  url.hostname = "www.cifraclub.com.br";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function isCifraClubUrl(value) {
  return Boolean(cifraClubUrl(value));
}

export function pastedCifraLink(value) {
  const text = String(value || "").trim();
  const direct = cifraClubUrl(text);
  if (direct) return direct;
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?cifraclub\.com\.br\/[^\s<>"']+/i);
  if (!match) return "";
  return cifraClubUrl(match[0].replace(/[),.;]+$/, ""));
}

function fold(text) {
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function roleOf(label) {
  const name = fold(label);
  if (name.includes("tab")) return "tab";
  if (name.includes("intro")) return "intro";
  if (name.includes("ponte") || name.includes("bridge")) return "bridge";
  if (name.includes("refra") || name.includes("chorus") || name.includes("coro")) {
    return name.includes("final") ? "chorus-final" : "chorus";
  }
  if (name.includes("parte") || name.includes("verse") || name.includes("verso")) return "verse";
  return "other";
}

function prettyLabel(label, role) {
  const name = fold(label);
  if (role === "intro") return "Intro";
  if (role === "bridge") return "Ponte";
  if (role === "chorus-final") return "Refrão final";
  if (role === "chorus") return "Refrão";
  if (role === "verse") {
    if (name.includes("segunda") || /\b2\b/.test(name)) return "Segunda Parte";
    return "Parte";
  }
  const clean = String(label || "").replace(/[[\]]/g, "").trim();
  return clean.slice(0, 40) || "A";
}

export function normalizeCifraChord(raw) {
  return String(raw || "")
    .trim()
    .replace(/7M(?![a-z])/g, "maj7")
    .replace(/m7\(5-\)/g, "m7b5")
    .replace(/7\(4\)/g, "7sus4")
    .replace(/\(4\)/g, "sus4");
}

function pairKey(left, right) {
  return `${left}|${right}`;
}

export function linesToBars(lines, knownPairs = []) {
  const known = new Set(knownPairs.map(([left, right]) => pairKey(left, right)));
  for (const line of lines) {
    if (line.length === 2) known.add(pairKey(line[0], line[1]));
    if (line.length === 3) known.add(pairKey(line[1], line[2]));
    if (line.length >= 4) {
      for (let index = 0; index + 1 < line.length; index += 2) {
        known.add(pairKey(line[index], line[index + 1]));
      }
    }
  }

  const phrases = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1];
    if (line.length === 1 && next?.length === 1 && known.has(pairKey(line[0], next[0]))) {
      phrases.push([line[0], next[0]]);
      index += 1;
      continue;
    }
    phrases.push(line);
  }

  const bars = [];
  for (const phrase of phrases) {
    if (!phrase.length) continue;
    if (phrase.length === 1 || phrase.length === 2) {
      bars.push(phrase);
      continue;
    }
    if (phrase.length === 3) {
      bars.push([phrase[0]]);
      bars.push([phrase[1], phrase[2]]);
      continue;
    }
    for (let index = 0; index < phrase.length; index += 2) {
      bars.push(phrase.slice(index, index + 2));
    }
  }
  return bars;
}

function sameBars(left, right) {
  if (left.length !== right.length) return false;
  return left.every((bar, index) => bar.join(" ") === right[index].join(" "));
}

function onlyShorter(first, second) {
  return first.length > second.length && first.slice(0, second.length).join(" ") === second.join(" ");
}

function decodeAttr(value) {
  return String(value || "")
    .replace(/&deg;|&#176;/g, "°")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"");
}

function textOf(fragment) {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function topDivs(preHtml) {
  const divs = [];
  const marks = /<div\b[^>]*>|<\/div>/gi;
  let depth = 0;
  let start = -1;
  for (const match of preHtml.matchAll(marks)) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        divs.push(preHtml.slice(start, match.index));
        start = -1;
      }
      continue;
    }
    if (depth === 0) start = match.index + match[0].length;
    depth += 1;
  }
  return divs;
}

function labelSplit(fragment) {
  const plain = fragment.replace(/<([a-z0-9]+)\b[^>]*>/gi, "<$1>");
  const chordAt = plain.search(/<b>/i);
  const labels = [...plain.matchAll(/\[([^[\]]{1,40})]/g)].map((match) => ({
    label: match[1].trim(),
    at: match.index,
  }));
  return {
    before: labels.filter((item) => chordAt < 0 || item.at < chordAt).map((item) => item.label),
    after: labels.filter((item) => chordAt >= 0 && item.at > chordAt).map((item) => item.label),
  };
}

function readSections(html) {
  const pre = html.match(/<pre\b[^>]*>[\s\S]*?<\/pre>/i)?.[0] || "";
  const sections = [];
  let current = null;
  const open = (label) => {
    if (roleOf(label) === "tab") {
      current = null;
      return;
    }
    current = { label, lines: [] };
    sections.push(current);
  };

  for (const fragment of topDivs(pre)) {
    const { before, after } = labelSplit(fragment);
    const chords = [...fragment.matchAll(/data-chord-name="([^"]+)"/g)]
      .map((match) => normalizeCifraChord(decodeAttr(match[1])))
      .filter(Boolean);
    for (const label of before) open(label);
    if (chords.length && current) current.lines.push(chords);
    for (const label of after) open(label);
  }
  return sections.filter((section) => section.lines.length);
}

function plainPage(html) {
  return textOf(String(html || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " "));
}

function buildMeasures(bars, repeatStart, repeatEnd) {
  return bars.map((bar, index) => {
    let repeat = "";
    if (index === 0 && repeatStart) repeat = "start";
    if (index === bars.length - 1 && repeatEnd) repeat = repeat === "start" ? "both" : "end";
    return { chords: bar.join(" "), repeat, ending: "" };
  });
}

function shape(label, role, bars, repeatStart = false, repeatEnd = false) {
  return {
    label: prettyLabel(label, role),
    measures: buildMeasures(bars, repeatStart, repeatEnd),
  };
}

const CHORD_REST = /^(?:maj|min|dim|aug|sus|add|m|M|b|#|\d|°|º|ø|Δ|\+|-|\(|\))*$/i;

function chordToken(token) {
  const clean = String(token || "").replace(/^[,;[]+|[,.;:\]]+$/g, "");
  const slash = clean.match(/^(.*?)(?:\/([A-G](?:#|b)?))?$/);
  if (!slash) return null;
  const match = slash[1].match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match || !CHORD_REST.test(match[2])) return null;
  const rest = match[2].replace(/maj|min|dim|aug|sus|add/gi, "");
  if (/[a-z]{2,}/i.test(rest)) return null;
  return { token: clean, rich: match[2].length > 0 || Boolean(slash[2]) };
}

function chordsOnLine(line) {
  const tokens = String(line || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const parsed = tokens.map(chordToken);
  if (parsed.every(Boolean)) return parsed.map((item) => normalizeCifraChord(item.token));
  const rich = parsed.filter((item) => item?.rich);
  if (!rich.length) return null;
  return rich.map((item) => normalizeCifraChord(item.token));
}

function readPlainSections(text) {
  const sections = [];
  let current = null;
  let skip = false;
  const open = (label) => {
    if (roleOf(label) === "tab") {
      current = null;
      skip = true;
      return;
    }
    skip = false;
    current = { label, lines: [] };
    sections.push(current);
  };

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || /^(?:tom|compositor|composi[cç][aã]o|estilo|andamento|tempo|bpm|compasso)\s*:/i.test(line)) continue;
    while (line) {
      const label = line.match(/^\[([^[\]]{1,40})]\s*/);
      if (!label) break;
      open(label[1]);
      line = line.slice(label[0].length).trim();
    }
    if (!line) continue;
    const chords = chordsOnLine(line);
    if (!chords || skip) continue;
    if (!current) open("A");
    current.lines.push(chords);
  }
  return sections.filter((section) => section.lines.length);
}

function chartFromSource(source, meta) {
  const intro = source.find((section) => roleOf(section.label) === "intro");
  const introPairs = (intro?.lines || []).filter((line) => line.length === 2);
  const blocks = source.map((section) => {
    const role = roleOf(section.label);
    let bars = linesToBars(section.lines, introPairs);
    if (role === "intro" && bars.length > 0 && bars.length < 4 && bars.every((bar) => bar.length === 2 && bar.join(" ") === bars[0].join(" "))) {
      bars = [bars[0], bars[0], bars[0], bars[0]];
    }
    return { label: section.label, role, bars };
  }).filter((block) => block.bars.length);

  const sections = [];
  const notes = [];
  let sawSplitBar = false;
  for (let index = 0; index < blocks.length; index += 1) {
    const verse = blocks[index];
    const chorus = blocks[index + 1];
    const verseAgain = blocks[index + 2];
    const chorusAgain = blocks[index + 3];
    const canRepeat = verse?.role === "verse"
      && chorus?.role === "chorus"
      && verseAgain?.role === "verse"
      && chorusAgain?.role === "chorus"
      && sameBars(chorus.bars, chorusAgain.bars)
      && verse.bars.length === verseAgain.bars.length;
    const diffs = canRepeat
      ? verse.bars.map((bar, barIndex) => (bar.join(" ") === verseAgain.bars[barIndex].join(" ") ? -1 : barIndex)).filter((barIndex) => barIndex >= 0)
      : [];
    if (canRepeat && diffs.length <= 1) {
      sections.push(shape(verse.label, "verse", verse.bars, true, false));
      sections.push(shape(chorus.label, "chorus", chorus.bars, false, true));
      notes.push("A repetição toca a Parte e o Refrão duas vezes.");
      if (diffs.length === 1) {
        const barIndex = diffs[0];
        const shown = formatCell(verseAgain.bars[barIndex].join(" "));
        const how = onlyShorter(verse.bars[barIndex], verseAgain.bars[barIndex]) ? "fica só em" : "fica em";
        notes.push(`Na segunda Parte, o ${barIndex + 1}º compasso ${how} ${shown}.`);
      }
      index += 3;
      sawSplitBar = sawSplitBar || verse.bars.some((bar) => bar.length > 1) || chorus.bars.some((bar) => bar.length > 1);
      continue;
    }
    sections.push(shape(verse.label, verse.role, verse.bars));
    sawSplitBar = sawSplitBar || verse.bars.some((bar) => bar.length > 1);
  }

  if (sawSplitBar) notes.unshift("Dois acordes no mesmo compasso valem metade cada.");

  return {
    title: String(meta.title || "").slice(0, 160),
    composer: String(meta.composer || "").slice(0, 240),
    key: normalizeKey(meta.key || "") || "",
    timeSignature: "4/4",
    notes: notes.join(" "),
    sections,
  };
}

export function chartFromCifraHtml(html) {
  const plain = plainPage(html);
  const title = textOf(String(html || "").match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i)?.[0] || "");
  const composer = plain.match(/Composi[cç][aã]o\s*:?\s*(.{5,180}?)(?:\s+Essa informa|\s+Envio por|$)/i)?.[1]?.trim() || "";
  return chartFromSource(readSections(String(html || "")), {
    title,
    composer,
    key: plain.match(/\bTom\s*:\s*([A-G](?:#|b)?m?)\b/i)?.[1] || "",
  });
}

export function chartFromCifraPlain(text) {
  const source = String(text || "");
  return chartFromSource(readPlainSections(source), {
    title: source.match(/^(?:t[ií]tulo|title)\s*:\s*(.+)$/im)?.[1]?.trim() || "",
    composer: source.match(/^(?:compositor|composer)\s*:\s*(.+)$/im)?.[1]?.trim() || "",
    key: source.match(/\bTom\s*:\s*([A-G](?:#|b)?m?)\b/i)?.[1] || "",
  });
}

export async function loadCifraChart(target) {
  const canonical = cifraClubUrl(target);
  if (!canonical) {
    return { ok: false, status: 400, error: "Esse link não é do Cifra Club." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let upstream;
  try {
    upstream = await fetch(canonical, {
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });
  } catch (error) {
    const code = String(error?.cause?.code || error?.name || "falha").replace(/[^A-Za-z0-9_:-]/g, "").slice(0, 40);
    return { ok: false, status: 502, error: `Não consegui ler esse link (${code || "falha"}).` };
  } finally {
    clearTimeout(timer);
  }
  if (!upstream.ok) {
    if (upstream.status === 401 || upstream.status === 403 || upstream.status === 429) {
      return { ok: false, status: 502, error: "O Cifra Club recusou esse link a partir do site publicado. Cole os acordes da cifra nesta caixa." };
    }
    return { ok: false, status: 502, error: `Não consegui ler esse link (HTTP ${upstream.status}).` };
  }
  const finalUrl = upstream.url || canonical;
  if (!isCifraClubUrl(finalUrl)) {
    return { ok: false, status: 502, error: "O link saiu do Cifra Club." };
  }
  const html = await upstream.text();
  if (html.length > 1500000) {
    return { ok: false, status: 413, error: "A página é grande demais." };
  }
  const chart = chartFromCifraHtml(html);
  if (!chart.sections.length) {
    return { ok: false, status: 422, error: "Não encontrei compassos nesse link." };
  }
  return { ok: true, status: 200, chart };
}
