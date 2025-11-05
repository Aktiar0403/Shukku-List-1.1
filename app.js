// app.js
// Full client-side app for Shukku List (pair-only shared shopping)
// Requirements:
// - firebase-config.js must export: export const auth = ..., export const db = ..., export default app;
// - Vercel endpoints: /api/fetchMetadata?url=..., /api/sendNotification (POST)
// - firebase-messaging-sw.js served at project root for background notifications

import { auth, db, default as app } from './firebase-config.js';

import {
  onAuthStateChanged,
  signOut,
  getIdToken,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import {
  getMessaging,
  getToken,
  onMessage,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-messaging.js";

/* ===========================
   CONFIG - put your VAPID public key here
   =========================== */
const VAPID_KEY = "BCR2my_4hqB9XOqjBTKmPLyVbOAg1-juwelEHiFIIXNSuoBo7ZX_4A9ktcYuwxmlX2meAv97H1gavSiC_1x_Tpc"; // get from Firebase Console -> Cloud Messaging -> Web configuration

/* ===========================
   DOM elements (match to your HTML)
   =========================== */
const itemInput = document.getElementById('itemInput');      // text or url
const qtyInput = document.getElementById('qtyInput');        // optional numeric
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
const ogPreview = document.getElementById('ogPreview'); // optional preview box

/* ===========================
   State
   =========================== */
let currentUid = null;
let pairId = null; // using owner's uid as pair id (simple design)
let pairDocUnsubscribe = null;

/* ===========================
   Utility: request ID token for server auth
   =========================== */
async function getUserIdToken() {
  try {
    if (!auth || !auth.currentUser) return null;
    return await getIdToken(auth.currentUser, /* forceRefresh */ false);
  } catch (e) {
    console.warn('Failed to get id token', e);
    return null;
  }
}

/* ===========================
   FCM: register token and store under users/{uid}.tokens
   =========================== */
async function registerFCMToken(uid) {
  try {
    const messaging = getMessaging(app);
    // request token via VAPID key
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) {
      console.warn('No FCM token received');
      return null;
    }
    // send token to server or store in Firestore users/{uid}
    // We'll update users/{uid}.tokens array in Firestore via serverless call or client update.
    // Using client update here (requires Firestore rules permitting user write to own profile)
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, { tokens: [token], createdAt: Date.now() });
    } else {
      // add token without duplicates
      const existing = snap.data().tokens || [];
      if (!existing.includes(token)) {
        await updateDoc(userRef, { tokens: arrayUnion(token) });
      }
    }
    return token;
  } catch (e) {
    console.warn('registerFCMToken error', e);
    return null;
  }
}

/* ===========================
   Server calls
   - fetchProductPreview(url)
   - sendNotification(pairId, payload)
   =========================== */
async function fetchProductPreview(url) {
  try {
    const res = await fetch(`/api/fetchMetadata?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch (e) {
    console.warn('fetchProductPreview failed', e);
    return null;
  }
}

async function sendNotification(pairIdParam, payload) {
  // payload: { title, body, excludeUid (optional) }
  try {
    const idToken = await getUserIdToken();
    const res = await fetch('/api/sendNotification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': idToken ? `Bearer ${idToken}` : ''
      },
      body: JSON.stringify({ pairId: pairIdParam, payload })
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn('sendNotification failed', res.status, txt);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('sendNotification error', e);
    return null;
  }
}

/* ===========================
   Pair doc helpers
   - ensure pair doc exists
   - listen to pair doc changes
   =========================== */
async function ensurePairDoc(uid) {
  // default pair id = owner's uid (first user who signed up)
  // If you have listId in localStorage, keep that
  const existingListId = localStorage.getItem('listId');
  if (existingListId) {
    pairId = existingListId;
  } else {
    pairId = uid; // use owner's uid
    localStorage.setItem('listId', pairId);
  }

  const pairRef = doc(db, 'pairs', pairId);
  const snap = await getDoc(pairRef);
  if (!snap.exists()) {
    // create minimal doc
    await setDoc(pairRef, {
      users: [uid],
      items: [],
      inviteCode: (Math.floor(100000 + Math.random() * 900000)).toString(),
      createdAt: Date.now()
    });
  } else {
    // ensure current uid in users array
    const data = snap.data();
    if (!Array.isArray(data.users) || !data.users.includes(uid)) {
      await updateDoc(pairRef, { users: arrayUnion(uid) });
    }
  }
  return pairId;
}

function unsubscribePairListener() {
  if (typeof pairDocUnsubscribe === 'function') pairDocUnsubscribe();
  pairDocUnsubscribe = null;
}

function startPairListener(pairIdToListen) {
  const pairRef = doc(db, 'pairs', pairIdToListen);
  unsubscribePairListener();
  pairDocUnsubscribe = onSnapshot(pairRef, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    const items = data.items || [];
    renderList(items);
    // invite code UI
    if (inviteCodeEl) inviteCodeEl.textContent = data.inviteCode || '—';
    // partner badge
    if (partnerBadge) {
      partnerBadge.textContent = (data.users && data.users.length > 1) ? 'Partner: Connected' : 'Partner: Not connected';
      partnerBadge.classList.remove('hidden');
    }
  });
}

/* ===========================
   Render list
   =========================== */
function renderList(items) {
  listContainer.innerHTML = '';
  const total = items.length;
  const doneCount = items.filter(i => i.done).length;
  // progress
  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');
  if (progressText) progressText.textContent = `${doneCount} of ${total} items`;
  if (progressBar) progressBar.style.width = total ? Math.round((doneCount/total)*100) + '%' : '0%';

  items.forEach((it, idx) => {
    const li = document.createElement('li');
    li.className = 'p-3 bg-white rounded shadow flex justify-between items-center';

    let leftHTML = `<div class="flex items-center">`;
    if (it.image) leftHTML += `<img src="${it.image}" alt="" class="w-12 h-12 rounded mr-3 object-cover">`;
    leftHTML += `<div>`;
    if (it.link) {
      leftHTML += `<a href="${it.link}" target="_blank" rel="noopener" class="font-semibold text-blue-600">${escapeHtml(it.name)}</a>`;
    } else {
      leftHTML += `<div class="font-semibold">${escapeHtml(it.name)}</div>`;
    }
    leftHTML += `<div class="text-xs text-gray-500">Qty: ${escapeHtml(it.qty || 1)} • ${escapeHtml(it.addedBy || '')}</div>`;
    leftHTML += `</div></div>`;

    const rightHTML = `
      <div class="flex items-center space-x-2">
        <button class="btn-toggle" data-idx="${idx}">${it.done ? '✅' : '🛒'}</button>
        <button class="btn-delete text-red-500" data-idx="${idx}">✕</button>
      </div>
    `;

    li.innerHTML = leftHTML + rightHTML;
    listContainer.appendChild(li);
  });

  // attach events
  listContainer.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.onclick = async (e) => {
      const idx = +e.currentTarget.dataset.idx;
      await toggleDone(idx);
    };
  });
  listContainer.querySelectorAll('.btn-delete').forEach(btn => {
    btn.onclick = async (e) => {
      const idx = +e.currentTarget.dataset.idx;
      await deleteItem(idx);
    };
  });
}

/* ===========================
   CRUD operations (items array inside pairs/{pairId})
   =========================== */
async function addItem(rawText, qty = 1) {
  if (!pairId || !currentUid) return alert('Not ready yet');
  let item = {
    name: rawText,
    qty,
    addedBy: currentUid,
    done: false,
    createdAt: Date.now()
  };

  // if rawText is a URL, try preview
  try {
    const parsed = new URL(rawText);
    const preview = await fetchProductPreview(parsed.href);
    if (preview) {
      item.name = preview.title || item.name;
      if (preview.image) item.image = preview.image;
      item.link = preview.url || parsed.href;
      if (preview.price) item.price = preview.price;
      if (preview.site) item.site = preview.site;
    } else {
      item.link = parsed.href;
    }
  } catch (e) {
    // not a URL
  }

  const pairRef = doc(db, 'pairs', pairId);
  const snap = await getDoc(pairRef);
  const data = snap.exists() ? snap.data() : {};
  const items = Array.isArray(data.items) ? data.items : [];
  items.push(item);
  await updateDoc(pairRef, { items });

  // notify partner(s) using server
  await sendNotification(pairId, {
    title: 'Item added',
    body: `${item.name} added to list`,
    excludeUid: currentUid
  });
}

async function toggleDone(index) {
  if (!pairId) return;
  const pairRef = doc(db, 'pairs', pairId);
  const snap = await getDoc(pairRef);
  if (!snap.exists()) return;
  const items = Array.isArray(snap.data().items) ? snap.data().items : [];
  if (!items[index]) return;
  items[index].done = !items[index].done;
  await updateDoc(pairRef, { items });

  await sendNotification(pairId, {
    title: items[index].done ? 'Item bought' : 'Item marked undone',
    body: `${items[index].name} ${items[index].done ? 'was bought' : 'marked not bought'}`,
    excludeUid: currentUid
  });
}

async function deleteItem(index) {
  if (!pairId) return;
  const pairRef = doc(db, 'pairs', pairId);
  const snap = await getDoc(pairRef);
  if (!snap.exists()) return;
  const items = Array.isArray(snap.data().items) ? snap.data().items : [];
  const removed = items.splice(index, 1);
  await updateDoc(pairRef, { items });

  await sendNotification(pairId, {
    title: 'Item removed',
    body: `${removed[0]?.name || 'An item'} removed`,
    excludeUid: currentUid
  });
}

async function clearCompleted() {
  if (!pairId) return;
  const pairRef = doc(db, 'pairs', pairId);
  const snap = await getDoc(pairRef);
  const items = Array.isArray(snap.data().items) ? snap.data().items : [];
  const filtered = items.filter(i => !i.done);
  await updateDoc(pairRef, { items: filtered });
}

/* ===========================
   Helpers + small utilities
   =========================== */
function escapeHtml(s) {
  if (!s && s !== 0) return '';
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/* ===========================
   UI event wiring
   =========================== */
if (addBtn) {
  addBtn.addEventListener('click', async () => {
    const raw = (itemInput?.value || '').trim();
    if (!raw) return;
    const qty = parseInt(qtyInput?.value || '1', 10) || 1;
    await addItem(raw, qty);
    if (itemInput) itemInput.value = '';
    if (qtyInput) qtyInput.value = 1;
    // hide OG preview if present
    if (ogPreview) { ogPreview.innerHTML = ''; ogPreview.classList.add('hidden'); }
  });
}

// enter key to add
if (itemInput) {
  itemInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      addBtn?.click();
    } else {
      // quick preview for URL when user stops typing (optional simple heuristic)
      clearTimeout(itemInput._previewTimer);
      itemInput._previewTimer = setTimeout(async () => {
        const val = (itemInput.value || '').trim();
        try {
          const url = new URL(val);
          const preview = await fetchProductPreview(url.href);
          if (preview && ogPreview) {
            ogPreview.innerHTML = `<div class="flex items-center"><img src="${preview.image || ''}" class="w-16 h-16 object-cover rounded mr-3"/><div><div class="font-semibold">${escapeHtml(preview.title||'')}</div><div class="text-sm text-gray-500">${escapeHtml(preview.site||'')}</div></div></div>`;
            ogPreview.classList.remove('hidden');
          } else if (ogPreview) {
            ogPreview.innerHTML = ''; ogPreview.classList.add('hidden');
          }
        } catch (err) {
          if (ogPreview) { ogPreview.innerHTML = ''; ogPreview.classList.add('hidden'); }
        }
      }, 600);
    }
  });
}

if (clearDoneBtn) clearDoneBtn.addEventListener('click', clearCompleted);

if (inviteBtn) inviteBtn.addEventListener('click', () => inviteModal.classList.remove('hidden'));
if (closeInviteBtn) closeInviteBtn.addEventListener('click', () => inviteModal.classList.add('hidden'));
if (copyInviteBtn) copyInviteBtn.addEventListener('click', async () => {
  const text = inviteCodeEl?.textContent || '';
  try { await navigator.clipboard.writeText(text); alert('Invite code copied'); } catch(e){ alert('Copy failed'); }
});
if (logoutBtn) logoutBtn.addEventListener('click', async () => {
  await signOut(auth);
  localStorage.removeItem('listId');
  window.location.href = '/login.html';
});

/* ===========================
   FCM foreground message handler
   =========================== */
function setupOnMessage() {
  try {
    const messaging = getMessaging(app);
    onMessage(messaging, (payload) => {
      // Show a small in-app toast or browser notification
      if (payload && payload.notification) {
        const { title, body } = payload.notification;
        try {
          if (Notification.permission === 'granted') {
            new Notification(title, { body });
          } else {
            // fallback UI: console
            console.log('FCM message', title, body);
          }
        } catch (err) {
          console.log('onMessage show notification error', err);
        }
      }
    });
  } catch (e) {
    console.warn('setupOnMessage failed', e);
  }
}

/* ===========================
   Auth state change -> initialize everything
   =========================== */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // not logged in -> go to login
    // but allow login page itself to import app.js without redirect errors
    if (!location.pathname.endsWith('login.html')) {
      window.location.href = '/login.html';
    }
    return;
  }

  currentUid = user.uid;

  // register FCM token and save to users/{uid}
  try {
    await registerFCMToken(currentUid);
  } catch (e) { console.warn('FCM registration error', e); }

  // request Notification permission if not granted
  try {
    if ('Notification' in window && Notification.permission !== 'granted') {
      await Notification.requestPermission();
    }
  } catch (e) {}

  // ensure pair doc exists and start real-time listener
  await ensurePairDoc(currentUid);
  startPairListener(pairId);

  // setup foreground message handling
  setupOnMessage();
});

/* ===========================
   Invite join helper (user enters invite code + owner list id)
   For demo: we use owner uid as list id. In production you'd query by inviteCode.
   =========================== */
export async function joinWithInviteCode(code, ownerListId) {
  // call this from your join flow: joinWithInviteCode(inviteCode, ownerUid)
  if (!code || !ownerListId) throw new Error('Missing code or ownerListId');
  const pairRef = doc(db, 'pairs', ownerListId);
  const snap = await getDoc(pairRef);
  if (!snap.exists()) throw new Error('List not found');
  const data = snap.data();
  if (String(data.inviteCode) !== String(code)) throw new Error('Invite code mismatch');
  // add current user to users array
  await updateDoc(pairRef, { users: arrayUnion(currentUid) });
  // set local listId
  localStorage.setItem('listId', ownerListId);
  pairId = ownerListId;
  startPairListener(pairId);
}

/* ===========================
   Clean up when unloading
   =========================== */
window.addEventListener('beforeunload', () => unsubscribePairListener());
