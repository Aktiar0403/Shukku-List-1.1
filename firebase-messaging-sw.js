// firebase-messaging-sw.js (place at project public root)
importScripts('https://www.gstatic.com/firebasejs/11.0.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.1/firebase-messaging-compat.js');

// Provide your firebaseConfig here (same as client)
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "shukku-list",
  storageBucket: "shukku-list.appspot.com",
  messagingSenderId: "11625002783",
  appId: "1:11625002783:web:8776c517ff9bc4d266222a",
  measurementId: "G-7SW8GVLQ90"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  const notification = payload.notification || {};
  const title = notification.title || 'Shukku List';
  const options = {
    body: notification.body || '',
    icon: '/icons/icon-192.png'
  };
  self.registration.showNotification(title, options);
});
