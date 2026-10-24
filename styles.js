// Textos vêm de _locales, no idioma do Chrome. Fora da extensão não há chrome.i18n e volta a chave.
const msg = (key, substitutions) => globalThis.chrome?.i18n?.getMessage?.(key, substitutions) || key;

// orbit: trajeto do 8D (0 círculo, 1 oito, 2 livre). wobble: wow e flutter de fita. warmth: saturação.
const NEUTRAL_STYLE = { speed: 1, linkPitch: true, pitch: 0, bass: 0, muffle: 0, warmth: 0, wobble: 0, chorus: 0, vinyl: 0, rain: 0, water: 0, reverb: 0, room: 50, spin: 0, orbit: 0 };

const STYLE_LIMITS = {
  speed: [0.5, 1.5],
  pitch: [-12, 12],
  bass: [0, 15],
  muffle: [0, 100],
  warmth: [0, 100],
  wobble: [0, 100],
  chorus: [0, 100],
  vinyl: [0, 100],
  rain: [0, 100],
  water: [0, 100],
  reverb: [0, 100],
  room: [0, 100],
  spin: [0, 100],
  orbit: [0, 2],
};

const ORBIT_NAMES = [msg('orbit_circle'), msg('orbit_eight'), msg('orbit_free')];
const ORBIT_IDS = ['circle', 'eight', 'free'];
const ORBIT_PRESET_ORDER = ['circle', 'free', 'eight'];

const PRESETS = [
  { id: 'slowed', name: msg('style_slowed'), style: { speed: 0.8, reverb: 35, room: 60 } },
  { id: 'sped-up', name: msg('style_sped_up'), style: { speed: 1.2 } },
  { id: 'nightcore', name: msg('style_nightcore'), style: { speed: 1.3, bass: 3 } },
  { id: 'daycore', name: msg('style_daycore'), style: { speed: 0.75, bass: 4, muffle: 15, reverb: 25, room: 45 } },
  { id: 'vaporwave', name: msg('style_vaporwave'), style: { speed: 0.75, muffle: 20, warmth: 20, wobble: 25, chorus: 45, reverb: 50, room: 85 } },
  // No 8D o que muda o som é o trajeto, não a força: as variantes escolhem o método.
  { id: '8d', name: msg('style_8d'), style: { spin: 45, orbit: 2, reverb: 25 }, variants: ORBIT_PRESET_ORDER.map((id) => {
    const orbit = ORBIT_IDS.indexOf(id);
    return { id, name: ORBIT_NAMES[orbit], changes: { orbit } };
  }) },
  { id: 'bass', name: msg('style_bass'), style: { bass: 12 } },
  { id: 'lofi', name: msg('style_lofi'), style: { speed: 0.9, bass: 3, muffle: 45, warmth: 50, wobble: 55, vinyl: 10, reverb: 20, room: 35 } },
  { id: 'party-bathroom', name: msg('style_party_bathroom'), style: { bass: 6, muffle: 88, reverb: 30, room: 0 } },
  { id: 'sunday-night', name: msg('style_sunday_night'), style: { speed: 0.9, bass: 2, muffle: 55, reverb: 78, room: 95 } },
  { id: 'underwater', name: msg('style_underwater'), style: { muffle: 75, reverb: 30, room: 50, wobble: 8, water: 68 } },
  { id: 'empty-arena', name: msg('style_empty_arena'), style: { reverb: 55, room: 80, bass: 3 } },
  { id: 'rainy', name: msg('style_rainy'), style: { bass: 3, rain: 72, reverb: 8, room: 18 } },
  { id: 'ethereal', name: msg('style_ethereal'), style: { reverb: 65, room: 90, warmth: 10 } },
  { id: 'phonk', name: msg('style_phonk'), style: { speed: 1.05, bass: 13, warmth: 60 } },
].map((preset) => ({ ...preset, style: { ...NEUTRAL_STYLE, ...preset.style } }));

// Intensidade de um estilo pronto: afasta ou aproxima cada parâmetro do neutro na mesma proporção.
// O trajeto do 8D e o "tom acompanha" não têm meio-termo e ficam como estão.
const INTENSITIES = [
  { id: 'soft', name: msg('intensity_soft'), factor: 0.6 },
  { id: 'normal', name: msg('intensity_normal'), factor: 1 },
  { id: 'strong', name: msg('intensity_strong'), factor: 1.4 },
];

function scaleStyle(style, intensityId) {
  const { factor } = INTENSITIES.find((intensity) => intensity.id === intensityId) ?? INTENSITIES[1];
  const scaled = { ...style };
  for (const [key, [min, max]] of Object.entries(STYLE_LIMITS)) {
    if (key === 'orbit') continue;
    const value = NEUTRAL_STYLE[key] + (style[key] - NEUTRAL_STYLE[key]) * factor;
    const rounded = key === 'speed' ? Math.round(value * 100) / 100 : Math.round(value);
    scaled[key] = Math.min(max, Math.max(min, rounded));
  }
  return scaled;
}

// Variantes de um estilo pronto: as intensidades, ou as do próprio estilo quando ele define outras
// (o 8D escolhe o trajeto em vez da força). A padrão é a que reproduz o estilo como definido.
function presetVariants(preset) {
  if (!preset.variants) return INTENSITIES.map(({ id, name }) => ({ id, name, style: scaleStyle(preset.style, id), standard: id === 'normal' }));
  return preset.variants.map(({ id, name, changes }) => ({
    id,
    name,
    style: { ...preset.style, ...changes },
    standard: Object.keys(changes).every((key) => changes[key] === preset.style[key]),
  }));
}

const SHARE_KEY = 'auracore';
// Cabe o nome mais longo de estilo pronto com variante ("banheiro da balada · intenso").
const NAME_MAX = 40;

// O estilo viaja no fragmento (#auracore=...) do próprio link da música: o fragmento não vai ao
// servidor, e quem abre sem a extensão só ouve a música original.
function encodeStyle(style, name) {
  const params = new URLSearchParams();
  for (const key of Object.keys(STYLE_LIMITS)) {
    if (style[key] !== NEUTRAL_STYLE[key]) params.set(key, style[key]);
  }
  if (!style.linkPitch) params.set('linkPitch', '0');
  if (name) params.set('n', name.slice(0, NAME_MAX));
  return params.toString();
}

function decodeStyle(code) {
  const params = new URLSearchParams(code);
  const style = { ...NEUTRAL_STYLE, linkPitch: params.get('linkPitch') !== '0' };
  for (const [key, [min, max]] of Object.entries(STYLE_LIMITS)) {
    const value = Number(params.get(key));
    if (params.has(key) && Number.isFinite(value)) style[key] = Math.min(max, Math.max(min, value));
  }
  style.orbit = Math.round(style.orbit);
  return { style, name: (params.get('n') ?? '').slice(0, NAME_MAX) };
}
