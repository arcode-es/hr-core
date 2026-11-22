// Aplica el tema antes de pintar para evitar el destello claro/oscuro.
// Va en un archivo aparte: la política de seguridad no admite scripts en línea.
try {
  var m = localStorage.getItem('hr.theme');
  var d = matchMedia('(prefers-color-scheme: dark)').matches;
  // Sin preferencia guardada, el tema es el oscuro del sistema de diseño; «system» sigue al dispositivo.
  document.documentElement.dataset.theme = m === 'light' || m === 'dark' || m === 'contrast' ? m : m === 'system' ? (d ? 'dark' : 'light') : 'dark';
} catch (e) {}
