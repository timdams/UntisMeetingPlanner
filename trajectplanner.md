# Trajectplanner-module — Implementatie

## Context & doel
Trajectplanner-module binnen de bestaande React + Vite + Tauri meetingplanner-tool. Helpt een trajectbegeleider bij het samenstellen van een individueel studentrooster door OLODs (vakken) te kiezen uit roosters van verschillende klasgroepen.

De module gebruikt de Untis-data van de parent-tool via een dunne adapter rond `untisService` — geen eigen authenticatie of caching nodig op consumer-niveau.

**Status: gerealiseerd (MVP).**

## Kernfunctionaliteit
1. Trajectbegeleider markeert in **instellingen** welke klasgroepen tot zijn opleiding behoren — die shortlist filtert al de rest.
2. Trajectbegeleider kiest de **periode-indeling** (semesters, of modules = 2 per semester) en de **actieve periode**. In het werkblad wisselt hij via de **periode-switcher** in de contextbalk snel van periode (S1/S2 of M1…M4).
3. Trajectbegeleider bladert door een **klasgroeprooster** en klikt lesblokken aan om OLODs toe te voegen of te verwijderen uit het studenttraject. Een keuze geldt voor de **actieve periode**; hetzelfde vak kan in een volgende module bij een andere klasgroep gekozen worden.
4. Een gekozen OLOD kan **gedeactiveerd** worden: ze blijft in de lijst staan (met haar klasgroep en periode), maar telt niet meer mee — handig om een scenario te vergelijken zonder de keuze weg te gooien.
5. In modulemodus kan een OLOD in het **werkblad** (niet in de instellingen) als **semestervak** gemarkeerd worden: sommige vakken lopen over beide modules van hun semester. De markering geldt voor de OLOD-naam, dus voor elke klasgroep waar dat vak in voorkomt.
6. Een **live overzicht** toont het opgebouwde studentrooster, week per week, voor de actieve periode, met conflictdetectie.
7. **Reset**-knop wist het volledige studenttraject (met bevestiging).
8. **Print/PDF-export** van het studenttraject als **eenvoudige lijst** (OLOD-naam + klasgroep), gegroepeerd per klasgroep — géén visuele weergave.
9. **Back-up & herstel**: instellingen + traject + kleurmap + profielen exporteren naar JSON en importeren vanuit JSON.
10. **Profielen**: een volledige set instellingen (klasgroep-shortlist, semester/module-indeling, grensdatums, semestervakken en de actieve periode) onder een naam bewaren, en er vanuit het werkblad met één klik tussen wisselen. Bedoeld voor de trajectbegeleider die meerdere doelgroepen naast elkaar heeft ("flextraject — enkel avondgroepen", "bissers module 1 in modulesysteem") en daarvoor vroeger telkens een back-up moest importeren. Bij een wissel vraagt de tool wat er met het **studenttraject** moet gebeuren: mee wissen, of behouden. Behouden is de standaard; wat daarna niet meer bij de nieuwe set past, krijgt in de OLOD-lijst een waarschuwing in plaats van stil te verdwijnen. Beide keuzes zijn één undo-punt.
11. **Een profiel delen**: elk bewaard profiel heeft een deel-icoon dat er een link (of QR) van maakt. Dezelfde link als *Deel met student*, maar gebouwd uit de instellingen van dát profiel en met zijn **naam** erin — waardoor de ontvanger de set niet alleen toegepast krijgt, maar ze ook onder die naam **permanent als profiel op zijn eigen toestel** kan bewaren. Zo geeft een trajectbegeleider een collega (of een tweede toestel) een set door zonder back-upbestand.

12. **Een OLOD opzoeken**: wie de naam van een vak kent maar niet weet bij welke klasgroep (of in welke week) het staat, zoekt het op met de knop *Zoek OLOD* in de actiebalk bovenaan paneel A. De zoeker doorloopt alle vakken die de shortlist in de actieve periode geeft; een klik op een resultaat toont per klasgroep het weekrooster waarin dat vak valt, en de gekozen klasgroep zet het vak meteen in het traject.

13. **Een rooster laten voorstellen (wizard)**: de trajectbegeleider duidt aan welke vakken de student moet volgen — in blokken per leerjaar — en de tool zoekt daar zelf een combinatie van klasgroepen bij. Hij stelt in wat "beter" betekent: **zo weinig mogelijk botsingen** of **zo weinig mogelijk lesdagen**. De puzzel wordt gelegd op 1 tot 3 zelfgekozen **referentieweken**, niet op de hele periode: een rooster herhaalt zich meestal week na week, terwijl eenmalige inhaallessen en de atypische eerste en laatste lesweek een voorstel anders onterecht onmogelijk maken. Het voorstel is zichtbaar vóór het overgenomen wordt, en overnemen is één undo-punt. De wizard puzzelt één periode per keer, maar blijft openstaan: met de **periodeknoppen in haar kop** gaat de begeleider in één zitting het hele jaar af (M1 overnemen → door naar M2), en bij elke wissel vraagt ze eerst of het berekende voorstel nog overgenomen moet worden. Staat er al iets in het traject wanneer de wizard start, dan zegt ze dat vooraf — de wizard vult aan en schrijft over — en laat ze de gebruiker kiezen: het traject laten staan, of het eerst wissen.

14. **Vakken die samen horen (labs)**: sommige opleidingen geven een groepje OLODs als één geheel — je volgt het hele lab bij één klasgroep. De trajectbegeleider koppelt zulke vakken met de hand — twee vakken na elkaar aanklikken en bevestigen — achter een *geavanceerd*-knopje in de wizard; die houdt ze daarna samen, en de OLOD-lijst waarschuwt wanneer een groep alsnog over twee klasgroepen verspreid staat. Standaard staat dit uit: een opleiding zonder labs merkt er niets van.

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

Een selectie kan bovendien **uitgeschakeld** staan (`actief: false`). Ze blijft dan volwaardig in het traject — met haar klasgroep en periode — maar levert nergens lessen: niet in het totaalrooster, niet in de conflictdetectie, niet in de afdruk. Het veld is optioneel; ontbreekt het (oudere opslag, back-ups), dan is de selectie actief. `isActief(sel)` in [types.ts](MEETINGPLANNER2026/src/components/Traject/types.ts) is de enige plaats waar die regel staat.

```typescript
type OLODSelectie = {
  klasgroep: string; olodNaam: string; van: string; tot: string;
  actief?: boolean; // afwezig of true = telt mee; false = gedeactiveerd
};
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
  semesterOlods: string[];            // OLOD-namen die semesterbreed lopen
  koppelGroepen: {                    // vakken die samen bij één klasgroep horen (een lab)
    actief: boolean;                  // standaard false — dan verandert er niets
    groepen: { naam: string; olods: string[] }[];
    overPeriodes: boolean;            // ook in de andere periodes dezelfde klasgroep
  };
};

type KleurMap = Record<string, string>; // olodNaam → kleur
```

### Semestervakken in modulemodus
Een opleiding die per module plant, heeft soms tóch een OLOD dat over **beide modules** van een semester loopt. De trajectbegeleider markeert zo'n vak in het werkblad; de tag hangt aan de **OLOD-naam**, dus aan het vak en niet aan één keuze — ze geldt bij elke klasgroep. Alle logica staat in [semesterOlods.ts](MEETINGPLANNER2026/src/components/Traject/semesterOlods.ts).

Gevolgen, allemaal enkel in **modulemodus** (in semestermodus loopt alles al over het hele semester en betekent de tag niets; ze blijft wel bewaard):
- Een klik in het rooster voegt zo'n vak toe voor het **volledige semester** waarin de actieve periode valt, ook wanneer die periode M1 of M2 is. `bereikVoorOlod` in [TrajectPlanner.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectPlanner.tsx) voedt zowel `toggleBlok` als `selectieVoor`, zodat het rooster precies de blokken als gekozen toont die een klik ook weer weghaalt.
- De periode-kiezer van paneel A laat er **geen module** meer voor kiezen: die opties staan uitgeschakeld, met de reden in hun tooltip.
- Op het moment van markeren worden **bestaande keuzes verbreed** naar hun semester (`verbreedNaarSemesters`). Keuzes die daardoor identiek worden (M1 én M2 bij dezelfde klasgroep) smelten samen — de eerste wint, zelfde regel als bij een bulk-klasgroepwissel. Markeren en verbreden vormen samen **één undo-punt**: ongedaan maken zet de tag én het traject terug.
- Keuzes bij **verschillende klasgroepen** in hetzelfde semester blijven allebei staan (er gaat niets verloren), maar krijgen in paneel A een oranje waarschuwing die de andere klasgroep benoemt (`botsendeKlasgroepen`).

Het semester waarin een bereik valt, wordt bepaald met "past er volledig in" en niet met "overlapt ermee": de twee semesters delen hun grensdag (het einde van semester 1 is de start van semester 2), dus overlap wijst ook naar het buursemester zodra een module exact op die grens eindigt. Een bereik dat de grens écht oversteekt (een selectie over het volledige academiejaar) past nergens volledig in en blijft ongemoeid — versmallen zou dan lessen wegnemen. Om dezelfde reden telt een gedeelde grensdag niet als botsing: hetzelfde vak in S1 bij de ene en in S2 bij een andere klasgroep is gewoon in orde.

De tags zitten in de **instellingen** (`semesterOlods`), hoewel de knop in het werkblad staat: het is een eigenschap van de opleiding, dus ze reizen mee met een back-up, een bewaard traject en de student-link. Ze tellen ook mee in `trajectVingerafdruk`, want een vak markeren verandert hoe het traject gelezen wordt.

Ontbrekende velden worden bij het laden aangevuld (`normalizeSettings`): semester-indeling en de grensdatums van het standaard-academiejaar, met de modulegrenzen halverwege elk semester (dichtstbijzijnde maandag). De periodes zelf (`S1`, `S2`, `M1`…`M4`) worden volledig uit `periodeGrenzen` afgeleid in [academicYear.ts](MEETINGPLANNER2026/src/components/Traject/academicYear.ts) (`periodesVoor`); een onbruikbare grens (leeg veld, semester dat achteruit loopt, modulegrens buiten haar semester) valt per semester terug op de standaard uit `ACADEMIEJAAR`.

De grensdatums zijn dus **instelbaar en bewaard**: de periode-knoppen (instellingen én contextbalk) zetten de actieve periode op exact deze datums, zodat een periodewissel nooit een ingestelde datum overschrijft. Opslag van vóór deze wijziging bevat enkel `moduleGrenzen: { m2Start, m4Start }`; die twee waarden worden bij het laden overgenomen en aangevuld met de standaard semestergrenzen.

LocalStorage-sleutels:
- `traject_settings` — `TrajectSettings`
- `traject_student` — `StudentTraject`
- `traject_kleurmap` — `KleurMap`
- `traject_bewaard` — `BewaardTraject[]` (bewaarde trajecten: naam + `TrajectSettings` + `StudentTraject`; zie hieronder)
- `traject_actief` — `ActiefTraject` (`{ id, naam, baseline }`): welk bewaard traject er "open" staat. `baseline` is de vingerafdruk van traject + instellingen op het moment van bewaren of laden (`trajectVingerafdruk` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts), normaliseert beide kanten); wijkt de huidige toestand daarvan af, dan staat er werk open dat niet bewaard is. Wordt gewist bij een back-up-import, bij een profielwissel waarbij het traject mee gewist wordt, en wanneer het bewaarde traject verwijderd wordt. Blijft het traject bij zo'n wissel behouden, dan blijft ook het dossier open — het werk is nog altijd dat van dezelfde student, en de gewijzigde instellingen tellen gewoon als niet-bewaard werk.
- `traject_profielen` — `Profiel[]` (bewaarde instellingssets: naam + `TrajectSettings`; zie hieronder)
- `traject_profiel_actief` — het **id** van het actieve profiel (of afwezig). Bewust enkel het id: naam en inhoud komen uit `traject_profielen` zelf, zodat een bijgewerkt of hernoemd profiel nooit uit de pas kan lopen met wat de contextbalk toont. Staat er een id dat niet meer bestaat, dan wordt er gewoon zonder profiel gewerkt.

De reset-knop wist enkel `traject_student`. Instellingen, kleurmap en profielen blijven staan.

### Profielen (instellingssets)
Een **profiel** is een `TrajectSettings` onder een naam (`Profiel` + `useProfielen` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts)):

```typescript
interface Profiel {
    id: string;
    naam: string;
    bewaardOp: string;      // ISO-tijdstip
    settings: TrajectSettings;
}
```

Het bestaat omdat een trajectbegeleider vaak meerdere doelgroepen naast elkaar heeft (avondgroepen versus dagklassen, bissers in modulesysteem versus de rest in semesters). Vóór de profielen betekende switchen: een back-upbestand importeren — te omslachtig om "on the fly" te doen.

**Gewijzigd of niet.** `profielVingerafdruk(settings)` vergelijkt de huidige instellingen met het actieve profiel; wijkt het af, dan draagt de profielknop een oranje stip (zelfde codering als het niet-bewaarde dossier ernaast). De **actieve periode** (`semesterStart`/`semesterEind`) telt daar bewust *niet* in mee: ze wordt wél mee bewaard en mee teruggezet, maar binnen een profiel van S1 naar S2 springen is navigatie in het werkblad, geen wijziging aan de set — anders stond de stip er na elke periodeklik.

**Wat gebeurt er met het traject?** De instellingen worden hoe dan ook vervangen, maar over het studenttraject valt écht iets te kiezen, en dus vraagt de tool het (`ProfielWisselDialog` in [TrajectDialogs.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectDialogs.tsx), een radiogroep met de uitleg bij elke optie in plaats van een gewone bevestiging):

- **Traject behouden** — de standaard, want dit is de omkeerbare kant. De keuzes blijven staan en het **geopende dossier blijft open**: het werk is nog altijd dat van dezelfde student, alleen bekeken onder een andere set. Keuzes die in de nieuwe set nergens op slaan verdwijnen niet stilletjes, ze worden **aangewezen** in paneel ③ (zie *Past deze keuze nog bij deze set?* hieronder). Zinvol wanneer dezelfde student onder een andere indeling bekeken wordt — modules naast semesters, of een tweede reeks klasgroepen erbij.
- **Traject wissen** — het oude gedrag: het werkblad start leeg en laat het **dossier** los (`traject_actief`), want met een leeg traject mag `Ctrl+S` dat dossier niet overschrijven. Zinvol wanneer de wissel over een andere student gaat.

In beide gevallen vormen instellingen, traject, dossier én profielkeuze samen **één herstelpunt** in de undo-toast, zodat een verkeerde klik volledig terug te draaien is. De toast zegt ook meteen wat de keuze kostte: *"traject behouden, 3 vakken passen niet bij deze set"*.

De dialoog verschijnt zodra er iets te verliezen valt: gekozen OLODs, of instellingen die in geen enkel profiel bewaard staan (`profielNietBewaard` in [TrajectPlanner.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectPlanner.tsx)). Staat het traject leeg, dan valt er niets te kiezen en blijft het bij de gewone bevestiging over die instellingen; valt er helemaal niets te verliezen, dan wisselt een klik meteen — een dialoog is dan enkel een extra klik.

**Een profiel delen.** Het deel-icoon in de profielrij bouwt `buildShareUrl(profiel.settings, profiel.naam)` — dezelfde preset als de student-link, plus een veld `n` met de profielnaam (afgekapt op 60 tekens, zodat de URL kort blijft). De link gaat meteen naar het klembord; het paneel dat onder de rij openklapt toont hem ook als tekst en als QR. Het veld is optioneel: de gewone *Deel met student*-link stuurt geen naam mee, en een oudere app-versie negeert het gewoon.

Aan de ontvangende kant past [App.tsx](MEETINGPLANNER2026/src/App.tsx) de preset toe zoals altijd (de instellingen staan dus meteen goed) en geeft de naam door aan de planner. Draagt de link een naam, dan biedt de preset-banner **Bewaar op dit toestel** aan: dat legt de zonet toegepaste instellingen vast als profiel, dat meteen actief wordt. De banner bevestigt daarna waar het profiel terug te vinden is — dat is het verschil met een gewone student-link, die eenmalig blijft.

Is die naam hier al bezet (`zelfdeNaam`, hoofdletter- en accentongevoelig), dan komt eerst de `ProfielDialog` met `uniekeProfielNaam` als voorstel ("CSC" → "CSC (2)"). Een deel-link mag nooit stilzwijgend een eigen profiel met dezelfde naam overschrijven; wie dát wél wil, typt de bestaande naam gewoon terug en krijgt de normale overschrijfwaarschuwing.

### Past deze keuze nog bij deze set?
Een OLOD-keuze draagt een **klasgroep** en een **periodebereik** — allebei betekenisloos zonder de instellingen waaronder ze gemaakt is. Zodra traject en instellingen uit elkaar kunnen lopen, moet de tool dat kunnen zéggen in plaats van er stil overheen te werken. Dat gebeurt niet enkel na een profielwissel met behouden traject: ook een geopend dossier, een back-up-import of een grensdatum die met de hand verzet wordt, brengt een traject onder een set waar het niet in gemaakt is.

De controle staat als pure module in [selectieProblemen.ts](MEETINGPLANNER2026/src/components/Traject/selectieProblemen.ts) en kijkt naar drie dingen:

| Probleem | Wanneer | Wat paneel ③ zegt |
| --- | --- | --- |
| `klasgroep-buiten-lijst` | de klasgroep van de keuze staat niet in `mijnOpleidingKlasgroepen` | de klasgroep bij naam, met de weg terug: kies er hier een andere, of zet ze bij Instellingen in de lijst |
| `periode-onbekend` | het bereik valt op geen enkele periodegrens van deze set (andere grensdatums, of een bereik uit oudere opslag dat het hele jaar beslaat) | kies hier een periode van deze set (in modulemodus), of verwijder het vak en kies het opnieuw |
| `module-in-semesterset` | het bereik is één module, terwijl deze set per semester werkt | het vak stopt halverwege het semester; in semestermodus staat de periode-kiezer niet open, dus: verwijderen en opnieuw kiezen |

Twee keuzes in het ontwerp:

- Er wordt getoetst tegen **alle** benoemde periodes van de set, niet enkel tegen die van haar indeling. In modulemodus is een volledig semester namelijk een geldige keuze — zo staat een semestervak in het traject (zie *Semestervakken in modulemodus*). Omgekeerd is een module in een semesterset dat níet, en dat is precies `module-in-semesterset`.
- Anders dan de lessencontrole (`selectieStatussen`, die een **gedeactiveerde** selectie overslaat) telt hier ook wat uitstaat mee: het gaat niet over lessen in het rooster maar over de keuze zelf, en die verwijst evengoed naar een onbekende klasgroep wanneer ze geparkeerd staat. Een **lege shortlist** levert bewust geen klasgroepklachten op — dat is geen oordeel maar een set die nog ingevuld moet worden.

De uitkomst wordt op twee plaatsen gebruikt: per rij in paneel ③ (oranje kader + melding, zoals bij een selectie zonder lessen), en als **getal** in de profielwissel-dialoog en de undo-toast, zodat de keuze *behouden* meteen haar prijs toont.

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
Gecentreerde kolom (max. 960px) met een sticky bovenbalk (*Klaar — terug naar werkblad*, titel, academiejaar-badge) en vijf **inklapbare kaarten** ([SettingsCard.tsx](MEETINGPLANNER2026/src/components/Traject/SettingsCard.tsx)). Elke kaartkop toont een live één-regel-samenvatting ([settingsSummaries.ts](MEETINGPLANNER2026/src/components/Traject/settingsSummaries.ts)), zodat het scherm dichtgeklapt als overzicht leest; enkel *Mijn opleiding* staat standaard open. Lange uitleg zit per kaart achter een *Meer uitleg*-disclosure (native `<details>`).
- **Profielen** (bovenaan, want alles eronder hoort bij het actieve profiel): welke set actief is en of ze afwijkt van wat er bewaard staat, *Bewaar als profiel…* en *"X" bijwerken*, en daaronder de lijst profielen met per rij *Activeren*, een **deel-icoon** en een verwijderknopje. Het deel-icoon klapt onder de rij een paneel open met de link, *Kopieer link* en *Toon QR* (zie *Een profiel delen* hierboven); het sluit zichzelf zodra de profielenlijst wijzigt, zodat er nooit een verouderde link blijft staan. Het beheer staat hier omdat dit het scherm is waar een set wordt opgebouwd; de snelle wissel zelf zit in de contextbalk van het werkblad. Beide lopen langs dezelfde handlers in [TrajectPlanner.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectPlanner.tsx), zodat activeren overal dezelfde bevestiging en undo krijgt. Een profielwissel springt bewust **niet** naar het werkblad: wie hier wisselt, wil meestal meteen verder kijken of bijstellen.
- **Mijn opleiding**: geselecteerde klasgroepen als chips (met *Wis selectie*), zoekveld, *Selecteer alle/geen* (op de zichtbare lijst) en een checkbox-raster gegroepeerd per jaar (1e/2e/3e jaar, *Overige*).
- **Periode**: **indeling** als segmented control (Semesters / Modules, 2 per semester); datepickers voor de **semestergrenzen** (start en einde van semester 1 en 2) met een knop *Standaarddatums* die alles terugzet op `ACADEMIEJAAR`; in modulemodus daarnaast datepickers voor de **modulegrenzen** (start module 2 en 4, begrensd door hun semester) en een strip met de vier moduleperiodes. Een onbruikbare grens geeft een waarschuwing die de standaard vermeldt die zolang geldt. De snelkeuze van de **actieve periode** ([PeriodeSwitcher.tsx](MEETINGPLANNER2026/src/components/Traject/PeriodeSwitcher.tsx)) en de handmatige start/einde-datepickers zitten onder *Geavanceerd: actieve periode handmatig* — dat bereik is enkel wat het werkblad nú toont en verandert de grenzen niet.
- **Deel met student**: student-link genereren/kopiëren en QR tonen/downloaden (zie [trajectShare.ts](MEETINGPLANNER2026/src/components/Traject/trajectShare.ts); de link draagt ook de semestervak-tags mee, want die horen bij de opleiding); een gegenereerde link verdwijnt zodra klasgroepen of periode wijzigen. Deze knoppen delen de instellingen zoals ze *nu* op het scherm staan en sturen géén naam mee — een specifiek profiel doorgeven gaat via het deel-icoon in de kaart *Profielen*.
- **Back-up & herstel**: compacte herinnering dat alles browser-lokaal staat, *Exporteer back-up* (downloadt JSON) en *Importeer back-up…* (bestandskiezer; overschrijft instellingen + traject + kleurmap na bevestiging in een dialoog). Het tijdstip van de laatste export staat in localStorage (`traject_last_backup`, `useLastBackup` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts)) en wordt in de kaartkop getoond; "nooit" krijgt een waarschuwingskleur zodra er klasgroepen of een traject zijn. Onderaan staat *Kleuren opnieuw toewijzen*, dat de kleurmap wist (onderhoud, dus hier en niet in de topbalk).
- Wijzigingen worden direct gepersisteerd in localStorage.

### Scherm 2 — Selectiewerkblad
Drie panelen naast elkaar (grid: `200px 1fr 460px`). De panelkoppen dragen een **volgnummer** (`①` Klasgroepen — `②` Klik vakken aan — `③` Traject van de student), zodat de opbouw links→rechts als werkwijze leest voor wie de tool maar een paar keer per jaar gebruikt.

**Paneel A — Klasgroep-selector** ([KlasgroepSelector.tsx](MEETINGPLANNER2026/src/components/Traject/KlasgroepSelector.tsx))
- Toont enkel klasgroepen uit `mijnOpleidingKlasgroepen`.
- Eén klasgroep tegelijk actief → bron voor paneel B.
- Lijst **Geselecteerde OLODs** met per selectie een **periode-badge** (`S1`, `M2`, of datums bij een handmatig bereik); de badge is gemarkeerd als de selectie de actieve periode raakt. Teller toont "in deze periode / totaal".
- In modulemodus is de badge een knop die een **periode-kiezer** opent: heel het semester (beide modules) of enkel module 1 of 2, voor die klasgroep (`setPeriode` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts); opties uit `periodeOptiesVoor`). De kiezer blijft open na een keuze.
- Bovenaan diezelfde kiezer staat de schakelaar **"Dit is een semestervak"** (met stand *aan*/*uit*): daarmee markeert de gebruiker het vak als semesterbreed. Staat ze aan, dan dragen de badge en de schakelaar een indigo markering met kalendericoon, en zijn de module-opties eronder uitgeschakeld. Zie *Semestervakken in modulemodus* hierboven; een botsing over klasgroepen heen krijgt hier dezelfde oranje melding als een selectie zonder lessen.
- De **klasgroepnaam** van een selectie is eveneens een knop die een **klasgroep-kiezer** opent: alle klasgroepen uit de shortlist waar hetzelfde vak in de periode van de selectie voorkomt (met per klasgroep het aantal lessen; de tooltip toont de wekelijkse lesmomenten). Een keuze verhuist de selectie naar die klasgroep (`setKlasgroep` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts)); valt ze samen met een bestaande selectie, dan smelten ze samen. De kandidaten worden lui opgehaald zodra de kiezer opent (`useKlasgroepAlternatieven` in [useTrajectBlokken.ts](MEETINGPLANNER2026/src/components/Traject/useTrajectBlokken.ts)); klasgroepen waarvan het rooster nog niet beschikbaar is, worden apart vermeld. Hooguit één kiezer (periode of klasgroep) staat tegelijk open.
- **Bulkselectie** (voor studenten die niet het hele programma volgen): elke selectie draagt een **checkbox**, en boven de lijst staan **snelkeuze-chips** per periode die in het traject voorkomt (`M1`, `M2`, …, plus *alles* en *wis*) — één klik vinkt alle vakken van die module aan. Zodra er iets aangevinkt is verschijnt een **actiebalk**: *N gekozen · Verzet naar… · 🗑 · ✕*. De aangevinkte set is vluchtige UI-state (`Set<selectieKey>`); ze wordt niet bewaard en gesnoeid zodra een selectie uit het traject verdwijnt.
- **Bulk-klasgroepkiezer**: *Verzet naar…* toont elke klasgroep uit de shortlist met **hoeveel van de aangevinkte vakken ze in hun periode geeft** (`gedekt/totaal`) en **hoeveel conflicten het traject na de wissel zou tellen**, met het huidige aantal als referentie ("nu N conflicten"). Beste eerst (meeste dekking, dan minste conflicten); de aanrader krijgt een ✨, een slechtere score staat rood. Klikken verzet alle gedekte selecties in één atomaire mutatie (`setKlasgroepBulk` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts), dedupliceert op `selectieKey` zodat samenvallende selecties versmelten); dekt de klasgroep maar een deel, dan vraagt een dialoog eerst bevestiging en blijven de andere vakken staan. Na de wissel klapt de kiezer dicht — het resultaat staat dan in paneel C, en een volgende poging verdient een verse vergelijking; de vakken blijven wel aangevinkt (onder hun nieuwe sleutel), zodat er meteen een volgende bulkactie op dezelfde set kan volgen. Kandidaten komen uit `useBulkAlternatieven` in [useTrajectBlokken.ts](MEETINGPLANNER2026/src/components/Traject/useTrajectBlokken.ts): één fetch per klasgroep voor het **volledige academiejaar** (zelfde range als `useTrajectBlokken`, dus grotendeels uit de range-cache), waarna scoren zonder nieuwe fetch gebeurt — ook na een wissel. Een klasgroep waarvan het rooster (nog) niet opgehaald kan worden zakt naar onderen met een aparte melding.
- **Wat-als-preview**: zolang de muis (of de toetsenbordfocus) op een andere klasgroep-chip in de kiezer staat, toont paneel C waar het vak dan zou vallen — zie hieronder. Bij de bulk-kiezer geldt dat voor de hele set tegelijk (`KlasgroepPreview.sels`), en enkel voor de selecties die effectief verhuizen. De preview verdwijnt zodra de muis de chip verlaat, de kiezer sluit of de wissel effectief gebeurt.
- **Activeren / deactiveren**: elke selectie draagt een oogknopje (open oog = telt mee, doorstreept oog = uit) dat haar uitschakelt of weer inschakelt (`toggleActief` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts)). Een uitgeschakelde selectie krijgt een gestippelde, doffe rij, verdwijnt uit paneel C (rooster, conflicten, teller) en uit de afdruk, maar blijft met klasgroep en periode in de lijst staan — zo kan een vak opzijgezet worden zonder het weg te gooien, en met één klik terug. De teller-tooltip vermeldt hoeveel er gedeactiveerd zijn. In de actiebalk van de bulkselectie zit dezelfde knop voor de hele aangevinkte set (alles uit zodra er nog iets aanstaat, anders alles aan; met undo-melding). Ook het rooster van paneel B toont zo'n blok gestippeld en doffer, naast de gewone "gekozen"-markering.
- **Waarschuwing** bij een selectie die in haar periode geen enkele les van dat vak bij die klasgroep oplevert (bv. na een wissel naar een module waarin het vak niet loopt): oranje kader + melding "Geen lessen van dit vak bij … in …". Is het rooster van die periode nog niet beschikbaar (Untis 404), dan staat er een informatieve melding in plaats van een vals alarm. Statussen komen uit `selectieStatussen` in [useTrajectBlokken.ts](MEETINGPLANNER2026/src/components/Traject/useTrajectBlokken.ts), dat ook het jaarrooster voor paneel C levert.
- **Waarschuwing bij een keuze die niet bij de huidige instellingen past**: een klasgroep buiten de shortlist, of een periode die niet op de grensdatums van deze set valt. Zelfde oranje kader als hierboven, met per geval de weg terug (een andere klasgroep kiezen, de klasgroep aan de lijst toevoegen, een periode kiezen). Boven de lijst staat één strookje — *"3 vakken passen niet bij deze instellingen — hieronder gemarkeerd"* — want een gemarkeerde rij kan ver naar onderen staan. Regels en teller komen uit [selectieProblemen.ts](MEETINGPLANNER2026/src/components/Traject/selectieProblemen.ts); zie *Past deze keuze nog bij deze set?* hierboven.
- **OLOD-zoeker** ([OlodZoeker.tsx](MEETINGPLANNER2026/src/components/Traject/OlodZoeker.tsx)): de knop **Zoek OLOD** in de actiebalk onder de kop van paneel A opent een modale zoeker over **alle klasgroepen uit de shortlist** in de actieve periode — de omgekeerde weg van paneel B, waar je eerst de juiste klasgroep en week moet vinden. Typen filtert op vaknaam (hoofdletter- en accentongevoelig, elk woord van de zoekterm moet ergens in de naam zitten); ↑↓ bladert en Enter opent. Elke rij toont bij hoeveel klasgroepen het vak loopt, hoeveel lessen dat zijn en of het al in het traject staat (en bij welke klasgroep). Een klik opent dezelfde gedeelde **klasgroep-kiezer** als paneel B en C ([OlodKlasgroepDialoog.tsx](MEETINGPLANNER2026/src/components/Traject/OlodKlasgroepDialoog.tsx)), met per klasgroep het weekrooster waarin het vak valt én de melding of het daar met de rest van het traject zou botsen; de gekozen klasgroep zet het vak in het traject voor de periode van dat vak (`bereikVoorOlod`, dus een semestervak krijgt zijn hele semester) en brengt je terug in de lijst, zodat je meteen een volgend vak kan opzoeken. De kiezer vergelijkt één week: die waarin de meeste klasgroepen het vak geven (bij gelijkspel de vroegste); klasgroepen die het vak wel in de periode maar niet in die week geven, worden in de hint bij naam genoemd. De roosters komen uit `usePeriodeRoosters` ([useTrajectBlokken.ts](MEETINGPLANNER2026/src/components/Traject/useTrajectBlokken.ts)), lui opgehaald bij het openen en klasgroep per klasgroep zichtbaar terwijl ze binnenkomen; een klasgroep waarvan het rooster niet opgehaald raakt wordt in de voetregel als niet-doorzocht gemeld, want anders lijkt een ontbrekend vak gewoon niet te bestaan.
- **Wizard: een rooster laten voorstellen** ([TrajectWizard.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectWizard.tsx)): de knop **Wizard** in de actiebalk van paneel A opent een venster met drie stappen. De knop draagt een **beta**-merkje (en zegt dat ook in haar tooltip): de functie ligt bij de testers, en een voorstel hoort nagekeken te worden vóór het overgenomen wordt. **① Referentieweken** — de 1 tot 3 lesweken waarop de puzzel gelegd wordt. Een rooster herhaalt zich meestal week na week (soms met een even/oneven ritme), terwijl de eerste en de laatste lesweek van een periode vaak atypisch zijn en er verspreid eenmalige lessen staan; zonder die keuze zou elke losse inhaalles als een onoplosbare botsing tellen. Standaard staan **twee opeenvolgende** weken uit het midden aangeduid die het dichtst bij het **mediane** aantal lessen liggen — bewust de mediaan en niet het maximum: een week met inhaallessen telt er méér, een week met een feestdag minder, en net die weken zijn slechte ijkpunten. Elke weekchip toont haar lessenaantal, de eerste en laatste week staan gestippeld, en de tooltip zegt of een week van een doorsneeweek afwijkt. **② Vakken** — alles wat de shortlist in de actieve periode geeft, in **blokken per leerjaar** (het eerste cijfer van de klasgroepnaam, `jaarVanKlasgroep` in [settingsSummaries.ts](MEETINGPLANNER2026/src/components/Traject/settingsSummaries.ts)) met *alles* / *geen* per blok; een vak dat in meerdere jaren voorkomt staat in beide blokken en blijft één keuze. Wat al in het traject staat, staat bij het openen aangevinkt. Een vak zonder les in de gekozen referentieweken is gestippeld en doet niet mee — de wizard zegt welke dat zijn en houdt hun bestaande keuze ongemoeid. **③ Voorstel** — de voorkeur (*zo weinig mogelijk botsingen* of *zo weinig mogelijk lesdagen*) en de knop *Doe voorstel*. Het resultaat toont per vak de gekozen klasgroep (met "was …" waar het van de huidige keuze afwijkt) en de botsende lessen, met bovenaan botsingen / lesdagen / tussenuren per week / aantal klasgroepen. **Overnemen** vervangt alle keuzes die de actieve periode raken door het voorstel — keuzes in andere periodes blijven staan, en een **gedeactiveerde** keuze die het voorstel niet invult blijft geparkeerd — als **één** undo-punt. De roosters komen uit dezelfde `usePeriodeRoosters` als de OLOD-zoeker, dus wie eerst gezocht heeft, opent de wizard zonder te wachten.

- **De wizard over het hele jaar** ([TrajectWizard.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectWizard.tsx) + `WizardStartDialog` in [TrajectDialogs.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectDialogs.tsx)): een traject bestaat uit alle periodes samen, maar de puzzel wordt per periode gelegd. Daarom staat in de **kop van de wizard** dezelfde `PeriodeSwitcher` als in de contextbalk van het werkblad (S1/S2 of M1…M4). Ze zet de **actieve periode van het werkblad** om en niet een aparte wizardperiode: `bereikVoorOlod`, de OLOD-lijst en het overzicht moeten hetzelfde bedoelen als de wizard, en wie de wizard sluit, staat in de periode waar hij laatst aan werkte. Een wissel **herstart de puzzel** — andere lesweken, andere vakken, een ander stuk traject — dus zolang er nog een berekend voorstel op tafel ligt dat niet overgenomen is, komt eerst de vraag *“Overnemen vóór je naar … gaat?”* met drie antwoorden: overnemen en wisselen, wisselen zonder overnemen, of annuleren. Overnemen is daar één undo-punt zoals elders, en de wizard blijft open (`onOvernemen(keuzes, sluiten)`; enkel de knop **Overnemen in traject** in de voet sluit ze). Bij het herstarten blijft alleen de **voorkeur** staan: die hoort bij de student en niet bij de periode, en wie vier modules na elkaar legt, wil ze niet vier keer opnieuw aanduiden. Het herstarten gebeurt in een effect dat bewust vóór het klaarzet-effect gedeclareerd staat, zodat `klaargezet` binnen dezelfde commit alweer vrij is en een periode met gecachete roosters niet met een lege weekkeuze achterblijft.
- **De waarschuwing vóór de wizard start** (`WizardStartDialog`): de wizard is geen leeg blad — ze vinkt aan wat al in het traject staat, en elk *overnemen* vervangt alle keuzes van de periode waarin ze op dat moment puzzelt. Wie er met de periodeknoppen het hele jaar mee afgaat, schrijft dus na elkaar over elke periode heen. Dat hoort de gebruiker te weten vóór hij begint, dus bij een niet-leeg traject gaat er een dialoog aan vooraf met een echte keuze — zelfde vorm als de profielwissel: **laten staan** (de standaard, de omkeerbare kant: meestal wil de begeleider net vertrekken van wat er ligt) of **eerst wissen** (rode knop, met undo, en de vakken die verdwijnen staan erbij opgesomd). Een leeg traject krijgt geen dialoog: er valt niets te waarschuwen.
- **De puzzel zelf** ([trajectVoorstel.ts](MEETINGPLANNER2026/src/components/Traject/trajectVoorstel.ts), pure module zonder React): variabele = een aangeduid vak (of een groep vakken die samen bij één klasgroep horen — zie hieronder), domein = de klasgroepen die het in de referentieweken geven, constraint = geen tijdsoverlap tussen de lessen van twee keuzes. Er wordt per **(vak, klasgroep)** gekozen en niet per les — dat is ook het datamodel van het traject. Backtracking met de minst flexibele vakken eerst en per vak de goedkoopste klasgroep eerst; botsingen en lesdagen kunnen bij het verder invullen alleen maar toenemen, dus hun tussenstand is een geldige **ondergrens** waarmee hele takken wegvallen. De score is `gewicht × botsingen per week + gewicht × lesdagen + tussenuren`: bij *conflictvrij* weegt een botsing 1000 (ze verliest dus altijd van compactheid), bij *compact* mag één lesdag minder één botsing kosten — twee niet. Er komt **altijd** een antwoord: bestaat er geen botsingsvrije combinatie, dan is het het minst botsende voorstel, met de betrokken vakken aangeduid. Harde limieten (2 miljoen knopen of 1 seconde) beschermen tegen een pathologisch geval; het voorstel meldt dan zelf dat de zoektocht afgekapt is.
- **Vakken die samen horen** ([koppelGroepen.ts](MEETINGPLANNER2026/src/components/Traject/koppelGroepen.ts) + [KoppelGroepenDialoog.tsx](MEETINGPLANNER2026/src/components/Traject/KoppelGroepenDialoog.tsx)): een opleiding die met **labs** werkt, geeft een groepje OLODs als één geheel — wie het Sales-lab volgt, volgt Accountmanagement, Markt en klant én Salestechnieken bij dezelfde klasgroep. De wizard koos vroeger per vak los en stelde dus roosters voor waarin één labvak elders zat. Nu gaat zo'n groep als **één variabele** de puzzel in, met als domein enkel de klasgroepen die *alle aangevinkte* leden geven. De koppeling is dus geen weging maar een gegeven: botst er iets, dan moet het andere vak wijken. Twee dingen zijn bewust zo: (1) het rekenwerk leest **nooit** een naamregel maar enkel een expliciete, bewaarde lijst groepen — de herkenning aan de dubbele punt (`Sales: …`) is enkel een suggestieknop, zodat een naamafspraak van één opleiding het voorstel van een andere niet kan sturen; (2) staat de schakelaar uit of is de lijst leeg — de toestand van elke bestaande gebruiker — dan verandert er niets. De **kandidaten** van een groep worden bepaald over de **volledige periode** en niet over de referentieweken (geeft een klasgroep in die twee weken toevallig maar twee van de drie labvakken, dan blijft ze de klasgroep van het lab); enkel kandidaten zonder één les in de ijkweken vallen af, anders zou zo'n klasgroep met nul botsingen blind winnen. Past de groep in **geen enkele** klasgroep, dan wordt ze niet geplaatst en zegt stap ③ waarom, met per klasgroep hoeveel leden ze geeft en welk vak er ontbreekt — liever geen antwoord dan een stil gesplitst lab; de bestaande keuzes van die vakken blijven staan. Volgt de student maar een deel van de groep (een vrijstelling), dan geldt de regel enkel voor wat aangevinkt staat, en een groep met één aangevinkt lid koppelt aan niets. Het venster erachter (het knopje **Vakken die samen horen** in stap ②) toont de groepen met hun vakken en laat er leden uit halen. Koppelen gebeurt **met de hand, in twee klikken**: klik een vak in de vakkenlijst aan — het licht op en de regel eronder zegt wat er klaarstaat — en klik dan het vak waar het bij hoort, of een bestaande groep die dan oplicht met *“klik om … hier bij te zetten”*. Daarna volgt de vraag *“Horen A en B samen bij één klasgroep?”*, met een naam die voorgesteld maar niet opgelegd wordt (Enter bevestigt, Esc annuleert eerst de vraag en pas daarna het venster). Bewust klikken en niet slepen: een HTML5-sleep vertrekt in Chromium — en dus in de WebView van de app — niet vanaf een `<button>`, en een lijst van enkele tientallen vakken die moet meescrollen sleept sowieso slecht. Twee klikken werken ook op een touchscreen en met het toetsenbord. Een vak hoort bij hoogstens één groep, dus koppelen aan een andere groep verhuist het. Onderaan staat als **hulpmiddel** nog de knop die groepen uit de namen voorstelt (alles vóór de dubbele punt): waar die afspraak geldt scheelt ze veel werk, maar ze is bewust niet de weg — lang niet elke opleiding benoemt haar labs zo. De vakkenlijst komt uit **één zelfgekozen periode** — standaard die van de wizard, zodat de roosters al in het geheugen zitten en Untis niet voor het hele jaar bevraagd wordt — met een zoekveldje ernaast. Twee schakelaars: de koppeling zelf, en *ook in de andere periodes van het jaar dezelfde klasgroep* (staat het lab in M1 bij D1, dan kiest de wizard in M3 diezelfde; staat het elders zelf al verspreid, dan wordt niets afgedwongen en zegt de wizard dat). De lijst zit in `TrajectSettings.koppelGroepen` en reist dus mee met profiel, back-up, bewaard dossier en deel-link (die laatste enkel wanneer ze aan staat).
- **Een groep die uit elkaar ligt** (paneel A): de wizard kan een lab niet meer splitsen, maar met de hand klikken, een geïmporteerde back-up of een ouder dossier wel. Staan de vakken van een groep in dezelfde periode bij verschillende klasgroepen, dan krijgt elke betrokken rij hetzelfde oranje kader met wie waar staat. En wie in de klasgroep-kiezer één labvak verzet, krijgt meteen de vraag of **de rest van de groep meeverhuist** — met dezelfde weegschaal als de bulkwissel, dus inclusief de melding wanneer de doelklasgroep maar een deel van die vakken geeft. Gedeactiveerde keuzes tellen nergens mee: die zijn een geparkeerd scenario, geen tegenspraak.

**Paneel B — Klasgroeprooster** ([KlasgroepRooster.tsx](MEETINGPLANNER2026/src/components/Traject/KlasgroepRooster.tsx))
- **Periodestrip** onder de panelkop: *"Een klik voegt het vak toe aan **S1** (21/09 – 31/01)."* De periode-switcher staat in de contextbalk, maar haar gevolg is hier voelbaar — zonder deze regel is dat onzichtbaar. Bij een handmatig bereik zonder naam staat enkel het datumbereik. Ligt de bekeken week **buiten** de actieve periode, dan wordt de strip oranje en meldt ze dat een klik het vak tóch aan die periode toevoegt (het gedrag van `selectieVoorBlok`, dat anders een stille verrassing is).
- Toont het rooster van de actieve klasgroep voor een **navigeerbare week** (vorige/volgende). Bij een periodewissel springt de week naar de eerste lesweek van die periode (of naar vandaag als die erin valt).
- Lesblokken zijn klikbaar:
  - Valt het blok onder geen enkele selectie van `(Y, X)` → **toevoegen** voor de actieve periode.
  - Valt het blok onder een bestaande selectie → **die selectie verwijderen** (alle instanties binnen haar periode).
- **"Alles toevoegen"** — een knop in een eigen actiebalk onder de weeknavigatie die **elk vak dat deze week op het rooster staat en nog niet gekozen is** in één klik aan het traject toevoegt (`addBlokken` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts)). Voor wie een student het volledige programma van een klasgroep laat volgen, was dat anders vak per vak aanklikken.
  - Per vak gaat er één blok mee (het vroegste van de week): een selectie geldt toch voor het hele vak in de hele periode. Elk vak krijgt dezelfde periode als bij een gewone klik (`bereikVoorOlod`), dus een **semestervak** krijgt ook hier zijn volledige semester.
  - Bewust **géén toggle**: al gekozen vakken blijven staan, ook wanneer ze in deze zelfde ronde net zijn bijgekomen. De knop vult enkel aan; weghalen gebeurt met een klik op het blok zelf of in paneel A.
  - De knop draagt een neutrale **teller** met het aantal dat effectief zou bijkomen, en haar tooltip somt die vakken op mét de klasgroep en de periode waarin ze belanden. Valt er niets toe te voegen, dan is ze uitgeschakeld en staat ernaast waarom: *Geen lessen in deze week* of *Alle vakken van deze week staan al in het traject*.
  - De actiebalk staat op een eigen regel en niet in de weeknavigatie: paneel B is maar 320px breed en de pijlen, het weeklabel en de datumkiezer vullen die rij al. De actie is er een van de **getoonde week**, dus ze verhuist mee met elke weekwissel; buiten de actieve periode geldt dezelfde waarschuwing als voor een gewone klik (oranje periodestrip). Toevoegen levert een **undo-melding** op — één klik kan het traject in één klap vullen.
- Geselecteerde OLODs hebben een groene streepjesrand (3px). De blokkleur stopt bij die rand (`background-clip: padding-box`), zodat de streepjes op de witte roosterachtergrond staan en de rand ook op een groen gekleurd vak leesbaar blijft; een buitenring of gloed kan niet, want verticaal aansluitende blokken raken elkaar. Is de selectie gedeactiveerd, dan wordt die rand grijs gestippeld en het blok doffer — bewust een ander patroon dan de groene streepjes (klikken verwijdert de selectie dan nog steeds — activeren gebeurt in paneel A).
- **Semestervak-schakelaar per lesblok** (enkel in modulemodus): links in de uurregel van elk blok staat een pil met `S` (indigo gevuld = semestervak, loopt over beide modules) of `M` (wit = modulevak). Ze is tegelijk indicator en knop, zodat je in het rooster zelf leest wat wat is en het ter plekke kan omzetten. Bewust in de uurregel en niet als tweede hoekknop: een gesplitst blok (twee lessen naast elkaar) is smaller dan twee hoekknoppen samen. De periodestrip vermeldt de regel er ook bij ("Een vak met een S-knopje … komt altijd in het hele semester").
- **Klasgroep-kiezer per vak** ([OlodKlasgroepDialoog.tsx](MEETINGPLANNER2026/src/components/Traject/OlodKlasgroepDialoog.tsx), gedeeld met paneel C): elk lesblok draagt rechtsboven een knopje dat een modaal venster opent (portal in `document.body`) met, per klasgroep uit de shortlist die dit vak deze week geeft, een mini-weekrooster met het vak gemarkeerd plus zijn lesuren. De huidige klasgroep staat vooraan (badge "huidig"). Het venster **scrollt zelf**, zodat ook een lange shortlist volledig bereikbaar blijft. Een klik op een kaart zet het vak in het traject **bij díe klasgroep** (voor de actieve periode) en sluit de kiezer; een klik op een al gekozen kaart ("in traject") haalt het er weer uit en houdt de kiezer open om meteen een andere klasgroep aan te duiden. Sluiten met Esc, de X of een klik naast het venster. De roosters van de andere klasgroepen worden pas opgehaald wanneer de kiezer opengaat en per week gecachet.

**Paneel C — Studenttraject-overzicht** ([StudentOverzicht.tsx](MEETINGPLANNER2026/src/components/Traject/StudentOverzicht.tsx))
- **Statusregel** bovenaan, altijd zichtbaar zodra er een traject is: groen *"Geen conflicten in dit traject"* of een rode knop *"N conflicten — toon"* die het conflictpaneel onderaan openklapt en in beeld scrolt (tijdens het laden: *"Rooster laden…"*). Het conflictpaneel zelf verschijnt enkel bij conflicten, dus zonder deze regel wordt "alles in orde" nooit bevestigd — terwijl de bulk-klasgroepkiezer in paneel A wél naar dit getal verwijst (*"nu N conflicten"*). Beide rekenen op dezelfde `detectConflicts` uit [conflicts.ts](MEETINGPLANNER2026/src/components/Traject/conflicts.ts), zodat de cijfers niet uit elkaar kunnen lopen. Tijdens een wat-als-preview neemt de preview-strip het over, met haar eigen referentiepunt.
- **Verticale strip**: één rij per week voor het **volledige academiejaar**; elke selectie draagt enkel binnen haar eigen periode bij. Subtiele **grensmarkeringen** bij de start van elk semester (en in modulemodus elke module); de weken van de actieve periode zijn gemarkeerd en worden bij een periodewissel in beeld gescrold.
- Per week een mini-kalender (5 dagen × uren) met **gekleurde blokjes** — geen tekstdetails.
- Eén **kleur per unieke `olodNaam`**, consistent over klasgroepen heen.
- Blokjes met **tijdsoverlap** krijgen een **rode outline**.
- **Legende** onderaan met OLOD-namen + swatches.
- **Uitklapbaar conflictpaneel** onderaan met datum, uur, OLOD-naam en klasgroep per conflict.
- Hover-tooltip per blokje (portal in `document.body`, zodat overflow van voorouders de positie niet verknoeit): vak, klasgroep, type, uren, de conflicten waar het blokje in zit, en onderaan de uitnodiging *“Klik om dit vak in een andere klasgroep te volgen”* — dat is meteen de vindplaats van de verhuis-kiezer hieronder.
- **Verhuizen vanuit een blokje**: een klik op een blokje opent dezelfde klasgroep-kiezer als het knopje in paneel B ([OlodKlasgroepDialoog.tsx](MEETINGPLANNER2026/src/components/Traject/OlodKlasgroepDialoog.tsx)), maar met **verhuis**-semantiek: de keuze achter dat blokje gaat naar de aangeklikte klasgroep in plaats van er een tweede bij te maken. Zo hoeft wie in het overzicht een botsing ziet niet eerst in paneel A of B de juiste rij terug te zoeken. De kiezer toont de week van het aangeklikte blokje, met de huidige klasgroep vooraan (badge "huidig"); klikken op die kaart sluit gewoon. Elke kandidaatkaart vermeldt bovendien of het vak daar **in deze week** zou botsen met de rest van het traject (rode streepjesrand op de betrokken lesjes, plus een regel "Botst deze week met N lessen" / "Geen botsing in deze week") — bewust week-scoped, want de kiezer vergelijkt één week. De kopbalk benoemt de **periode die mee verhuist** (S1/M2 + datums), zodat het niet lijkt alsof enkel die ene week verplaatst. De verhuis loopt via `setKlasgroepBulk` ([hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts)) met undo-melding: normaal is er één selectie, maar een semesterkeuze naast een modulekeuze bij dezelfde klasgroep moet als geheel mee, anders bleef het blokje staan. Ghost-blokjes uit een wat-als-preview zijn niet klikbaar — daar zit nog geen keuze achter. De weekroosters van de kandidaten komen uit `useWeekRoosters` ([useTrajectBlokken.ts](MEETINGPLANNER2026/src/components/Traject/useTrajectBlokken.ts)), lui opgehaald bij het openen en grotendeels uit de range-cache van de adapter.
- **Vergrootglas per week** ([WeekZoom.tsx](MEETINGPLANNER2026/src/components/Traject/WeekZoom.tsx)): het knopje bij het weeklabel opent die week **alleen-lezen** in een groot venster (portal in `document.body`) — een volwaardig rooster met uurkolom en rasterlijnen, waarin elk blok zijn uren, OLOD-naam, klasgroep, type en lokaal uitgeschreven toont. Conflicten en de wat-als-preview zijn er in dezelfde codering zichtbaar; onderaan staat een legende met per vak de klasgroep(en). Sluiten met Esc, de X of een klik naast het venster. Klikken op blokken doet er niets: verhuizen kan vanuit de kleine weekstrook eronder, toevoegen en verwijderen in paneel A en B.
- **Wat-als-preview** vanuit de klasgroep-kiezer van paneel A (`preview`-prop, type `KlasgroepPreview`): de lessen van de verhuizende selectie bij de huidige klasgroep vervagen (tenzij een andere selectie van hetzelfde vak bij die klasgroep ze ook dekt), de lessen bij de kandidaat-klasgroep verschijnen als gestreepte, gestippeld omrande *ghost*-blokjes (zonder blokken die al in het traject zitten), en conflictdetectie + conflictpaneel rekenen voor dat scenario ("… bij wissel naar 2 TI B"). Een strip bovenaan vat samen: vak, nieuwe i.p.v. huidige klasgroep, aantal lessen en het aantal *nieuwe* conflicten (rood zodra > 0). De eerste week met een ghost-blok wordt zo nodig in beeld gescrold.

### Topbalk: appbalk + contextbalk ([TrajectPlanner.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectPlanner.tsx))
De balk staat in **twee rijen**, omdat één rij vier soorten dingen door elkaar droeg: navigatie, context, acties en hulp. De scheidslijn is *commando versus toestand*.

**Rij 1 — appbalk** (`.appbar`, altijd zichtbaar): links een **huisje-icoonknop** terug naar de modulekeuze + de titel *Trajectplanner*, rechts de tab-switcher **Werkblad / Instellingen** en een icoonknop **Handleiding** (PDF, opent in een nieuw tabblad). Het huisje draagt geen tekst: terug naar de modulekeuze is zelden nodig, en de tooltip plus `aria-label` benoemen het.

Deze rij draagt bewust **geen** overloopmenu meer. Afdrukken, kopiëren en resetten zaten er eerst in, maar ze horen bij het samenstellen zelf — zo levert de trajectbegeleider een dossier af, en scenario's uitproberen vraagt een reset — en twee klikken diep is dan te ver. Ze staan nu vast in de contextbalk.

**Rij 2 — contextbalk** (`.contextbar`, **enkel in het werkblad**): de toestand waarin het werkblad staat, elke groep met een uitgeschreven label en gescheiden door een verticale lijn. Niet in het instellingenscherm — dat heeft zijn eigen sticky kopbalk, en drie balken boven elkaar is er één te veel.
- **Periode** — de periode-switcher (compact: `S1 | S2` of `M1 | M2 | M3 | M4`, afhankelijk van de indeling) zet de actieve periode; paneel B en C volgen. Het label erbij is nodig: `S1 S2` alleen is voor wie de tool een paar keer per jaar gebruikt een raadsel.
- **Dossier** — het **dossiermenu** ([BewaardeTrajecten.tsx](MEETINGPLANNER2026/src/components/Traject/BewaardeTrajecten.tsx)), één knop die de vroegere `Bewaar traject` en `Laad traject ▾` vervangt. De knop draagt de naam van het geopende dossier (`traject_actief`) met een oranje stip zodra er niet-bewaarde wijzigingen zijn; zonder geopend dossier staat er een gedempt *nieuw dossier*.
  - Menu-inhoud: **Bewaar** (met de sneltoets `Ctrl+S` rechts in het item) en, zodra er een dossier open staat, **Bewaar als…**; daaronder de lijst **Bewaarde dossiers** (naam, aantal OLODs/klasgroepen, periode, datum). Klik op een rij = na bevestiging traject **én instellingen** vervangen (zoals een back-up-import, zonder kleurmap); prullenbakje = bewaard dossier verwijderen uit localStorage. Staat het werkblad leeg, dan laadt een klik meteen. Reset en import raken de bewaarde dossiers niet.
  - **Bewaren** (`doeSnelBewaar`) gaat rechtstreeks naar het geopende dossier; is er geen, dan opent de dialoog met naamveld (voorgevuld met de actieve naam), de lijst bestaande dossiers om aan te klikken en te overschrijven, en een waarschuwing zodra de naam een bestaand item raakt. *Bewaar als…* opent die dialoog altijd. Bewaard wordt het `StudentTraject` **samen met de `TrajectSettings`** (klasgroep-shortlist, actieve periode, semester/module-indeling, grensdatums) in `traject_bewaard` (`useBewaardeTrajecten`); het item wordt gemarkeerd als het geopende dossier. Kleurmap wordt niet meebewaard.
  - **`Ctrl+S` / `Cmd+S`** roept hetzelfde aan, ook vanuit het instellingenscherm. De handler hangt in een ref zodat de listener één keer aangehaakt wordt en toch met verse state werkt; hij doet niets zolang er een dialoog openstaat of het traject leeg is.
  - Naast de knop staat een expliciete **Bewaar**-knop. Ze staat er **altijd**, ook wanneer alles bewaard is (dan uitgeschakeld, met *Alles is bewaard* in de tooltip): zou ze komen en gaan met `nietBewaard`, dan zouden de icoonknoppen ernaast bij elke wijziging verschuiven. Enkel haar rand en tekst kleuren oranje zodra er werk openstaat — dezelfde kleur als de stip op de dossiernaam.
  - Daarnaast twee **icoonknoppen** (28px, een maatje kleiner dan die in de appbalk): **Print / PDF** (`window.print()`) en **Kopieer naar klembord**, dat na een geslaagde kopie even een vinkje toont. Beide iconen lezen zonder tekst, dus ze dragen er geen; de tooltip en `aria-label` benoemen ze. Ze staan in de dossiergroep omdat ze op datzelfde dossier werken: bewaren, afdrukken, kopiëren.
- **Reset traject** staat helemaal **rechts in de contextbalk**, achter een `topbarSpacer`. In het zicht, want scenario's uitproberen hoort bij het werk — maar op armlengte van de opbouwende knoppen, zodat een misklik niet voor de hand ligt. Met tekst erbij: het `RotateCcw`-icoon alleen leest als *ongedaan maken*. Klik geeft de dialoog met de vakken die verdwijnen, en wist daarna enkel `StudentTraject`; instellingen, profielen en bewaarde dossiers blijven staan.
- **Profiel** — de eerste groep: het **profielmenu** ([ProfielMenu.tsx](MEETINGPLANNER2026/src/components/Traject/ProfielMenu.tsx)), de switcher tussen **instellingssets** ("Flextraject — avondgroepen", "Bissers module 1", …). De knop draagt de naam van het actieve profiel (met schuifjes-icoon, zodat ze niet te verwarren is met de dossierknop verderop) en een oranje stip zodra de instellingen ervan afwijken; zonder actief profiel staat er een gedempt *geen profiel*.
  - Menu-inhoud: **Bewaar instellingen als profiel…** en, met een actief profiel, **"X" bijwerken** (uitgeschakeld zolang er niets gewijzigd is); daaronder de lijst **Profielen** met per rij de naam, een samenvatting (`profielSamenvatting`: aantal klasgroepen · semesters/modules · periode) en de bewaardatum, plus een prullenbakje. De actieve rij is uitgeschakeld en draagt een vinkje.
  - Een klik op een andere rij **wisselt** van set: de instellingen worden vervangen, en de dialoog vraagt of het studenttraject mee gewist wordt of blijft staan (behouden is de standaard; wissen laat ook het dossier los) — zie *Profielen (instellingssets)* hierboven voor het waarom en voor wanneer die dialoog verschijnt.
  - Openen/sluiten van het menu komt uit dezelfde [TopbarMenu.tsx](MEETINGPLANNER2026/src/components/Traject/TopbarMenu.tsx) als het dossiermenu.

**Dossier versus profiel.** Twee woorden die uit elkaar moeten blijven, want ze overlappen in wat ze bewaren: een **dossier** is één student (traject + zijn instellingen), een **profiel** draagt alleen instellingen (klasgroep-shortlist, periode-indeling, grensdatums, semestervakken, actieve periode) en is herbruikbaar over studenten heen. Vandaar ook de hernoeming in de UI van "traject" naar "dossier" waar het over het bewaarde geheel gaat; *traject* blijft de term voor de vakkenlijst zelf (`StudentTraject`, *Reset traject*).

Ze staan naast elkaar in de contextbalk en gedragen zich tegengesteld, wat het onderscheid ook zichtbaar maakt: een **dossier openen** brengt een traject mee (en de instellingen waarin het gekozen is), een **profiel wisselen** biedt aan er net één weg te gooien. Wie het werk van een student wil houden, kiest daar dus *behouden* — of bewaart vooraf zijn dossier — dat zet later ook meteen de juiste instellingen terug, los van welk profiel er dan actief is.

**Dialogen en undo.** Alle bevestigingen lopen via `BevestigDialog` / `BewaarDialog` / `ProfielWisselDialog` ([TrajectDialogs.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectDialogs.tsx)) in plaats van `window.confirm` / `window.prompt` — dat laat toe de betrokken vakken bij naam en kleur te tonen (reset, bulkwissel, bulk verwijderen). Bij een destructieve dialoog start de focus op *Annuleren*. Ingrijpende mutaties bieden daarna een **undo-toast** ([Toast.tsx](MEETINGPLANNER2026/src/components/Traject/Toast.tsx), ±8 s): reset, één OLOD verwijderen, bulk verwijderen, bulk verzetten en *Alles toevoegen* in paneel B. Het herstelpunt is telkens een **snapshot van het volledige traject** dat via `replaceTraject` teruggezet wordt — bewust geen inverse per actie, omdat `setKlasgroepBulk` selecties kan laten samensmelten en dat niet omkeerbaar is door de wissel te herhalen. De toast rendert in `document.body` en wordt in `@media print` verborgen.

De uitklapmechaniek van de topbalk-menu's (buiten-klik, Escape, `aria-haspopup`) zit in [TopbarMenu.tsx](MEETINGPLANNER2026/src/components/Traject/TopbarMenu.tsx). Oproepers kunnen er een extra knopklasse (`btnClass`, voor de icoonknop en de dossierknop) en per item een rechts uitgelijnde `hint` (de sneltoets) aan meegeven.

## Conflictdefinitie
```typescript
const overlapt = (a: Lesblok, b: Lesblok) =>
  a.start < b.eind && b.start < a.eind;
```
Conflictdetectie loopt over alle effectieve lesblokken binnen het semester (uitgerold uit de OLOD-selecties), met een vroege break op gesorteerde startijden.

Gedeactiveerde selecties (`actief: false`) doen in dit alles niet mee: `effectieveBlokken` laat ze weg, en `wegBlokkenVoor` / `ghostBlokkenVoor` negeren ze zowel als verhuizende selectie als bij de vraag of een andere selectie een blok in het rooster houdt.

Alles wat "welke blokken zitten er effectief in het traject en wat zou een wissel daaraan veranderen" beantwoordt, staat in [conflicts.ts](MEETINGPLANNER2026/src/components/Traject/conflicts.ts): `effectieveBlokken` (uitrollen van de selecties, elk blok hoogstens één keer), `wegBlokkenVoor` / `ghostBlokkenVoor` (wat verdwijnt en wat erbij komt bij een wissel van één of meerdere selecties) en `scenarioBlokken` (bestaand − weg + ghost). Paneel C tekent daarmee de preview en paneel A scoort er de bulk-kiezer mee, zodat het conflictaantal in de kiezer exact overeenkomt met wat het overzicht daarna toont.

## Kleurtoekenning
- Eén kleur per unieke `olodNaam`, persistent in `traject_kleurmap`.
- Palet van **12** visueel onderscheidbare, print-vriendelijke kleuren.
- Nieuwe OLOD krijgt de eerstvolgende vrije kleur; bij uitputting cycleren.

## Print-export
**Visuele weergave wordt onderdrukt in print** (`@media print` verbergt `.overzichtScroll`, `.legendRow`, `.conflicts`).
De afdruk bevat:
- **Titel + actieve periode (naam + datums) + afdrukdatum** bovenaan.
- Een **eenvoudige lijst van OLODs** voor het volledige traject, gegroepeerd per klasgroep (alfabetisch), elk vak als bullet met zijn periode, bv. `Web Development (M2)`. **Gedeactiveerde OLODs staan er niet bij** (ze tellen ook in het rooster niet mee); staan er, dan sluit een voetnoot af met hoeveel er niet meegeteld zijn. Hetzelfde geldt voor *Kopieer naar klembord*.

Geen kleurenlegende, geen conflictlijst, geen mini-kalender in de afdruk.

## Back-up & herstel
- **Export**: JSON-bestand met `{ settings, traject, kleurmap, profielen, exportedAt, version }`. Bestandsnaam bevat de exportdatum.
- **Import**: bestand inlezen, valideren, na confirm `replaceSettings` / `replaceTraject` / `replaceMap` aanroepen (zie [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts)).
- **Profielen** zitten mee in de back-up (anders is een browserwissel of gewiste cache het einde van elke bewaarde set). Het veld is optioneel: een back-up van vóór de profielen laat de lijst van de importerende browser ongemoeid; bevat ze het veld wél, dan **vervangt** ze de lijst — de back-up zet de browser terug zoals ze was — en dat staat ook in de bevestigingsdialoog. Na de import wordt het profiel dat overeenkomt met de geïmporteerde instellingen (zelfde `profielVingerafdruk`) meteen als actief gemarkeerd. Een profielitem zonder id of naam wordt overgeslagen in plaats van het hele bestand af te keuren.
- Feedback in de Instellingen-sectie met success/error-melding.

## Bestandsstructuur
```
MEETINGPLANNER2026/src/components/Traject/
├── types.ts                 # Lesblok, OLODSelectie, StudentTraject, TrajectSettings, KleurMap, Conflict, TrajectUntisService
├── academicYear.ts          # Academiejaar, instelbare grensdatums (PeriodeGrenzen), periodes (periodesVoor), defaultRoosterWeek
├── semesterOlods.ts         # Semestervakken: tag per OLOD-naam, semesterbereik, verbreden van keuzes, botsingen
├── trajectService.ts        # Adapter rond untisService met range-aware cache
├── hooks.ts                 # useTrajectSettings, useStudentTraject, useKleurMap, useBewaardeTrajecten, useActiefTraject, useProfielen (+ normalize/replace-functies voor import)
├── useTrajectBlokken.ts     # Jaarrooster per klasgroep in het traject + selectieStatussen (geen lessen / niet beschikbaar) + useKlasgroepAlternatieven (klasgroep-kiezer) + useBulkAlternatieven (bulk-kiezer met dekking/conflictscore) + useWeekRoosters (weekroosters voor de kiezer vanuit paneel C) + usePeriodeRoosters (periode-roosters voor de OLOD-zoeker)
├── conflicts.ts             # Gedeelde scenariologica: effectieveBlokken, wegBlokkenVoor, ghostBlokkenVoor, scenarioBlokken, detectConflicts
├── dateUtils.ts             # mondayOf, weeksBetween, isoWeekNumber, periodeBereik, formatters
├── PeriodeSwitcher.tsx      # Snelkeuze-knoppen actieve periode (contextbalk compact + instellingen)
├── TrajectPlanner.tsx       # Shell + appbalk/contextbalk + tabs + periode-switcher + dialoog-/undo-state + bewaar/laad dossier (Ctrl+S) + profielwissel + print + export/import wiring
├── TopbarMenu.tsx           # Herbruikbare topbalk-dropdown (buiten-klik + Esc) + menu-item (icoon, danger, sneltoets-hint)
├── TrajectDialogs.tsx       # BevestigDialog + BewaarDialog + ProfielDialog + ProfielWisselDialog (vervangen window.confirm/prompt)
├── Toast.tsx                # useUndo + UndoToast ("… — Ongedaan maken")
├── BewaardeTrajecten.tsx    # Dossiermenu in de contextbalk: bewaren + lijst bewaarde dossiers (openen / verwijderen)
├── ProfielMenu.tsx          # Profielmenu in de contextbalk: instellingsset bewaren/bijwerken + lijst profielen (activeren / verwijderen)
├── settingsSummaries.ts     # Pure kaartsamenvattingen + profielSamenvatting + groepering klasgroepen
├── selectieProblemen.ts     # Pure controle: past een OLOD-keuze (klasgroep + periode) nog bij de actieve instellingenset?
├── TrajectSettings.tsx      # Scherm 1
├── KlasgroepSelector.tsx    # Paneel A
├── KlasgroepRooster.tsx     # Paneel B
├── OlodKlasgroepDialoog.tsx # Gedeelde modale klasgroep-kiezer (mini-weekroosters per klasgroep) voor paneel B en C
├── OlodZoeker.tsx           # Modale OLOD-zoeker (paneel A): vak zoeken over de shortlist → klasgroep kiezen via OlodKlasgroepDialoog
├── trajectVoorstel.ts       # Puzzel achter de wizard: vakken + referentieweken → klasgroepkeuze (backtracking), plus lesweken/standaardWeken
├── koppelGroepen.ts         # Vakken die samen bij één klasgroep horen (een lab): instellingen, handmatig koppelen, naamsuggestie, puzzelopbouw, splitsingsdetectie
├── TrajectWizard.tsx        # Wizard (paneel A): referentieweken + vakken aanduiden → voorstel → overnemen
├── KoppelGroepenDialoog.tsx # "Vakken die samen horen" (geavanceerd venster van de wizard): groepen aanduiden en bewaren
├── StudentOverzicht.tsx     # Paneel C + print-only OLOD-lijst
├── WeekZoom.tsx             # Alleen-lezen uitvergroting van één weekstrook uit paneel C
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
- **Conflict-solver over het volledige academiejaar** (fase 2 van de wizard): alle periodes tegelijk in één raster, vakken vastzetten en de rest opnieuw laten zoeken, en meerdere voorstellen na elkaar. De wizard van vandaag puzzelt één periode per keer — ze wisselt er wel zelf tussen, maar zonder de periodes tegen elkaar af te wegen.
- **Meerdere studentdossiers** parallel beheren.
- **Lokaal-veld** invullen vanuit de Untis-roster-entries (nu leeg gelaten).
