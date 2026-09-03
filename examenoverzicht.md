# Examenoverzicht-module — Ontwerp

**Status: gebouwd (fase 1 t/m 6), nog niet op echte Untis-data getest.** Fase 0 — de verificatie van de
ruwe Untis-velden — staat nog open; de module bevat daarvoor een uitklapbaar *Diagnose*-paneel onder het
overzicht, zodat de vragen onderaan dit document zonder browserconsole beantwoord kunnen worden. De sectie
[Gebouwd — afwijkingen van het ontwerp](#gebouwd--afwijkingen-van-het-ontwerp) somt op waar de bouw van dit
ontwerp afweek en waarom.

## Context & doel
Derde module naast de Meeting Planner (bevroren) en de Traject Planner. Een opleidingsmedewerker stelt
**eenmalig** in welke opleidingen hij beheert en welke klasgroepen daarbij horen, kiest daarna een
**opleiding en een week**, en krijgt die week samengevat in **zo weinig mogelijk roosters**: klasgroepen
die hetzelfde rooster hebben delen één raster.

### Waarom "examenoverzicht" en niet "weekoverzicht"
Examens zijn in Untis **gewone OLODs** — er is geen markering die "examen" van "les" onderscheidt. De
examen-eigenschap zit niet in het blok maar in de **week**: een examenweek bevat enkel examens, nooit nog
lessen. Twee gevolgen:

1. De tool filtert niet en detecteert niets. De medewerker kiest vrij een week en weet zelf dat het een
   examenweek is. Kiest hij een gewone lesweek, dan krijgt hij een druk, weinig samengevoegd resultaat —
   dat corrigeert zichzelf en is geen waarschuwing waard.
2. Samenvoegen werkt juist omdat het examenweken zijn. In een gewone lesweek heeft elke klasgroep zijn
   eigen roosterpuzzel en valt er niets te clusteren; in een examenweek zitten acht klassen wél in
   hetzelfde examen.

De naam zegt de gebruiker dus waarvoor de module bedoeld is, zonder dat er ergens een examen-filter
bestaat.

### Terminologie — let op het woord "traject"
In de Traject Planner betekent *traject* "het studiepad van één student" (`traject_bewaard`, trajectnaam-chip).
De opleidingsmedewerker noemt zijn opleidingstrajecten óók "trajecten". Zelfde woord, twee betekenissen,
in dezelfde app, met gedeelde opslagruimte. **In code en UI van deze module gebruiken we consequent
`opleiding`**, ook als de gebruiker in gesprek "traject" zegt. Opslagsleutels krijgen het prefix `examen_`.

## Gemaakte keuzes
| Vraag | Keuze |
|---|---|
| Naam | Examenoverzicht |
| Examenherkenning | Geen — de week is de filter, vrije weekkeuze |
| Groepering | Hybride: auto-voorstel op basis van de data, gebruiker past aan, keuze wordt bewaard |
| Tijdsspanne | Eén week per overzicht, met vorige/volgende; S1/S2-knoppen springen naar de examenweken die uit de semestergrenzen volgen (laatste volledige week vóór het semestereinde). Standaardweek = de eerstvolgende examenweek, tot de gebruiker zelf een week kiest |
| Omvang | Altijd één opleiding tegelijk (max. ~5 per medewerker, nooit gelijktijdig nodig) |
| Semestergrenzen | Eén stel voor **alle** opleidingen; een opleiding die er structureel naast valt zet er eenmalig een eigen periode naast (overrule) |
| Roostervenster | Maandag t/m vrijdag, avondexamens tot 22u |
| Blokinhoud | Uur + vak, daaronder **één regel per lokaal** met de docenten en de klasgroepen die er zitten. Binnen één examen is het vak overal hetzelfde; het lokaal is wat per klasgroep verschilt. Houdt elk lokaal dezelfde docent, dan staat die één keer boven de lokalenlijst |
| Geen examenweek | Lopen de roosters binnen één jaargroep sterk uiteen, dan wordt het raster niet getekend maar uitgelegd — met een knop *Toch tonen* |
| Blended weken | Per jaargroep apart beoordeeld: de ene groep kan examens hebben en de andere niet, en dat wordt expliciet zo benoemd |
| Output | Op scherm, Print/PDF, en PNG om te plakken |
| PNG-techniek | Raster als inline **SVG** (nul dependencies, scherpe print én exacte PNG) |
| Config delen | Deel-link met configuratie **én** de bekeken week, zoals `trajectShare.ts` |

## Datamodel

### Verrijkte roosterdata
De oorspronkelijke adapter kleedde de Untis-data sterk uit: in [UntisService.ts](MEETINGPLANNER2026/src/services/UntisService.ts)
stonden `classes`, `teachers`, `rooms` en `subjects` op `[]` (*"Detailed mapping omitted for now"*). Die
mapping is nu afgemaakt: de vier lijsten worden uit de `position1..5`-velden gevuld, en `RosterEntry` kreeg
`ids`, `status` en `type` erbij. De wijziging is **additief**: de Meeting Planner leest enkel
`lessonText`/`lessonInfo` (geverifieerd) en verandert niet van gedrag.

De module definieert haar eigen blok-type in [types.ts](MEETINGPLANNER2026/src/components/Examen/types.ts) —
`Lesblok` van de Traject Planner wordt **niet** aangepast. `ExamenBlok` is structureel een superset van
`Lesblok`, zodat pure helpers zoals `layoutDay` er ongewijzigd op werken.

```typescript
type ExamenBlok = {
  klasgroep: string; olodNaam: string; type?: string; start: Date; eind: Date;  // = Lesblok
  lokaal?: string;      // ROOM-posities, ", "-gescheiden
  docent?: string;      // TEACHER-posities
  id?: number;          // ge.ids[0]
  ids?: number[];
  klassen?: string[];   // alle CLASS-posities van deze entry
  status?: string;      // ge.status — geannuleerd/verplaatst mag nooit als gewoon blok tonen
  untisType?: string;   // ge.type
};
```

`status` en de precieze vorm van de ROOM/TEACHER-posities moeten op echte data geverifieerd worden
(zie Fase 0). Voor een examenoverzicht weegt een geannuleerd examen dat als gewoon blok verschijnt
zwaarder dan waar ook in deze tool.

### Opleidingen en jaargroepen (localStorage)
```typescript
type Jaargroep = { id: string; naam: string; klasgroepen: string[] };
type Opleiding = {
  id: string; naam: string; jaargroepen: Jaargroep[];
  eigenPeriode?: ExamenPeriode;  // overrule op de algemene semestergrenzen; meestal afwezig
};
```
Sleutels: `examen_opleidingen` (`Opleiding[]`), `examen_actief` (`{ opleidingId, weekMaandag }`),
`examen_periode` (de algemene `ExamenPeriode`).

**De semestergrenzen zijn algemeen, de overrule is de uitzondering.** Bijna alle opleidingen examineren
in dezelfde weken; die grenzen horen dus één keer ingesteld te worden en niet per opleiding herhaald.
Een opleiding zonder `eigenPeriode` volgt de algemene grenzen ook wanneer die later verschuiven — dat
is precies waarom "uit" méér is dan een kopie van de huidige waarden. Zet de beleidsmedewerker de eigen
periode aan, dan vertrekt ze van wat op dat moment geldt, zodat de eerste wijziging een aanpassing is en
geen herinvoer van vier datums. Ongeldige eigen grenzen (leeg, achteruitlopend) worden in hun geheel
genegeerd in plaats van halfweg toegepast: je valt terug op de algemene grenzen, nooit op een mengvorm.
`effectievePeriode(algemeen, eigen)` in [periode.ts](MEETINGPLANNER2026/src/components/Examen/periode.ts)
is de enige plaats waar die keuze valt; alles wat van de grenzen afhangt (S1/S2-knoppen, standaardweek,
het clustervoorstel in de instellingen) leest daaruit.

**De jaargroep is het duurzame ding, niet het cluster.** Een clustervoorstel wordt per week uit de data
afgeleid, maar zodra de gebruiker het bevestigt of bijstuurt wordt het als jaargroep bij de opleiding
bewaard. In een volgende week wordt die jaargroep hergebruikt en enkel *gecontroleerd*: klopt hij niet
meer, dan verschijnt een afwijkingsmelding in plaats van stilzwijgend een andere indeling. Een document
dat rondgemaild wordt moet van week tot week herkenbaar blijven — dat weegt zwaarder dan optimale
clustering.

## Samenvoeglogica

### Merge-sleutel
Twee blokken zijn "hetzelfde examen" als `startISO|eindISO|olodNaam` gelijk is. Bewust niet primair op
`id`: of Untis dezelfde entry-id teruggeeft wanneer je per klasgroep bevraagt, is nog niet geverifieerd.
`id` mag als versneller of tiebreak dienen zodra dat wél vaststaat.

### Clustervoorstel (per week, per opleiding)
1. Haal per klasgroep uit de opleiding de blokken van de week op (parallel; de bestaande range-cache in
   [trajectService.ts](MEETINGPLANNER2026/src/components/Traject/trajectService.ts) bedient dit).
2. Bouw per klasgroep een **weeksignatuur**: de gesorteerde set merge-sleutels.
3. Klasgroepen met een identieke signatuur vormen een exacte groep.
4. Tweede pass: groepen die sterk overlappen (Jaccard ≥ ~0,8) worden voorgesteld als één jaargroep, met
   de verschillen expliciet benoemd.
5. Naamgeving als hint: gemeenschappelijk prefix van de klasgroepnamen (`2 TI A/B/C` → `2 TI`).
6. De gebruiker bevestigt of herschikt; het resultaat wordt als jaargroep bewaard.

### Weergaveregel — geen valse negatieven
Per jaargroep één raster. Elk blok toont onder de vaknaam **één regel per lokaal**, met de docenten en de
klasgroepen die daar zitten (`A.101 · De Smet J. · 2TIA`). Geldt het examen niet voor de hele jaargroep,
dan staat er bovendien expliciet **wie het níét heeft** ("niet voor 2TIB, 2TIC") — dat is precies de
informatie die de lokalenlijst niet geeft, want die noemt enkel wie er wél zit.

Onder het raster staat een **afwijkingenlijst**: elk blok dat niet voor de hele jaargroep geldt, en elke
klasgroep waarvan het rooster niet opgehaald kon worden. Vuistregel: liever een blok te veel getoond dan
een klas die ten onrechte denkt geen examen te hebben. Past niet alles in een blok, dan zegt de laatste
regel "+N meer" — stilzwijgend afkappen zou een lokaal of een klas kunnen verbergen.

### Is dit wel een examenweek?
De tool kan dat niet aan de blokken zien (examens zijn gewone OLODs), maar wél aan de jaargroep: die
belooft dat haar klasgroepen hetzelfde rooster hebben. In een examenweek klopt dat; in een gewone lesweek
heeft elke klasgroep haar eigen roosterpuzzel. [beoordeling.ts](MEETINGPLANNER2026/src/components/Examen/beoordeling.ts)
berekent daarom de gemiddelde paarsgewijze overeenkomst (Jaccard op de weeksignaturen) tussen de
klasgroepen mét blokken:

| Uitkomst | Weergave |
|---|---|
| overeenkomst ≥ 0,34 (of één klasgroep met blokken) | het raster |
| overeenkomst < 0,34 | geen raster, maar de uitleg dat dit geen examenweek lijkt óf dat de jaargroep niet meer klopt, met knop *Toch tonen* |
| geen enkel blok | "Geen examens deze week" (zie blended) |
| geen enkel rooster opgehaald | foutmelding met de reden |

De drempel ligt bewust laag: twee identieke klasgroepen naast één afwijkende geeft (1 + 0 + 0) / 3 ≈ 0,33,
terwijl een echte examenweek waarin één klas één examen mist rond 0,8 zit. Klasgroepen zonder blokken
tellen niet mee in de berekening — dat is een eigen signaal (de "leeg"-afwijking), geen bewijs van een
lesweek. Een jaargroep van één klasgroep valt niets te vergelijken en wordt dus nooit tegengehouden.

*Toch tonen* geldt voor die ene jaargroep in die ene week (niet bewaard) en wordt in de kaartkop vermeld
als "getoond op eigen verzoek", zodat een gedeelde afdruk niet verzwijgt dat de tool bezwaar had.

### Blended examenweken
Niet elke jaargroep examineert dezelfde week. Elke jaargroep wordt daarom apart beoordeeld: de ene kan een
raster krijgen terwijl de andere "Geen examens deze week" toont, met de vermelding dat andere jaargroepen
wél examens hebben. De statusregel benoemt het geheel ("Gedeeltelijke examenweek: 1 van 3 jaargroepen
zonder examens"). Een lege jaargroep krijgt geen leeg raster en geen eigen printpagina — een leeg raster
mag nooit gelezen worden als "vergeten" of "nog niet gepubliceerd".

## Schermen

### Scherm 1 — Instellingen
Zelfde vorm als [TrajectSettings.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectSettings.tsx):
gecentreerde kolom, inklapbare kaarten met een live samenvatting in de kop.
- **Mijn opleidingen**: opleidingen toevoegen, hernoemen, verwijderen (ordegrootte: een handvol); per
  opleiding klasgroepen kiezen uit Untis (hergebruik van het zoekveld + chips + checkbox-raster
  gegroepeerd per jaar).
- **Academiejaar**: de **algemene** semestergrenzen (start en einde van beide semesters), zoals in de
  Traject Planner en met dezelfde standaarddatums uit `academicYear.ts`. Startwaarden worden de eerste
  keer uit de opgeslagen Traject-instellingen overgenomen (alleen-lezen) als die er zijn. Eronder een
  aanvinkvakje *&lt;opleiding&gt; heeft een eigen examenperiode* met, aangevinkt, vier eigen datumvelden en
  een knop *Algemene grenzen overnemen*; daaronder de afgeleide examenweken S1 en S2 **zoals ze voor de
  actieve opleiding gelden**. Wijkt een andere opleiding af, dan staat dat onder de algemene grenzen
  vermeld — anders zou de beleidsmedewerker daar datums aanpassen zonder te zien wie ze niet volgt.
  Opslag: `examen_periode` (algemeen) en `Opleiding.eigenPeriode` (de overrule).
- **Jaargroepen**: per opleiding de jaargroepen beheren. Eerst een weekkiezer (Examens S1 / Examens S2 /
  vorige / volgende), dan *Voorstel op basis van week …* dat het clustervoorstel genereert en laat
  bevestigen. Per jaargroep een paneel *klasgroepen toevoegen* met enkel de nog niet-ingedeelde
  klasgroepen, meerdere tegelijk aanvinkbaar.
- **Deel met collega's**: link genereren en kopiëren met de configuratie van de opleiding.

### Scherm 2 — Examenoverzicht
- **Topbar**: terug · titel · opleiding-kiezer (dropdown, altijd één actief) · een chip *eigen periode*
  wanneer die opleiding de algemene grenzen overruled (klikbaar naar de instellingen — de S1/S2-knoppen
  ernaast wijzen dan naar andere weken dan bij de rest, en dat mag niet stilzwijgend gebeuren) · weekpicker (weeknummer +
  datumbereik, vorige/volgende, *deze week*) · *Exporteren ▾* (Print/PDF · PNG kopiëren · PNG downloaden ·
  Link naar dit overzicht kopiëren).
- **Statusregel**: `Opgehaald op <datum + uur> · N klasgroepen · M examens`, plus waarschuwingen
  (klasgroep zonder rooster, geannuleerde blokken). Deze stempel staat óók in print en PNG — het document
  gaat rond en veroudert.
- **Body**: per jaargroep een kaart met kop (naam, klasgroepen, aantal examens), het SVG-raster en de
  afwijkingenlijst. Eén opleiding tegelijk, dus de scroll blijft kort.

## Rendering — SVG
Het raster wordt inline SVG in plaats van CSS-grid:
- Vijf dagkolommen (maandag t/m vrijdag), tijd verticaal. Avondexamens tot 22u komen voor, dus het
  venster wordt **bijgesneden** op het eerste en laatste blok van de week, afgerond op het uur — een
  examenweek is spaarzaam gevuld en een vast raster van 8u tot 22u leest slecht.
- Eén avondexamen naast een ochtendweek rekt dat venster alsnog uit. Als de praktijk uitwijst dat dat
  storend is: een lege band van meer dan ~3u waarin geen enkele dag een blok heeft, visueel inkorten met
  een breukmarkering. Niet nodig in fase 3, wel bewust een latere optie.
- Overlappende blokken naast elkaar via `layoutDay` uit
  [layout.ts](MEETINGPLANNER2026/src/components/Traject/layout.ts) — pure functie op `Lesblok`,
  herbruikbaar zoals ze is.
- **PNG**: `XMLSerializer` → data-URL → `Image` → canvas op 2× → `toBlob()` → clipboard (`ClipboardItem`)
  of download. Geen externe library. Let op: alleen systeemfonts gebruiken, want een webfont rendert niet
  mee in de geserialiseerde SVG. Clipboard-write werkt in Chrome/Edge; voor Firefox blijft de
  download-knop het alternatief.
- **Print**: dezelfde SVG schaalt scherp; één jaargroep per pagina (`break-after: page`), topbar en
  knoppen verborgen via `@media print`.
- Kleur: terughoudend. Examens herhalen niet wekelijks, dus een kleur-per-vak (zoals de trajectplanner)
  voegt weinig toe en kost leesbaarheid in zwart-wit print. Voorstel: neutrale blokken, kleur enkel om
  subset-blokken te markeren.

## Deel-link
Eén mechaniek, twee ingangen — beide bouwen op het patroon van
[trajectShare.ts](MEETINGPLANNER2026/src/components/Traject/trajectShare.ts) (base64url-payload in de
URL-hash, zodat statische hosting niets hoeft te herschrijven):
- **Deel configuratie** (instellingen): opleiding + klasgroepen + jaargroepen, zonder week. Heeft de
  opleiding een eigen periode, dan reist die mee — anders landt de collega met dezelfde jaargroepen op
  een andere S1/S2-week. De algemene grenzen reizen niet mee: die zijn van de ontvanger. De collega
  neemt de opleiding over en kiest zelf een week.
- **Link naar dit overzicht** (exportmenu): dezelfde payload plus `weekMaandag`. De collega landt
  rechtstreeks op ditzelfde overzicht.

De ontvanger krijgt een bevestiging vóór de configuratie wordt overgenomen — een link mag nooit stil zijn
eigen opleidingen overschrijven.

## Hergebruik uit de Traject Planner
| Hergebruikt | Nieuw |
|---|---|
| `untisService` + `trajectUntisService` (gedeelde, warme cache) | Clustering en weeksignaturen |
| `dateUtils` (`mondayOf`, `isoWeekNumber`, formatters) | SVG-raster + PNG-export |
| `layout.ts` (overlap-layout) | Opleidingen- en jaargroepenbeheer |
| `TopbarMenu`, `TrajectDialogs`, `Toast` | Weekpicker |
| Het deel-link-patroon uit `trajectShare.ts` | |

Nieuwe map `MEETINGPLANNER2026/src/components/Examen/`; wiring via
[App.tsx](MEETINGPLANNER2026/src/App.tsx) (`view === 'examen'`) en een derde tegel in
[AppChoice.tsx](MEETINGPLANNER2026/src/components/AppChoice.tsx).

Voorlopig importeert de nieuwe module rechtstreeks uit `Traject/`. Pas als een gedeelde helper voor de
tweede consument moet veranderen, lichten we hem uit naar een `shared/`-map — nu zou dat enkel churn in
werkende code opleveren.

## Fasering
| Fase | Inhoud | Stand |
|---|---|---|
| 0 | **Sample ophalen.** Eén examenweek openen en verifiëren: status-veld, ROOM/TEACHER-posities, en of entry-ids over klasgroepen heen gedeeld worden. | **Open** — via het Diagnose-paneel in het overzicht (zie onderaan). |
| 1 | Adapter verrijken: `RosterEntry`-mapping afmaken; eigen `ExamenBlok`. | Gebouwd |
| 2 | Instellingen: opleidingen + klasgroepen + handmatige jaargroepen. | Gebouwd |
| 3 | Weekpicker + SVG-raster + samenvoegen + afwijkingenlijst. | Gebouwd |
| 4 | Clustervoorstel (auto-detectie) met bevestigingsflow. | Gebouwd |
| 5 | Print/PDF + PNG. | Gebouwd |
| 6 | Deel-link (configuratie en overzicht). | Gebouwd |

Fase 0 werd niet als blokkade behandeld: de code gaat defensief om met wat nog onzeker is (onbekende status
= afwijkend, samenvoegen op tijdstip+vak in plaats van op id), en het Diagnose-paneel maakt de verificatie
achteraf mogelijk. Wat er na die verificatie mogelijk moet veranderen staat onderaan.

## Gebouwd — afwijkingen van het ontwerp
Map: `MEETINGPLANNER2026/src/components/Examen/`. Wiring: `view === 'examen'` in `App.tsx`, derde tegel in
`AppChoice.tsx`. De module importeert **alleen-lezen** uit `Traject/` (dateUtils, layout, SettingsCard,
TopbarMenu, TrajectDialogs, settingsSummaries, trajectShare.copyToClipboard en de CSS-module voor de schil);
er is niets in `Traject/` gewijzigd.

- **Eigen adapter** ([examenService.ts](MEETINGPLANNER2026/src/components/Examen/examenService.ts)) met een
  cache per klasgroep × week, in plaats van de range-cache van `trajectService.ts`. Die laatste kleedt de
  blokken uit tot wat de planner nodig heeft (geen lokaal, docent, status) en aanpassen zou een wijziging
  in de Traject-module zijn. Beide adapters delen wel `untisService` en zijn login/sessie.
- **Halve week over 21 september** (schooljaargrens) wordt in twee calls gesplitst. Faalt één segment, dan
  telt de klasgroep als "niet opgehaald" — een half opgehaalde week zou er compleet uitzien.
- **Status-heuristiek** in [merge.ts](MEETINGPLANNER2026/src/components/Examen/merge.ts): `REGULAR`,
  `NORMAL`, `STANDARD`, `OK` en leeg zijn "gewoon"; **alles wat onbekend is telt als afwijkend** (rood, met
  de ruwe waarde erbij). Een status met `CANCEL` erin toont grijs, gestreept en doorgestreept. Na fase 0
  moet de set `NORMALE_STATUS` bevestigd of aangevuld worden.
- **Samenvoegen op merge-sleutel** (`start|eind|vak`), exact zoals ontworpen. Geeft Untis dezelfde entry
  voor één klasgroep twee keer terug (bv. één entry per lokaal), dan smelten die delen samen en worden de
  lokalen opgesomd. Lokaal en docent tonen één waarde als alle klasgroepen dezelfde hebben, anders per
  klasgroep (`2TIA: A.101 · 2TIB: A.102`).
- **Niet-ingedeelde klasgroepen** krijgen elk een eigen raster (naam = klasgroepnaam), zodat geen enkele
  klasgroep stilzwijgend uit het overzicht valt. Zonder jaargroepen toont het overzicht een banner die naar
  het clustervoorstel leidt.
- **Clustervoorstel**: exacte groepen op weeksignatuur, daarna agglomeratief samenvoegen zolang de beste
  Jaccard-score ≥ 0,8 is; verschillen worden per examen benoemd ("Databanken (do 09:00–12:00): enkel 2TIA,
  2TIB"). Klasgroepen zonder blokken in die week vormen een aparte, expliciet als "leeg" gemarkeerde groep;
  klasgroepen waarvan het rooster niet opgehaald kon worden blijven buiten het voorstel en worden apart
  vermeld. Namen zijn in het voorstel aanpasbaar vóór het overnemen; overnemen vervangt de bestaande
  jaargroepen na bevestiging.
- **PNG per jaargroep** (kopiëren + downloaden op elke kaart) in plaats van één PNG-actie in de topbar —
  met meerdere jaargroepen is "PNG kopiëren" daar dubbelzinnig. Het exportmenu bevat Print/PDF, "Alle
  rasters als PNG downloaden" en "Link naar dit overzicht kopiëren".
- **Print liggend**: een `@page { size: landscape }`-regel wordt enkel geïnjecteerd zolang de module
  gemount is, zodat de afdruk van de Traject Planner er niets van merkt. Enkel getekende rasters krijgen
  een eigen pagina; jaargroepen zonder raster schuiven als korte notities samen.
- **Weekpicker**: S1/S2 (examenweken uit de semestergrenzen), vorige/volgende, een datumveld (eender
  welke datum → de maandag van die week) en *Deze week*. Een gekozen week wordt bewaard (`examen_actief`,
  met `weekGekozen: true`) en is ook de basis voor het clustervoorstel in de instellingen. Zolang de
  gebruiker niets koos volgt de week de eerstvolgende examenweek — de huidige week is in september of
  midden in een semester zelden nuttig voor een examenoverzicht.
- **Semestergrenzen** in [periode.ts](MEETINGPLANNER2026/src/components/Examen/periode.ts): eigen opslag
  (`examen_periode`), gevalideerd met dezelfde helpers als de Traject Planner (`semesterDefs`,
  `semesterGrensGeldig`). De examenweek van een semester is de maandag van de week die de dag vóór het
  semestereinde bevat — het standaard-einde van semester 1 (1 februari) valt zelf op een maandag.
  De grenzen gelden voor alle opleidingen; `Opleiding.eigenPeriode` overruled ze voor één opleiding
  (zie Datamodel).
- **Tijdvenster** van het raster: bijgesneden op het eerste en laatste blok (op het uur afgerond), met een
  minimum van vier uur. De breukmarkering voor lange lege banden is niet gebouwd (bewust latere optie).
- **Deel-link**: hash-parameter `examen=`; naast `traject=` bruikbaar. De ontvanger krijgt een dialoog
  vóór de overname; bestaat er al een opleiding met dezelfde naam, dan wordt die vervangen (met rode
  bevestigknop), anders komt ze erbij.

## Risico's
- **Veroudering.** Het document is een momentopname die per mail rondgaat. Tijdstempel op scherm, print
  en PNG is verplicht, en geannuleerde of verplaatste blokken moeten als zodanig tonen.
- **Schijnbare volledigheid.** Examens die niet in Untis staan (digitaal elders, mondeling op afspraak)
  ontbreken terwijl het overzicht compleet oogt. De tool moet dat zelf vermelden.
- **Parallel kanaal.** Publiceert AP al een officieel examenrooster, dan circuleert er nu een tweede
  versie. Bij verschil is de vraag "welke geldt?" — vandaar de expliciete "weergave van Untis op
  moment X"-vermelding.
- **Browser-lokale configuratie.** De deel-link verspreidt kopieën, geen gedeelde waarheid; configuraties
  van collega's kunnen uiteendrijven. Zonder server is dat niet volledig op te lossen.
- **Docentnamen staan altijd in het document.** Bewuste keuze; het betekent wel dat elke PNG en PDF
  personeelsgegevens bevat en dus niet zomaar buiten de eigen kring gedeeld hoort te worden.
- **Verkeerde week.** De tool kan een lesweek enkel herkennen aan uiteenlopende roosters binnen één
  jaargroep. Twee parallelle klasgroepen die ook in een gewone lesweek samen les volgen, halen een hoge
  overeenkomst en krijgen dus gewoon een (druk) raster. Dat blijft aanvaard: de gebruiker weet zelf welke
  week hij zoekt.
- **Jaargroep versus week.** Een lage overeenkomst kan twee dingen betekenen: het is geen examenweek, óf
  de jaargroep klopt niet meer (bv. na een herindeling). De melding noemt beide mogelijkheden, want de
  data zelf maakt het onderscheid niet.

## Nog te verifiëren op echte data (fase 0)
Open een echte examenweek in het overzicht en klap onderaan **"Diagnose van de ruwe Untis-velden (fase 0)"**
open. Het paneel telt de voorkomende `status`- en `type`-waarden, hoeveel blokken een lokaal/docent dragen,
hoeveel entries méér `CLASS`-posities bevatten dan de eigen klasgroep, en bij hoeveel samengevoegde examens
de entry-id over de klasgroepen heen gelijk is — plus vijf ruwe voorbeeldblokken. (De
`console.log('[UntisService] Raw gridEntry:', …)` in [UntisService.ts](MEETINGPLANNER2026/src/services/UntisService.ts)
bestaat nog voor wie het volledige object wil zien.)

1. Hoe ziet een **geannuleerd of verplaatst** examen eruit? (`ge.status`, en mogelijk `ge.type`.)
   → Daarna `NORMALE_STATUS` en `statusLabel()` in [merge.ts](MEETINGPLANNER2026/src/components/Examen/merge.ts)
   bevestigen of aanvullen. Nu telt elke onbekende waarde als afwijkend.
2. Zitten **lokaal** en **docent** effectief als `ROOM`- en `TEACHER`-posities in `position1..5`, en hoe
   zien die displayNames eruit bij meerdere lokalen of meerdere toezichthouders?
   → Diagnose-regel "Met lokaal / docent" moet (bijna) gelijk zijn aan het aantal blokken.
3. Krijgt dezelfde les **dezelfde entry-id** wanneer je per klasgroep bevraagt?
   → Diagnose-regel "Entry-id gedeeld / verschillend". Is het altijd gedeeld, dan mag `id` in `mergeKey()`
   als versneller of tiebreak dienen; samenvoegen op tijdstip+vak blijft de basis.
4. Staan alle deelnemende klasgroepen als `CLASS`-posities in de entry, ook wanneer je maar één
   klasgroep opvraagt?
   → Diagnose-regel "CLASS-posities met meer dan de eigen klasgroep". Zo ja, dan kan `klassen` later
   dienen om een klasgroep waarvan het rooster niet opgehaald kon worden toch (met markering) in te vullen.
