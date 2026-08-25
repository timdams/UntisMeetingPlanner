// Eén bron van waarheid voor het academiejaar dat de Trajectplanner plant.
// De semestergrenzen bepalen zowel de standaard semesterperiode (verse start)
// als de snelkeuze-knoppen in de instellingen en de topbar. Pas dit blok aan
// bij een nieuw academiejaar.
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

// Bepaalt welk semester "nu" actief is op basis van de gegeven datum: vóór de
// start van semester 2 → semester 1, anders semester 2. Een datum vóór het
// academiejaar valt zo ook op semester 1 (handig om vooruit te plannen).
export function huidigSemester(today: Date = new Date()): SemesterDef {
    const iso = today.toISOString().slice(0, 10);
    const [s1, s2] = ACADEMIEJAAR.semesters;
    return iso < s2.start ? s1 : s2;
}

// Standaard semesterperiode voor een verse start: het semester waarin we
// vandaag zitten. We laden bewust niet het volledige academiejaar (52 weken)
// in, enkel het lopende semester.
export function defaultSemesterPeriode(today: Date = new Date()): { start: string; eind: string } {
    const sem = huidigSemester(today);
    return { start: sem.start, eind: sem.eind };
}

// Start- en einddatum van het volledige academiejaar (eerste semester-start t/m
// laatste semester-einde).
export function academiejaarStartDatum(): Date {
    return parseIsoDate(ACADEMIEJAAR.semesters[0].start);
}
export function academiejaarEindDatum(): Date {
    return parseIsoDate(ACADEMIEJAAR.semesters[ACADEMIEJAAR.semesters.length - 1].eind);
}
export function effectieveLesStartDatum(): Date {
    return parseIsoDate(ACADEMIEJAAR.effectieveLesStart);
}

// Het volledige academiejaar als inclusief ISO-bereik. Wordt gebruikt om oude
// OLOD-selecties zonder periode te normaliseren: die telden vroeger overal.
export function academiejaarBereik(): { van: string; tot: string } {
    return {
        van: ACADEMIEJAAR.semesters[0].start,
        tot: ACADEMIEJAAR.semesters[ACADEMIEJAAR.semesters.length - 1].eind,
    };
}

// True wanneer de gegeven datum binnen het academiejaar valt.
export function valtBinnenAcademiejaar(d: Date): boolean {
    return d.getTime() >= academiejaarStartDatum().getTime()
        && d.getTime() <= academiejaarEindDatum().getTime();
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

// Eerste dag van module 2 (binnen semester 1) en van module 4 (binnen semester 2).
export interface ModuleGrenzen {
    m2Start: string;
    m4Start: string;
}

// Standaard modulegrens: de maandag die het dichtst bij het midden van het
// semester ligt (mondayOf geeft de maandag op of vóór een datum; door eerst
// 3 dagen op te tellen ronden we naar de dichtstbijzijnde maandag).
function middenMaandag(sem: SemesterDef): string {
    const start = parseIsoDate(sem.start).getTime();
    const eind = parseIsoDate(sem.eind).getTime();
    const midden = new Date((start + eind) / 2);
    return toIsoDate(mondayOf(addDays(midden, 3)));
}

export function defaultModuleGrenzen(): ModuleGrenzen {
    const [s1, s2] = ACADEMIEJAAR.semesters;
    return { m2Start: middenMaandag(s1), m4Start: middenMaandag(s2) };
}

// Een grens is enkel bruikbaar als het een echte datum is die strikt binnen
// haar semester valt (anders krijgt een module een leeg of negatief bereik).
export function moduleGrensGeldig(grens: unknown, sem: SemesterDef): grens is string {
    return isIsoDate(grens) && grens > sem.start && grens < sem.eind;
}

// De grenzen die effectief gebruikt worden: ongeldige of ontbrekende waarden
// (bv. een leeggemaakt datumveld) vallen terug op de standaard.
export function effectieveModuleGrenzen(grenzen: Partial<ModuleGrenzen> | undefined): ModuleGrenzen {
    const [s1, s2] = ACADEMIEJAAR.semesters;
    const def = defaultModuleGrenzen();
    const m2 = grenzen?.m2Start;
    const m4 = grenzen?.m4Start;
    return {
        m2Start: moduleGrensGeldig(m2, s1) ? m2 : def.m2Start,
        m4Start: moduleGrensGeldig(m4, s2) ? m4 : def.m4Start,
    };
}

export function semesterPeriodes(): Periode[] {
    return ACADEMIEJAAR.semesters.map(sem => ({
        id: `S${sem.nummer}`,
        label: sem.label,
        kort: `S${sem.nummer}`,
        start: sem.start,
        eind: sem.eind,
    }));
}

export function modulePeriodes(grenzen: Partial<ModuleGrenzen> | undefined): Periode[] {
    const [s1, s2] = ACADEMIEJAAR.semesters;
    const g = effectieveModuleGrenzen(grenzen);
    return [
        { id: 'M1', label: 'Module 1', kort: 'M1', start: s1.start, eind: dagVoorIso(g.m2Start) },
        { id: 'M2', label: 'Module 2', kort: 'M2', start: g.m2Start, eind: s1.eind },
        { id: 'M3', label: 'Module 3', kort: 'M3', start: s2.start, eind: dagVoorIso(g.m4Start) },
        { id: 'M4', label: 'Module 4', kort: 'M4', start: g.m4Start, eind: s2.eind },
    ];
}

// De periodes waar de snelkeuze in de topbar tussen wisselt.
export function periodesVoor(periodeType: PeriodeType, grenzen: Partial<ModuleGrenzen> | undefined): Periode[] {
    return periodeType === 'module' ? modulePeriodes(grenzen) : semesterPeriodes();
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
export function periodeGrenzen(
    periodeType: PeriodeType,
    grenzen: Partial<ModuleGrenzen> | undefined
): Array<{ datum: string; label: string }> {
    const bronnen = [...semesterPeriodes(), ...(periodeType === 'module' ? modulePeriodes(grenzen) : [])];
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
    grenzen: Partial<ModuleGrenzen> | undefined
): Periode[] {
    const modules = modulePeriodes(grenzen);
    const out: Periode[] = [];
    semesterPeriodes().forEach((sem, i) => {
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
    grenzen: Partial<ModuleGrenzen> | undefined
): { kort: string; label: string } {
    const match = actievePeriode([...semesterPeriodes(), ...modulePeriodes(grenzen)], van, tot);
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
// moet een gebruiker niet elke keer een paar lege weken doorklikken.
export function defaultRoosterWeek(
    today: Date = new Date(),
    periodeStart: string = ACADEMIEJAAR.semesters[0].start,
    periodeEind: string = ACADEMIEJAAR.semesters[ACADEMIEJAAR.semesters.length - 1].eind
): Date {
    const lesStart = effectieveLesStartDatum();
    const pStart = parseIsoDate(periodeStart);
    const pEind = parseIsoDate(periodeEind);
    pEind.setHours(23, 59, 59, 999);
    const eersteLesweek = pStart.getTime() < lesStart.getTime() ? lesStart : pStart;
    const binnenPeriode = today.getTime() >= pStart.getTime() && today.getTime() <= pEind.getTime();
    if (!binnenPeriode) return eersteLesweek;
    return today.getTime() < lesStart.getTime() ? lesStart : today;
}
