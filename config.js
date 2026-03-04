// Replace with your Firebase and admin password. See config.example.js.

// Firebase Web config (from Console → Project settings → Your apps).
// useMock: false = live only (Firebase); no mock data when Firebase is unavailable.
window.FUSION_VOTE_CONFIG = {
  firebase: {
    apiKey: "AIzaSyBijGfYdIa4UtAgPiP8DpGPcnt0qUBtgm4",
    authDomain: "uipathfusiondb.firebaseapp.com",
    projectId: "uipathfusiondb",
    storageBucket: "uipathfusiondb.firebasestorage.app",
    messagingSenderId: "51307258253",
    appId: "1:51307258253:web:311d2a2766918730c55dc4"
  },
  adminPassword: "fusion2026",
  useMock: false  // true = fallback to mock when no Firebase; false = live only
};
