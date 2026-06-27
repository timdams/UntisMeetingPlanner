// Eén bron van waarheid voor het academiejaar dat de Trajectplanner plant.
// De semestergrenzen bepalen zowel de standaard semesterperiode (verse start)
// als de snelkeuze-knoppen in de instellingen. Pas dit blok aan bij een nieuw
// academiejaar.
//
// Houd ACADEMIEJAAR.naam gelijk aan PREFERRED_SCHOOL_YEAR_NAME in
// UntisService, zodat de roosterdata (klasgroep-/leraar-IDs) en de
// semesterperiode hetzelfde jaar betreffen.

export interface SemesterDef {
    nummer: 1 | 2;
    label: string;
    start: string; // ISO date (YYYY-MM-DD), inclusief
    eind: string;  // ISO date (YYYY-MM-DD), inclusief
}

export const ACADEMIEJAAR = {
    naam: '2026/2027',
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

export function semesterByNummer(nummer: 1 | 2): SemesterDef {
    return ACADEMIEJAAR.semesters.find(s => s.nummer === nummer) ?? ACADEMIEJAAR.semesters[0];
}

// Standaard semesterperiode voor een verse start: het semester waarin we
// vandaag zitten. We laden bewust niet het volledige academiejaar (52 weken)
// in, enkel het lopende semester.
export function defaultSemesterPeriode(today: Date = new Date()): { start: string; eind: string } {
    const sem = huidigSemester(today);
    return { start: sem.start, eind: sem.eind };
}

// True wanneer een opgeslagen periode exact overeenkomt met een semester,
// zodat de UI de actieve snelkeuze-knop kan markeren.
export function matchtSemester(sem: SemesterDef, start: string, eind: string): boolean {
    return sem.start === start && sem.eind === eind;
}
