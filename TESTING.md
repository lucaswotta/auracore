# Testes

Requisito: Node.js 22 ou superior. A extensão não precisa de dependências instaladas para os testes.

Na raiz do repositório, execute:

```sh
node --test test/*.test.js
```

A suíte cobre receitas e links de estilos, seleção no popup, sincronização com o storage, troca de faixas, velocidade, fade, play/pause com tape stop, recarga da página, desvio do motor ao desligar, captura de aba e concorrência do documento offscreen. Os testes de Web Audio e das APIs do Chrome usam simulações.

Para ver o popup renderizado sem abrir o Chrome do dia a dia, `node tools/popup-screenshot.mjs --out /tmp/popup.png` abre um Chrome for Testing com a extensão e salva a captura; `--style`, `--variant` e `--view custom|about` escolhem o que mostrar. Em sandbox de agente, ele precisa de rede local liberada (veja `AGENTS.md`).

Para validar no Chrome, carregue a pasta como extensão sem compactação e confira estes fluxos em uma página com música:

1. Ligue um estilo, pause, retome e troque de faixa. Repita com tape stop e fade.
2. Troque entre os 15 estilos e suas variantes durante a reprodução; desligue após cada troca e confira o áudio original.
3. Ajuste a velocidade do player, ligue slowed e desligue; a velocidade anterior deve voltar.
4. Recarregue a página durante a reprodução e confirme que o estilo continua aplicado à nova mídia.
5. Em uma aba com áudio protegido, inicie a captura e encerre-a pelo indicador do Chrome. Confira se o aviso de captura some, se a aba continua audível no som original e se o popup mostra o efeito desligado. Ligue o estilo novamente, alterne estilos e desligue. Repita com duas abas e feche uma delas.
6. Copie um link de uma faixa em site que usa `#/...`, abra-o em outra aba e confira a rota e o estilo.

Áudio real, DRM, permissões, qualidade sonora e latência dependem dessa validação no navegador.
Em sites com rota no fragmento, o parâmetro `auracore` vai na query; serviços que rejeitam parâmetros extras podem exigir um formato de link próprio.
