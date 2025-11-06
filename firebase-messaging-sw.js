// Enhanced Firebase Messaging Service Worker
importScripts("https://www.gstatic.com/firebasejs/11.0.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.0.1/firebase-messaging-compat.js");

// Enhanced Firebase initialization with error handling
try {
  firebase.initializeApp({
    apiKey: "AIzaSyArChDRFsV9V-PmpDdhYxB3FnqN69RVnAI",
    authDomain: "shukku-list.firebaseapp.com",
    projectId: "shukku-list",
    storageBucket: "shukku-list.appspot.com",
    messagingSenderId: "11625002783",
    appId: "1:11625002783:web:8776c517ff9bc4d266222a",
    measurementId: "G-7SW8GVLQ90"
  });

  const messaging = firebase.messaging();

  // Enhanced background message handler
  messaging.onBackgroundMessage(function(payload) {
    console.log('[firebase-messaging-sw.js] Received background message:', payload);
    
    const notificationTitle = payload.notification?.title || 'Shukku Family List';
    const notificationOptions = {
      body: payload.notification?.body || 'Your family shopping list was updated',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      image: payload.notification?.image || null,
      tag: 'shukku-family-notification',
      renotify: true,
      requireInteraction: false,
      data: payload.data || {},
      actions: [
        {
          action: 'open',
          title: '📝 Open Family List'
        },
        {
          action: 'dismiss',
          title: '❌ Dismiss'
        }
      ]
    };

    // Enhanced notification display with fallbacks
    self.registration.showNotification(notificationTitle, notificationOptions)
      .then(() => {
        console.log('Family notification shown successfully');
      })
      .catch(error => {
        console.error('Failed to show family notification:', error);
        
        // Fallback: Try without actions if they caused the error
        if (error.message.includes('actions')) {
          delete notificationOptions.actions;
          self.registration.showNotification(notificationTitle, notificationOptions)
            .catch(console.error);
        }
      });
  });

  console.log('Firebase Messaging Service Worker initialized successfully');

} catch (error) {
  console.error('Firebase Messaging Service Worker initialization failed:', error);
}

// Enhanced notification click handler
self.addEventListener('notificationclick', function(event) {
  console.log('Family notification clicked:', event.notification.tag);
  
  event.notification.close();

  const action = event.action;
  const notificationData = event.notification.data || {};

  // Handle different actions
  if (action === 'open' || action === '') {
    // Open the app and focus on relevant content
    event.waitUntil(
      self.clients.matchAll({ 
        type: 'window', 
        includeUncontrolled: true 
      }).then(function(clientList) {
        
        // Look for existing app window
        for (const client of clientList) {
          if (client.url.includes(self.location.origin)) {
            // Focus existing window and navigate to main app
            client.focus();
            client.postMessage({
              type: 'FAMILY_NOTIFICATION_CLICK',
              data: notificationData
            });
            return;
          }
        }
        
        // No existing window, open new one
        if (self.clients.openWindow) {
          return self.clients.openWindow('/');
        }
      })
    );
  } else if (action === 'dismiss') {
    // Notification was dismissed, no action needed
    console.log('Family notification dismissed by user');
  }
});

// Enhanced notification close handler
self.addEventListener('notificationclose', function(event) {
  console.log('Family notification closed:', event.notification.tag);
});

// Handle messages from the main app
self.addEventListener('message', function(event) {
  console.log('Service Worker received message:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Enhanced error handling for service worker
self.addEventListener('error', function(event) {
  console.error('Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', function(event) {
  console.error('Service Worker unhandled rejection:', event.reason);
});