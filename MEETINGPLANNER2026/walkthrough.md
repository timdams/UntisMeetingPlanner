# Migration to Pure Browser Web App

We hebben de Tauri app succesvol omgezet naar een pure React/Vite webapplicatie, gereed voor GitHub Pages, inclusief de Cloudflare Worker integratie voor de Untis API!

## Changes Made
1. **Verhuizing**: Alle broncode is gekopieerd van `UntisBrowser.MeetingPlanner.Web` naar `MEETINGPLANNER2026`.
2. **Tauri Verwijderd**: In [package.json](file:///c:/Users/p008465/Koofr/PROGPROJECTS/UntisBrowser/MEETINGPLANNER2026/package.json) en [vite.config.ts](file:///c:/Users/p008465/Koofr/PROGPROJECTS/UntisBrowser/MEETINGPLANNER2026/vite.config.ts) zijn alle referenties naar `@tauri-apps/...` verwijderd. De app draait nu weer als een standaard React applicatie.
3. **API Client ([UntisService.ts](file:///c:/Users/p008465/Koofr/PROGPROJECTS/UntisBrowser/MEETINGPLANNER2026/src/services/UntisService.ts))**: 
   - De tauri HTTP plugin is vervangen door de ingebouwde browser [fetch](file:///c:/Users/p008465/Koofr/PROGPROJECTS/UntisBrowser/MEETINGPLANNER2026/cloudflare-worker/src/index.js#2-42) API.
   - De API url is aangepast om te poorten naar de proxy server.
4. **Cloudflare Worker Proxy**: We hebben een handmatige Cloudflare worker script gemaakt ([MEETINGPLANNER2026/cloudflare-worker/src/index.js](file:///c:/Users/p008465/Koofr/PROGPROJECTS/UntisBrowser/MEETINGPLANNER2026/cloudflare-worker/src/index.js)) die in staat is om:
   - Requests door te sturen naar `ap.webuntis.com`.
   - `CORS` headers (`Access-Control-Allow-Origin: *`) toe te voegen aan inkomende preflight `OPTIONS` requests en de daadwerkelijke web requests.

## Hoe te starten en testen
Omdat browsers zeer streng zijn met CORS, is de proxy verplicht.

### 1. Start de Proxy (in Terminal 1)
```powershell
cd c:\Users\p008465\Koofr\PROGPROJECTS\UntisBrowser\MEETINGPLANNER2026\cloudflare-worker
npx wrangler dev
```
Dit start een lokale reverse proxy op `http://localhost:8787`.

### 2. Start de React App (in Terminal 2)
```powershell
cd c:\Users\p008465\Koofr\PROGPROJECTS\UntisBrowser\MEETINGPLANNER2026
npm run dev
```
Open de URL in je browser (doorgaans `http://localhost:3000` of de URL in je console).

### 3. Deployen naar Cloudflare en Github
Wanneer je klaar bent kan je runnen:
*   In `cloudflare-worker`: `npx wrangler deploy` (Deployt de proxy server).
*   Pas je [UntisService.ts](file:///c:/Users/p008465/Koofr/PROGPROJECTS/UntisBrowser/MEETINGPLANNER2026/src/services/UntisService.ts) aan zodat `BASE_URL` wijst naar je nieuwe cloudflare URL in plaats van localhost.
*   Zet de inhoud van `MEETINGPLANNER2026` op GitHub Pages.
