import { db, auth } from './firebase-config.js';
import { doc, getDoc, onSnapshot, updateDoc, arrayUnion, setDoc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';
import { logout } from './auth.js';

const uid = localStorage.getItem('uid');
if (!uid) {
  window.location.href = 'login.html';
}

const listId = localStorage.getItem('listId');
const listContainer = document.getElementById('listContainer');
const itemInput = document.getElementById('itemInput');
const qtyInput = document.getElementById('qtyInput');
const addBtn = document.getElementById('addBtn');
const inviteBtn = document.getElementById('inviteBtn');
const inviteModal = document.getElementById('inviteModal');
const inviteCodeEl = document.getElementById('inviteCode');
const copyInvite = document.getElementById('copyInvite');
const closeInvite = document.getElementById('closeInvite');
const partnerBadge = document.getElementById('partnerBadge');
const progressText = document.getElementById('progressText');
const progressBar = document.getElementById('progressBar');
const ogPreview = document.getElementById('ogPreview');
const clearDone = document.getElementById('clearDone');
const logoutBtn = document.getElementById('logoutBtn');

if (logoutBtn) logoutBtn.addEventListener('click', logout);

let currentListId = listId || null;

async function init() {
  if (!currentListId) {
    // if no listId, assume user is owner and uses their uid as list id
    currentListId = uid;
    localStorage.setItem('listId', currentListId);
    // ensure doc exists
    const docRef = doc(db, 'lists', currentListId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await setDoc(docRef, { users: [uid], items: [], inviteCode: Math.floor(100000 + Math.random() * 900000).toString(), createdAt: Date.now() });
    }
  }
  listen();
  requestNotificationPermission();
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission !== 'granted') {
    Notification.requestPermission();
  }
}

function showNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

function renderList(items) {
  listContainer.innerHTML = '';
  const total = items.length;
  const doneCount = items.filter(i => i.done).length;
  progressText.textContent = `${doneCount} of ${total} items`;
  progressBar.style.width = total ? Math.round((doneCount/total)*100) + '%' : '0%';
  items.forEach((it, idx) => {
    const li = document.createElement('li');
    li.className = 'p-3 bg-white rounded shadow flex justify-between items-center';
    const left = document.createElement('div');
    left.innerHTML = `<div class="font-medium">${it.name}</div><div class="text-sm text-gray-500">Qty: ${it.qty} • ${it.addedByName || it.addedBy}</div>`;
    const right = document.createElement('div');
    right.innerHTML = `<button data-idx="${idx}" class="toggleDone mr-2 text-green-600">✓</button><button data-idx="${idx}" class="deleteItem text-red-600">✕</button>`;
    li.appendChild(left);
    li.appendChild(right);
    listContainer.appendChild(li);
  });
}

async function listen() {
  const docRef = doc(db, 'lists', currentListId);
  onSnapshot(docRef, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    const items = data.items || [];
    renderList(items);
    inviteCodeEl.textContent = data.inviteCode || '—';
    partnerBadge.textContent = `Partner: ${data.users && data.users.length>1 ? 'Connected' : 'Not connected'}`;
    partnerBadge.classList.remove('hidden');
  });
}

async function addItem() {
  const raw = itemInput.value.trim();
  const qty = qtyInput.value || 1;
  if (!raw) return;
  let item = { name: raw, qty: qty, addedBy: uid, done:false, createdAt: Date.now() };
  // try to detect URL
  try {
    const url = new URL(raw);
    // fetch og metadata via a public CORS proxy (may fail). Production: use serverless proxy.
    const proxy = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url.href);
    const res = await fetch(proxy);
    if (res.ok) {
      const text = await res.text();
      // naive title extraction
      const m = text.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) || text.match(/<title>([^<]+)<\/title>/i);
      if (m) item.name = m[1].trim();
      // try to get image
      const mi = text.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
      if (mi) item.image = mi[1];
      item.productUrl = url.href;
    }
  } catch(e) {
    // not a URL
  }
  // save to firestore
  const docRef = doc(db, 'lists', currentListId);
  const snap = await getDoc(docRef);
  const data = snap.data();
  const newItems = data.items ? [...data.items, item] : [item];
  await updateDoc(docRef, { items: newItems });
  itemInput.value = ''; qtyInput.value = 1;
  showNotification('Item added', `${item.name} added to list`);
}
// Fetch product metadata from your Vercel API route
async function fetchProductPreview(url) {
  try {
    const response = await fetch(`/api/fetchMetadata?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    console.log("Fetched metadata:", data);
    return data;
  } catch (error) {
    console.error("Error fetching product preview:", error);
    return null;
  }
}

// delegate clicks
document.body.addEventListener('click', async (e) => {
  if (e.target.matches('#addBtn')) await addItem();
  if (e.target.matches('.toggleDone')) {
    const idx = +e.target.dataset.idx;
    const docRef = doc(db, 'lists', currentListId);
    const snap = await getDoc(docRef); const data = snap.data(); const items = data.items || [];
    items[idx].done = !items[idx].done;
    await updateDoc(docRef, { items });
    showNotification('Item updated', `Marked ${items[idx].done ? 'done' : 'not done'}: ${items[idx].name}`);
  }
  if (e.target.matches('.deleteItem')) {
    const idx = +e.target.dataset.idx;
    const docRef = doc(db, 'lists', currentListId);
    const snap = await getDoc(docRef); const data = snap.data(); const items = data.items || [];
    const removed = items.splice(idx,1);
    await updateDoc(docRef, { items });
    showNotification('Item removed', `${removed[0].name} removed`);
  }
  if (e.target.matches('#inviteBtn')) {
    inviteModal.classList.remove('hidden');
  }
  if (e.target.matches('#closeInvite')) inviteModal.classList.add('hidden');
  if (e.target.matches('#copyInvite')) {
    navigator.clipboard.writeText(inviteCodeEl.textContent || '');
    alert('Invite code copied');
  }
  if (e.target.matches('#clearDone')) {
    const docRef = doc(db, 'lists', currentListId);
    const snap = await getDoc(docRef); const data = snap.data(); const items = data.items || [];
    const filtered = items.filter(i => !i.done);
    await updateDoc(docRef, { items: filtered });
  }
});

// keyboard enter to add
itemInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addItem();
});

init();
