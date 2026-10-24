# auracore

Extensão para Chrome que toca o áudio de qualquer aba nos estilos de remix da internet, como slowed + reverb, nightcore, 8D e lo-fi, ao vivo enquanto você ouve.

[English](README.md) · [Español](README.es.md)

<p align="center">
  <img src="docs/readme-character.webp" alt="arabot, a personagem do auracore, segurando a logo" width="260">
  <img src="docs/popup-pt-BR.webp" alt="Popup do auracore com o estilo lo-fi ligado" width="300">
</p>

## Requisitos

- Chrome 116 ou superior. Outros navegadores baseados em Chromium não foram testados.
- Node.js 22 ou superior, só para rodar os testes.

## Instalação

O auracore ainda não está na Chrome Web Store. Para instalar a partir deste repositório:

1. Baixe ou clone o repositório.
2. Abra `chrome://extensions` e ative o Modo do desenvolvedor.
3. Clique em Carregar sem compactação e selecione a pasta do repositório.

## Uso

1. Toque uma música numa aba: YouTube, YouTube Music, Spotify, Deezer, SoundCloud e outros players.
2. Clique no ícone do auracore e escolha um estilo. Clicar de novo no estilo ativo desliga.
3. O controle abaixo dos estilos deixa o efeito mais suave ou mais intenso. No 8D ele escolhe o trajeto: círculo, livre ou oito.
4. Personalizado abre todos os controles (velocidade, graves, tom, reverb, 8D, chuva, água e outros) e permite salvar estilos próprios.

Estilos: slowed + reverb, sped up, nightcore, daycore, vaporwave, 8D, bass boosted, lo-fi, banheiro da balada, domingo à noite, debaixo d'água, estádio vazio, na chuva, etéreo e phonk.

O auracore funciona em uma aba por vez. Abrir o popup em outra aba e escolher um estilo leva o efeito para lá; as demais abas continuam com o som original. A interface segue o idioma do Chrome: português do Brasil, inglês ou espanhol.

## Configuração

Estilo, intensidade, fade, tape stop e estilos salvos ficam em `chrome.storage.local`; a aba ativa fica em `chrome.storage.session`. O áudio é processado no seu dispositivo e nunca é gravado nem enviado a lugar nenhum. Os detalhes estão na [política de privacidade](PRIVACY.md#português).

## Limitações

- Em serviços com reprodução protegida, como Spotify e Amazon Music, os efeitos passam pela captura de aba do Chrome, que mostra um indicador de captura enquanto o efeito estiver ligado. Encerrar a captura por esse indicador desliga o auracore naquela aba.
- O auracore roda em todos os sites para encontrar players que começam antes de o popup abrir. Dá para limitar o acesso por site em `chrome://extensions` → auracore → Detalhes.
- Firefox e Safari não são suportados.

## Desenvolvimento

`npm test` roda a suíte de testes, sem dependências para instalar. `npm run package` gera `dist/auracore.zip`. A documentação para desenvolvimento está em [ARCHITECTURE.md](ARCHITECTURE.md), [TESTING.md](TESTING.md) e [ROADMAP.md](ROADMAP.md).

## Apoio

O auracore é gratuito. Se ele já embala as suas músicas, você pode me pagar um cafezinho pelo Pix ou pelo [GitHub Sponsors](https://github.com/sponsors/lucaswotta). Indicar para um amigo ou deixar uma estrela no repositório também ajuda muito.

<p align="center"><img src="support/pix-qr.svg" alt="QR do Pix" width="180"></p>

Chave Pix aleatória: `16a5c103-0372-42a7-8b40-0d29c2a418f0`

## Licença e créditos

O código é visível, mas todos os direitos são reservados: você pode ler e instalar o auracore para uso pessoal, não redistribuir. Veja a [LICENSE](LICENSE), em inglês.

A arte da arabot e os sons de ambiente foram gerados com IA e editados por mim. As fontes estão sob a SIL Open Font License, em `fonts/licenses/`.
