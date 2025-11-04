# Shukku List - Shared Shopping (Pair-only)
This is a Firebase-backed web app for two partners (pair-only) to share a shopping list, send notifications, and share product wishlist links from marketplaces (Amazon/Flipkart/Meesho).

## Features
- Email/password signup & login
- Invite code flow: one pair per list (owner creates list, partner joins with code)
- Shared realtime Firestore list with items (name, qty, addedBy, done, url preview optional)
- Push notifications (browser Notification API) when partner adds/completes items
- Wishlist integration: paste product URL, app attempts to fetch Open Graph metadata (uses an open CORS proxy; may require a server-side proxy in production)
- PWA: manifest + service worker for offline caching of app shell

## Setup
1. Create a Firebase project and enable:
   - Authentication -> Email/Password
   - Firestore Database (in test mode during development)
2. Replace firebase keys in `firebase-config.js` if different.
3. Deploy static files to Firebase Hosting or any static server.

## Notes & Production
- Tailwind CDN is used for quick prototyping. For production, build Tailwind with PostCSS or Tailwind CLI.
- Wishlist metadata fetch depends on CORS proxies. For reliable metadata fetching, use a serverless function (Cloud Function) to fetch and return OG tags.
- Firestore security rules should be configured so only UIDs in `lists/{listId}.users` may read/write that document.
