(function () {
  let saved = '';
  try {
    saved = localStorage.getItem('speedo-api-base') || '';
  } catch (err) {}
  const fromUrl = (new URLSearchParams(location.search).get('api') || '').replace(/\/$/, '');
  if (fromUrl) {
    try {
      localStorage.setItem('speedo-api-base', fromUrl);
    } catch (err) {}
  }
  window.SPEEDO_API_BASE = fromUrl || saved;
})();
