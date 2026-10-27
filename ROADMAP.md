# Roadmap

Direção: ser o lugar onde se ouve qualquer música no estilo dos remixes da internet, com a qualidade desses remixes, em qualquer serviço de streaming no navegador, e compartilhar esse estilo por link.

## Implementado (v0.9.0)

- 15 estilos prontos com cena animada e paleta própria; editor e estilos salvos.
- Velocidade com tom junto (o "slowed" clássico) em qualquer mídia, inclusive players fora do DOM.
- Motor de efeitos no mundo da página; captura de aba para sites com DRM, validada no Spotify.
- 8D binaural com trajetos círculo, oito e livre.
- Fade entre músicas e tape stop.
- Ambientes de chuva e água gerados por IA, nivelados por loudness e emendados sem estalo.
- Interface em inglês, espanhol e português do Brasil.
- Painel de apoio com Ko-fi e Pix.
- Aplicação de estilo recebido por link (`?auracore=`); o popup não gera esses links.

## Fidelidade dos estilos

Variantes por estilo: suave, padrão e intenso; no 8D, o trajeto (círculo, oito, livre).

Receitas de referência; os testes automatizados da suíte usam simulações de Web Audio. A qualidade final depende de escuta no navegador:

| Estilo | Receita aplicada |
|---|---|
| lo-fi | 90% com tom junto, passa-baixa, saturação leve, fita com wow e flutter, vinil discreto que silencia na pausa, reverb curto |
| vaporwave | 75%, chorus, fita, saturação, reverb grande |
| bass boosted | +12 dB em 150 Hz com limitador e clipper suave no fim da cadeia (pico máximo 1,0) |
| banheiro da balada | passa-baixa forte e sala de 0,8 s |
| slowed + reverb | 80%, a velocidade mais comum nas receitas |
| daycore | 75% com reverb |
| nightcore, 8D, sped up | sem mudança |
| domingo à noite | criação própria: o termo é de conteúdo nostálgico no TikTok BR, sem receita de áudio estabelecida |

## Verificação funcional

- Suíte de regressão sem dependências para estilos, popup, página, captura e motor de áudio; execução e limites em `TESTING.md`.
- Velocidade e configuração de tom anteriores do player restauradas ao desligar.
- Início e fim de capturas serializados para evitar disputa pelo documento offscreen.
- Encerramento da captura pelo indicador do Chrome sincroniza o estado da página e libera o documento offscreen quando não há outra captura.
- Link compartilhado preserva a rota de sites que usam o fragmento `#`, com o estilo na query.

## Depois

- Efeitos novos: eco, estéreo largo, rádio.
- Página de convite para quem abre um link compartilhado sem a extensão (GitHub Pages).
- Estudar concessão por site sem perder a detecção de mídia fora do DOM criada antes do popup e a aplicação automática de links compartilhados. `activeTab` sozinho não preserva esses fluxos.
- Testes de DSP offline e integração no navegador via CDP.
- Verificar a marca "auracore" no INPI e no TMview antes do lançamento.

## Fora de escopo

- Exportar ou baixar o áudio alterado (direitos autorais).
- Napster: encerrou o streaming de música em janeiro de 2026.
