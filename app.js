/* app.js
  - Requires firebase-config.js (exports app, auth, db)
  - Uses modular Firebase SDK via CDN imports (or your bundler)
  - Stores FCM tokens per-user (collection: users/{uid}.tokens array)
  - Calls /api/fetchMetadata for OG previews
  - Calls /api/sendNotification on add/complete to notify partner
*/

/* ---------- Imports ---------- */
import { app, auth, db } from './firebase-config.js';

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import {
  getMessaging,
  getToken,
  onMessage
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-messaging.js";

/* ---------- Config ---------- */
// Fill your VAPID key (get it from Firebase Console > Cloud Messaging)
const VAPID_KEY = "YOUR_PUBLIC_VAPID_KEY_HERE";

/* ---------- DOM Elements (adjust selectors to your HTML) ---------- */
const inputEl = document.getElementById('itemInput');
const qtyEl = document.getElementById('qtyInput');
const addBtn = document.getElementById('addBtn');
const listContainer = document.getElementById('listContainer');
const inviteBtn = document.getElementById('inviteBtn');
const inviteModal = document.getElementById('inviteModal');
const inviteCodeEl = document.getElementById('inviteCode');
const copyInviteBtn = document.getElementById('copyInvite');
const closeInviteBtn = document.getElementById('closeInvite');
const logoutBtn = document.getElementById('logoutBtn');
const clearDoneBtn = document.getElementById('clearDone');
const partnerBadge = document.getElementById('partnerBadge');

/* ---------- Helper utils ---------- */
function uidToPairId(uid) {
  // using owner's uid as pair id (simple deterministic approach)
  return uid;
}

async function fetchProductPreview(url) {
  try {
    const res = await fetch(`/api/fetchMetadata?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("Preview fetch failed:", e);
    return null;
  }
}

/* ---------- FCM: register token and store in Firestore ---------- */
async function registerFCMToken(uid) {
  try {
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) return null;
    // store token in users/{uid} -> tokens array
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, { tokens: [token], createdAt: Date.now() });
    } else {
      await updateDoc(userRef, { tokens: arrayUnion(token) });
    }
    return token;
  } catch (e) {
    console.warn("FCM token registration failed:", e);
    return null;
  }
}

/* ---------- Call server to send notification ---------- */
async function triggerSendNotification(pairId, payload) {
  // payload: { title, body, excludeUid (optional) }
  try {
    await fetch('/api/sendNotification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairId, payload })
    });
  } catch (e) {
    console.warn('sendNotification failed', e);
  }
}

/* ---------- Firestore list flow ---------- */
let currentUid = null;
let currentPairId = null;

async function ensurePairDocExists(pairId, uid) {
  const pairRef = doc(db, 'pairs', pairId);
  const snap = await getDoc(pairRef);
  if (!snap.exists()) {
    await setDoc(pairRef, {
      users: [uid],
      items: [],
      inviteCode: (Math.floor(100000 + Math.random()*900000)).toString(),
      createdAt: Date.now()
    });
  }
}

/* Render function for list items (items stored as array in document) */
function renderListItems(items) {
  listContainer.innerHTML = '';
  items.forEach((it, idx) => {
    const li = document.createElement('li');
    li.className = 'p-3 bg-white rounded shadow flex justify-between items-center';

    const leftHtml = [];
    if (it.image) {
      leftHtml.push(`<img src="${it.image}" class="w-12 h-12 rounded mr-3" alt="img">`);
    }
    leftHtml.push(`<div>
      ${it.link ? `<a href="${it.link}" target="_blank" class="font-semibold text-blue-600">${it.name}</a>` : `<div class="font-semibold">${it.name}</div>`}
      <div class="text-xs text-gray-500">Qty: ${it.qty || 1} • ${it.addedBy || ''}</div>
    </div>`);

    li.innerHTML = `
      <div class="flex items-center">${leftHtml.join('')}</div>
      <div class="flex items-center space-x-2">
        <button class="toggle-done text-sm" data-idx="${idx}">${it.done ? '✅' : '🛒'}</button>
        <button class="delete-item text-red-500 text-sm" data-idx="${idx}">✕</button>
      </div>
    `;
    listContainer.appendChild(li);
  });

  // Attach listeners
  listContainer.querySelectorAll('.toggle-done').forEach(btn => {
    btn.onclick = async (e) => {
      const idx = +e.target.dataset.idx;
      await toggleDone(idx);
    };
  });
  listContainer.querySelectorAll('.delete-item').forEach(btn => {
    btn.onclick = async (e) => {
      const idx = +e.target.dataset.idx;
      await deleteItem(idx);
    };
  });
}

/* ---------- Firestore CRUD helpers (storing items as array inside pairs/{pairId}) ---------- */
async function addItem(rawText, qty = 1) {
  if (!currentPairId || !currentUid) return;
  let item = { name: rawText, qty, addedBy: currentUid, done: false, createdAt: Date.now() };

  // If URL, fetch preview
  try {
    const parsed = new URL(rawText);
    const meta = await fetchProductPreview(parsed.href);
    if (meta) {
      item.name = meta.title || item.name;
      if (meta.image) item.image = meta.image;
      item.link = meta.url || parsed.href;
      if (meta.price) item.price = meta.price;
      item.site = meta.site;
    } else {
      item.link = parsed.href;
    }
  } catch (e) {
    // not a URL
  }

  const pairRef = doc(db, 'pairs', currentPairId);
  const snap = await getDoc(pairRef);
  const data = snap.exists() ? snap.data() : { items: [] };
  const items = data.items || [];
  items.push(item);
  await updateDoc(pairRef, { items });

  // notify partner(s)
  await triggerSendNotification(currentPairId, {
    title: 'Item added',
    body: `${item.name} added to list`,
    excludeUid: currentUid
  });
}

async function toggleDone(index) {
  const pairRef = doc(db, 'pairs', currentPairId);
  const snap = await getDoc(pairRef);
  if (!snap.exists()) return;
  const items = snap.data().items || [];
  if (!items[index]) return;
  items[index].done = !items[index].done;
  await updateDoc(pairRef, { items });

  // notify
  await triggerSendNotification(currentPairId, {
    title: items[index].done ? 'Item bought' : 'Item marked undone',
    body: `${items[index].name} ${items[index].done ? 'was bought' : 'is marked not bought'}`,
    excludeUid: currentUid
  });
}

async function deleteItem(index) {
  const pairRef = doc(db, 'pairs', currentPairId);
  const snap = await getDoc(pairRef);
  if (!snap.exists()) return;
  const items = snap.data().items || [];
  const removed = items.splice(index, 1);
  await updateDoc(pairRef, { items });
  // notify partner
  await triggerSendNotification(currentPairId, {
    title: 'Item removed',
    body: `${removed[0]?.name || 'An item'} was removed`,
    excludeUid: currentUid
  });
}

async function clearCompleted() {
  const pairRef = doc(db, 'pairs', currentPairId);
  const snap = await getDoc(pairRef);
  if (!snap.exists()) return;
  const items = snap.data().items || [];
  const filtered = items.filter(i => !i.done);
  await updateDoc(pairRef, { items: filtered });
}

/* ---------- Listener that watches the pair doc for realtime updates ---------- */
function watchPairDoc(pairId) {
  const pairRef = doc(db, 'pairs', pairId);
  onSnapshot(pairRef, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    renderListItems(data.items || []);
    // update invite code UI
    if (inviteCodeEl) inviteCodeEl.textContent = data.inviteCode || '—';
    if (partnerBadge) {
      const connected = (data.users && data.users.length > 1);
      partnerBadge.textContent = connected ? 'Partner: Connected' : 'Partner: Not connected';
      partnerBadge.classList.remove('hidden');
    }
  });
}

/* ---------- Notification click handlers (foreground) ---------- */
function setupOnMessage() {
  const messaging = getMessaging(app);
  onMessage(messaging, (payload) => {
    // handle foreground messages
    if (payload && payload.notification) {
      const { title, body } = payload.notification;
      // Show in-app toast or notification
      try {
        if (Notification.permission === 'granted') {
          new Notification(title, { body });
        }
      } catch (e) {}
    }
  });
}

/* ---------- Event bindings ---------- */
if (addBtn) {
  addBtn.addEventListener('click', async () => {
    const raw = inputEl.value.trim();
    if (!raw) return;
    const qty = parseInt(qtyEl?.value || 1, 10) || 1;
    await addItem(raw, qty);
    inputEl.value = '';
    if (qtyEl) qtyEl.value = 1;
  });
}

if (clearDoneBtn) {
  clearDoneBtn.addEventListener('click', clearCompleted);
}
if (inviteBtn) {
  inviteBtn.addEventListener('click', () => inviteModal.classList.remove('hidden'));
}
if (closeInviteBtn) closeInviteBtn.addEventListener('click', () => inviteModal.classList.add('hidden'));
if (copyInviteBtn) copyInviteBtn.addEventListener('click', async () => {
  const text = inviteCodeEl.textContent || '';
  await navigator.clipboard.writeText(text);
  alert('Invite code copied');
});
if (logoutBtn) logoutBtn.addEventListener('click', async () => {
  await signOut(auth);
  localStorage.removeItem('listId');
  window.location.href = '/login.html';
});

/* ---------- Auth state ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = '/login.html';
    return;
  }
  currentUid = user.uid;
  // register fcm token and store in users collection
  await registerFCMToken(currentUid);
  // pair id decision: if localStorage has listId use it; otherwise default to uid
  currentPairId = localStorage.getItem('listId') || uidToPairId(currentUid);
  await ensurePairDocExists(currentPairId, currentUid);
  localStorage.setItem('listId', currentPairId);
  // start listening
  watchPairDoc(currentPairId);
  setupOnMessage();
  // Ask permission for notifications
  if ('Notification' in window && Notification.permission !== 'granted') {
    await Notification.requestPermission();
  }
});
