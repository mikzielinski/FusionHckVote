# API: upload miniatury do GitHub (Vercel)

Funkcja serverless zapisuje obraz z formularza w repo GitHub (`images/projects/`), żeby można było dodawać miniatury przez formularz bez Firebase Storage.

## Wdrożenie (Vercel)

1. Zainstaluj Vercel CLI: `npm i -g vercel`
2. W katalogu projektu: `vercel` (pierwszy raz połącz z kontem)
3. Ustaw zmienne środowiskowe w Vercel Dashboard (Project → Settings → Environment Variables):
   - **GITHUB_TOKEN** — Personal Access Token (GitHub → Settings → Developer settings → Personal access tokens) z uprawnieniem `repo`
   - **GITHUB_REPO** — `owner/repo`, np. `mikzielinski/FusionHckVote`
   - **GITHUB_PAGES_BASE** (opcjonalnie) — bazowy URL strony, np. `https://mikzielinski.github.io/FusionHckVote`
4. Redeploy: `vercel --prod`

## Konfiguracja w aplikacji

W `config.js` dodaj (użyj URL swojego deploymentu Vercel):

```javascript
window.FUSION_VOTE_CONFIG = {
  // ... firebase, adminPassword
  uploadImageApiUrl: "https://twoja-aplikacja.vercel.app/api/upload-thumbnail"
};
```

Po tym w formularzu „Wgraj plik” będzie wysyłał obraz do API, a link do pliku w repo zostanie zapisany w projekcie.

## Bez API

Jeśli nie ustawisz `uploadImageApiUrl`, wgrany plik jest kompresowany i zapisywany w Firestore (`thumbnailDataUrl`). Możesz też dodać pliki ręcznie do `images/projects/` i podać URL w polu „Adres URL obrazu”.
