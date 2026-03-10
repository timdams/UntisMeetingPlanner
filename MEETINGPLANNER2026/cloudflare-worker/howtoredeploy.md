# Cloudflare Worker Deployment Guide

Dit document beschrijft de stappen om de `untis-proxy` Cloudflare Worker te installeren op een nieuwe locatie of om een bestaande installatie te updaten.

## Prerequisites

- **Node.js**: Zorg dat Node.js is geïnstalleerd op je systeem.
- **Service Account**: Je hebt een Cloudflare account nodig.

## Voorbereiding

Open een terminal in de `cloudflare-worker` map:
```bash
cd MEETINGPLANNER2026/cloudflare-worker
npm install
```

## A) Opnieuw installeren (Elders/Nieuw account)

Indien je de worker op een volledig nieuw Cloudflare account of onder een andere naam wilt installeren:

1.  **Login bij Cloudflare**:
    ```bash
    npx wrangler login
    ```
2.  **(Optioneel) Naam aanpassen**: 
    Open `wrangler.toml` en pas de `name` aan indien gewenst.
3.  **Deploy**:
    ```bash
    npx wrangler deploy
    ```
    Wrangler zal vragen of je de worker wilt aanmaken als deze nog niet bestaat. Bevestig dit.
4.  **Base URL aanpassen**:
    Vergeet niet de base URL in de frontend applicatie (`src/config.ts` of vergelijkbaar) aan te passen naar de nieuwe `.workers.dev` URL die je van Cloudflare krijgt na de succesvolle deploy.

## B) Bestaande installatie updaten

Indien je nieuwe functionaliteit hebt toegevoegd aan `src/index.js` en deze wilt live zetten op de bestaande worker:

1.  **Login via terminal** (indien de sessie verlopen is):
    ```bash
    npx wrangler login
    ```
2.  **Deploy update**:
    ```bash
    npx wrangler deploy
    ```
    Wrangler detecteert dat de worker al bestaat en zal de bestaande code overschrijven met de nieuwste versie uit `src/index.js`.

---

*Tip: Gebruik `npx wrangler dev` om de worker lokaal te testen alvorens te deployen.*
