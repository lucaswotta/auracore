# auracore

Extensión para Chrome que reproduce el audio de cualquier pestaña en los estilos de remix de internet, como slowed + reverb, nightcore, 8D y lo-fi, en vivo mientras escuchas.

[English](README.md) · [Português](README.pt-BR.md)

<p align="center">
  <img src="docs/readme-character.webp" alt="arabot, el personaje de auracore, sosteniendo el logo" width="260">
  <img src="docs/popup-es.webp" alt="Popup de auracore con el estilo lo-fi activo" width="300">
</p>

## Requisitos

- Chrome 116 o superior, o Firefox 128 o superior. Otros navegadores no se han probado.
- Node.js 22 o superior, solo para ejecutar las pruebas.

## Instalación

auracore todavía no está en la Chrome Web Store. Para instalarlo desde este repositorio:

1. Descarga o clona el repositorio.
2. Abre `chrome://extensions` y activa el Modo de desarrollador.
3. Haz clic en Cargar descomprimida y selecciona la carpeta del repositorio.

En Firefox, mientras auracore no esté en addons.mozilla.org: ejecuta `npm run package`, abre `about:debugging#/runtime/this-firefox`, haz clic en Cargar complemento temporal y elige `dist/auracore-firefox.zip`. Firefox quita los complementos temporales al cerrarse.

## Uso

1. Reproduce música en una pestaña: YouTube, YouTube Music, Spotify, Deezer, SoundCloud y otros reproductores.
2. Haz clic en el icono de auracore y elige un estilo. Al hacer clic de nuevo en el estilo activo, se apaga.
3. El control debajo de los estilos hace el efecto más suave o más intenso. En 8D elige la trayectoria: círculo, libre u ocho.
4. Personalizado abre todos los controles (velocidad, graves, tono, reverb, 8D, lluvia, agua y más) y permite guardar tus propios estilos.

Estilos: slowed + reverb, sped up, nightcore, daycore, vaporwave, 8D, bass boosted, lo-fi, baño de la fiesta, domingo por la noche, bajo el agua, estadio vacío, bajo la lluvia, etéreo y phonk.

auracore funciona en una pestaña a la vez. Abrir el popup en otra pestaña y elegir un estilo lleva el efecto allí; las demás pestañas mantienen su sonido original. La interfaz sigue el idioma de Chrome: español, inglés o portugués de Brasil.

## Configuración

El estilo, la intensidad, el fade, el tape stop y los estilos guardados se almacenan en `chrome.storage.local`; la pestaña activa se guarda en `chrome.storage.session`. El audio se procesa en tu dispositivo y nunca se graba ni se envía a ningún lado. Los detalles están en la [política de privacidad](PRIVACY.md#español).

## Limitaciones

- En servicios con reproducción protegida, como Spotify y Amazon Music, los efectos pasan por la captura de pestaña de Chrome, que muestra un indicador de captura mientras el efecto está activo. Detener la captura desde ese indicador apaga auracore en esa pestaña.
- auracore se ejecuta en todos los sitios para encontrar reproductores que empiezan antes de abrir el popup. Puedes limitar el acceso por sitio en `chrome://extensions` → auracore → Detalles.
- Firefox no tiene captura de pestaña, así que en los servicios con reproducción protegida solo cambian la velocidad y el tono; los demás efectos necesitan Chrome.
- Safari no es compatible.

## Desarrollo

`npm test` ejecuta las pruebas, sin dependencias que instalar. `npm run package` genera `dist/auracore.zip`. La documentación para desarrollo está en portugués: [ARCHITECTURE.md](ARCHITECTURE.md), [TESTING.md](TESTING.md) y [ROADMAP.md](ROADMAP.md).

## Apoyo

auracore es gratuito. Si ya acompaña tu música, puedes invitarme un cafecito en [GitHub Sponsors](https://github.com/sponsors/lucaswotta). Recomendarlo a un amigo o dejar una estrella en el repositorio también ayuda mucho.

## Licencia y créditos

El código es visible, pero todos los derechos están reservados: puedes leerlo e instalar auracore para uso personal, no redistribuirlo. Consulta la [LICENSE](LICENSE), en inglés.

El arte de arabot y los sonidos de ambiente fueron generados con IA y editados por mí. Las fuentes están bajo la SIL Open Font License, en `fonts/licenses/`.
