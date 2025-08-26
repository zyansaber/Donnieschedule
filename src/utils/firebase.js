
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, get } from 'firebase/database';
import { getFirestore } from "firebase/firestore";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBcczqGj5X1_w9aCX1lOK4-kgz49Oi03Bg",
  authDomain: "scheduling-dd672.firebaseapp.com",
  databaseURL: "https://scheduling-dd672-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "scheduling-dd672",
  storageBucket: "scheduling-dd672.firebasestorage.app",
  messagingSenderId: "432092773012",
  appId: "1:432092773012:web:ebc7203ea570b0da2ad281"
};

// Initialize Firebase
let app;
let database;
let firestoreDB;

try {
  app = initializeApp(firebaseConfig);
  firestoreDB = getFirestore(app,"schedule");
  database = getDatabase(app);
  console.log("Firebase initialized successfully");
} catch (error) {
  console.error("Firebase initialization failed:", error);
}

// Save dealer colors
export const saveDealerColors = async (colors) => {
  try {
    const dealerColorsRef = ref(database, 'dealerColors');
    await set(dealerColorsRef, colors);
    return true;
  } catch (error) {
    console.error("Error saving dealer colors:", error);
    throw error;
  }
};

// Fetch dealer colors
export const fetchDealerColors = async () => {
  try {
    const dealerColorsRef = ref(database, 'dealerColors');
    const snapshot = await get(dealerColorsRef);
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error("Error fetching dealer colors:", error);
    throw error;
  }
};

export { database, firestoreDB };
