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
  adminPassword: "change-me",
  // Opcjonalnie: URL API do zapisu miniaturek w repo GitHub (np. Vercel serverless).
  // Gdy ustawione, „Wgraj plik” w formularzu projektu wysyła obraz do API, które dodaje plik do images/projects/ w repo.
  // uploadImageApiUrl: "https://twoja-aplikacja.vercel.app/api/upload-thumbnail"
};
