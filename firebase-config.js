// Browser-friendly modular Firebase imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyArChDRFsV9V-PmpDdhYxB3FnqN69RVnAI",
  authDomain: "shukku-list.firebaseapp.com",
  projectId: "shukku-list",
  storageBucket: "shukku-list.appspot.com",
  messagingSenderId: "11625002783",
  appId: "1:11625002783:web:8776c517ff9bc4d266222a",
  measurementId: "G-7SW8GVLQ90"
};

// Initialize Firebase with error handling
let app;
try {
  app = initializeApp(firebaseConfig);
  console.log("Firebase initialized successfully");
} catch (error) {
  console.error("Firebase initialization error:", error);
  throw new Error("Failed to initialize Firebase");
}

// Initialize services with error handling
export const auth = getAuth(app);
export const db = getFirestore(app);

// Optional analytics
let analytics = null;
try {
  analytics = getAnalytics(app);
} catch (e) {
  console.log("Analytics not supported in this environment");
}

export default app;