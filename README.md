# Caderno de Cifras

Aplicação web para organizar cifras, PDFs, playlists e setlists de apresentação.

## Requisitos

- Node.js 24 ou versão compatível
- npm
- Netlify CLI somente quando for necessário testar as funções hospedadas

## Preparação

```bash
npm install
```

## Verificação completa

```bash
npm run check
```

Esse comando executa, nesta ordem:

1. validação de sintaxe dos arquivos JavaScript do produto;
2. lint com ESLint;
3. verificação de tipos dos módulos de lógica próprios;
4. testes unitários.

O `typecheck` inicial cobre os módulos de lógica listados em `jsconfig.json`. A interface DOM e o PDF.js de terceiros ainda não fazem parte dessa barreira porque o código atual não possui as anotações necessárias para uma verificação útil sem uma migração dedicada.

## Servidor local

```bash
npm start
```

A interface fica disponível em `http://127.0.0.1:4173`.

O servidor local oferece implementações de desenvolvimento para `/api/cifra` e `/api/acervo`. Para validar as funções e regras reais de hospedagem, use `netlify dev`; abrir apenas o servidor local não prova o comportamento do deploy.

## Fronteira do repositório

O produto versionado está em `caderno/`, `netlify/` e `data/`, além das configurações da raiz. Dependências instaladas, estado local do Netlify, worktrees, sondagens temporárias e pastas de pesquisa não entram no Git.
