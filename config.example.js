// Copy this file to config.js and fill in your values.
// config.js is in .gitignore so secrets are not committed.

window.FUSION_VOTE_CONFIG = {
  // Firebase Web App config from Firebase Console
  firebase: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
  },
  // Simple password for Admin Panel (no backend - store in config)
  adminPassword: "change-me"
};
