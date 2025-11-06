// Complete Family Shopping List App with Price Tracking & Categories
import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged,
  signOut,
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

import { 
  getUserFamily, 
  updateFamilyBudget,
  signOutUser 
} from './auth.js';

/* ===========================
   CONFIG
   =========================== */
const VAPID_KEY = "BCR2my_4hqB9XOqjBTKmPLyVbOAg1-juwelEHiFIIXNSuoBo7ZX_4A9ktcYuwxmlX2meAv97H1gavSiC_1x_Tpc";

/* ===========================
   DOM elements
   =========================== */
const itemInput = document.getElementById('itemInput');
const categorySelect = document.getElementById('categorySelect');
const qtyInput = document.getElementById('qtyInput');
const priceInput = document.getElementById('priceInput');
const addBtn = document.getElementById('addBtn');
const listContainer = document.getElementById('listContainer');
const familySettingsBtn = document.getElementById('familySettingsBtn');
const familySettingsModal = document.getElementById('familySettingsModal');
const monthlyBudgetInput = document.getElementById('monthlyBudget');
const saveSettingsBtn = document.getElementById('saveSettings');
const closeSettingsBtn = document.getElementById('closeSettings');
const logoutBtn = document.getElementById('logoutBtn');
const clearDoneBtn = document.getElementById('clearDoneBtn');
const familyNameEl = document.getElementById('familyName');
const memberCountEl = document.getElementById('memberCount');
const familyCodeTextEl = document.getElementById('familyCodeText');
const settingsFamilyCodeEl = document.getElementById('settingsFamilyCode');
const settingsMemberCountEl = document.getElementById('settingsMemberCount');
const categoryChipsEl = document.getElementById('categoryChips');
const ogPreview = document.getElementById('ogPreview');

// Spending elements
const totalSpentEl = document.getElementById('totalSpent');
const remainingBudgetEl = document.getElementById('remainingBudget');
const budgetAmountEl = document.getElementById('budgetAmount');
const budgetProgressEl = document.getElementById('budgetProgress');
const budgetPercentEl = document.getElementById('budgetPercent');
const spendingSummaryEl = document.getElementById('spendingSummary');

// Stats elements
const totalItemsEl = document.getElementById('totalItems');
const completedItemsEl = document.getElementById('completedItems');
const pricedItemsEl = document.getElementById('pricedItems');
const avgPriceEl = document.getElementById('avgPrice');

/* ===========================
   State
   =========================== */
let currentUid = null;
let currentFamilyCode = null;
let currentFamilyData = null;
let familyDocUnsubscribe = null;
let currentFilter = 'all';

/* ===========================
   Enhanced Utility Functions
   =========================== */

// Show user-friendly error messages
function showError(message, duration = 5000) {
  const existingToast = document.getElementById('error-toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.id = 'error-toast';
  toast.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 max-w-md';
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), duration);
}

// Show success messages
function showSuccess(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 max-w-md';
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), duration);
}

// Show loading state
function showLoading(show = true) {
  const loader = document.getElementById('globalLoader');
  if (loader) {
    loader.classList.toggle('hidden', !show);
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

// Format currency
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount || 0);
}

/* ===========================
   Price & Spending Calculations
   =========================== */

// Calculate total spending
function calculateTotalSpending(items) {
  return items
    .filter(item => item.done && item.price)
    .reduce((total, item) => total + (item.price * (item.qty || 1)), 0);
}

// Calculate budget usage
function calculateBudgetUsage(totalSpent, budget) {
  if (!budget || budget <= 0) return { percent: 0, remaining: 0 };
  
  const percent = (totalSpent / budget) * 100;
  const remaining = Math.max(0, budget - totalSpent);
  
  return { percent, remaining };
}

// Update spending summary UI
function updateSpendingSummary(items, familyData) {
  const totalSpent = calculateTotalSpending(items);
  const budget = familyData?.monthlyBudget || 0;
  const { percent, remaining } = calculateBudgetUsage(totalSpent, budget);
  
  // Update elements
  if (totalSpentEl) totalSpentEl.textContent = formatCurrency(totalSpent);
  if (remainingBudgetEl) remainingBudgetEl.textContent = formatCurrency(remaining);
  if (budgetAmountEl) budgetAmountEl.textContent = formatCurrency(budget);
  if (budgetProgressEl) budgetProgressEl.style.width = `${Math.min(percent, 100)}%`;
  if (budgetPercentEl) budgetPercentEl.textContent = `${Math.round(percent)}%`;
  
  // Update spending summary appearance based on budget usage
  if (spendingSummaryEl) {
    spendingSummaryEl.classList.remove('budget-warning', 'budget-danger');
    if (percent > 80 && percent <= 100) {
      spendingSummaryEl.classList.add('budget-warning');
    } else if (percent > 100) {
      spendingSummaryEl.classList.add('budget-danger');
    }
  }
}

// Update quick stats
function updateQuickStats(items) {
  const totalItems = items.length;
  const completedItems = items.filter(item => item.done).length;
  const pricedItems = items.filter(item => item.price).length;
  
  // Calculate average price of priced items
  const pricedItemsWithPrice = items.filter(item => item.price);
  const avgPrice = pricedItemsWithPrice.length > 0 
    ? pricedItemsWithPrice.reduce((sum, item) => sum + item.price, 0) / pricedItemsWithPrice.length 
    : 0;
  
  if (totalItemsEl) totalItemsEl.textContent = totalItems;
  if (completedItemsEl) completedItemsEl.textContent = completedItems;
  if (pricedItemsEl) pricedItemsEl.textContent = pricedItems;
  if (avgPriceEl) avgPriceEl.textContent = formatCurrency(avgPrice);
}

/* ===========================
   FCM: Enhanced token registration
   =========================== */
async function registerFCMToken(uid) {
  return safeAsyncOperation(async () => {
    const isMessagingSupported = await isSupported();
    if (!isMessagingSupported) {
      console.log('FCM not supported in this environment');
      return null;
    }

    const messaging = getMessaging(app);
    
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
    return await res.json();
  }, 'Failed to fetch product preview');
}

async function sendNotification(familyCode, payload) {
  return safeAsyncOperation(async () => {
    const res = await fetch('/api/sendNotification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        familyCode, 
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
   Family Management
   =========================== */
function unsubscribeFamilyListener() {
  if (typeof familyDocUnsubscribe === 'function') {
    familyDocUnsubscribe();
  }
  familyDocUnsubscribe = null;
}

function startFamilyListener(familyCode) {
  unsubscribeFamilyListener();
  
  const familyRef = doc(db, 'families', familyCode);
  
  familyDocUnsubscribe = onSnapshot(familyRef, 
    (snap) => {
      if (!snap.exists()) {
        console.warn('Family document not found');
        showError('Family data not found');
        return;
      }
      
      const data = snap.data();
      currentFamilyData = data;
      const items = data.items || [];
      const categories = data.categories || ['Groceries', 'Household', 'Personal Care', 'Electronics', 'Other'];
      
      // Update UI
      updateFamilyUI(data);
      renderList(items);
      updateProgress(items);
      updateSpendingSummary(items, data);
      updateQuickStats(items);
      renderCategoryChips(categories);
      
    },
    (error) => {
      console.error('Firestore listener error:', error);
      showError('Connection issue. Reconnecting...');
      
      setTimeout(() => {
        if (currentFamilyCode) {
          startFamilyListener(currentFamilyCode);
        }
      }, 5000);
    }
  );
}

function updateFamilyUI(familyData) {
  // Update family name
  if (familyNameEl) {
    familyNameEl.textContent = familyData.familyName || 'Shukku List';
  }
  
  // Update member count
  const memberCount = familyData.members?.length || 1;
  if (memberCountEl) {
    memberCountEl.classList.toggle('hidden', memberCount <= 1);
    document.getElementById('memberCountText').textContent = memberCount;
  }
  
  // Update family code
  if (familyCodeTextEl) {
    familyCodeTextEl.textContent = familyData.familyCode;
    familyCodeTextEl.parentElement.classList.remove('hidden');
  }
  
  // Update settings modal
  if (settingsFamilyCodeEl) {
    settingsFamilyCodeEl.textContent = familyData.familyCode;
  }
  if (settingsMemberCountEl) {
    settingsMemberCountEl.textContent = `${memberCount} member${memberCount !== 1 ? 's' : ''}`;
  }
  if (monthlyBudgetInput) {
    monthlyBudgetInput.value = familyData.monthlyBudget || '';
  }
}

/* ===========================
   Enhanced UI Rendering
   =========================== */
function renderList(items) {
  if (!listContainer) return;
  
  // Apply filter
  let filteredItems = items;
  if (currentFilter !== 'all') {
    filteredItems = items.filter(item => item.category === currentFilter);
  }
  
  listContainer.innerHTML = '';
  
  if (filteredItems.length === 0) {
    const message = currentFilter === 'all' 
      ? 'Your family list is empty. Add items above to get started!'
      : `No items in ${currentFilter} category.`;
    
    listContainer.innerHTML = `
      <li class="p-8 text-center text-gray-500 bg-white rounded shadow">
        <div class="text-gray-400 mb-3">🛒</div>
        <h3 class="text-lg font-medium text-gray-600 mb-2">${message}</h3>
      </li>
    `;
    return;
  }
  
  filteredItems.forEach((item, idx) => {
    const originalIndex = items.findIndex(i => i.id === item.id);
    const li = document.createElement('li');
    li.className = `p-4 bg-white rounded-lg shadow flex justify-between items-start transition-all duration-200 ${
      item.done ? 'opacity-60' : ''
    }`;
    
    const totalPrice = item.price && item.qty ? (item.price * item.qty).toFixed(2) : null;
    
    let leftHTML = `<div class="flex items-start flex-1 min-w-0">`;
    
    // Item image if available
    if (item.image) {
      leftHTML += `<img src="${item.image}" alt="" class="w-16 h-16 rounded mr-3 object-cover flex-shrink-0" onerror="this.style.display='none'">`;
    }
    
    leftHTML += `<div class="min-w-0 flex-1">`;
    
    // Category badge
    if (item.category) {
      leftHTML += `<span class="inline-block px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full mb-2">${escapeHtml(item.category)}</span>`;
    }
    
    // Item name with link if available
    if (item.link) {
      leftHTML += `<a href="${item.link}" target="_blank" rel="noopener" class="font-semibold text-blue-600 hover:text-blue-800 truncate block mb-1">${escapeHtml(item.name)}</a>`;
    } else {
      leftHTML += `<div class="font-semibold truncate mb-1">${escapeHtml(item.name)}</div>`;
    }
    
    // Item details with price information
    leftHTML += `<div class="text-sm text-gray-600 space-y-1">`;
    leftHTML += `<div>Qty: ${escapeHtml(item.qty || 1)}</div>`;
    
    if (item.price) {
      leftHTML += `<div>`;
      leftHTML += `Price: $${item.price.toFixed(2)} each`;
      if (totalPrice) {
        leftHTML += ` • <span class="font-semibold text-green-600">Total: $${totalPrice}</span>`;
      }
      leftHTML += `</div>`;
    }
    
    if (item.addedBy && item.addedBy !== currentUid) {
      leftHTML += `<div class="text-xs text-gray-500">Added by family member</div>`;
    }
    leftHTML += `</div>`;
    
    leftHTML += `</div></div>`;

    const rightHTML = `
      <div class="flex items-center space-x-2 flex-shrink-0 ml-3">
        <button class="btn-toggle p-2 rounded-full hover:bg-gray-100 transition-colors" data-idx="${originalIndex}" title="${item.done ? 'Mark as not bought' : 'Mark as bought'}">
          ${item.done ? '✅' : '🛒'}
        </button>
        <button class="btn-delete p-2 rounded-full hover:bg-red-50 text-red-500 transition-colors" data-idx="${originalIndex}" title="Remove item">
          ✕
        </button>
      </div>
    `;

    li.innerHTML = leftHTML + rightHTML;
    listContainer.appendChild(li);
  });

  // Update clear completed button state
  const hasCompletedItems = items.some(item => item.done);
  if (clearDoneBtn) {
    clearDoneBtn.disabled = !hasCompletedItems;
  }

  attachItemEventListeners();
}

function renderCategoryChips(categories) {
  if (!categoryChipsEl) return;
  
  categoryChipsEl.innerHTML = '';
  
  // All categories chip
  const allChip = document.createElement('button');
  allChip.className = `category-chip px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
    currentFilter === 'all' 
      ? 'bg-blue-600 text-white' 
      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
  }`;
  allChip.textContent = 'All Items';
  allChip.onclick = () => setCategoryFilter('all');
  categoryChipsEl.appendChild(allChip);
  
  // Category chips
  categories.forEach(category => {
    const chip = document.createElement('button');
    chip.className = `category-chip px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
      currentFilter === category 
        ? 'bg-blue-100 text-blue-800 border border-blue-300' 
        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
    }`;
    chip.textContent = category;
    chip.onclick = () => setCategoryFilter(category);
    categoryChipsEl.appendChild(chip);
  });
}

function setCategoryFilter(category) {
  currentFilter = category;
  if (currentFamilyData) {
    renderList(currentFamilyData.items || []);
  }
}

function updateProgress(items) {
  const total = items.length;
  const doneCount = items.filter(i => i.done).length;
  
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressBar = document.getElementById('progressBar');
  
  if (progressText) {
    progressText.textContent = `${doneCount} of ${total} items`;
  }
  
  if (progressBar && progressPercent) {
    const percentage = total ? Math.round((doneCount / total) * 100) : 0;
    progressBar.style.width = `${percentage}%`;
    progressPercent.textContent = `${percentage}%`;
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
async function addItem(rawText, category, qty = 1, price = null) {
  return safeAsyncOperation(async () => {
    if (!currentFamilyCode || !currentUid) {
      throw new Error('App not ready. Please refresh the page.');
    }

    const trimmedText = (rawText || '').trim();
    if (!trimmedText) {
      throw new Error('Please enter an item name or URL');
    }

    let item = {
      id: Date.now().toString(),
      name: trimmedText,
      category: category || 'Other',
      qty: parseInt(qty),
      price: price ? parseFloat(price) : null,
      addedBy: currentUid,
      done: false,
      createdAt: Date.now(),
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
    const familyRef = doc(db, 'families', currentFamilyCode);
    await updateDoc(familyRef, { 
      items: arrayUnion(item),
      updatedAt: Date.now()
    });

    // Clear inputs
    if (itemInput) itemInput.value = '';
    if (categorySelect) categorySelect.value = '';
    if (qtyInput) qtyInput.value = '1';
    if (priceInput) priceInput.value = '';
    if (ogPreview) {
      ogPreview.innerHTML = '';
      ogPreview.classList.add('hidden');
    }

    // Notify family members
    await sendNotification(currentFamilyCode, {
      title: 'Item added',
      body: `${item.name} added to ${item.category} list`,
      excludeUid: currentUid
    });

    showSuccess('Item added successfully!');
    
  }, 'Failed to add item');
}

async function toggleDone(index) {
  return safeAsyncOperation(async () => {
    if (!currentFamilyCode) throw new Error('No active family');

    const familyRef = doc(db, 'families', currentFamilyCode);
    const snap = await getDoc(familyRef);
    
    if (!snap.exists()) throw new Error('Family not found');
    
    const items = Array.isArray(snap.data().items) ? [...snap.data().items] : [];
    if (!items[index]) throw new Error('Item not found');
    
    items[index].done = !items[index].done;
    items[index].updatedAt = Date.now();
    
    await updateDoc(familyRef, { 
      items,
      updatedAt: Date.now()
    });

    const action = items[index].done ? 'bought' : 'marked not bought';
    await sendNotification(currentFamilyCode, {
      title: items[index].done ? 'Item bought' : 'Item updated',
      body: `${items[index].name} ${action}`,
      excludeUid: currentUid
    });

  }, 'Failed to update item');
}

async function deleteItem(index) {
  return safeAsyncOperation(async () => {
    if (!currentFamilyCode) throw new Error('No active family');

    const familyRef = doc(db, 'families', currentFamilyCode);
    const snap = await getDoc(familyRef);
    
    if (!snap.exists()) throw new Error('Family not found');
    
    const items = Array.isArray(snap.data().items) ? [...snap.data().items] : [];
    if (!items[index]) throw new Error('Item not found');
    
    const removedItem = items.splice(index, 1)[0];
    
    await updateDoc(familyRef, { 
      items,
      updatedAt: Date.now()
    });

    await sendNotification(currentFamilyCode, {
      title: 'Item removed',
      body: `${removedItem.name} removed from list`,
      excludeUid: currentUid
    });

    showSuccess('Item removed successfully!');
    
  }, 'Failed to remove item');
}

async function clearCompleted() {
  return safeAsyncOperation(async () => {
    if (!currentFamilyCode) throw new Error('No active family');

    const familyRef = doc(db, 'families', currentFamilyCode);
    const snap = await getDoc(familyRef);
    
    const items = Array.isArray(snap.data().items) ? snap.data().items : [];
    const filtered = items.filter(i => !i.done);
    
    if (filtered.length === items.length) {
      showError('No completed items to clear');
      return;
    }
    
    await updateDoc(familyRef, { 
      items: filtered,
      updatedAt: Date.now()
    });

    showSuccess('Completed items cleared!');
    
  }, 'Failed to clear completed items');
}

async function updateBudget(newBudget) {
  return safeAsyncOperation(async () => {
    if (!currentFamilyCode) throw new Error('No active family');

    await updateFamilyBudget(currentFamilyCode, newBudget);
    showSuccess('Budget updated successfully!');
    
    // Close settings modal
    familySettingsModal.classList.add('hidden');
    
  }, 'Failed to update budget');
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
      const category = categorySelect?.value || 'Other';
      const qty = parseInt(qtyInput?.value || '1', 10) || 1;
      const price = priceInput?.value || null;
      
      if (raw) {
        await addItem(raw, category, qty, price);
      }
    });
  }

  // Enter key to add
  if (itemInput) {
    itemInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const raw = (itemInput?.value || '').trim();
        const category = categorySelect?.value || 'Other';
        const qty = parseInt(qtyInput?.value || '1', 10) || 1;
        const price = priceInput?.value || null;
        
        if (raw) {
          await addItem(raw, category, qty, price);
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

  // Family settings
  if (familySettingsBtn) {
    familySettingsBtn.addEventListener('click', () => {
      familySettingsModal.classList.remove('hidden');
    });
  }
  
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
      familySettingsModal.classList.add('hidden');
    });
  }
  
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
      const budget = monthlyBudgetInput?.value || '0';
      await updateBudget(budget);
    });
  }

  // Copy invite code
  const copyInviteBtn = document.getElementById('copyInvite');
  if (copyInviteBtn) {
    copyInviteBtn.addEventListener('click', async () => {
      if (currentFamilyData?.familyCode) {
        try {
          await navigator.clipboard.writeText(currentFamilyData.familyCode);
          showSuccess('Family code copied!');
        } catch (e) {
          showError('Failed to copy family code');
        }
      }
    });
  }

  // Logout
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to logout?')) {
        showLoading(true);
        try {
          await signOutUser();
          window.location.href = './login.html';
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
  console.log('🔐 Auth state changed:', user ? `User logged in (${user.uid})` : 'No user');
  
  // Handle user logout
  if (!user) {
    console.log('👤 No user found, redirecting to login...');
    
    // Clean up listeners and state
    unsubscribeFamilyListener();
    currentUid = null;
    currentFamilyCode = null;
    currentFamilyData = null;
    
    // Redirect to login if not already there
    if (!window.location.pathname.endsWith('login.html') && 
        window.location.pathname !== '/login.html') {
      window.location.href = './login.html';
    }
    return;
  }

  // User is logged in
  currentUid = user.uid;
  console.log('✅ User authenticated:', currentUid);

  // If we're on login page and user is authenticated, redirect to main app
  if (window.location.pathname.endsWith('login.html') || 
      window.location.pathname === '/login.html') {
    window.location.href = './index.html';
    return;
  }

  // Initialize the app
  console.log('🚀 Initializing Family Shopping List app...');
  
  try {
    // Step 1: Get user's family data
    console.log('🏠 Loading family data...');
    const familyData = await getUserFamily(currentUid);
    
    if (!familyData) {
      showError('No family found. Please create or join a family.');
      window.location.href = './login.html';
      return;
    }

    currentFamilyCode = familyData.familyCode;
    currentFamilyData = familyData;

    // Step 2: Register for push notifications
    console.log('📱 Registering FCM token...');
    await registerFCMToken(currentUid);

    // Step 3: Start real-time listener for the family
    console.log('📡 Starting real-time listener for family:', currentFamilyCode);
    startFamilyListener(currentFamilyCode);

    // Step 4: Setup foreground message handling for notifications
    console.log('🔔 Setting up message handlers...');
    setupOnMessage();

    // Step 5: Initialize UI event listeners
    console.log('🎨 Initializing UI components...');
    initEventListeners();

    console.log('🎉 Family app initialized successfully!');
    
  } catch (error) {
    console.error('❌ App initialization failed:', error);
    showError('Failed to initialize app. Please refresh.');
    
    // Redirect to login if family data couldn't be loaded
    if (error.message.includes('family') || error.message.includes('Family')) {
      setTimeout(() => {
        window.location.href = './login.html';
      }, 3000);
    }
  }
});