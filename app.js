// Full client-side app for Shukku List (pair-only shared shopping)
// Enhanced with complete error handling and performance optimizations

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
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import {
  getMessaging,
  getToken,
  onMessage,
  isSupported
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-messaging.js";

/* ===========================
   CONFIG - put your VAPID public key here
   =========================== */
const VAPID_KEY = "BCR2my_4hqB9XOqjBTKmPLyVbOAg1-juwelEHiFIIXNSuoBo7ZX_4A9ktcYuwxmlX2meAv97H1gavSiC_1x_Tpc";

/* ===========================
   DOM elements (match to your HTML)
   =========================== */
const itemInput = document.getElementById('itemInput');
const qtyInput = document.getElementById('qtyInput');
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
const ogPreview = document.getElementById('ogPreview');
const progressText = document.getElementById('progressText');
const progressBar = document.getElementById('progressBar');

/* ===========================
   State
   =========================== */
let currentUid = null;
let pairId = null;
let pairDocUnsubscribe = null;
let isOnline = navigator.onLine;

/* ===========================
   Enhanced Utility Functions
   =========================== */

// Show user-friendly error messages
function showError(message, duration = 5000) {
  // Remove existing error toast if any
  const existingToast = document.getElementById('error-toast');
  if (existingToast) existingToast.remove();

  // Create new toast
  const toast = document.createElement('div');
  toast.id = 'error-toast';
  toast.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 max-w-md';
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  // Auto remove after duration
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, duration);
}

// Show success messages
function showSuccess(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 max-w-md';
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, duration);
}

// Show loading state
function showLoading(show = true) {
  if (show) {
    const loader = document.createElement('div');
    loader.id = 'global-loader';
    loader.className = 'fixed inset-0 bg-black bg-opacity-20 flex items-center justify-center z-50';
    loader.innerHTML = '<div class="bg-white p-4 rounded-lg shadow-lg">Loading...</div>';
    document.body.appendChild(loader);
  } else {
    const loader = document.getElementById('global-loader');
    if (loader) loader.remove();
  }
}

// Safe async operation wrapper
async function safeAsyncOperation(operation, errorMessage) {
  try {
    return await operation();
  } catch (error) {
    console.error(errorMessage, error);
    showError(errorMessage);
    return null;
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Validate URL
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

/* ===========================
   FCM: Enhanced token registration
   =========================== */
async function registerFCMToken(uid) {
  return safeAsyncOperation(async () => {
    // Check if messaging is supported
    const isMessagingSupported = await isSupported();
    if (!isMessagingSupported) {
      console.log('FCM not supported in this environment');
      return null;
    }

    const messaging = getMessaging(app);
    
    // Request notification permission if not granted
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    if (Notification.permission !== 'granted') {
      console.log('Notification permission not granted');
      return null;
    }

    const token = await getToken(messaging, { 
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker?.ready
    });
    
    if (!token) {
      console.warn('No FCM token received');
      return null;
    }

    // Store token in Firestore
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    
    if (!snap.exists()) {
      await setDoc(userRef, { 
        tokens: [token], 
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    } else {
      const existing = snap.data().tokens || [];
      if (!existing.includes(token)) {
        await updateDoc(userRef, { 
          tokens: arrayUnion(token),
          updatedAt: new Date().toISOString()
        });
      }
    }
    
    console.log('FCM token registered successfully');
    return token;
  }, 'Failed to register for push notifications');
}

/* ===========================
   Enhanced Server Calls
   =========================== */
async function fetchProductPreview(url) {
  return safeAsyncOperation(async () => {
    if (!isValidUrl(url)) {
      throw new Error('Invalid URL');
    }

    const res = await fetch(`/api/fetchMetadata?url=${encodeURIComponent(url)}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    return data;
  }, 'Failed to fetch product preview');
}

async function sendNotification(pairIdParam, payload) {
  return safeAsyncOperation(async () => {
    const idToken = await getUserIdToken();
    const res = await fetch('/api/sendNotification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': idToken ? `Bearer ${idToken}` : ''
      },
      body: JSON.stringify({ 
        pairId: pairIdParam, 
        payload: {
          title: payload.title || 'Shukku List',
          body: payload.body || '',
          excludeUid: payload.excludeUid
        }
      })
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Notification failed: ${res.status} ${errorText}`);
    }
    
    return await res.json();
  }, 'Failed to send notification');
}

/* ===========================
   Enhanced Pair Management
   =========================== */
async function ensurePairDoc(uid) {
  return safeAsyncOperation(async () => {
    // Try to get existing list ID from localStorage
    const existingListId = localStorage.getItem('listId');
    
    if (existingListId) {
      // Verify the list still exists
      const pairRef = doc(db, 'pairs', existingListId);
      const snap = await getDoc(pairRef);
      
      if (snap.exists()) {
        pairId = existingListId;
        return pairId;
      } else {
        // List doesn't exist anymore, create new one
        localStorage.removeItem('listId');
      }
    }

    // Create new pair document
    pairId = uid;
    localStorage.setItem('listId', pairId);

    const pairRef = doc(db, 'pairs', pairId);
    const snap = await getDoc(pairRef);
    
    if (!snap.exists()) {
      await setDoc(pairRef, {
        users: [uid],
        items: [],
        inviteCode: Math.floor(100000 + Math.random() * 900000).toString(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    } else {
      // Ensure current user is in users array
      const data = snap.data();
      if (!data.users || !data.users.includes(uid)) {
        await updateDoc(pairRef, { 
          users: arrayUnion(uid),
          updatedAt: Date.now()
        });
      }
    }
    
    return pairId;
  }, 'Failed to setup your shopping list');
}

function unsubscribePairListener() {
  if (typeof pairDocUnsubscribe === 'function') {
    pairDocUnsubscribe();
  }
  pairDocUnsubscribe = null;
}

function startPairListener(pairIdToListen) {
  unsubscribePairListener();
  
  const pairRef = doc(db, 'pairs', pairIdToListen);
  
  pairDocUnsubscribe = onSnapshot(pairRef, 
    (snap) => {
      if (!snap.exists()) {
        console.warn('Pair document not found');
        showError('Shopping list not found. Creating new one...');
        ensurePairDoc(currentUid);
        return;
      }
      
      const data = snap.data();
      const items = data.items || [];
      
      // Update UI
      renderList(items);
      updateProgress(items);
      updateInviteCode(data.inviteCode);
      updatePartnerStatus(data.users);
      
    },
    (error) => {
      console.error('Firestore listener error:', error);
      showError('Connection issue. Reconnecting...');
      
      // Attempt to reconnect after delay
      setTimeout(() => {
        if (pairId) {
          startPairListener(pairId);
        }
      }, 5000);
    }
  );
}

/* ===========================
   Enhanced UI Rendering
   =========================== */
function renderList(items) {
  if (!listContainer) return;
  
  listContainer.innerHTML = '';
  
  if (items.length === 0) {
    listContainer.innerHTML = `
      <li class="p-8 text-center text-gray-500 bg-white rounded shadow">
        Your shopping list is empty<br>
        <span class="text-sm">Add items above to get started</span>
      </li>
    `;
    return;
  }
  
  items.forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = `p-3 bg-white rounded shadow flex justify-between items-center transition-all duration-200 ${
      item.done ? 'opacity-60' : ''
    }`;
    
    let leftHTML = `<div class="flex items-center flex-1 min-w-0">`;
    
    // Item image if available
    if (item.image) {
      leftHTML += `<img src="${item.image}" alt="" class="w-12 h-12 rounded mr-3 object-cover flex-shrink-0" onerror="this.style.display='none'">`;
    }
    
    leftHTML += `<div class="min-w-0 flex-1">`;
    
    // Item name with link if available
    if (item.link) {
      leftHTML += `<a href="${item.link}" target="_blank" rel="noopener" class="font-semibold text-blue-600 hover:text-blue-800 truncate block">${escapeHtml(item.name)}</a>`;
    } else {
      leftHTML += `<div class="font-semibold truncate">${escapeHtml(item.name)}</div>`;
    }
    
    // Item details
    leftHTML += `<div class="text-xs text-gray-500 mt-1">`;
    leftHTML += `Qty: ${escapeHtml(item.qty || 1)}`;
    if (item.addedBy && item.addedBy !== currentUid) {
      leftHTML += ` • Added by partner`;
    }
    leftHTML += `</div>`;
    
    leftHTML += `</div></div>`;

    const rightHTML = `
      <div class="flex items-center space-x-2 flex-shrink-0">
        <button class="btn-toggle p-2 rounded-full hover:bg-gray-100 transition-colors" data-idx="${idx}" title="${item.done ? 'Mark as not bought' : 'Mark as bought'}">
          ${item.done ? '✅' : '🛒'}
        </button>
        <button class="btn-delete p-2 rounded-full hover:bg-red-50 text-red-500 transition-colors" data-idx="${idx}" title="Remove item">
          ✕
        </button>
      </div>
    `;

    li.innerHTML = leftHTML + rightHTML;
    listContainer.appendChild(li);
  });

  // Attach event listeners
  attachItemEventListeners();
}

function updateProgress(items) {
  const total = items.length;
  const doneCount = items.filter(i => i.done).length;
  
  if (progressText) {
    progressText.textContent = `${doneCount} of ${total} items`;
  }
  
  if (progressBar) {
    const percentage = total ? Math.round((doneCount / total) * 100) : 0;
    progressBar.style.width = `${percentage}%`;
    progressBar.setAttribute('aria-valuenow', percentage);
  }
}

function updateInviteCode(code) {
  if (inviteCodeEl) {
    inviteCodeEl.textContent = code || '—';
  }
}

function updatePartnerStatus(users) {
  if (partnerBadge) {
    const hasPartner = users && users.length > 1;
    partnerBadge.textContent = hasPartner ? '👫 Connected' : '👤 Alone';
    partnerBadge.className = `ml-3 text-sm px-2 py-0.5 rounded ${
      hasPartner ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
    }`;
    partnerBadge.classList.remove('hidden');
  }
}

function attachItemEventListeners() {
  // Toggle buttons
  listContainer.querySelectorAll('.btn-toggle').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const idx = +e.currentTarget.dataset.idx;
      await toggleDone(idx);
    };
  });
  
  // Delete buttons
  listContainer.querySelectorAll('.btn-delete').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const idx = +e.currentTarget.dataset.idx;
      if (confirm('Are you sure you want to remove this item?')) {
        await deleteItem(idx);
      }
    };
  });
}

/* ===========================
   Enhanced CRUD Operations
   =========================== */
async function addItem(rawText, qty = 1) {
  return safeAsyncOperation(async () => {
    if (!pairId || !currentUid) {
      throw new Error('App not ready. Please refresh the page.');
    }

    // Input validation
    const trimmedText = (rawText || '').trim();
    if (!trimmedText) {
      throw new Error('Please enter an item name or URL');
    }

    if (qty < 1 || qty > 999 || isNaN(qty)) {
      throw new Error('Quantity must be a number between 1 and 999');
    }

    let item = {
      name: trimmedText,
      qty: parseInt(qty),
      addedBy: currentUid,
      done: false,
      createdAt: Date.now(),
      id: Date.now().toString() // Simple ID for tracking
    };

    // URL detection and metadata fetching
    if (isValidUrl(trimmedText)) {
      showLoading(true);
      try {
        const preview = await fetchProductPreview(trimmedText);
        if (preview) {
          item.name = preview.title || item.name;
          if (preview.image) item.image = preview.image;
          item.link = preview.url || trimmedText;
          if (preview.description) item.description = preview.description;
        } else {
          item.link = trimmedText;
        }
      } catch (error) {
        console.warn('Preview failed, using original text:', error);
        item.link = trimmedText;
      } finally {
        showLoading(false);
      }
    }

    // Save to Firestore
    const pairRef = doc(db, 'pairs', pairId);
    await updateDoc(pairRef, { 
      items: arrayUnion(item),
      updatedAt: Date.now()
    });

    // Clear input
    if (itemInput) itemInput.value = '';
    if (qtyInput) qtyInput.value = '1';
    if (ogPreview) {
      ogPreview.innerHTML = '';
      ogPreview.classList.add('hidden');
    }

    // Notify partner
    await sendNotification(pairId, {
      title: 'Item added',
      body: `${item.name} added to list`,
      excludeUid: currentUid
    });

    showSuccess('Item added successfully!');
    
  }, 'Failed to add item');
}

async function toggleDone(index) {
  return safeAsyncOperation(async () => {
    if (!pairId) throw new Error('No active list');

    const pairRef = doc(db, 'pairs', pairId);
    const snap = await getDoc(pairRef);
    
    if (!snap.exists()) throw new Error('List not found');
    
    const items = Array.isArray(snap.data().items) ? [...snap.data().items] : [];
    if (!items[index]) throw new Error('Item not found');
    
    items[index].done = !items[index].done;
    items[index].updatedAt = Date.now();
    
    await updateDoc(pairRef, { 
      items,
      updatedAt: Date.now()
    });

    const action = items[index].done ? 'bought' : 'marked not bought';
    await sendNotification(pairId, {
      title: items[index].done ? 'Item bought' : 'Item updated',
      body: `${items[index].name} ${action}`,
      excludeUid: currentUid
    });

  }, 'Failed to update item');
}

async function deleteItem(index) {
  return safeAsyncOperation(async () => {
    if (!pairId) throw new Error('No active list');

    const pairRef = doc(db, 'pairs', pairId);
    const snap = await getDoc(pairRef);
    
    if (!snap.exists()) throw new Error('List not found');
    
    const items = Array.isArray(snap.data().items) ? [...snap.data().items] : [];
    if (!items[index]) throw new Error('Item not found');
    
    const removedItem = items.splice(index, 1)[0];
    
    await updateDoc(pairRef, { 
      items,
      updatedAt: Date.now()
    });

    await sendNotification(pairId, {
      title: 'Item removed',
      body: `${removedItem.name} removed from list`,
      excludeUid: currentUid
    });

    showSuccess('Item removed successfully!');
    
  }, 'Failed to remove item');
}

async function clearCompleted() {
  return safeAsyncOperation(async () => {
    if (!pairId) throw new Error('No active list');

    const pairRef = doc(db, 'pairs', pairId);
    const snap = await getDoc(pairRef);
    
    const items = Array.isArray(snap.data().items) ? snap.data().items : [];
    const filtered = items.filter(i => !i.done);
    
    if (filtered.length === items.length) {
      showError('No completed items to clear');
      return;
    }
    
    await updateDoc(pairRef, { 
      items: filtered,
      updatedAt: Date.now()
    });

    showSuccess('Completed items cleared!');
    
  }, 'Failed to clear completed items');
}

/* ===========================
   Enhanced UI Event Handlers
   =========================== */

// Debounce function for performance
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// URL preview handler
const debouncedPreview = debounce(async (value) => {
  if (!ogPreview) return;
  
  try {
    const url = new URL(value);
    const preview = await fetchProductPreview(url.href);
    
    if (preview && preview.title) {
      ogPreview.innerHTML = `
        <div class="flex items-center p-3 bg-blue-50 rounded border border-blue-200">
          <img src="${preview.image || ''}" class="w-16 h-16 object-cover rounded mr-3" onerror="this.style.display='none'">
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-sm truncate">${escapeHtml(preview.title)}</div>
            <div class="text-xs text-gray-500 mt-1">${escapeHtml(preview.site || 'Website preview')}</div>
          </div>
        </div>
      `;
      ogPreview.classList.remove('hidden');
    } else {
      ogPreview.innerHTML = '';
      ogPreview.classList.add('hidden');
    }
  } catch (err) {
    ogPreview.innerHTML = '';
    ogPreview.classList.add('hidden');
  }
}, 800);

// Initialize event listeners
function initEventListeners() {
  // Add item
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const raw = (itemInput?.value || '').trim();
      const qty = parseInt(qtyInput?.value || '1', 10) || 1;
      if (raw) {
        await addItem(raw, qty);
      }
    });
  }

  // Enter key to add
  if (itemInput) {
    itemInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const raw = (itemInput?.value || '').trim();
        const qty = parseInt(qtyInput?.value || '1', 10) || 1;
        if (raw) {
          await addItem(raw, qty);
        }
      }
    });

    // URL preview
    itemInput.addEventListener('input', (e) => {
      const value = e.target.value.trim();
      if (value) {
        debouncedPreview(value);
      } else {
        if (ogPreview) {
          ogPreview.innerHTML = '';
          ogPreview.classList.add('hidden');
        }
      }
    });
  }

  // Clear completed
  if (clearDoneBtn) {
    clearDoneBtn.addEventListener('click', async () => {
      if (confirm('Clear all completed items?')) {
        await clearCompleted();
      }
    });
  }

  // Invite modal
  if (inviteBtn) inviteBtn.addEventListener('click', () => {
    inviteModal.classList.remove('hidden');
  });
  
  if (closeInviteBtn) closeInviteBtn.addEventListener('click', () => {
    inviteModal.classList.add('hidden');
  });
  
  if (copyInviteBtn) copyInviteBtn.addEventListener('click', async () => {
    const text = inviteCodeEl?.textContent || '';
    if (text && text !== '—') {
      try {
        await navigator.clipboard.writeText(text);
        showSuccess('Invite code copied!');
      } catch (e) {
        showError('Failed to copy invite code');
      }
    }
  });

  // Logout
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to logout?')) {
        showLoading(true);
        try {
          await signOut(auth);
          localStorage.removeItem('listId');
          window.location.href = '/login.html';
        } catch (error) {
          showError('Logout failed');
          showLoading(false);
        }
      }
    });
  }
}

/* ===========================
   Enhanced FCM Message Handling
   =========================== */
function setupOnMessage() {
  safeAsyncOperation(async () => {
    const isMessagingSupported = await isSupported();
    if (!isMessagingSupported) return;

    const messaging = getMessaging(app);
    onMessage(messaging, (payload) => {
      if (payload && payload.notification) {
        const { title, body } = payload.notification;
        
        // Show in-app notification
        showSuccess(`${title}: ${body}`, 4000);
        
        // Also show browser notification if permitted
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { 
            body,
            icon: '/icons/icon-192.png'
          });
        }
      }
    });
  }, 'Failed to setup message handler');
}

/* ===========================
   Enhanced Auth State Management
   =========================== */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Not logged in - redirect to login (but allow login page itself)
    if (!window.location.pathname.endsWith('login.html')) {
      window.location.href = '/login.html';
    }
    return;
  }

  currentUid = user.uid;
  console.log('User authenticated:', currentUid);

  try {
    // Register for push notifications
    await registerFCMToken(currentUid);

    // Request notification permission if not granted
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    // Setup pair document and real-time listener
    await ensurePairDoc(currentUid);
    startPairListener(pairId);

    // Setup foreground message handling
    setupOnMessage();

    // Initialize UI event listeners
    initEventListeners();

    console.log('App initialized successfully');
    
  } catch (error) {
    console.error('App initialization failed:', error);
    showError('Failed to initialize app. Please refresh.');
  }
});

/* ===========================
   Network Status Monitoring
   =========================== */
window.addEventListener('online', () => {
  isOnline = true;
  showSuccess('Back online!', 2000);
});

window.addEventListener('offline', () => {
  isOnline = false;
  showError('You are offline. Some features may not work.', 5000);
});

/* ===========================
   Invite System
   =========================== */
export async function joinWithInviteCode(code, ownerListId) {
  return safeAsyncOperation(async () => {
    if (!code || !ownerListId) {
      throw new Error('Invite code and list ID are required');
    }

    if (!currentUid) {
      throw new Error('You must be logged in to join a list');
    }

    const pairRef = doc(db, 'pairs', ownerListId);
    const snap = await getDoc(pairRef);
    
    if (!snap.exists()) {
      throw new Error('Shopping list not found');
    }
    
    const data = snap.data();
    if (String(data.inviteCode) !== String(code)) {
      throw new Error('Invalid invite code');
    }

    // Add current user to users array
    await updateDoc(pairRef, { 
      users: arrayUnion(currentUid),
      updatedAt: Date.now()
    });

    // Set local listId
    localStorage.setItem('listId', ownerListId);
    pairId = ownerListId;
    
    // Restart listener with new pairId
    startPairListener(pairId);

    showSuccess('Successfully joined the shopping list!');
    
  }, 'Failed to join shopping list');
}

/* ===========================
   Cleanup on Unload
   =========================== */
window.addEventListener('beforeunload', () => {
  unsubscribePairListener();
});

// Global error handler
window.addEventListener('error', (e) => {
  console.error('Global error:', e.error);
  showError('Something went wrong. Please refresh the page.');
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  showError('Something went wrong. Please try again.');
});

// Utility function for other modules
async function getUserIdToken() {
  try {
    if (!auth || !auth.currentUser) return null;
    return await getIdToken(auth.currentUser, false);
  } catch (e) {
    console.warn('Failed to get id token', e);
    return null;
  }
}