const CACHE_NAME = "shukku-family-v2";
const API_CACHE_NAME = "shukku-api-v1";
const urlsToCache = [
  "/",
  "/index.html",
  "/login.html",
  "/style.css",
  "/app.js",
  "/auth.js", 
  "/firebase-config.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

const apiUrlsToCache = [
  '/api/fetchMetadata'
];

// Enhanced install event
self.addEventListener("install", (event) => {
  console.log('Service Worker installing...');
  
  event.waitUntil(
    Promise.all([
      // Cache core app files
      caches.open(CACHE_NAME).then((cache) => {
        console.log('Caching app shell');
        return cache.addAll(urlsToCache);
      }),
      // Cache API responses separately
      caches.open(API_CACHE_NAME).then((cache) => {
        console.log('Caching API routes');
        return cache.addAll(apiUrlsToCache);
      }),
      // Skip waiting to activate immediately
      self.skipWaiting()
    ]).catch(error => {
      console.error('Cache installation failed:', error);
    })
  );
});

// Enhanced activate event
self.addEventListener("activate", (event) => {
  console.log('Service Worker activating...');
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Take control of all clients
      self.clients.claim()
    ])
  );
});

// Enhanced fetch event with sophisticated caching strategy
self.addEventListener("fetch", (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Handle API requests with network-first strategy
  if (event.request.url.includes('/api/')) {
    event.respondWith(handleApiRequest(event.request));
    return;
  }

  // Handle static assets with cache-first strategy
  if (isStaticAsset(event.request)) {
    event.respondWith(handleStaticRequest(event.request));
    return;
  }

  // For HTML pages, use network-first strategy
  if (event.request.destination === 'document') {
    event.respondWith(handleHtmlRequest(event.request));
    return;
  }
});

// API request handler - Network First
async function handleApiRequest(request) {
  const cache = await caches.open(API_CACHE_NAME);
  
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    // If successful, cache the response
    if (networkResponse.status === 200) {
      const responseClone = networkResponse.clone();
      cache.put(request, responseClone).catch(console.warn);
    }
    
    return networkResponse;
  } catch (error) {
    // Network failed, try cache
    console.log('Network failed for API, trying cache:', request.url);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // If no cache, return offline page for metadata requests
    if (request.url.includes('/api/fetchMetadata')) {
      return new Response(JSON.stringify({ 
        error: 'Offline - Cannot fetch metadata' 
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // For other APIs, return error
    return new Response('Network error', { 
      status: 408, 
      statusText: 'Network Unavailable' 
    });
  }
}

// Static asset handler - Cache First
async function handleStaticRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    // Return cached version but update cache in background
    updateCacheInBackground(request, cache);
    return cachedResponse;
  }
  
  // Not in cache, try network
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.status === 200) {
      cache.put(request, networkResponse.clone()).catch(console.warn);
    }
    
    return networkResponse;
  } catch (error) {
    // Network failed and not in cache
    if (request.destination === 'image') {
      // Return a placeholder image for missing images
      return new Response(
        '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#f3f4f6"/></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    }
    
    throw error;
  }
}

// HTML page handler - Network First
async function handleHtmlRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    // Try network first for HTML to ensure freshness
    const networkResponse = await fetch(request);
    
    if (networkResponse.status === 200) {
      // Cache the updated version
      cache.put(request, networkResponse.clone()).catch(console.warn);
    }
    
    return networkResponse;
  } catch (error) {
    // Network failed, try cache
    console.log('Network failed for HTML, trying cache');
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // If no cache available, return offline page
    return caches.match('/index.html');
  }
}

// Background cache updates
async function updateCacheInBackground(request, cache) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.status === 200) {
      cache.put(request, networkResponse);
    }
  } catch (error) {
    // Silent fail - we have the cached version
  }
}

// Helper to identify static assets
function isStaticAsset(request) {
  return request.destination === 'style' || 
         request.destination === 'script' ||
         request.destination === 'image' ||
         request.url.includes('/icons/') ||
         request.url.includes('/manifest.json');
}

// Enhanced background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('Background sync:', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // This would sync any pending actions when back online
  console.log('Performing background sync');
}

// Handle push notifications (if not using Firebase SW)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'Shukku List', body: event.data.text() };
  }

  const options = {
    body: data.body || 'Your family shopping list was updated',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'shukku-notification',
    renotify: true,
    actions: [
      {
        action: 'open',
        title: 'Open App'
      },
      {
        action: 'dismiss', 
        title: 'Dismiss'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Shukku List', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'open') {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        // Focus existing app window or open new one
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }
});