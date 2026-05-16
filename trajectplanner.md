# Trajectplanner-module — Implementatieprompt

## Context & doel
Bouw een **trajectplanner-module** binnen een bestaande React + Vite + Tauri meetingplanner-tool. De module ondersteunt een trajectbegeleider bij het samenstellen van een individueel studentrooster door OLODs (vakken) te kiezen uit roosters van verschillende klasgroepen.

De parent-tool levert reeds Untis-roosterdata aan via een geïnjecteerde service (zie *Aannames over de Untis-interface*). De module hoeft zich niets aan te trekken van authenticatie, ophaalmechanisme of caching — enkel de interface gebruiken.

## Kernfunctionaliteit (MVP)
1. Trajectbegeleider markeert in **instellingen** welke klasgroepen tot zijn opleiding behoren — die shortlist filtert al de rest.
2. Trajectbegeleider stelt het **semesterbereik** in (start- en einddatum).
3. Trajectbegeleider bladert door een **klasgroeprooster** en klikt lesblokken aan om OLODs toe te voegen of te verwijderen uit het studenttraject.
4. Een **live overzicht** toont het opgebouwde studentrooster, week per week, voor de volledige semesterperiode, met conflictdetectie.
5. **Reset**-knop wist het volledige studenttraject (met bevestiging).
6. **Print/PDF-export** van het studentrooster.

Expliciet **niet** in MVP: favorieten/templates, alternatievensuggesties, conflict-solver, meerdere studentdossiers parallel, export/import van settings.

## Datamodel

### Lesblok (input vanuit Untis-interface)
```typescript
type Lesblok = {
  klasgroep: string;        // bv. "2 TI A"
  olodNaam: string;         // bv. "Web Development"
  type: "theorie" | "lab";  // categorisatie
  start: Date;
  eind: Date;
  lokaal?: string;          // optioneel, enkel voor weergave
};
```

### OLOD-selectie (interne state)
Een OLOD wordt geïdentificeerd door de combinatie `(klasgroep, olodNaam)`. Het studenttraject is een lijst van zulke tupels. Alle lesblokken binnen het semesterbereik die aan een geselecteerde tupel voldoen, horen bij het traject.

```typescript
type OLODSelectie = {
  klasgroep: string;
  olodNaam: string;
};

type StudentTraject = OLODSelectie[];
```

### Instellingen (localStorage)
```typescript
type Settings = {
  mijnOpleidingKlasgroepen: string[]; // gefilterde shortlist
  semesterStart: string;              // ISO date
  semesterEind: string;               // ISO date
};
```

Ook het huidige studenttraject én de OLOD-kleurmap worden in localStorage bewaard, zodat een refresh niets verliest. De reset-knop wist enkel het traject (niet de instellingen, niet de kleurmap).

## Schermen en interactieflows

### Scherm 1 — Instellingen
- Lijst van **alle** beschikbare klasgroepen (uit `UntisService.getKlasgroepen()`), met zoek/filter.
- Checkboxes om klasgroepen te markeren als "behoort tot mijn opleiding".
- Datepickers voor semesterstart en -einde.
- Wijzigingen worden direct gepersisteerd in localStorage.

### Scherm 2 — Selectiewerkblad (hoofdscherm)
Drie panelen naast elkaar.

**Paneel A — Klasgroep-selector (smal, links)**
- Toont enkel klasgroepen uit `mijnOpleidingKlasgroepen`.
- Eén klasgroep tegelijk actief → bron voor paneel B.

**Paneel B — Klasgroeprooster (midden)**
- Toont het rooster van de actieve klasgroep voor een **navigeerbare week** (volgende/vorige week).
- Lesblokken zijn klikbaar.
- Klikgedrag op een blok van OLOD `X` in klasgroep `Y`:
  - Als `(Y, X)` nog niet in het traject zit → **toevoegen** (alle instanties van die OLOD in die klasgroep binnen het semester worden onderdeel van het studentrooster).
  - Als `(Y, X)` al in het traject zit → **volledig verwijderen** (alle instanties weg).
- Reeds geselecteerde OLODs zijn visueel gemarkeerd in de bron-weergave (bv. dikkere rand of vinkje).

**Paneel C — Studenttraject-overzicht (rechts, dominant)**
- **Verticale strip**: weken onder elkaar, één rij per week tussen `semesterStart` en `semesterEind`.
- Per week een compacte mini-kalender (dagen als kolommen, uren verticaal in de cel) met **gekleurde blokjes** — geen tekstdetails nodig, enkel kleur en positie.
- Eén **kleur per unieke `olodNaam`**, consistent over klasgroepen heen (zelfde vaknaam = zelfde kleur), automatisch toegekend uit een palet bij eerste verschijning.
- Blokjes met **tijdsoverlap** krijgen een **rode rand**.
- Onder de strip: **uitklapbaar conflictpaneel** met per conflict de twee betrokken lesblokken (datum, uur, OLOD-naam, klasgroep).
- Hover op blokje toont tooltip met OLOD-naam, klasgroep, type, lokaal.

### Globale acties
- **Reset**-knop in toolbar → bevestigingsdialog → wist `StudentTraject`.
- **Print/PDF**-knop → opent een print-view van paneel C, geoptimaliseerd voor afdruk:
  - Titel + huidige datum bovenaan.
  - Kleurbehoud met print-vriendelijk palet.
  - Legende van OLOD-kleuren onderaan.
  - Conflictlijst als bijlage indien aanwezig.

## Conflictdefinitie
Twee lesblokken zijn in conflict wanneer hun tijdsintervallen **overlappen**:
```typescript
const overlapt = (a: Lesblok, b: Lesblok) =>
  a.start < b.eind && b.start < a.eind;
```
Conflictdetectie gebeurt op het uitgerolde studenttraject (alle effectieve lesblokken), niet op OLOD-niveau.

## Kleurtoekenning
- Eén kleur per unieke `olodNaam`, stabiel binnen en tussen sessies (kleurmap in localStorage).
- Palet van minstens 12 visueel onderscheidbare, print-vriendelijke kleuren.
- Nieuwe OLOD krijgt de eerstvolgende vrije kleur uit het palet; bij uitputting cycleren.

## Aannames over de Untis-interface
De module verwacht een geïnjecteerde service met minimaal:
```typescript
interface UntisService {
  getKlasgroepen(): Promise<string[]>;
  getLesblokken(klasgroep: string, van: Date, tot: Date): Promise<Lesblok[]>;
}
```
Voorzie een **stub-implementatie** met realistische voorbeelddata (meerdere klasgroepen, gedeelde OLOD-namen tussen klasgroepen, theorie + lab, enkele overlappende uren om conflictlogica te testen), zodat de module standalone te ontwikkelen en demobaar is.

## Technische richtlijnen
- React + Vite + TypeScript, draaiend binnen Tauri-shell maar geschreven als zelfstandige webmodule.
- State management: React state + context voor het studenttraject; localStorage voor persistentie. Geen Redux.
- Styling: zo licht mogelijk; als shadcn/ui in de parent-tool beschikbaar is, gebruik dat, anders Tailwind of plain CSS modules.
- Print via `@media print` CSS — geen externe PDF-library, gewoon `window.print()`.
- Componenten opgesplitst per paneel + duidelijke `types.ts` met de modellen hierboven.

## Out of scope (volgende iteraties)
- **Favorieten**: huidige selectie bewaren als template om bij vergelijkbare studenten te hergebruiken.
- **Alternatievensuggesties** ("dit vak loopt ook in klasgroep B").
- **Conflict-solver**.
- **Export/import** van instellingen of trajecten als JSON.
- **Meerdere studentdossiers** parallel beheren.