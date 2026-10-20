# PDF.js vendorizado

Esta pasta contém os artefatos necessários para abrir PDFs sem depender da rede durante uma apresentação.

- Projeto de origem: <https://mozilla.github.io/pdf.js/>
- Pacote publicado: `pdfjs-dist@6.4.299`
- Licença: Apache-2.0, preservada em `LICENSE`
- Versão declarada nos dois bundles: `6.4.299`
- Integridade do pacote publicado: `sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==`

O projeto original não registrava como esses arquivos foram copiados. A versão foi confirmada no cabeçalho dos bundles e no registro npm; a igualdade byte a byte com o pacote publicado ainda não foi comprovada.

## Atualização

1. Baixar a versão fixada com `npm pack pdfjs-dist@6.4.299`.
2. Extrair `build/pdf.min.mjs`, `build/pdf.worker.min.mjs` e os arquivos necessários de `standard_fonts/`.
3. Preservar as licenças que acompanham a distribuição.
4. Atualizar a versão e a integridade documentadas acima.
5. Executar `npm run check` e abrir um PDF real no navegador.
