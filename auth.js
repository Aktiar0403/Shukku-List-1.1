import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  signOut 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { 
  doc, 
  setDoc, 
  getDoc,
  updateDoc,
  arrayUnion,
  collection,
  query,
  where,
  getDocs
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

// Generate family reference code
function generateFamilyCode(familyName) {
  const cleanName = familyName.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 4);
  const randomDigits = Math.floor(1000 + Math.random() * 9000); // 1000-9999
  return `${cleanName}${randomDigits}`;
}

// Create new family (Family Creator)
export const createFamily = async (email, password, familyName, userName) => {
  try {
    if (!familyName || familyName.length < 2) {
      throw new Error('Family name must be at least 2 characters');
    }

    // 1. Create user account
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // 2. Generate unique family code
    const familyCode = generateFamilyCode(familyName);
    
    // 3. Create family document
    const familyData = {
      familyName: familyName.trim(),
      familyCode,
      createdBy: user.uid,
      members: [user.uid],
      items: [],
      categories: ['Groceries', 'Household', 'Personal Care', 'Electronics', 'Other'],
      monthlyBudget: 0,
      currency: 'USD',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await setDoc(doc(db, "families", familyCode), familyData);

    // 4. Create user document
    const userData = {
      email: user.email,
      name: userName.trim(),
      currentFamily: familyCode,
      role: 'admin',
      createdAt: new Date().toISOString()
    };

    await setDoc(doc(db, "users", user.uid), userData);

    console.log("Family created successfully:", familyCode);
    return { user, familyCode, familyName: familyName.trim() };

  } catch (error) {
    console.error("Error creating family:", error.code, error.message);
    const userMessage = authErrorMessages[error.code] || 
                       error.message || 
                       'Family creation failed. Please try again.';
    throw new Error(userMessage);
  }
};

// Join existing family (Family Member)
export const joinFamily = async (email, password, familyCode, userName) => {
  try {
    if (!familyCode || familyCode.length < 6) {
      throw new Error('Please enter a valid family code');
    }

    // 1. Verify family exists
    const familyRef = doc(db, "families", familyCode);
    const familySnap = await getDoc(familyRef);
    
    if (!familySnap.exists()) {
      throw new Error('Family not found. Please check the code.');
    }

    const familyData = familySnap.data();

    // 2. Create user account
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // 3. Add user to family members
    await updateDoc(familyRef, {
      members: arrayUnion(user.uid),
      updatedAt: new Date().toISOString()
    });

    // 4. Create user document
    const userData = {
      email: user.email,
      name: userName.trim(),
      currentFamily: familyCode,
      role: 'member',
      createdAt: new Date().toISOString()
    };

    await setDoc(doc(db, "users", user.uid), userData);

    console.log("User joined family successfully:", familyCode);
    return { user, familyCode, familyName: familyData.familyName };

  } catch (error) {
    console.error("Error joining family:", error.code, error.message);
    const userMessage = authErrorMessages[error.code] || 
                       error.message || 
                       'Failed to join family. Please try again.';
    throw new Error(userMessage);
  }
};

// Sign in user
export const signInUser = async (email, password) => {
  try {
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    console.log("User signed in successfully:", user.uid);
    return user;
  } catch (error) {
    console.error("Error during sign in:", error.code, error.message);
    const userMessage = authErrorMessages[error.code] || 
                       error.message || 
                       'Sign in failed. Please try again.';
    throw new Error(userMessage);
  }
};

// Get user's family data
export const getUserFamily = async (userId) => {
  try {
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      throw new Error('User data not found');
    }

    const userData = userSnap.data();
    const familyCode = userData.currentFamily;

    if (!familyCode) {
      return null; // User has no family
    }

    const familyRef = doc(db, "families", familyCode);
    const familySnap = await getDoc(familyRef);
    
    if (!familySnap.exists()) {
      throw new Error('Family data not found');
    }

    return {
      ...familySnap.data(),
      familyCode,
      userRole: userData.role
    };

  } catch (error) {
    console.error("Error getting user family:", error);
    throw error;
  }
};

// Update family budget
export const updateFamilyBudget = async (familyCode, budget) => {
  try {
    const familyRef = doc(db, "families", familyCode);
    await updateDoc(familyRef, {
      monthlyBudget: parseFloat(budget),
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error updating budget:", error);
    throw error;
  }
};

// Utility function to get current user
export const getCurrentUser = () => {
  return auth.currentUser;
};

// Sign out
export const signOutUser = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out:", error);
    throw error;
  }
};