import assert from "node:assert/strict";
import test from "node:test";
import { chartKey, toSharedChart } from "./acervo.js";

const sections = [
  {
    label: "A",
    measures: ["CΔ7", "D-7 G7", "CΔ7", "FΔ7"].map((chords) => ({ chords, ending: "", repeat: "" })),
  },
];

test("reconhece a mesma música com acento e maiúscula diferentes", () => {
  assert.equal(chartKey("  Garoa ", "Oficina"), chartKey("garoa", "oficina"));
  assert.equal(chartKey("São Paulo", "Tom Jobim"), chartKey("Sao Paulo", "tom jobim"));
  assert.equal(chartKey("A", "Oficina"), "");
});

test("guarda uma cifra com acordes e recusa um rascunho de NC", () => {
  const chart = toSharedChart({
    title: "Garoa",
    composer: "Oficina",
    key: "C",
    tempo: 120,
    timeSignature: "4/4",
    barsPerRow: 4,
    sections,
  });
  assert.equal(chart.title, "Garoa");
  assert.equal(chart.sections[0].measures[0].chords, "CΔ7");

  const draft = toSharedChart({
    title: "Garoa",
    composer: "Oficina",
    sections: [{
      label: "A",
      measures: ["C", "NC", "NC", "NC", "NC", "NC", "NC", "NC"].map((chords) => ({ chords })),
    }],
  });
  assert.equal(draft, null);
  assert.equal(toSharedChart({ title: "Sem título", composer: "", sections }), null);
});
