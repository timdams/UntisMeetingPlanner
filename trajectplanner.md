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
  periodeGrenzen: {                   // alle grensdatums van het academiejaar
    s1Start: string; s1Eind: string;  // semester 1 (inclusieve ISO-datums)
    s2Start: string; s2Eind: string;  // semester 2
    m2Start: string; m4Start: string; // eerste dag van M2 resp. M4
  };
};

type KleurMap = Record<string, string>; // olodNaam → kleur
```

Ontbrekende velden worden bij het laden aangevuld (`normalizeSettings`): semester-indeling en de grensdatums van het standaard-academiejaar, met de modulegrenzen halverwege elk semester (dichtstbijzijnde maandag). De periodes zelf (`S1`, `S2`, `M1`…`M4`) worden volledig uit `periodeGrenzen` afgeleid in [academicYear.ts](MEETINGPLANNER2026/src/components/Traject/academicYear.ts) (`periodesVoor`); een onbruikbare grens (leeg veld, semester dat achteruit loopt, modulegrens buiten haar semester) valt per semester terug op de standaard uit `ACADEMIEJAAR`.

De grensdatums zijn dus **instelbaar en bewaard**: de periode-knoppen (instellingen én topbar) zetten de actieve periode op exact deze datums, zodat een periodewissel nooit een ingestelde datum overschrijft. Opslag van vóór deze wijziging bevat enkel `moduleGrenzen: { m2Start, m4Start }`; die twee waarden worden bij het laden overgenomen en aangevuld met de standaard semestergrenzen.

LocalStorage-sleutels:
- `traject_settings` — `TrajectSettings`
- `traject_student` — `StudentTraject`
- `traject_kleurmap` — `KleurMap`
- `traject_bewaard` — `BewaardTraject[]` (bewaarde trajecten: naam + `TrajectSettings` + `StudentTraject`; zie hieronder)

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
Gecentreerde kolom (max. 960px) met een sticky bovenbalk (*Klaar — terug naar werkblad*, titel, academiejaar-badge) en vier **inklapbare kaarten** ([SettingsCard.tsx](MEETINGPLANNER2026/src/components/Traject/SettingsCard.tsx)). Elke kaartkop toont een live één-regel-samenvatting ([settingsSummaries.ts](MEETINGPLANNER2026/src/components/Traject/settingsSummaries.ts)), zodat het scherm dichtgeklapt als overzicht leest; enkel *Mijn opleiding* staat standaard open. Lange uitleg zit per kaart achter een *Meer uitleg*-disclosure (native `<details>`).
- **Mijn opleiding**: geselecteerde klasgroepen als chips (met *Wis selectie*), zoekveld, *Selecteer alle/geen* (op de zichtbare lijst) en een checkbox-raster gegroepeerd per jaar (1e/2e/3e jaar, *Overige*).
- **Periode**: **indeling** als segmented control (Semesters / Modules, 2 per semester); datepickers voor de **semestergrenzen** (start en einde van semester 1 en 2) met een knop *Standaarddatums* die alles terugzet op `ACADEMIEJAAR`; in modulemodus daarnaast datepickers voor de **modulegrenzen** (start module 2 en 4, begrensd door hun semester) en een strip met de vier moduleperiodes. Een onbruikbare grens geeft een waarschuwing die de standaard vermeldt die zolang geldt. De snelkeuze van de **actieve periode** ([PeriodeSwitcher.tsx](MEETINGPLANNER2026/src/components/Traject/PeriodeSwitcher.tsx)) en de handmatige start/einde-datepickers zitten onder *Geavanceerd: actieve periode handmatig* — dat bereik is enkel wat het werkblad nú toont en verandert de grenzen niet.
- **Deel met student**: student-link genereren/kopiëren en QR tonen/downloaden (zie [trajectShare.ts](MEETINGPLANNER2026/src/components/Traject/trajectShare.ts)); een gegenereerde link verdwijnt zodra klasgroepen of periode wijzigen.
- **Back-up & herstel**: compacte herinnering dat alles browser-lokaal staat, *Exporteer back-up* (downloadt JSON) en *Importeer back-up…* (bestandskiezer; overschrijft instellingen + traject + kleurmap na bevestiging). Het tijdstip van de laatste export staat in localStorage (`traject_last_backup`, `useLastBackup` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts)) en wordt in de kaartkop getoond; "nooit" krijgt een waarschuwingskleur zodra er klasgroepen of een traject zijn.
- Wijzigingen worden direct gepersisteerd in localStorage.

### Scherm 2 — Selectiewerkblad
Drie panelen naast elkaar (grid: `200px 1fr 460px`).

**Paneel A — Klasgroep-selector** ([KlasgroepSelector.tsx](MEETINGPLANNER2026/src/components/Traject/KlasgroepSelector.tsx))
- Toont enkel klasgroepen uit `mijnOpleidingKlasgroepen`.
- Eén klasgroep tegelijk actief → bron voor paneel B.
- Lijst **Geselecteerde OLODs** met per selectie een **periode-badge** (`S1`, `M2`, of datums bij een handmatig bereik); de badge is gemarkeerd als de selectie de actieve periode raakt. Teller toont "in deze periode / totaal".
- In modulemodus is de badge een knop die een **periode-kiezer** opent: heel het semester (beide modules) of enkel module 1 of 2, voor die klasgroep (`setPeriode` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts); opties uit `periodeOptiesVoor`). De kiezer blijft open na een keuze.
- De **klasgroepnaam** van een selectie is eveneens een knop die een **klasgroep-kiezer** opent: alle klasgroepen uit de shortlist waar hetzelfde vak in de periode van de selectie voorkomt (met per klasgroep het aantal lessen; de tooltip toont de wekelijkse lesmomenten). Een keuze verhuist de selectie naar die klasgroep (`setKlasgroep` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts)); valt ze samen met een bestaande selectie, dan smelten ze samen. De kandidaten worden lui opgehaald zodra de kiezer opent (`useKlasgroepAlternatieven` in [useTrajectBlokken.ts](MEETINGPLANNER2026/src/components/Traject/useTrajectBlokken.ts)); klasgroepen waarvan het rooster nog niet beschikbaar is, worden apart vermeld. Hooguit één kiezer (periode of klasgroep) staat tegelijk open.
- **Wat-als-preview**: zolang de muis (of de toetsenbordfocus) op een andere klasgroep-chip in de kiezer staat, toont paneel C waar het vak dan zou vallen — zie hieronder. De preview verdwijnt zodra de muis de chip verlaat, de kiezer sluit of de wissel effectief gebeurt.
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
- **Wat-als-preview** vanuit de klasgroep-kiezer van paneel A (`preview`-prop, type `KlasgroepPreview`): de lessen van de verhuizende selectie bij de huidige klasgroep vervagen (tenzij een andere selectie van hetzelfde vak bij die klasgroep ze ook dekt), de lessen bij de kandidaat-klasgroep verschijnen als gestreepte, gestippeld omrande *ghost*-blokjes (zonder blokken die al in het traject zitten), en conflictdetectie + conflictpaneel rekenen voor dat scenario ("… bij wissel naar 2 TI B"). Een strip bovenaan vat samen: vak, nieuwe i.p.v. huidige klasgroep, aantal lessen en het aantal *nieuwe* conflicten (rood zodra > 0). De eerste week met een ghost-blok wordt zo nodig in beeld gescrold.

### Globale acties (toolbar in [TrajectPlanner.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectPlanner.tsx))
- Tab-switcher Werkblad / Instellingen.
- **Periode-switcher** (compact: `S1 | S2` of `M1 | M2 | M3 | M4`, afhankelijk van de indeling) — zet de actieve periode; paneel B en C volgen.
- **Reset traject** → confirm → wist enkel `StudentTraject`.
- **Bewaar traject** → vraagt een naam (`prompt`) en bewaart het huidige `StudentTraject` **samen met de `TrajectSettings`** (klasgroep-shortlist, actieve periode, semester/module-indeling, grensdatums) in `traject_bewaard` (`useBewaardeTrajecten` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts)). Een bestaande naam wordt na bevestiging overschreven. Kleurmap wordt niet meebewaard.
- **Laad traject** ([BewaardeTrajecten.tsx](MEETINGPLANNER2026/src/components/Traject/BewaardeTrajecten.tsx)) → uitklapmenu met alle bewaarde trajecten (naam, aantal OLODs/klasgroepen, periode, datum). Klik = na bevestiging traject **én instellingen** vervangen (zoals een back-up-import, zonder kleurmap); prullenbakje = bewaard traject verwijderen uit localStorage. Reset en import raken de bewaarde trajecten niet.
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
├── academicYear.ts          # Academiejaar, instelbare grensdatums (PeriodeGrenzen), periodes (periodesVoor), defaultRoosterWeek
├── trajectService.ts        # Adapter rond untisService met range-aware cache
├── hooks.ts                 # useTrajectSettings, useStudentTraject, useKleurMap (+ normalize/replace-functies voor import)
├── useTrajectBlokken.ts     # Jaarrooster per klasgroep in het traject + selectieStatussen (geen lessen / niet beschikbaar) + useKlasgroepAlternatieven (klasgroep-kiezer)
├── dateUtils.ts             # mondayOf, weeksBetween, isoWeekNumber, periodeBereik, formatters
├── PeriodeSwitcher.tsx      # Snelkeuze-knoppen actieve periode (topbar compact + instellingen)
├── TrajectPlanner.tsx       # Shell + topbar + tabs + periode-switcher + reset + bewaar/laad traject + print + export/import wiring
├── BewaardeTrajecten.tsx    # "Laad traject"-knop + uitklapmenu van bewaarde trajecten (laden / verwijderen)
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
