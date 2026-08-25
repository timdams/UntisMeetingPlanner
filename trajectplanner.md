# Trajectplanner-module — Implementatie

## Context & doel
Trajectplanner-module binnen de bestaande React + Vite + Tauri meetingplanner-tool. Helpt een trajectbegeleider bij het samenstellen van een individueel studentrooster door OLODs (vakken) te kiezen uit roosters van verschillende klasgroepen.

De module gebruikt de Untis-data van de parent-tool via een dunne adapter rond `untisService` — geen eigen authenticatie of caching nodig op consumer-niveau.

**Status: gerealiseerd (MVP).**

## Kernfunctionaliteit
1. Trajectbegeleider markeert in **instellingen** welke klasgroepen tot zijn opleiding behoren — die shortlist filtert al de rest.
2. Trajectbegeleider kiest de **periode-indeling** (semesters, of modules = 2 per semester) en de **actieve periode**. In het werkblad wisselt hij via de **periode-switcher** in de topbar snel van periode (S1/S2 of M1…M4).
3. Trajectbegeleider bladert door een **klasgroeprooster** en klikt lesblokken aan om OLODs toe te voegen of te verwijderen uit het studenttraject. Een keuze geldt voor de **actieve periode**; hetzelfde vak kan in een volgende module bij een andere klasgroep gekozen worden.
4. Een **live overzicht** toont het opgebouwde studentrooster, week per week, voor de actieve periode, met conflictdetectie.
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
Een OLOD-keuze is **periodegebonden**: de student volgt `olodNaam` bij `klasgroep` tussen `van` en `tot` (inclusieve ISO-datums; het actieve periodebereik op het moment van klikken). Zo kan hetzelfde vak in module 1 bij klasgroep A en in module 2 bij klasgroep B gekozen worden zonder dat beide keuzes elkaar overlappen. Het studenttraject is één lijst voor het hele academiejaar; het overzicht toont enkel de selecties die de actieve periode raken. Alle lesblokken van de tuple `(klasgroep, olodNaam)` waarvan de datum binnen `[van, tot]` én binnen de actieve periode valt, horen bij het traject.

```typescript
type OLODSelectie = { klasgroep: string; olodNaam: string; van: string; tot: string; };
type StudentTraject = OLODSelectie[];
```

Oudere opgeslagen selecties zonder `van`/`tot` krijgen bij het laden het volledige academiejaar als bereik (`normalizeTraject` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts)).

### Instellingen + kleurmap (localStorage)
```typescript
type TrajectSettings = {
  mijnOpleidingKlasgroepen: string[]; // gefilterde shortlist
  semesterStart: string;              // actieve periode — ISO date (historische naam)
  semesterEind: string;               // actieve periode — ISO date
  periodeType: 'semester' | 'module'; // indeling van de opleiding
  moduleGrenzen: { m2Start: string; m4Start: string }; // eerste dag van M2 resp. M4
};

type KleurMap = Record<string, string>; // olodNaam → kleur
```

Ontbrekende velden worden bij het laden aangevuld (`normalizeSettings`): semester-indeling en modulegrenzen halverwege elk semester (dichtstbijzijnde maandag). De periodes zelf (`S1`, `S2`, `M1`…`M4`) worden afgeleid in [academicYear.ts](MEETINGPLANNER2026/src/components/Traject/academicYear.ts) (`periodesVoor`); een ongeldige modulegrens valt terug op de standaard.

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
- Houdt een **range-aware cache per klasgroep** bij: een vraag die volledig binnen een al-gefetcht interval valt wordt vanuit het geheugen geserveerd, zodat panel B's wekelijkse view geen extra round-trip doet bovenop panel C's periodefetch. De cache bewaart een lijst gedekte intervallen (geen unie-bereik), zodat een tussenliggende, nooit opgehaalde module niet als leeg uit de cache komt.
- Dedupliceert in-flight requests.

Een aparte stub-implementatie is niet nodig: er is al een echte Untis-backend.

## Schermen en interactieflows

### Scherm 1 — Instellingen ([TrajectSettings.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectSettings.tsx))
- Banner met waarschuwing dat alles browser-lokaal opgeslagen wordt en de aanbeveling om regelmatig een back-up te exporteren.
- **Back-up & herstel**-sectie met *Exporteer back-up* (downloadt JSON) en *Importeer back-up…* (bestandskiezer). Importeren overschrijft instellingen + traject + kleurmap, na bevestiging.
- **Periode**: keuze van de **indeling** (Semesters / Modules, 2 per semester); in modulemodus datepickers voor de **modulegrenzen** (start module 2 en 4, met waarschuwing bij een ongeldige grens); snelkeuze van de **actieve periode** ([PeriodeSwitcher.tsx](MEETINGPLANNER2026/src/components/Traject/PeriodeSwitcher.tsx), semesters + in modulemodus ook modules) en datepickers voor een handmatig start/einde.
- **Mijn opleiding — klasgroepen**: lijst van alle beschikbare klasgroepen met zoekveld; checkboxes om te markeren.
- Wijzigingen worden direct gepersisteerd in localStorage.

### Scherm 2 — Selectiewerkblad
Drie panelen naast elkaar (grid: `200px 1fr 460px`).

**Paneel A — Klasgroep-selector** ([KlasgroepSelector.tsx](MEETINGPLANNER2026/src/components/Traject/KlasgroepSelector.tsx))
- Toont enkel klasgroepen uit `mijnOpleidingKlasgroepen`.
- Eén klasgroep tegelijk actief → bron voor paneel B.
- Lijst **Geselecteerde OLODs** met per selectie een **periode-badge** (`S1`, `M2`, of datums bij een handmatig bereik); de badge is gemarkeerd als de selectie de actieve periode raakt. Teller toont "in deze periode / totaal".
- In modulemodus is de badge een knop die een **periode-kiezer** opent: heel het semester (beide modules) of enkel module 1 of 2, voor die klasgroep (`setPeriode` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts); opties uit `periodeOptiesVoor`). De kiezer blijft open na een keuze.
- **Waarschuwing** bij een selectie die in haar periode geen enkele les van dat vak bij die klasgroep oplevert (bv. na een wissel naar een module waarin het vak niet loopt): oranje kader + melding "Geen lessen van dit vak bij … in …". Is het rooster van die periode nog niet beschikbaar (Untis 404), dan staat er een informatieve melding in plaats van een vals alarm. Statussen komen uit `selectieStatussen` in [useTrajectBlokken.ts](MEETINGPLANNER2026/src/components/Traject/useTrajectBlokken.ts), dat ook het jaarrooster voor paneel C levert.

**Paneel B — Klasgroeprooster** ([KlasgroepRooster.tsx](MEETINGPLANNER2026/src/components/Traject/KlasgroepRooster.tsx))
- Toont het rooster van de actieve klasgroep voor een **navigeerbare week** (vorige/volgende). Bij een periodewissel springt de week naar de eerste lesweek van die periode (of naar vandaag als die erin valt).
- Lesblokken zijn klikbaar:
  - Valt het blok onder geen enkele selectie van `(Y, X)` → **toevoegen** voor de actieve periode.
  - Valt het blok onder een bestaande selectie → **die selectie verwijderen** (alle instanties binnen haar periode).
- Geselecteerde OLODs hebben een donkere rand + witte inset.
- Hover-popover toont hetzelfde vak in andere klasgroepen van de shortlist (handig om een vak in een volgende module elders te kiezen).

**Paneel C — Studenttraject-overzicht** ([StudentOverzicht.tsx](MEETINGPLANNER2026/src/components/Traject/StudentOverzicht.tsx))
- **Verticale strip**: één rij per week voor het **volledige academiejaar**; elke selectie draagt enkel binnen haar eigen periode bij. Subtiele **grensmarkeringen** bij de start van elk semester (en in modulemodus elke module); de weken van de actieve periode zijn gemarkeerd en worden bij een periodewissel in beeld gescrold.
- Per week een mini-kalender (5 dagen × uren) met **gekleurde blokjes** — geen tekstdetails.
- Eén **kleur per unieke `olodNaam`**, consistent over klasgroepen heen.
- Blokjes met **tijdsoverlap** krijgen een **rode outline**.
- **Legende** onderaan met OLOD-namen + swatches.
- **Uitklapbaar conflictpaneel** onderaan met datum, uur, OLOD-naam en klasgroep per conflict.
- Hover-tooltip per blokje (CSS `data-tip`).

### Globale acties (toolbar in [TrajectPlanner.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectPlanner.tsx))
- Tab-switcher Werkblad / Instellingen.
- **Periode-switcher** (compact: `S1 | S2` of `M1 | M2 | M3 | M4`, afhankelijk van de indeling) — zet de actieve periode; paneel B en C volgen.
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
- **Titel + actieve periode (naam + datums) + afdrukdatum** bovenaan.
- Een **eenvoudige lijst van OLODs** voor het volledige traject, gegroepeerd per klasgroep (alfabetisch), elk vak als bullet met zijn periode, bv. `Web Development (M2)`.

Geen kleurenlegende, geen conflictlijst, geen mini-kalender in de afdruk.

## Back-up & herstel
- **Export**: JSON-bestand met `{ settings, traject, kleurmap, exportedAt, version }`. Bestandsnaam bevat de exportdatum.
- **Import**: bestand inlezen, valideren, na confirm `replaceSettings` / `replaceTraject` / `replaceMap` aanroepen (zie [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts)).
- Feedback in de Instellingen-sectie met success/error-melding.

## Bestandsstructuur
```
MEETINGPLANNER2026/src/components/Traject/
├── types.ts                 # Lesblok, OLODSelectie, StudentTraject, TrajectSettings, KleurMap, Conflict, TrajectUntisService
├── academicYear.ts          # Academiejaar, semesters, modules (Periode, periodesVoor, modulegrenzen), defaultRoosterWeek
├── trajectService.ts        # Adapter rond untisService met range-aware cache
├── hooks.ts                 # useTrajectSettings, useStudentTraject, useKleurMap (+ normalize/replace-functies voor import)
├── useTrajectBlokken.ts     # Jaarrooster per klasgroep in het traject + selectieStatussen (geen lessen / niet beschikbaar)
├── dateUtils.ts             # mondayOf, weeksBetween, isoWeekNumber, periodeBereik, formatters
├── PeriodeSwitcher.tsx      # Snelkeuze-knoppen actieve periode (topbar compact + instellingen)
├── TrajectPlanner.tsx       # Shell + topbar + tabs + periode-switcher + reset + print + export/import wiring
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
