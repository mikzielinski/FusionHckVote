# UiPath Fusion — Public Choice Award (Hackathon Voting)

Mobile-first voting web app for the UiPath Fusion hackathon. Participants vote for up to 2 projects. Static SPA for **GitHub Pages**, data in **Firebase Firestore**.

- **/#/vote** — Public voting (max 2 votes, change anytime)
- **/#/results** — Live results and Chart.js bar chart
- **/#/admin** — Admin panel (add/edit/delete projects, stats; password-protected)

## Stack

- HTML, CSS, vanilla JavaScript
- Firebase Firestore (database)
- Chart.js (results charts)
- Hash routing (no server)

## Assets

- `images/banner-hero.png` — mobile vote-page banner
- `images/banner-desktop.png` — desktop/laptop vote-page banner
- `images/banner-event.png` — event banner (results page)

## Quick start

1. **Clone**
   ```bash
   git clone https://github.com/mikzielinski/FusionHckVote.git UiPathFusion
   cd UiPathFusion
   ```

2. **Firebase**
   - Create a project at [Firebase Console](https://console.firebase.google.com)
   - Enable **Firestore**
   - Register a web app and copy the config object
   - In **Firestore → Rules**, use rules that allow read/write for your app (see below)

3. **Config**
   - Open `config.js`
   - Set `firebase` with your project config
   - Set `adminPassword` for the admin panel

4. **Run locally**
   - Serve the folder (e.g. `npx serve .` or `python -m http.server 8000`)
   - Open `http://localhost:8000/#/vote`

## Deploy on GitHub Pages

1. Push this repo to GitHub (e.g. `mikzielinski/FusionHckVote`).
2. **Settings → Pages**: Source = “Deploy from a branch”, Branch = `main`, folder = `/ (root)`.
3. Site URL: `https://<username>.github.io/FusionHckVote/`
4. In Firebase Console, add this origin to **Authentication → Settings → Authorized domains** (if you use auth) and ensure **Firestore rules** allow your domain as needed.

## Firestore collections

- **projects**  
  `projectId`, `name`, `description`, `team`, `videoUrl`, `thumbnailUrl`, `createdAt`, `isActive`

- **votes**  
  `voteId`, `projectId`, `voterId`, `timestamp`

- **views**  
  `viewId`, `projectId`, `voterId`, `timestamp`

- **config/app** (single document)  
  `votingEnabled` (boolean) — when `false`, voting is disabled for everyone. Toggled from Admin.

## Firestore rules (example)

Because the app is static and admin runs in the browser, the client must be allowed to write to `projects` for the admin panel to work. Example for a closed event:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /projects/{id} {
      allow read: if true;
      allow create, update, delete: if true;  // admin panel runs in browser
    }
    match /votes/{id} {
      allow read: if true;
      allow create: if true;
      allow update, delete: if true;  // so users can change their vote
    }
    match /views/{id} {
      allow read: if true;
      allow create: if true;
      allow update, delete: if false;
    }
    match /config/{doc} {
      allow read: if true;
      allow write: if true;  // admin toggles voting on/off
    }
  }
}
```

Restrict by domain or use Firebase Auth for production if needed.

## Optional enhancements

The spec mentioned three useful additions that still work on GitHub Pages:

1. **QR voting** — Generate a QR code that links to `https://yoursite.github.io/FusionHckVote/#/vote`; scanning opens the vote page.
2. **Anti-cheat** — Detect multiple devices (e.g. same voterId from many IPs or fingerprint); log views/votes and analyze in admin or externally.
3. **Live leaderboard** — A separate “display” URL (e.g. `/#/results` or `/#/leaderboard`) that auto-refreshes; show it on the conference screen.

## License

For use at UiPath Fusion event. All rights reserved.
