// auth.js
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { db } from "./firebase-config"; // make sure your db is properly exported

const auth = getAuth();

// Utility to clean data (remove undefined values)
const cleanData = (data) => {
  return Object.fromEntries(Object.entries(data).filter(([_, v]) => v !== undefined));
};

// Sign up user
export const signUpUser = async (email, password, extraData = {}) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    const userData = cleanData({
      uid: user.uid,
      email: user.email,
      createdAt: new Date(),
      ...extraData
    });

    console.log("Writing user data to Firestore:", userData);
    await setDoc(doc(db, "users", user.uid), userData);
    console.log("User created and saved in Firestore successfully!");

    return user;
  } catch (error) {
    console.error("Error during sign up:", error.code, error.message);
    throw error;
  }
};

// Sign in user
export const signInUser = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    console.log("User signed in:", user.uid);
    return user;
  } catch (error) {
    console.error("Error during sign in:", error.code, error.message);
    throw error;
  }
};
