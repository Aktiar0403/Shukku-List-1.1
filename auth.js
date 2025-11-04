import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { doc, setDoc, getDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

const emailEl = document.getElementById('email');
const passEl = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
const errorEl = document.getElementById('error');
const joinWithCode = document.getElementById('joinWithCode');

// Login
if (loginBtn) loginBtn.addEventListener('click', async () => {
  try {
    const cred = await signInWithEmailAndPassword(auth, emailEl.value, passEl.value);
    localStorage.setItem('uid', cred.user.uid);
    window.location.href = 'index.html';
  } catch (e) {
    errorEl.textContent = e.message;
  }
});

// Signup (create user + create own list document)
if (signupBtn) signupBtn.addEventListener('click', async () => {
  try {
    const cred = await createUserWithEmailAndPassword(auth, emailEl.value, passEl.value);
    const uid = cred.user.uid;
    // create list doc owned by this user
    const listRef = doc(db, 'lists', uid); // using uid as list id for simplicity
    await setDoc(listRef, {
      users: [uid],
      items: [],
      inviteCode: Math.floor(100000 + Math.random() * 900000).toString(),
      createdAt: Date.now()
    });
    localStorage.setItem('uid', uid);
    localStorage.setItem('listId', uid);
    window.location.href = 'index.html';
  } catch (e) {
    errorEl.textContent = e.message;
  }
});

// Join with invite code flow (simple prompt)
if (joinWithCode) joinWithCode.addEventListener('click', async () => {
  const code = prompt('Enter partner invite code');
  if (!code) return;
  // search lists collection for inviteCode match
  try {
    // naive approach: try to find doc with field inviteCode == code
    // For demo, we check uid-based doc (production: use a query)
    // We'll attempt to fetch all users' lists (may be limited)
    const listId = prompt('Paste partner list id (for demo use list owner uid)');
    if (!listId) return alert('Please paste partner list id (owner uid) for this demo');
    const listRef = doc(db, 'lists', listId);
    const snap = await getDoc(listRef);
    if (!snap.exists()) return alert('List not found');
    const data = snap.data();
    if (data.inviteCode !== code) return alert('Invite code does not match');
    // add current user to users array
    const uid = auth.currentUser.uid;
    await updateDoc(listRef, { users: Array.from(new Set([...(data.users||[]), uid])) });
    localStorage.setItem('listId', listId);
    alert('Joined list! Redirecting to list...');
    window.location.href = 'index.html';
  } catch (e) {
    alert('Error joining: ' + e.message);
  }
});

// Logout handler used by index
export async function logout() {
  try {
    await signOut(auth);
    localStorage.removeItem('uid');
    localStorage.removeItem('listId');
    window.location.href = 'login.html';
  } catch(e) {
    console.error(e);
  }
}

// If page is index and user already logged in, set localStorage
auth.onAuthStateChanged((user) => {
  if (user) localStorage.setItem('uid', user.uid);
});
