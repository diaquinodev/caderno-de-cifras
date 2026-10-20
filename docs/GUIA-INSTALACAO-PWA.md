# Guia de Instalação do Caderno como Aplicativo (PWA)

O **Caderno de Cifras e Setlists** é uma Progressive Web App (PWA). Isso significa que você pode instalá-lo como um aplicativo nativo no seu computador, celular ou tablet, funcionando com acesso direto na tela inicial e operando 100% offline durante ensaios e apresentações em locais sem sinal de internet.

---

## 1. No Computador (Windows, Mac ou Linux)

Navegadores suportados: **Google Chrome**, **Microsoft Edge**, **Brave**.

1. Acesse o endereço do Caderno (ex.: no Netlify ou servidor local).
2. Na barra de endereços (ao lado da estrela de favoritos), observe o ícone de instalação:
   - No **Chrome**: clique no ícone de computador com seta para baixo (**"Instalar Caderno"**).
   - No **Edge**: clique no ícone de três quadradinhos com sinal de mais (**"Aplicativo disponível"**).
3. Na janela de confirmação, clique em **Instalar**.
4. O Caderno abrirá em uma janela própria, sem a barra de abas do navegador, com ícone na barra de tarefas e no menu Iniciar.

---

## 2. No Celular ou Tablet Android

Navegador recomendado: **Google Chrome**.

1. Abra o Caderno no Chrome do seu dispositivo Android.
2. Toque no menu de três pontinhos (**⋮**) no canto superior direito.
3. Selecione a opção **"Instalar aplicativo"** ou **"Adicionar à tela inicial"**.
4. Toque em **Instalar** para confirmar.
5. O ícone do Caderno será adicionado à sua gaveta de aplicativos e tela de início.
6. Ao abrir pelo ícone, o app roda em tela cheia (*display standalone*), preservando a rotação de tela para uso tanto em pé quanto deitado na estante.

---

## 3. No iPhone ou iPad (iOS / iPadOS)

Navegador obrigatório: **Safari**.

1. Abra o Caderno no **Safari** do seu iPhone ou iPad.
2. Toque no botão de **Compartilhar** (o ícone de quadrado com seta para cima, na barra inferior do iPhone ou no topo do iPad).
3. Role as opções para baixo e toque em **"Adicionar à Tela de Início"** (ícone com um sinal de **+**).
4. O nome "Caderno" aparecerá automaticamente; toque em **Adicionar** no canto superior direito.
5. O ícone elegante do Caderno aparecerá na sua tela de início.
6. Ao tocar no ícone, o Caderno abre sem as barras do Safari, como um app nativo de palco.

---

## 4. Como funciona o Modo Offline

- **Primeiro acesso com internet**: Ao carregar a página pela primeira vez, o Service Worker pré-armazena todo o código, telas, estilos e o leitor de PDF no cache do seu aparelho.
- **Armazenamento de repertório**: Todas as cifras, setlists e arquivos PDF importados ficam guardados no banco de dados local do seu navegador (`localStorage` e `IndexedDB`).
- **No dia do show**: Mesmo colocando o aparelho em **Modo Avião** ou sem Wi-Fi/4G no palco, abra o Caderno: todo o seu repertório, partituras e modo palco abrirão instantaneamente.
