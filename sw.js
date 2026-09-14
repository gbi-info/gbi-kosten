/* Offline-Betrieb: App-Dateien werden beim ersten Aufruf zwischengespeichert und
   danach sofort aus dem Cache geladen; im Hintergrund wird eine neuere Fassung
   geholt (stale-while-revalidate). Bei jeder Veroeffentlichung CACHE erhoehen.

   Mit Anmeldung (Azure Static Web Apps): Der App-Start geht zuerst ans Netz, damit
   bei abgelaufener Sitzung die Microsoft-Anmeldung erscheint; ohne Netz oder bei
   langsamer Verbindung startet die App aus dem Cache. Umleitungen zur Anmeldung
   werden nie zwischengespeichert, /.auth/ bleibt unberuehrt. */
const CACHE = 'gbi-kosten-iphone-v11';
const NAV_TIMEOUT_MS = 4000;
/* Der Firmenstempel gehoert nicht zur Web-App; er wird auf jedem iPhone importiert. */
const ASSETS = [
  './', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'assets/logo-gbi.png', 'assets/logo-ibbi.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheable(res) {
  return res && res.ok && res.type === 'basic' && !res.redirected;
}

function store(req, res) {
  if (cacheable(res)) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/.auth/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
      const fromNet = fetch(req).then(res => store(req, res));
      if (!hit) return fromNet;
      const timeout = new Promise(resolve => setTimeout(() => resolve(hit), NAV_TIMEOUT_MS));
      return Promise.race([fromNet.catch(() => hit), timeout]);
    }));
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const fromNet = fetch(req).then(res => store(req, res)).catch(() => hit);
      return hit || fromNet;
    })
  );
});
