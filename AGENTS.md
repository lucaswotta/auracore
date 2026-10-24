# Instruções para agentes

- Testes de lógica: `npm test` (Node 22+, sem dependências).
- Textos visíveis ficam em `_locales/{en,es,pt_BR}/messages.json` e são lidos com `msg('chave')` (`styles.js`) ou `data-i18n*` no `popup.html`. Toda chave nova entra nos três idiomas, escrita como um falante nativo diria, sem tradução literal; `test/i18n.test.js` confere a paridade. Chaves do Pix existem só em `pt_BR`.
- Ver a interface: `node tools/popup-screenshot.mjs --out /tmp/popup.png [--style "lo-fi"] [--variant intenso] [--view custom|about|support] [--lang en-US|es|pt-BR] [--layout]` abre o popup (380×520) num Chrome for Testing com a extensão carregada e salva a captura. `--layout` imprime se há rolagem de página e quais nomes de estilo precisaram correr no botão; nenhuma tela pode ter rolagem de página.
- O Chrome precisa de sockets locais e o controle dele passa por `127.0.0.1`. No sandbox do Codex com a rede bloqueada ele falha ("Operation not permitted" ou "O Chrome não abriu a porta de depuração"); rode o comando com a rede liberada no sandbox ou peça aprovação para executá-lo fora dele. Reinstalar o Chrome não resolve.
- O Chrome estável ignora `--load-extension`; use o Chrome for Testing do cache do Playwright (`~/.cache/ms-playwright/chromium-1243/`) ou aponte `CHROME_BIN`.
