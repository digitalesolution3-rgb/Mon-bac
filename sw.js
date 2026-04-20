/* ============================================================
   PhysiQ BF — Service Worker v1.0
   PWA - Terminale D Burkina Faso
   Stratégie : Cache First avec Network Fallback
   ============================================================ */

const CACHE_NAME = 'physiq-bf-v1.0.0';
const OFFLINE_URL = '/offline.html';

// Ressources à mettre en cache immédiatement à l'installation
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  // CSS et polices externes
  'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap',
  // Scripts Firebase (pour le mode hors-ligne)
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions-compat.js'
];

// Ressources à mettre en cache dynamiquement (API, images YouTube)
const DYNAMIC_CACHE = 'physiq-bf-dynamic-v1';
const YT_THUMB_CACHE = 'physiq-bf-youtube-thumbs-v1';

/* ============================================================
   INSTALLATION
   ============================================================ */
self.addEventListener('install', (event) => {
  console.log('[SW] Installation en cours...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Mise en cache des ressources statiques');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Skip waiting');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Erreur lors de l\'installation:', error);
      })
  );
});

/* ============================================================
   ACTIVATION (Nettoyage des anciens caches)
   ============================================================ */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation...');
  
  const cacheWhitelist = [CACHE_NAME, DYNAMIC_CACHE, YT_THUMB_CACHE];
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!cacheWhitelist.includes(cacheName)) {
            console.log('[SW] Suppression de l\'ancien cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] Claim clients');
      return self.clients.claim();
    })
  );
});

/* ============================================================
   FETCH - Stratégie de cache
   ============================================================ */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Ignorer les requêtes non GET
  if (event.request.method !== 'GET') return;
  
  // Ignorer les requêtes vers Firebase Functions (API IA) - toujours Network First
  if (url.pathname.includes('/askDeepSeek')) {
    return; // Laisser passer, ne pas mettre en cache les réponses IA
  }
  
  // Ignorer les requêtes Firestore (données en temps réel)
  if (url.hostname.includes('firestore.googleapis.com')) {
    return;
  }

  // Stratégie pour les miniatures YouTube
  if (url.hostname.includes('img.youtube.com') || url.hostname.includes('i.ytimg.com')) {
    event.respondWith(cacheYouTubeThumb(event.request));
    return;
  }

  // Stratégie pour les polices Google Fonts
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Stratégie par défaut : Cache First avec Network Fallback
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // Retourner le cache si disponible
        if (cachedResponse) {
          // Mise à jour du cache en arrière-plan (Stale-While-Revalidate)
          fetchAndCache(event.request, DYNAMIC_CACHE);
          return cachedResponse;
        }
        
        // Sinon, aller chercher sur le réseau
        return fetch(event.request)
          .then((networkResponse) => {
            // Mettre en cache la réponse pour plus tard
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(DYNAMIC_CACHE).then((cache) => {
                cache.put(event.request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // Si réseau échoue et que c'est une page HTML, retourner la page offline
            if (event.request.headers.get('accept')?.includes('text/html')) {
              return caches.match(OFFLINE_URL);
            }
            // Sinon, retourner une erreur silencieuse
            return new Response('', { status: 408, statusText: 'Offline' });
          });
      })
  );
});

/* ============================================================
   Fonctions helper
   ============================================================ */
function fetchAndCache(request, cacheName) {
  fetch(request).then((response) => {
    if (response && response.status === 200) {
      caches.open(cacheName).then((cache) => {
        cache.put(request, response.clone());
      });
    }
  }).catch(() => {});
}

function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    return cached || fetch(request).then((response) => {
      if (response && response.status === 200) {
        caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    });
  });
}

function cacheYouTubeThumb(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    
    return fetch(request).then((response) => {
      if (response && response.status === 200) {
        caches.open(YT_THUMB_CACHE).then((cache) => {
          cache.put(request, response.clone());
        });
      }
      return response;
    }).catch(() => {
      // Retourner une image placeholder si hors-ligne
      return new Response(
        '<svg width="295" height="165" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0d1422"/><text x="50%" y="50%" font-family="Arial" font-size="14" fill="#6b7a99" text-anchor="middle">📺 Vidéo hors-ligne</text></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    });
  });
}

/* ============================================================
   Gestion des messages (pour forcer la mise à jour)
   ============================================================ */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      }).then(() => {
        console.log('[SW] Tous les caches ont été supprimés');
      })
    );
  }
});

/* ============================================================
   Notification Push (Optionnel - pour futures fonctionnalités)
   ============================================================ */
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  
  const options = {
    body: data.body || 'Nouveau contenu disponible sur PhysiQ BF',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/'
    },
    actions: [
      {
        action: 'open',
        title: '📖 Voir maintenant'
      },
      {
        action: 'close',
        title: '❌ Fermer'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(
      data.title || 'PhysiQ BF - Terminale D',
      options
    )
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    const urlToOpen = event.notification.data?.url || '/';
    
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        // Si un onglet est déjà ouvert, le focus
        for (const client of clientList) {
          if (client.url.includes(urlToOpen) && 'focus' in client) {
            return client.focus();
          }
        }
        // Sinon, ouvrir un nouvel onglet
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
    );
  }
});

console.log('[SW] Service Worker chargé et prêt !');