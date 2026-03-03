# Deployment Strategie - Meeting Planner 2026

De Meeting Planner applicatie bestaat nu uit twee losgekoppelde delen die elk op hun eigen platform gehost worden:
1.  **De Backend Proxy:** Een Cloudflare Worker die instaat voor het oplossen van WebUntis CORS problemen en het juist routeren van Session Cookies.
2.  **De Frontend:** Een statische React Single Page Application (SPA), gebouwd met Vite. Dit gaan we hosten op GitHub Pages.

Hieronder volgt het stappenplan om beide onderdelen succesvol online te krijgen.

---

## Deel 1: De Cloudflare Worker Deployen (Backend)

Momenteel draait de worker lokaal in je terminal via `npx wrangler dev`. We gaan dit script nu definitief opladen naar het Cloudflare netwerk zodat het 24/7 bereikbaar is.

1. Zorg ervoor dat je globaal aangemeld bent via wrangler: `npx wrangler login` in je terminal. Dit opent een browservenster.
2. Navigeer in de terminal naar de proxy werkmap: `cd MEETINGPLANNER2026/cloudflare-worker`
3. Check in [wrangler.toml](file:///c:/Users/p008465/Koofr/PROGPROJECTS/UntisBrowser/MEETINGPLANNER2026/cloudflare-worker/wrangler.toml) of de naam (`untis-proxy`) correct is bedacht (indien er één is gecreëerd, anders kan je deze genereren via `npx wrangler init`).
4. Om definitief online te zetten: run `npx wrangler deploy`.
5. Cloudflare geeft je na enkele seconden een URL terug die eindigt op `.workers.dev`. (vb: `https://untis-proxy.jouwaccount.workers.dev`). **Kopieer deze host name!**

---

## Deel 2: De React Frontend Configureren (Frontend)

Voor we de React code kunnen omzetten ('bouwen') naar statische bestanden voor Github Pages, moeten we de app vertellen *waar* de Cloudflare proxy in stap 1 is komen te staan. 

### Stap 2.1: De Service Linken
Open het bronbestand waar de Fetch acties naar de proxy worden uitgevoerd:
*   Open: [MEETINGPLANNER2026/src/services/UntisService.ts](file:///c:/Users/p008465/Koofr/PROGPROJECTS/UntisBrowser/MEETINGPLANNER2026/src/services/UntisService.ts)
*   Zoek bovenaan (lijn 5) naar de constante `BASE_URL`:
    ```typescript
    // Vroeger (tijdens lokaal testen):
    // const BASE_URL = 'http://localhost:8787'; 

    // Nu (Productie URLs):
    const BASE_URL = 'https://untis-proxy.JOUW_ACCOUNT.workers.dev';
    ```
Vervang de `localhost` URL dus door de url uit de vorige stap **(belangrijk: zonder afsluitende `/`)**. Sla het bestand op.

### Stap 2.2: Vite Configureren voor GitHub Pages Base Path
Omdat we de code waarschijnlijk gaan hosten op een specifiek pad binnen Github Pages (bijv. `https://jouwnaam.github.io/MeetingPlanner2026/`), moeten we Vite vertellen dit basis-pad in te calculeren bij het bouwen van de HTML, anders breken alle CSS en JS links (404 Not Found error).

*   Open: [MEETINGPLANNER2026/vite.config.ts](file:///c:/Users/p008465/Koofr/PROGPROJECTS/UntisBrowser/MEETINGPLANNER2026/vite.config.ts).
*   Voeg het in rood aangeduide `base` pad toe en vervang diens naam door exact de repository naam van Github:

```typescript
export default defineConfig({
  plugins: [react()],
  base: '/MeetingPlanner2026/', // Voeg dit toe
  //... de rest blijft hetzelfde
})
```

---

## Deel 3: Github Actions en Pages Opzetten

Het is sterk aangeraden om de code meteen via een GitHub integratie te laten bouwen bij elke wijziging ("CI/CD pipelines").

### Stap 3.1: Repository aanmaken
Zet de `MEETINGPLANNER2026` inhoud in jouw nieuwe GitHub omgeving en **commit** de aanpassingen van Stap 2.

### Stap 3.2: De Github Actions Workflow Toevoegen
1.  Maak in je Git project een verborgen folder mapstructuur aan (in de *root*): `.github/workflows/`.
2.  Maak daarin het tekstbestand aan: `deploy.yml`.
3.  Plak volgende inhoud in het bestand en commit dit:

```yaml
name: Deploy React App to GitHub Pages
on:
  push:
    branches: ["main"]
jobs:
  build_and_deploy:
    runs-on: ubuntu-latest
    permissions:
        contents: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Build project
        run: npm run build

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

### Stap 3.3: Permissies inschakelen
Nu dat de `deploy.yml` in de repository zit, gaat GitHub trachten dit te verifiëren wanneer je committeert op `main`. Hiervoor moeten wel de juiste rechten goed staan op Github:

1.  Ga naar **Settings > Actions > General** in de linker zijbalk op je Github Repository pagina.
2.  Scrol naar onder tot *Workflow permissions* en vink **Read and write permissions** aan. Sla deze sectie op.
3.  Ga naar **Settings > Pages** aan de zijkant.
4.  Onder `Source` bij *Build and deployment*, wijzig je de branch naar de nieuw aangemaakte "gh-pages" (vaak gebeurt dit nadat de eerste Action-ronde voltooid is) en de directory setting op "/ (root)", en klik **Save**. 

Vanaf nu is jouw front-end succesvol gekoppeld! Zodra GitHub je code succesvol compileert is dit direct bereikbaar op het `.github.io` adres!
