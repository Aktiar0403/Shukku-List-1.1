import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { 
  doc, 
  setDoc 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { auth, db } from './firebase-config.js';

// Enhanced error mapping
const authErrorMessages = {
  'auth/email-already-in-use': 'This email is already registered. Please log in instead.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/weak-password': 'Password should be at least 6 characters long.',
  'auth/user-not-found': 'No account found with this email.',
  'auth/wrong-password': 'Incorrect password. Please try again.',
  'auth/network-request-failed': 'Network error. Please check your connection.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.'
};

// Utility to clean data (remove undefined values)
const cleanData = (data) => {
  const cleaned = {};
  Object.keys(data).forEach(key => {
    if (data[key] !== undefined && data[key] !== null) {
      cleaned[key] = data[key];
    }
  });
  return cleaned;
};

// Sign up user with enhanced error handling
export const signUpUser = async (email, password, extraData = {}) => {
  try {
    // Input validation
    if (!email || !password) {
      throw new Error('Email and password are required');
    }
    
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Prepare user data for Firestore
    const userData = cleanData({
      uid: user.uid,
      email: user.email,
      name: extraData.name || '',
      createdAt: new Date().toISOString(),
      ...extraData
    });

    console.log("Creating user document in Firestore:", userData);
    await setDoc(doc(db, "users", user.uid), userData);
    console.log("User created and saved in Firestore successfully!");

    return user;
  } catch (error) {
    console.error("Error during sign up:", error.code, error.message);
    
    // Provide user-friendly error messages
    const userMessage = authErrorMessages[error.code] || 
                       error.message || 
                       'Sign up failed. Please try again.';
    throw new Error(userMessage);
  }
};

// Sign in user with enhanced error handling
export const signInUser = async (email, password) => {
  try {
    // Input validation
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    console.log("User signed in successfully:", user.uid);
    return user;
  } catch (error) {
    console.error("Error during sign in:", error.code, error.message);
    
    // Provide user-friendly error messages
    const userMessage = authErrorMessages[error.code] || 
                       error.message || 
                       'Sign in failed. Please try again.';
    throw new Error(userMessage);
  }
};

// Utility function to get current user
export const getCurrentUser = () => {
  return auth.currentUser;
};