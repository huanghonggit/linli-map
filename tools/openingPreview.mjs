// This runs in the HTML before the application bundle, only on a preset link.
export function startMapPreview(presets) {
  const query = new URLSearchParams(location.search);
  if (query.get('map') !== 'ruiheyuan') return;
  const requested = query.get('radius');
  const radius = ['5', '8', '10'].includes(requested) ? requested : '5';
  const preset = presets['ruiheyuan-' + radius];
  window.linliOpening = { radius, preview: preset.preview };
  const image = document.createElement('link');
  image.rel = 'preload';
  image.as = 'image';
  image.href = preset.preview;
  image.fetchPriority = 'high';
  document.head.append(image);
}
