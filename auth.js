import { auth, db } from './firebase-config.js';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js';
import { doc, setDoc, getDoc, updateDoc, query, where, collection, getDocs } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';

const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const errorEl = document.getElementById('error');

// --- LOGIN ---
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      localStorage.setItem('uid', cred.user.uid);

      // Fetch user's list (for simplicity, assume list exists with uid)
      localStorage.setItem('listId', cred.user.uid);
      window.location.href = 'shopping.html';
    } catch(e) {
      errorEl.textContent = e.message;
    }
  });
}

// --- SIGNUP ---
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value.trim();
    const partnerCode = document.getElementById('partner-code').value.trim();

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;

      // Create user's list doc
      const listRef = doc(db, 'lists', uid);
      await setDoc(listRef, {
        users: [uid],
        items: [],
        inviteCode: Math.floor(100000 + Math.random() * 900000).toString(),
        createdAt: Date.now()
      });

      localStorage.setItem('uid', uid);
      localStorage.setItem('listId', uid);

      // If partnerCode is provided, attempt to join that list
      if (partnerCode) {
        const listsCol = collection(db, 'lists');
        const q = query(listsCol, where('inviteCode', '==', partnerCode));
        const querySnap = await getDocs(q);
        if (!querySnap.empty) {
          const partnerList = querySnap.docs[0];
          const data = partnerList.data();
          await updateDoc(partnerList.ref, { users: Array.from(new Set([...(data.users||[]), uid])) });
          localStorage.setItem('listId', partnerList.id);
          alert('Joined partner list!');
        } else {
          alert('Partner code not found. You will have your own list.');
        }
      }

      window.location.href = 'index.html';
    } catch(e) {
      errorEl.textContent = e.message;
    }
  });
}

// --- LOGOUT ---
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

// --- Auth state listener ---
onAuthStateChanged(auth, (user) => {
  if (user) localStorage.setItem('uid', user.uid);
});
