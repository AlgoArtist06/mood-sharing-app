const CACHE_NAME = 'mood-app-v1';
const urlsToCache = [
  '/',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        console.error('Failed to cache resources:', error);
      })
  );
  
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  
  // Ensure the service worker takes control immediately
  self.clients.claim();
});

// Fetch event - serve from cache when offline (Cache First strategy)
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip external requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        
        // Clone the request because it's a stream
        const fetchRequest = event.request.clone();
        
        return fetch(fetchRequest).then((response) => {
          // Check if valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          // Clone the response because it's a stream
          const responseToCache = response.clone();
          
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });
          
          return response;
        });
      })
      .catch(() => {
        // Return offline fallback for HTML requests
        if (event.request.destination === 'document') {
          return caches.match('/');
        }
      })
  );
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
  console.log('Push notification received:', event);
  
  let notificationData = {
    title: 'Mood Tracker',
    body: 'Time to update your mood!',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    tag: 'mood-update',
    data: {
      url: '/'
    }
  };

  // Parse the push payload if available
  if (event.data) {
    try {
      const payload = event.data.json();
      notificationData = { ...notificationData, ...payload };
    } catch (error) {
      console.error('Error parsing push payload:', error);
      notificationData.body = event.data.text() || notificationData.body;
    }
  }

  // Show the notification
  event.waitUntil(
    self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      tag: notificationData.tag,
      data: notificationData.data,
      actions: [
        {
          action: 'view',
          title: 'View App'
        },
        {
          action: 'close',
          title: 'Dismiss'
        }
      ],
      requireInteraction: false,
      silent: false,
      vibrate: [200, 100, 200],
      timestamp: Date.now()
    })
  );
});

// Notification click event - handle user interaction with notifications
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event);
  
  const notification = event.notification;
  const action = event.action;
  const data = notification.data || {};

  // Close the notification
  notification.close();

  if (action === 'close') {
    return;
  }

  // Handle the click action
  event.waitUntil(
    clients.matchAll({ 
      type: 'window',
      includeUncontrolled: true 
    }).then((clientList) => {
      const url = data.url || '/';
      const targetUrl = new URL(url, self.location.origin).href;
      
      // Check if there's already a window/tab open with the target URL
      for (let client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      
      // If no existing window/tab, open a new one
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    }).catch((error) => {
      console.error('Error handling notification click:', error);
    })
  );
});

// Notification close event - handle when user dismisses notification
self.addEventListener('notificationclose', (event) => {
  console.log('Notification closed:', event.notification.tag);
});

// Background sync event - handle background sync
self.addEventListener('sync', (event) => {
  console.log('Background sync triggered:', event.tag);
  
  if (event.tag === 'mood-sync') {
    event.waitUntil(syncMoodData());
  }
});

// Sync mood data function
async function syncMoodData() {
  try {
    console.log('Syncing mood data in background...');
    // Add your sync logic here
  } catch (error) {
    console.error('Error syncing mood data:', error);
  }
}

// Message event - handle messages from main thread
self.addEventListener('message', (event) => {
  console.log('Service Worker received message:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  // Send response back to main thread if ports are available
  if (event.ports && event.ports[0]) {
    event.ports[0].postMessage({
      type: 'SW_RESPONSE',
      message: 'Service Worker received your message'
    });
  }
});

// Error handling
self.addEventListener('error', (error) => {
  console.error('Service Worker error:', error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker unhandled promise rejection:', event.reason);
});