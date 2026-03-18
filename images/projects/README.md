# Miniatury projektów (thumbnails)

**Przez formularz:** W panelu admina (Add project / Edit project) przy wyborze **Upload file** miniatura jest automatycznie kompresowana i zapisywana w **Firebase Storage** (katalog `project-thumbnails/`). W Firestore zapisywany jest tylko URL — bez limitu rozmiaru dokumentu.

**Opcjonalnie z repozytorium:** Możesz też dodać tutaj pliki (PNG, JPG) i podać ich URL w formularzu (pole **Image URL**). Po deployu na GitHub Pages: `https://<user>.github.io/FusionHckVote/images/projects/nazwa.png`
