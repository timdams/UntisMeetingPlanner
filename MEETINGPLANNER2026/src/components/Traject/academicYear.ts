// Eén bron van waarheid voor het academiejaar dat de Trajectplanner plant.
// De semestergrenzen bepalen zowel de standaard semesterperiode (verse start)
// als de snelkeuze-knoppen in de instellingen en de topbar. Pas dit blok aan
// bij een nieuw academiejaar.
//
// De datums hieronder zijn de *standaard*: de gebruiker kan elke grens
// (semesterstart/-einde en de eerste dag van module 2 en 4) in de instellingen
// overschrijven; die keuze zit in TrajectSettings.periodeGrenzen. Elke functie
// hier die periodes afleidt neemt daarom die grenzen als argument en valt per
// semester terug op de standaard zodra een grens ontbreekt of geen geldig
// bereik vormt.
//
// Houd ACADEMIEJAAR.naam gelijk aan PREFERRED_SCHOOL_YEAR_NAME in
// UntisService, zodat de roosterdata (klasgroep-/leraar-IDs) en de
// semesterperiode hetzelfde jaar betreffen.

import { addDays, dagVoorIso, formatDateBE, isIsoDate, mondayOf, parseIsoDate, toIsoDate } from './dateUtils';

export interface SemesterDef {
    nummer: 1 | 2;
    label: string;
    start: string; // ISO date (YYYY-MM-DD), inclusief
    eind: string;  // ISO date (YYYY-MM-DD), inclusief
}

export const ACADEMIEJAAR = {
    naam: '2026/2027',
    // Effectieve start van de eerste lesweek (na de voorbereidingsdagen/het
    // onthaal) — meestal midden september. De roosterweergave opent hier
    // standaard op in plaats van op de officiële semesterstart (1 september),
    // zodat gebruikers niet elke keer een paar lege weken moeten doorklikken.
    effectieveLesStart: '2026-09-19',
    semesters: [
        { nummer: 1, label: 'Semester 1', start: '2026-09-01', eind: '2027-02-01' },
        { nummer: 2, label: 'Semester 2', start: '2027-02-01', eind: '2027-07-01' },
    ] as SemesterDef[],
};

// ===== Grensdatums =====
//
// Alle datums die samen de periodes bepalen: start en einde van elk semester,
// plus de eerste dag van module 2 (in semester 1) en module 4 (in semester 2).
// Ze worden als geheel in de instellingen bewaard, zodat een periodewissel
// nooit een handmatig ingestelde datum overschrijft.
export interface PeriodeGrenzen {
    s1Start: string;
    s1Eind: string;
    s2Start: string;
    s2Eind: string;
    m2Start: string;
    m4Start: string;
}

// Grenzen zoals ze binnenkomen: uit de instellingen (allemaal strings), maar
// evengoed uit localStorage, een back-up of een deel-link, waar elke waarde
// nog van alles kan zijn. Vandaar `unknown` per veld — elke functie hier
// valideert zelf en valt terug op de standaard.
export type GrenzenInput = Partial<Record<keyof PeriodeGrenzen, unknown>>;

// Standaard modulegrens: de maandag die het dichtst bij het midden van het
// semester ligt (mondayOf geeft de maandag op of vóór een datum; door eerst
// 3 dagen op te tellen ronden we naar de dichtstbijzijnde maandag).
function middenMaandag(sem: SemesterDef): string {
    const start = parseIsoDate(sem.start).getTime();
    const eind = parseIsoDate(sem.eind).getTime();
    const midden = new Date((start + eind) / 2);
    return toIsoDate(mondayOf(addDays(midden, 3)));
}

// Een semestergrens is enkel bruikbaar als beide datums echt zijn én het
// semester vooruit loopt; anders krijgen zijn modules een leeg bereik.
export function semesterGrensGeldig(start: unknown, eind: unknown): boolean {
    return isIsoDate(start) && isIsoDate(eind) && start < eind;
}

// Een modulegrens is enkel bruikbaar als het een echte datum is die strikt
// binnen haar semester valt (anders krijgt een module een leeg of negatief bereik).
export function moduleGrensGeldig(grens: unknown, sem: SemesterDef): grens is string {
    return isIsoDate(grens) && grens > sem.start && grens < sem.eind;
}

function eigenSemester(start: unknown, eind: unknown, standaard: SemesterDef): SemesterDef {
    if (!semesterGrensGeldig(start, eind)) return standaard;
    return { ...standaard, start: start as string, eind: eind as string };
}

// De semesters zoals ze effectief gelden: de ingestelde grenzen, of — per
// semester apart — die van het standaard-academiejaar zodra de ingestelde
// datums geen geldig bereik vormen (bv. een leeggemaakt datumveld).
export function semesterDefs(grenzen: GrenzenInput | undefined): SemesterDef[] {
    const [d1, d2] = ACADEMIEJAAR.semesters;
    return [
        eigenSemester(grenzen?.s1Start, grenzen?.s1Eind, d1),
        eigenSemester(grenzen?.s2Start, grenzen?.s2Eind, d2),
    ];
}

// Standaardgrenzen: het volledige academiejaar zoals hierboven vastgelegd,
// met de modulegrenzen halverwege elk semester. Met `grenzen` meegegeven
// volgen de modulegrenzen de (eventueel aangepaste) semesters — zo krijgt een
// verschoven semester een zinnige standaardgrens in het midden.
export function defaultPeriodeGrenzen(grenzen?: GrenzenInput): PeriodeGrenzen {
    const [s1, s2] = semesterDefs(grenzen);
    return {
        s1Start: s1.start,
        s1Eind: s1.eind,
        s2Start: s2.start,
        s2Eind: s2.eind,
        m2Start: middenMaandag(s1),
        m4Start: middenMaandag(s2),
    };
}

// De grenzen die effectief gebruikt worden: ongeldige of ontbrekende waarden
// vallen terug op de standaard.
export function effectieveGrenzen(grenzen: GrenzenInput | undefined): PeriodeGrenzen {
    const [s1, s2] = semesterDefs(grenzen);
    const def = defaultPeriodeGrenzen(grenzen);
    const m2 = grenzen?.m2Start;
    const m4 = grenzen?.m4Start;
    return {
        ...def,
        m2Start: moduleGrensGeldig(m2, s1) ? m2 : def.m2Start,
        m4Start: moduleGrensGeldig(m4, s2) ? m4 : def.m4Start,
    };
}

// True zolang elke grens bruikbaar is. `periodeType` bepaalt of de
// modulegrenzen meetellen: in semestermodus spelen ze geen rol.
export function grenzenGeldig(grenzen: GrenzenInput | undefined, periodeType: PeriodeType): boolean {
    if (!semesterGrensGeldig(grenzen?.s1Start, grenzen?.s1Eind)) return false;
    if (!semesterGrensGeldig(grenzen?.s2Start, grenzen?.s2Eind)) return false;
    if (periodeType !== 'module') return true;
    const [s1, s2] = semesterDefs(grenzen);
    return moduleGrensGeldig(grenzen?.m2Start, s1) && moduleGrensGeldig(grenzen?.m4Start, s2);
}

// Bepaalt welk semester "nu" actief is op basis van de gegeven datum: vóór de
// start van semester 2 → semester 1, anders semester 2. Een datum vóór het
// academiejaar valt zo ook op semester 1 (handig om vooruit te plannen).
export function huidigSemester(today: Date = new Date(), grenzen?: GrenzenInput): SemesterDef {
    const iso = toIsoDate(today);
    const [s1, s2] = semesterDefs(grenzen);
    return iso < s2.start ? s1 : s2;
}

// Standaard semesterperiode voor een verse start: het semester waarin we
// vandaag zitten. We laden bewust niet het volledige academiejaar (52 weken)
// in, enkel het lopende semester.
export function defaultSemesterPeriode(
    today: Date = new Date(),
    grenzen?: GrenzenInput
): { start: string; eind: string } {
    const sem = huidigSemester(today, grenzen);
    return { start: sem.start, eind: sem.eind };
}

// Het volledige academiejaar als inclusief ISO-bereik. Wordt gebruikt om oude
// OLOD-selecties zonder periode te normaliseren: die telden vroeger overal.
export function academiejaarBereik(grenzen?: GrenzenInput): { van: string; tot: string } {
    const defs = semesterDefs(grenzen);
    return { van: defs[0].start, tot: defs[defs.length - 1].eind };
}

// Start- en einddatum van het volledige academiejaar (eerste semester-start t/m
// laatste semester-einde).
export function academiejaarStartDatum(grenzen?: GrenzenInput): Date {
    return parseIsoDate(academiejaarBereik(grenzen).van);
}
export function academiejaarEindDatum(grenzen?: GrenzenInput): Date {
    return parseIsoDate(academiejaarBereik(grenzen).tot);
}
export function effectieveLesStartDatum(): Date {
    return parseIsoDate(ACADEMIEJAAR.effectieveLesStart);
}

// True wanneer de gegeven datum binnen het academiejaar valt.
export function valtBinnenAcademiejaar(d: Date, grenzen?: GrenzenInput): boolean {
    const { van, tot } = academiejaarBereik(grenzen);
    const iso = toIsoDate(d);
    return iso >= van && iso <= tot;
}

// ===== Periodes: semesters of modules =====
//
// Een opleiding plant per semester of per module (twee modules per semester).
// De actieve periode blijft in de instellingen opgeslagen als een datumbereik
// (semesterStart/semesterEind); een Periode is enkel een benoemd voorgedefinieerd
// bereik waar de snelkeuze-knoppen naar verwijzen.

export type PeriodeType = 'semester' | 'module';

export interface Periode {
    id: string;    // 'S1' | 'S2' | 'M1' … 'M4'
    label: string; // bv. "Module 2"
    kort: string;  // bv. "M2" — voor de compacte topbar-knoppen en badges
    start: string; // ISO date, inclusief
    eind: string;  // ISO date, inclusief
}

export function semesterPeriodes(grenzen?: GrenzenInput): Periode[] {
    return semesterDefs(grenzen).map(sem => ({
        id: `S${sem.nummer}`,
        label: sem.label,
        kort: `S${sem.nummer}`,
        start: sem.start,
        eind: sem.eind,
    }));
}

export function modulePeriodes(grenzen?: GrenzenInput): Periode[] {
    const g = effectieveGrenzen(grenzen);
    return [
        { id: 'M1', label: 'Module 1', kort: 'M1', start: g.s1Start, eind: dagVoorIso(g.m2Start) },
        { id: 'M2', label: 'Module 2', kort: 'M2', start: g.m2Start, eind: g.s1Eind },
        { id: 'M3', label: 'Module 3', kort: 'M3', start: g.s2Start, eind: dagVoorIso(g.m4Start) },
        { id: 'M4', label: 'Module 4', kort: 'M4', start: g.m4Start, eind: g.s2Eind },
    ];
}

// De periodes waar de snelkeuze in de topbar tussen wisselt.
export function periodesVoor(periodeType: PeriodeType, grenzen: GrenzenInput | undefined): Periode[] {
    return periodeType === 'module' ? modulePeriodes(grenzen) : semesterPeriodes(grenzen);
}

// Alle benoemde periodes (semesters én modules), ongeacht de gekozen indeling —
// voor het herkennen van een opgeslagen bereik en om de actieve periode mee te
// laten verhuizen wanneer een grens verschuift.
export function allePeriodes(grenzen: GrenzenInput | undefined): Periode[] {
    return [...semesterPeriodes(grenzen), ...modulePeriodes(grenzen)];
}

// True wanneer een opgeslagen periode exact overeenkomt met een voorgedefinieerde,
// zodat de UI de actieve snelkeuze-knop kan markeren.
export function matchtPeriode(p: Periode, start: string, eind: string): boolean {
    return p.start === start && p.eind === eind;
}

export function actievePeriode(periodes: Periode[], start: string, eind: string): Periode | null {
    return periodes.find(p => matchtPeriode(p, start, eind)) ?? null;
}

// Grensdatums (eerste dag van een periode) met label, voor de markering in het
// jaaroverzicht: altijd de semesters, in modulemodus ook de modules. Vallen
// een semester en een module op dezelfde dag samen, dan delen ze één label.
export function periodeMarkeringen(
    periodeType: PeriodeType,
    grenzen: GrenzenInput | undefined
): Array<{ datum: string; label: string }> {
    const bronnen = periodeType === 'module' ? allePeriodes(grenzen) : semesterPeriodes(grenzen);
    const perDatum = new Map<string, string[]>();
    for (const p of bronnen) {
        const arr = perDatum.get(p.start) ?? [];
        arr.push(p.label);
        perDatum.set(p.start, arr);
    }
    return Array.from(perDatum.entries())
        .map(([datum, labels]) => ({ datum, label: labels.join(' · ') }))
        .sort((a, b) => a.datum.localeCompare(b.datum));
}

// De periodes waaruit een bestaande selectie kan kiezen: voor elk semester dat
// haar bereik raakt het hele semester (beide modules) en elk van de twee
// modules apart. Zo kan een student een vak bij een klasgroep het hele
// semester volgen, of enkel in module 1 of 2.
export function periodeOptiesVoor(
    van: string,
    tot: string,
    grenzen: GrenzenInput | undefined
): Periode[] {
    const modules = modulePeriodes(grenzen);
    const out: Periode[] = [];
    semesterPeriodes(grenzen).forEach((sem, i) => {
        if (van > sem.eind || tot < sem.start) return;
        out.push(sem, ...modules.slice(i * 2, i * 2 + 2));
    });
    return out;
}

// Label voor een opgeslagen bereik: de naam van de overeenkomstige periode
// (semester óf module, ongeacht de huidige indeling), anders de datums zelf.
export function periodeLabelVoor(
    van: string,
    tot: string,
    grenzen: GrenzenInput | undefined
): { kort: string; label: string } {
    const match = actievePeriode(allePeriodes(grenzen), van, tot);
    if (match) return { kort: match.kort, label: match.label };
    const datums = `${formatDateBE(parseIsoDate(van))}–${formatDateBE(parseIsoDate(tot))}`;
    return { kort: datums, label: `Periode ${datums}` };
}

// De week waarop de rooster-weergave standaard opent voor een periode. Valt
// vandaag binnen de periode en ná de effectieve lesstart (zie
// ACADEMIEJAAR.effectieveLesStart), dan tonen we gewoon de huidige week.
// Anders openen we op de eerste lesweek van de periode: de periodestart, of
// de effectieve lesstart wanneer de periode vóór die datum begint (semester 1
// start officieel op 1 september, maar de lessen pas midden september) — zo
// moet een gebruiker niet elke keer een paar lege weken doorklikken. Ligt die
// lesstart buiten de periode (bv. bij een handmatig verschoven semester), dan
// telt ze niet mee.
export function defaultRoosterWeek(
    today: Date = new Date(),
    periodeStart: string = ACADEMIEJAAR.semesters[0].start,
    periodeEind: string = ACADEMIEJAAR.semesters[ACADEMIEJAAR.semesters.length - 1].eind
): Date {
    const lesStart = effectieveLesStartDatum();
    const pStart = parseIsoDate(periodeStart);
    const pEind = parseIsoDate(periodeEind);
    pEind.setHours(23, 59, 59, 999);
    const lesStartBinnen =
        lesStart.getTime() > pStart.getTime() && lesStart.getTime() <= pEind.getTime();
    const eersteLesweek = lesStartBinnen ? lesStart : pStart;
    const binnenPeriode = today.getTime() >= pStart.getTime() && today.getTime() <= pEind.getTime();
    if (!binnenPeriode) return eersteLesweek;
    return today.getTime() < eersteLesweek.getTime() ? eersteLesweek : today;
}
