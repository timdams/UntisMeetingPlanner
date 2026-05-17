# Trajectplanner-module — Implementatie

## Context & doel
Trajectplanner-module binnen de bestaande React + Vite + Tauri meetingplanner-tool. Helpt een trajectbegeleider bij het samenstellen van een individueel studentrooster door OLODs (vakken) te kiezen uit roosters van verschillende klasgroepen.

De module gebruikt de Untis-data van de parent-tool via een dunne adapter rond `untisService` — geen eigen authenticatie of caching nodig op consumer-niveau.

**Status: gerealiseerd (MVP).**

## Kernfunctionaliteit
1. Trajectbegeleider markeert in **instellingen** welke klasgroepen tot zijn opleiding behoren — die shortlist filtert al de rest.
2. Trajectbegeleider stelt het **semesterbereik** in (start- en einddatum).
3. Trajectbegeleider bladert door een **klasgroeprooster** en klikt lesblokken aan om OLODs toe te voegen of te verwijderen uit het studenttraject.
4. Een **live overzicht** toont het opgebouwde studentrooster, week per week, voor de volledige semesterperiode, met conflictdetectie.
5. **Reset**-knop wist het volledige studenttraject (met bevestiging).
6. **Print/PDF-export** van het studenttraject als **eenvoudige lijst** (OLOD-naam + klasgroep), gegroepeerd per klasgroep — géén visuele weergave.
7. **Back-up & herstel**: instellingen + traject + kleurmap exporteren naar JSON en importeren vanuit JSON.

Expliciet **niet** in MVP: favorieten/templates, alternatievensuggesties, conflict-solver, meerdere studentdossiers parallel.

## Datamodel
Geïmplementeerd in [MEETINGPLANNER2026/src/components/Traject/types.ts](MEETINGPLANNER2026/src/components/Traject/types.ts).

### Lesblok (output van de adapter)
```typescript
type Lesblok = {
  klasgroep: string;        // bv. "2 TI A" (displayName uit Untis)
  olodNaam: string;         // bv. "Web Development" (eerste subject uit lessonText)
  type?: string;            // ruwe Untis INFO-tag, bv. "Theorie", "Labo"; undefined als onbekend
  start: Date;
  eind: Date;
  lokaal?: string;          // momenteel niet gevuld door de adapter
};
```

### OLOD-selectie (interne state)
Een OLOD wordt geïdentificeerd door de combinatie `(klasgroep, olodNaam)`. Het studenttraject is een lijst van zulke tupels. Alle lesblokken binnen het semesterbereik die aan een geselecteerde tupel voldoen, horen bij het traject.

```typescript
type OLODSelectie = { klasgroep: string; olodNaam: string; };
type StudentTraject = OLODSelectie[];
```

### Instellingen + kleurmap (localStorage)
```typescript
type TrajectSettings = {
  mijnOpleidingKlasgroepen: string[]; // gefilterde shortlist
  semesterStart: string;              // ISO date
  semesterEind: string;               // ISO date
};

type KleurMap = Record<string, string>; // olodNaam → kleur
```

LocalStorage-sleutels:
- `traject_settings` — `TrajectSettings`
- `traject_student` — `StudentTraject`
- `traject_kleurmap` — `KleurMap`

De reset-knop wist enkel `traject_student`. Instellingen en kleurmap blijven staan.

## Aannames over de Untis-interface
De module bevat een eigen interface en een adapter rond de parent-`untisService`:

```typescript
interface TrajectUntisService {
  getKlasgroepen(): Promise<string[]>;
  getLesblokken(klasgroep: string, van: Date, tot: Date): Promise<Lesblok[]>;
}
```

De adapter ([trajectService.ts](MEETINGPLANNER2026/src/components/Traject/trajectService.ts)):
- Mapt `getKlasgroepen()` → `untisService.getClasses()` → `displayName[]`.
- Mapt `getLesblokken()` → `untisService.getRoster(classId, 'CLASS', ...)` en transformeert de roster-entries.
- Houdt een **range-aware cache per klasgroep** bij: een vraag die binnen een al-gefetcht bereik valt wordt vanuit het geheugen geserveerd, zodat panel B's wekelijkse view geen extra round-trip doet bovenop panel C's semesterfetch.
- Dedupliceert in-flight requests.

Een aparte stub-implementatie is niet nodig: er is al een echte Untis-backend.

## Schermen en interactieflows

### Scherm 1 — Instellingen ([TrajectSettings.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectSettings.tsx))
- Banner met waarschuwing dat alles browser-lokaal opgeslagen wordt en de aanbeveling om regelmatig een back-up te exporteren.
- **Back-up & herstel**-sectie met *Exporteer back-up* (downloadt JSON) en *Importeer back-up…* (bestandskiezer). Importeren overschrijft instellingen + traject + kleurmap, na bevestiging.
- **Semesterperiode**: datepickers voor start en einde.
- **Mijn opleiding — klasgroepen**: lijst van alle beschikbare klasgroepen met zoekveld; checkboxes om te markeren.
- Wijzigingen worden direct gepersisteerd in localStorage.

### Scherm 2 — Selectiewerkblad
Drie panelen naast elkaar (grid: `200px 1fr 460px`).

**Paneel A — Klasgroep-selector** ([KlasgroepSelector.tsx](MEETINGPLANNER2026/src/components/Traject/KlasgroepSelector.tsx))
- Toont enkel klasgroepen uit `mijnOpleidingKlasgroepen`.
- Eén klasgroep tegelijk actief → bron voor paneel B.

**Paneel B — Klasgroeprooster** ([KlasgroepRooster.tsx](MEETINGPLANNER2026/src/components/Traject/KlasgroepRooster.tsx))
- Toont het rooster van de actieve klasgroep voor een **navigeerbare week** (vorige/volgende).
- Lesblokken zijn klikbaar:
  - `(Y, X)` nog niet in het traject → **toevoegen**.
  - Reeds in het traject → **volledig verwijderen** (alle instanties).
- Geselecteerde OLODs hebben een donkere rand + witte inset.
- Hover-tooltip met OLOD, type, tijd, lokaal.

**Paneel C — Studenttraject-overzicht** ([StudentOverzicht.tsx](MEETINGPLANNER2026/src/components/Traject/StudentOverzicht.tsx))
- **Verticale strip**: één rij per week tussen `semesterStart` en `semesterEind`.
- Per week een mini-kalender (5 dagen × uren) met **gekleurde blokjes** — geen tekstdetails.
- Eén **kleur per unieke `olodNaam`**, consistent over klasgroepen heen.
- Blokjes met **tijdsoverlap** krijgen een **rode outline**.
- **Legende** onderaan met OLOD-namen + swatches.
- **Uitklapbaar conflictpaneel** onderaan met datum, uur, OLOD-naam en klasgroep per conflict.
- Hover-tooltip per blokje (CSS `data-tip`).

### Globale acties (toolbar in [TrajectPlanner.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectPlanner.tsx))
- Tab-switcher Werkblad / Instellingen.
- **Reset traject** → confirm → wist enkel `StudentTraject`.
- **Print / PDF** → `window.print()`.

## Conflictdefinitie
```typescript
const overlapt = (a: Lesblok, b: Lesblok) =>
  a.start < b.eind && b.start < a.eind;
```
Conflictdetectie loopt over alle effectieve lesblokken binnen het semester (uitgerold uit de OLOD-selecties), met een vroege break op gesorteerde startijden.

## Kleurtoekenning
- Eén kleur per unieke `olodNaam`, persistent in `traject_kleurmap`.
- Palet van **12** visueel onderscheidbare, print-vriendelijke kleuren.
- Nieuwe OLOD krijgt de eerstvolgende vrije kleur; bij uitputting cycleren.

## Print-export
**Visuele weergave wordt onderdrukt in print** (`@media print` verbergt `.overzichtScroll`, `.legendRow`, `.conflicts`).
De afdruk bevat:
- **Titel + semesterperiode + afdrukdatum** bovenaan.
- Een **eenvoudige lijst van OLODs**, gegroepeerd per klasgroep (alfabetisch), elk vak als bullet.

Geen kleurenlegende, geen conflictlijst, geen mini-kalender in de afdruk.

## Back-up & herstel
- **Export**: JSON-bestand met `{ settings, traject, kleurmap, exportedAt, version }`. Bestandsnaam bevat de exportdatum.
- **Import**: bestand inlezen, valideren, na confirm `replaceSettings` / `replaceTraject` / `replaceMap` aanroepen (zie [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts)).
- Feedback in de Instellingen-sectie met success/error-melding.

## Bestandsstructuur
```
MEETINGPLANNER2026/src/components/Traject/
├── types.ts                 # Lesblok, OLODSelectie, StudentTraject, TrajectSettings, KleurMap, Conflict, TrajectUntisService
├── trajectService.ts        # Adapter rond untisService met range-aware cache
├── hooks.ts                 # useTrajectSettings, useStudentTraject, useKleurMap (+ replace-functies voor import)
├── dateUtils.ts             # mondayOf, weeksBetween, isoWeekNumber, formatters
├── TrajectPlanner.tsx       # Shell + topbar + tabs + reset + print + export/import wiring
├── TrajectSettings.tsx      # Scherm 1
├── KlasgroepSelector.tsx    # Paneel A
├── KlasgroepRooster.tsx     # Paneel B
├── StudentOverzicht.tsx     # Paneel C + print-only OLOD-lijst
└── Traject.module.css       # Alle styling + @media print
```

Wiring: [App.tsx](MEETINGPLANNER2026/src/App.tsx) routeert `view === 'traject'` naar `<TrajectPlanner />`; [AppChoice.tsx](MEETINGPLANNER2026/src/components/AppChoice.tsx) biedt de keuze tegel.

## Technische richtlijnen (toegepast)
- React + Vite + TypeScript, draait binnen Tauri-shell maar geschreven als zelfstandige webmodule.
- State management: React state + lokale hooks; localStorage voor persistentie. Geen Redux.
- Styling: plain CSS modules (`Traject.module.css`); icons via `lucide-react`.
- Print via `@media print` + `window.print()`; geen externe PDF-library.

## Out of scope (volgende iteraties)
- **Favorieten**: huidige selectie bewaren als template om bij vergelijkbare studenten te hergebruiken.
- **Alternatievensuggesties** ("dit vak loopt ook in klasgroep B").
- **Conflict-solver**.
- **Meerdere studentdossiers** parallel beheren.
- **Lokaal-veld** invullen vanuit de Untis-roster-entries (nu leeg gelaten).
