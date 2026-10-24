# Arquitetura

O auracore é uma extensão Chrome Manifest V3 sem dependências de produção. O popup controla uma aba por vez e a escolha do usuário fica em `chrome.storage.local`; o ID da aba alvo fica em `chrome.storage.session`, pois não vale após reiniciar o navegador.

## Caminho do áudio

1. `popup.js` seleciona a aba alvo antes de salvar o estilo. `background.js` informa a aba anterior e encerra sua captura.
2. `content.js`, no mundo isolado, lê o storage e envia a configuração para `page.js` por eventos no documento.
3. `page.js`, no mundo da página, acompanha elementos de mídia, inclusive os que nunca entram no DOM. Aplica velocidade, fade e tape stop. Quando a mídia permite Web Audio, cria `engine.js` sob demanda e roteia o som pelo grafo de efeitos.
4. Em mídia protegida ou sem acesso ao áudio pela página, o popup pede `tabCapture`. `background.js` cria o documento offscreen e `offscreen.js` processa o áudio capturado com o mesmo motor. A velocidade continua no elemento de mídia da página.

Mídia protegida não deve ser ligada a `MediaElementAudioSourceNode`: isso pode produzir silêncio. O motor mantém um caminho direto para o estilo neutro. Ao encerrar uma captura pelo indicador do Chrome, o offscreen avisa o service worker, que limpa o estado da aba, desliga o efeito na aba alvo e fecha o documento quando nenhuma captura resta.

## Permissões

`<all_urls>` e `all_frames` permitem detectar mídia em qualquer serviço, inclusive frames e players fora do DOM criados antes da abertura do popup. Os scripts no mundo `MAIN` alcançam objetos da página, mas compartilham o ambiente JavaScript dela. O Chrome permite restringir o acesso a sites específicos nas configurações da extensão. Uma troca para `activeTab` exige redesenhar a ativação antecipada e os links compartilhados para preservar esses casos.

`tabCapture` começa após o usuário abrir o popup na aba. `offscreen` permite continuar o processamento depois que o popup fecha. Os arquivos de áudio ambiente são carregados apenas quando o estilo correspondente está ativo.

## Artes

`artwork/{styleId}.webp` traz a arabot, personagem do auracore, em WebP com alfa de 640 × 800 px; as artes de produção em resolução maior ficam fora do repositório. O popup anima a arte só com o estilo ligado, e a preferência por movimento reduzido desliga a animação:

| Movimento | Estilos |
| --- | --- |
| Respiração | `slowed`, `lofi`, `sunday-night` |
| Passos | `sped-up` |
| Balanço musical | `nightcore`, `party-bathroom` |
| Balanço lento | `daycore`, `empty-arena`, `rainy` |
| Deslocamento lateral | `vaporwave`, `8d`, `custom` |
| Pulso | `bass`, `phonk` |
| Flutuação | `underwater`, `ethereal` |

## Firefox

O Firefox 128 ou superior roda o mesmo código. `tools/firefox-manifest.mjs` gera o manifest dele a partir do `manifest.json`: o background vira página de eventos com `styles.js` e `background.js` (sem service worker nem `importScripts`), saem `tabCapture` e `offscreen`, que ele não tem, e entram o ID `auracore@lucaswotta` e a declaração de dados exigida pelo addons.mozilla.org. Sem captura de aba, `background.js` responde que não há captura e o popup avisa, em site protegido, que só velocidade e tom mudam. `npm run package` gera `dist/auracore.zip` (Chrome e Edge) e `dist/auracore-firefox.zip`.

## Idiomas

A interface segue o idioma do Chrome por `chrome.i18n`: inglês (`default_locale`), espanhol e português do Brasil, em `_locales/`. Idiomas sem tradução, inclusive português de Portugal, caem no inglês. O painel de apoio mostra o Pix só com o Chrome em `pt-BR`. O ID interno de cada estilo não muda com o nome exibido, para preservar estilos salvos.

## Estado e limites

`enabled` e `style` são globais no storage local; `targetTab` limita sua aplicação a uma aba. O popup consulta a captura ativa ao abrir. O áudio não sai do navegador para processamento.

A suíte de `test/` simula Web Audio e APIs de extensão. `TESTING.md` define a verificação com áudio real, DRM e indicador de captura. `tools/package.sh` gera o ZIP de distribuição com artes WebP, fontes, áudios e arquivos de execução; os arquivos de produção em alta resolução ficam fora da árvore da extensão.
