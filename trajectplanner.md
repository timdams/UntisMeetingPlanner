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
10. **Profielen**: een volledige set instellingen (klasgroep-shortlist, semester/module-indeling, grensdatums, semestervakken en de actieve periode) onder een naam bewaren, en er vanuit het werkblad met één klik tussen wisselen. Bedoeld voor de trajectbegeleider die meerdere doelgroepen naast elkaar heeft ("flextraject — enkel avondgroepen", "bissers module 1 in modulesysteem") en daarvoor vroeger telkens een back-up moest importeren. Een wissel **wist het studenttraject** (na bevestiging, met undo).

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
- `traject_actief` — `ActiefTraject` (`{ id, naam, baseline }`): welk bewaard traject er "open" staat. `baseline` is de vingerafdruk van traject + instellingen op het moment van bewaren of laden (`trajectVingerafdruk` in [hooks.ts](MEETINGPLANNER2026/src/components/Traject/hooks.ts), normaliseert beide kanten); wijkt de huidige toestand daarvan af, dan staat er werk open dat niet bewaard is. Wordt gewist bij een back-up-import, bij een profielwissel en wanneer het bewaarde traject verwijderd wordt.
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

**Een wissel wist het traject.** Dat is geen bijwerking maar de kern: de OLOD-keuzes verwijzen naar klasgroepen en periodes van de vórige set en zouden in de nieuwe als lege of foute selecties blijven staan. Om dezelfde reden laat het werkblad het **geopende dossier** los (`traject_actief`): met een leeg traject mag `Ctrl+S` dat dossier niet overschrijven. Instellingen, traject, dossier én profielkeuze vormen samen **één herstelpunt** in de undo-toast, zodat een verkeerde klik volledig terug te draaien is.

Bevestiging wordt gevraagd zodra er iets te verliezen valt: gekozen OLODs, of instellingen die in geen enkel profiel bewaard staan (`profielNietBewaard` in [TrajectPlanner.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectPlanner.tsx)). Valt er niets te verliezen, dan wisselt een klik meteen — een dialoog is dan enkel een extra klik.

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
- **Profielen** (bovenaan, want alles eronder hoort bij het actieve profiel): welke set actief is en of ze afwijkt van wat er bewaard staat, *Bewaar als profiel…* en *"X" bijwerken*, en daaronder de lijst profielen met per rij *Activeren* en een verwijderknopje. Het beheer staat hier omdat dit het scherm is waar een set wordt opgebouwd; de snelle wissel zelf zit in de contextbalk van het werkblad. Beide lopen langs dezelfde handlers in [TrajectPlanner.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectPlanner.tsx), zodat activeren overal dezelfde bevestiging en undo krijgt. Een profielwissel springt bewust **niet** naar het werkblad: wie hier wisselt, wil meestal meteen verder kijken of bijstellen.
- **Mijn opleiding**: geselecteerde klasgroepen als chips (met *Wis selectie*), zoekveld, *Selecteer alle/geen* (op de zichtbare lijst) en een checkbox-raster gegroepeerd per jaar (1e/2e/3e jaar, *Overige*).
- **Periode**: **indeling** als segmented control (Semesters / Modules, 2 per semester); datepickers voor de **semestergrenzen** (start en einde van semester 1 en 2) met een knop *Standaarddatums* die alles terugzet op `ACADEMIEJAAR`; in modulemodus daarnaast datepickers voor de **modulegrenzen** (start module 2 en 4, begrensd door hun semester) en een strip met de vier moduleperiodes. Een onbruikbare grens geeft een waarschuwing die de standaard vermeldt die zolang geldt. De snelkeuze van de **actieve periode** ([PeriodeSwitcher.tsx](MEETINGPLANNER2026/src/components/Traject/PeriodeSwitcher.tsx)) en de handmatige start/einde-datepickers zitten onder *Geavanceerd: actieve periode handmatig* — dat bereik is enkel wat het werkblad nú toont en verandert de grenzen niet.
- **Deel met student**: student-link genereren/kopiëren en QR tonen/downloaden (zie [trajectShare.ts](MEETINGPLANNER2026/src/components/Traject/trajectShare.ts); de link draagt ook de semestervak-tags mee, want die horen bij de opleiding); een gegenereerde link verdwijnt zodra klasgroepen of periode wijzigen.
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

**Paneel B — Klasgroeprooster** ([KlasgroepRooster.tsx](MEETINGPLANNER2026/src/components/Traject/KlasgroepRooster.tsx))
- **Periodestrip** onder de panelkop: *"Een klik voegt het vak toe aan **S1** (21/09 – 31/01)."* De periode-switcher staat in de contextbalk, maar haar gevolg is hier voelbaar — zonder deze regel is dat onzichtbaar. Bij een handmatig bereik zonder naam staat enkel het datumbereik. Ligt de bekeken week **buiten** de actieve periode, dan wordt de strip oranje en meldt ze dat een klik het vak tóch aan die periode toevoegt (het gedrag van `selectieVoorBlok`, dat anders een stille verrassing is).
- Toont het rooster van de actieve klasgroep voor een **navigeerbare week** (vorige/volgende). Bij een periodewissel springt de week naar de eerste lesweek van die periode (of naar vandaag als die erin valt).
- Lesblokken zijn klikbaar:
  - Valt het blok onder geen enkele selectie van `(Y, X)` → **toevoegen** voor de actieve periode.
  - Valt het blok onder een bestaande selectie → **die selectie verwijderen** (alle instanties binnen haar periode).
- Geselecteerde OLODs hebben een donkere rand + witte inset; is de selectie gedeactiveerd, dan is die rand gestippeld en het blok doffer (klikken verwijdert de selectie dan nog steeds — activeren gebeurt in paneel A).
- **Semestervak-schakelaar per lesblok** (enkel in modulemodus): links in de uurregel van elk blok staat een pil met `S` (indigo gevuld = semestervak, loopt over beide modules) of `M` (wit = modulevak). Ze is tegelijk indicator en knop, zodat je in het rooster zelf leest wat wat is en het ter plekke kan omzetten. Bewust in de uurregel en niet als tweede hoekknop: een gesplitst blok (twee lessen naast elkaar) is smaller dan twee hoekknoppen samen. De periodestrip vermeldt de regel er ook bij ("Een vak met een S-knopje … komt altijd in het hele semester").
- **Klasgroep-kiezer per vak**: elk lesblok draagt rechtsboven een knopje dat een modaal venster opent (portal in `document.body`) met, per klasgroep uit de shortlist die dit vak deze week geeft, een mini-weekrooster met het vak gemarkeerd plus zijn lesuren. De huidige klasgroep staat vooraan (badge "huidig"). Het venster **scrollt zelf**, zodat ook een lange shortlist volledig bereikbaar blijft. Een klik op een kaart zet het vak in het traject **bij díe klasgroep** (voor de actieve periode) en sluit de kiezer; een klik op een al gekozen kaart ("in traject") haalt het er weer uit en houdt de kiezer open om meteen een andere klasgroep aan te duiden. Sluiten met Esc, de X of een klik naast het venster. De roosters van de andere klasgroepen worden pas opgehaald wanneer de kiezer opengaat en per week gecachet.

**Paneel C — Studenttraject-overzicht** ([StudentOverzicht.tsx](MEETINGPLANNER2026/src/components/Traject/StudentOverzicht.tsx))
- **Statusregel** bovenaan, altijd zichtbaar zodra er een traject is: groen *"Geen conflicten in dit traject"* of een rode knop *"N conflicten — toon"* die het conflictpaneel onderaan openklapt en in beeld scrolt (tijdens het laden: *"Rooster laden…"*). Het conflictpaneel zelf verschijnt enkel bij conflicten, dus zonder deze regel wordt "alles in orde" nooit bevestigd — terwijl de bulk-klasgroepkiezer in paneel A wél naar dit getal verwijst (*"nu N conflicten"*). Beide rekenen op dezelfde `detectConflicts` uit [conflicts.ts](MEETINGPLANNER2026/src/components/Traject/conflicts.ts), zodat de cijfers niet uit elkaar kunnen lopen. Tijdens een wat-als-preview neemt de preview-strip het over, met haar eigen referentiepunt.
- **Verticale strip**: één rij per week voor het **volledige academiejaar**; elke selectie draagt enkel binnen haar eigen periode bij. Subtiele **grensmarkeringen** bij de start van elk semester (en in modulemodus elke module); de weken van de actieve periode zijn gemarkeerd en worden bij een periodewissel in beeld gescrold.
- Per week een mini-kalender (5 dagen × uren) met **gekleurde blokjes** — geen tekstdetails.
- Eén **kleur per unieke `olodNaam`**, consistent over klasgroepen heen.
- Blokjes met **tijdsoverlap** krijgen een **rode outline**.
- **Legende** onderaan met OLOD-namen + swatches.
- **Uitklapbaar conflictpaneel** onderaan met datum, uur, OLOD-naam en klasgroep per conflict.
- Hover-tooltip per blokje (CSS `data-tip`).
- **Vergrootglas per week** ([WeekZoom.tsx](MEETINGPLANNER2026/src/components/Traject/WeekZoom.tsx)): het knopje bij het weeklabel opent die week **alleen-lezen** in een groot venster (portal in `document.body`) — een volwaardig rooster met uurkolom en rasterlijnen, waarin elk blok zijn uren, OLOD-naam, klasgroep, type en lokaal uitgeschreven toont. Conflicten en de wat-als-preview zijn er in dezelfde codering zichtbaar; onderaan staat een legende met per vak de klasgroep(en). Sluiten met Esc, de X of een klik naast het venster. Klikken op blokken doet niets: aanpassen gebeurt in paneel B.
- **Wat-als-preview** vanuit de klasgroep-kiezer van paneel A (`preview`-prop, type `KlasgroepPreview`): de lessen van de verhuizende selectie bij de huidige klasgroep vervagen (tenzij een andere selectie van hetzelfde vak bij die klasgroep ze ook dekt), de lessen bij de kandidaat-klasgroep verschijnen als gestreepte, gestippeld omrande *ghost*-blokjes (zonder blokken die al in het traject zitten), en conflictdetectie + conflictpaneel rekenen voor dat scenario ("… bij wissel naar 2 TI B"). Een strip bovenaan vat samen: vak, nieuwe i.p.v. huidige klasgroep, aantal lessen en het aantal *nieuwe* conflicten (rood zodra > 0). De eerste week met een ghost-blok wordt zo nodig in beeld gescrold.

### Topbalk: appbalk + contextbalk ([TrajectPlanner.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectPlanner.tsx))
De balk staat in **twee rijen**, omdat één rij vier soorten dingen door elkaar droeg: navigatie, context, acties en hulp. De scheidslijn is *commando versus toestand*.

**Rij 1 — appbalk** (`.appbar`, altijd zichtbaar): links een **huisje-icoonknop** terug naar de modulekeuze + de titel *Trajectplanner*, rechts de tab-switcher **Werkblad / Instellingen**, een icoonknop **Handleiding** (PDF, opent in een nieuw tabblad) en het overloopmenu **⋯**. Het huisje draagt geen tekst: terug naar de modulekeuze is zelden nodig, en de tooltip plus `aria-label` benoemen het.
- **⋯** bevat wat zelden nodig is of gevaarlijk is: *Print / PDF* (`window.print()`), *Kopieer naar klembord*, en na een scheidingslijn **Reset traject** (rood) — dialoog met de vakken die verdwijnen, wist daarna enkel `StudentTraject`. Na een geslaagde kopie draagt de ⋯-knop zelf even een vinkje; het menu is dan al dicht.

**Rij 2 — contextbalk** (`.contextbar`, **enkel in het werkblad**): de toestand waarin het werkblad staat, elke groep met een uitgeschreven label en gescheiden door een verticale lijn. Niet in het instellingenscherm — dat heeft zijn eigen sticky kopbalk, en drie balken boven elkaar is er één te veel.
- **Periode** — de periode-switcher (compact: `S1 | S2` of `M1 | M2 | M3 | M4`, afhankelijk van de indeling) zet de actieve periode; paneel B en C volgen. Het label erbij is nodig: `S1 S2` alleen is voor wie de tool een paar keer per jaar gebruikt een raadsel.
- **Dossier** — het **dossiermenu** ([BewaardeTrajecten.tsx](MEETINGPLANNER2026/src/components/Traject/BewaardeTrajecten.tsx)), één knop die de vroegere `Bewaar traject` en `Laad traject ▾` vervangt. De knop draagt de naam van het geopende dossier (`traject_actief`) met een oranje stip zodra er niet-bewaarde wijzigingen zijn; zonder geopend dossier staat er een gedempt *nieuw dossier*.
  - Menu-inhoud: **Bewaar** (met de sneltoets `Ctrl+S` rechts in het item) en, zodra er een dossier open staat, **Bewaar als…**; daaronder de lijst **Bewaarde dossiers** (naam, aantal OLODs/klasgroepen, periode, datum). Klik op een rij = na bevestiging traject **én instellingen** vervangen (zoals een back-up-import, zonder kleurmap); prullenbakje = bewaard dossier verwijderen uit localStorage. Staat het werkblad leeg, dan laadt een klik meteen. Reset en import raken de bewaarde dossiers niet.
  - **Bewaren** (`doeSnelBewaar`) gaat rechtstreeks naar het geopende dossier; is er geen, dan opent de dialoog met naamveld (voorgevuld met de actieve naam), de lijst bestaande dossiers om aan te klikken en te overschrijven, en een waarschuwing zodra de naam een bestaand item raakt. *Bewaar als…* opent die dialoog altijd. Bewaard wordt het `StudentTraject` **samen met de `TrajectSettings`** (klasgroep-shortlist, actieve periode, semester/module-indeling, grensdatums) in `traject_bewaard` (`useBewaardeTrajecten`); het item wordt gemarkeerd als het geopende dossier. Kleurmap wordt niet meebewaard.
  - **`Ctrl+S` / `Cmd+S`** roept hetzelfde aan, ook vanuit het instellingenscherm. De handler hangt in een ref zodat de listener één keer aangehaakt wordt en toch met verse state werkt; hij doet niets zolang er een dialoog openstaat of het traject leeg is.
  - Naast de knop verschijnt een expliciete **Bewaar**-knop, maar **enkel zolang er werk openstaat** (`nietBewaard`) — zolang alles bewaard is, is ze overbodig. Ze blijft nog even staan na het bewaren om *Bewaard!* te kunnen tonen.
- **Profiel** — de eerste groep: het **profielmenu** ([ProfielMenu.tsx](MEETINGPLANNER2026/src/components/Traject/ProfielMenu.tsx)), de switcher tussen **instellingssets** ("Flextraject — avondgroepen", "Bissers module 1", …). De knop draagt de naam van het actieve profiel (met schuifjes-icoon, zodat ze niet te verwarren is met de dossierknop verderop) en een oranje stip zodra de instellingen ervan afwijken; zonder actief profiel staat er een gedempt *geen profiel*.
  - Menu-inhoud: **Bewaar instellingen als profiel…** en, met een actief profiel, **"X" bijwerken** (uitgeschakeld zolang er niets gewijzigd is); daaronder de lijst **Profielen** met per rij de naam, een samenvatting (`profielSamenvatting`: aantal klasgroepen · semesters/modules · periode) en de bewaardatum, plus een prullenbakje. De actieve rij is uitgeschakeld en draagt een vinkje.
  - Een klik op een andere rij **wisselt** van set: instellingen vervangen, studenttraject gewist, dossier losgelaten — zie *Profielen (instellingssets)* hierboven voor het waarom en voor wanneer er eerst bevestiging gevraagd wordt.
  - Openen/sluiten van het menu komt uit dezelfde [TopbarMenu.tsx](MEETINGPLANNER2026/src/components/Traject/TopbarMenu.tsx) als het dossiermenu en het overloopmenu.

**Dossier versus profiel.** Twee woorden die uit elkaar moeten blijven, want ze overlappen in wat ze bewaren: een **dossier** is één student (traject + zijn instellingen), een **profiel** draagt alleen instellingen (klasgroep-shortlist, periode-indeling, grensdatums, semestervakken, actieve periode) en is herbruikbaar over studenten heen. Vandaar ook de hernoeming in de UI van "traject" naar "dossier" waar het over het bewaarde geheel gaat; *traject* blijft de term voor de vakkenlijst zelf (`StudentTraject`, *Reset traject*).

Ze staan naast elkaar in de contextbalk en gedragen zich tegengesteld, wat het onderscheid ook zichtbaar maakt: een **dossier openen** brengt een traject mee (en de instellingen waarin het gekozen is), een **profiel wisselen** wist er net één. Wie het werk van een student wil houden, bewaart dus eerst zijn dossier — dat zet later ook meteen de juiste instellingen terug, los van welk profiel er dan actief is.

**Dialogen en undo.** Alle bevestigingen lopen via `BevestigDialog` / `BewaarDialog` ([TrajectDialogs.tsx](MEETINGPLANNER2026/src/components/Traject/TrajectDialogs.tsx)) in plaats van `window.confirm` / `window.prompt` — dat laat toe de betrokken vakken bij naam en kleur te tonen (reset, bulkwissel, bulk verwijderen). Bij een destructieve dialoog start de focus op *Annuleren*. Ingrijpende mutaties bieden daarna een **undo-toast** ([Toast.tsx](MEETINGPLANNER2026/src/components/Traject/Toast.tsx), ±8 s): reset, één OLOD verwijderen, bulk verwijderen en bulk verzetten. Het herstelpunt is telkens een **snapshot van het volledige traject** dat via `replaceTraject` teruggezet wordt — bewust geen inverse per actie, omdat `setKlasgroepBulk` selecties kan laten samensmelten en dat niet omkeerbaar is door de wissel te herhalen. De toast rendert in `document.body` en wordt in `@media print` verborgen.

De uitklapmechaniek van beide topbalk-menu's (buiten-klik, Escape, `aria-haspopup`) zit in [TopbarMenu.tsx](MEETINGPLANNER2026/src/components/Traject/TopbarMenu.tsx). Oproepers kunnen er een extra knopklasse (`btnClass`, voor de icoonknop en de dossierknop) en per item een rechts uitgelijnde `hint` (de sneltoets) aan meegeven.

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
├── useTrajectBlokken.ts     # Jaarrooster per klasgroep in het traject + selectieStatussen (geen lessen / niet beschikbaar) + useKlasgroepAlternatieven (klasgroep-kiezer) + useBulkAlternatieven (bulk-kiezer met dekking/conflictscore)
├── conflicts.ts             # Gedeelde scenariologica: effectieveBlokken, wegBlokkenVoor, ghostBlokkenVoor, scenarioBlokken, detectConflicts
├── dateUtils.ts             # mondayOf, weeksBetween, isoWeekNumber, periodeBereik, formatters
├── PeriodeSwitcher.tsx      # Snelkeuze-knoppen actieve periode (contextbalk compact + instellingen)
├── TrajectPlanner.tsx       # Shell + appbalk/contextbalk + tabs + periode-switcher + dialoog-/undo-state + bewaar/laad dossier (Ctrl+S) + profielwissel + print + export/import wiring
├── TopbarMenu.tsx           # Herbruikbare topbalk-dropdown (buiten-klik + Esc) + menu-item (icoon, danger, sneltoets-hint)
├── TrajectDialogs.tsx       # BevestigDialog + BewaarDialog + ProfielDialog (vervangen window.confirm/prompt)
├── Toast.tsx                # useUndo + UndoToast ("… — Ongedaan maken")
├── BewaardeTrajecten.tsx    # Dossiermenu in de contextbalk: bewaren + lijst bewaarde dossiers (openen / verwijderen)
├── ProfielMenu.tsx          # Profielmenu in de contextbalk: instellingsset bewaren/bijwerken + lijst profielen (activeren / verwijderen)
├── settingsSummaries.ts     # Pure kaartsamenvattingen + profielSamenvatting + groepering klasgroepen
├── TrajectSettings.tsx      # Scherm 1
├── KlasgroepSelector.tsx    # Paneel A
├── KlasgroepRooster.tsx     # Paneel B
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
- **Conflict-solver**.
- **Meerdere studentdossiers** parallel beheren.
- **Lokaal-veld** invullen vanuit de Untis-roster-entries (nu leeg gelaten).
