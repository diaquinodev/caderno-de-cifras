/**
 * Sanitized test fixtures for the six real-world songs in the Caderno corpus.
 * These fixtures contain chord progressions, section headers, and tablature annotations
 * without storing protected copyrighted lyrics.
 */

export const FIXTURE_SO_EASY = `
Título: So Easy (To Fall In Love)
Artista: Willy Chirino
Tom: C

[Intro]
C G/B Am F

[Primeira Parte]
C G/B Am F
C G/B Am F

[Refrão]
Dm G Em Am
Dm G C
`.trim();

export const FIXTURE_WHATS_GOING_ON = `
Título: What's Going On
Artista: Marvin Gaye
Compositor: Marvin Gaye / Al Cleveland / Renaldo Benson
Tom: E

[Intro]
E7M C#m7

[Primeira Parte]
E7M C#m7
E7M C#m7

[Refrão]
F#m7 B7(9)
F#m7 B7(9)

[Segunda Parte]
A/B E7M C#m7
`.trim();

export const FIXTURE_REU_CONFESSO = `
Título: Réu Confesso
Artista: Tim Maia
Compositor: Tim Maia
Tom: A

[Intro]
A7M F#m7 Bm7 E7(9)

[Primeira Parte]
A7M F#m7 Bm7 E7(9)
A7M F#m7 Bm7 E7(9)

[Refrão]
C#m7 F#m7 Bm7 E7(9) A7M
`.trim();

/**
 * Águas de Março: intentionally has NO section tags ([Intro], [Refrão], etc.)
 * to prove the requirement that anonymous blocks are generated without error.
 */
export const FIXTURE_AGUAS_DE_MARCO = `
Título: Águas de Março
Artista: Tom Jobim
Compositor: Tom Jobim
Tom: Bb

Bb Bb7M Bb7 Eb7M
Ebm6 Bb/D Db° Cm7 F7
Bb Bb7M Bb7 Eb7M
Ebm6 Bb/D Db° Cm7 F7 Bb
`.trim();

export const FIXTURE_GAROTA_DE_IPANEMA = `
Título: Garota de Ipanema
Artista: Tom Jobim
Compositor: Tom Jobim / Vinicius de Moraes
Tom: F

[Intro]
F7M G7 Gm7 Gb7

[Primeira Parte]
F7M G7
Gm7 Gb7(11#) F7M

[Segunda Parte]
Gb7M B7(9) F#m7 D7(9)
Gm7 Eb7(9) Am7 D7(9-)
Gm7 C7(9-)
`.trim();

/**
 * Samba de Uma Nota Só: contains a [Tab - Intro] block and guitar tab lines
 * to prove that tablatures are identified and never silently dropped.
 */
export const FIXTURE_SAMBA_DE_UMA_NOTA_SO = `
Título: Samba de Uma Nota Só
Artista: Tom Jobim
Compositor: Tom Jobim / Newton Mendonça
Tom: D

[Tab - Intro]
e|---5---5---5---5---|
B|---5---5---5---5---|
G|---5---5---5---5---|
D|---4---4---4---4---|

[Primeira Parte]
Dm7 Db7(9) Cm7 B7(9)
Bb7M A7(13-) Dm7

[Segunda Parte]
Gm7 C7(9) F7M F6
Fm7 Bb7(9) Eb7M A7
`.trim();

export const ALL_SIX_FIXTURES = [
  { id: "so-easy", name: "So Easy (To Fall In Love)", raw: FIXTURE_SO_EASY, expectedBlocks: 3, hasTabs: false },
  { id: "whats-going-on", name: "What's Going On", raw: FIXTURE_WHATS_GOING_ON, expectedBlocks: 4, hasTabs: false },
  { id: "reu-confesso", name: "Réu Confesso", raw: FIXTURE_REU_CONFESSO, expectedBlocks: 3, hasTabs: false },
  { id: "aguas-de-marco", name: "Águas de Março", raw: FIXTURE_AGUAS_DE_MARCO, expectedBlocks: 1, isAnonymous: true, hasTabs: false },
  { id: "garota-de-ipanema", name: "Garota de Ipanema", raw: FIXTURE_GAROTA_DE_IPANEMA, expectedBlocks: 3, hasTabs: false },
  { id: "samba-de-uma-nota-so", name: "Samba de Uma Nota Só", raw: FIXTURE_SAMBA_DE_UMA_NOTA_SO, expectedBlocks: 3, hasTabs: true },
];