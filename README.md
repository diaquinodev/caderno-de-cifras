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

1. validação de sintaxe dos arquivos JavaScript do produto (`npm run syntax`);
2. lint com ESLint (`npm run lint`);
3. verificação de tipos dos módulos de lógica e da extensão (`npm run typecheck`);
4. validação do manifesto MV3 da extensão (`npm run manifest:check`);
5. testes unitários (`npm test`);
6. testes de ponta a ponta e responsividade com Playwright (`npm run test:e2e`).

## Servidor local

```bash
npm start
```

A interface fica disponível em `http://127.0.0.1:4173` (com suporte local para `/api/acervo`).

## Extensão local: Caderno Clipper (`extension/`)

A antiga rota servidora de busca por URL foi substituída pela extensão local **Caderno Clipper** (Manifest V3), que lê apenas a estrutura musical já aberta pelo usuário na aba ativa do navegador quando acionada por clique.

### Instalação local no Chrome / Chromium

1. Abra `chrome://extensions` no navegador.
2. Ative a chave **Modo do desenvolvedor** (*Developer mode*) no canto superior direito.
3. Clique em **Carregar sem compactação** (*Load unpacked*).
4. Selecione a pasta `extension` dentro deste repositório.
5. Abra uma página de cifra no navegador e clique no ícone do **Caderno Clipper**: a extensão extrai apenas metadados, seções, acordes em ordem por linha e tablaturas marcadas, copia a fonte musical canônica para a área de transferência e abre o Caderno pronto para colar (`Ctrl+V`) e montar o rascunho de compassos.

### Permissões e privacidade

- **`activeTab` e `scripting`**: o código só é injetado na aba atual após o clique explícito no ícone da extensão.
- **Zero `host_permissions` e zero `content_scripts` permanentes**: a extensão não roda em segundo plano nas páginas navegadas.
- **Zero chamadas de rede ao Cifra Club**: a leitura ocorre exclusivamente sobre o DOM já renderizado na aba ativa.
- **Sem letra ou sessão**: versos cantados, `document.cookie`, `localStorage` e `sessionStorage` nunca são lidos nem copiados.

### Limites conhecidos

- Uso pessoal em aba aberta e visível no navegador desktop.
- Tablaturas (`E|---`, `B|---` etc.) são preservadas como blocos `[Tablatura]` para referência, sem inventar acordes a partir de números de casas.
- A fórmula de compasso (`4/4`, `2/4`, `3/4`, `6/8`) é sempre escolhida ou confirmada pelo músico no rascunho interativo do Caderno antes de criar a cifra.

### Procedimento de atualização

1. Atualize o repositório local (`git pull`).
2. Abra `chrome://extensions` e clique no botão **Recarregar** (*Reload*) no cartão do **Caderno Clipper**.

## Fronteira do repositório

O produto versionado está em `caderno/`, `extension/`, `netlify/` e `data/`, além das configurações e testes da raiz. Dependências instaladas, estado local do Netlify, worktrees, sondagens temporárias e pastas de pesquisa não entram no Git.
