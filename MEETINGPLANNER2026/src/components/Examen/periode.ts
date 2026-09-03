import { semesterDefs, semesterGrensGeldig, type SemesterDef } from '../Traject/academicYear';
import { addDays, formatDateBE, isIsoDate, isoWeekNumber, mondayOf, parseIsoDate, toIsoDate } from '../Traject/dateUtils';

/**
 * Semestergrenzen van het examenoverzicht, zelfde vorm als in de Traject
 * Planner: start en einde van elk semester als ISO-datum. Ze bepalen de
 * examenweken (de S1/S2-knoppen in de weekkiezer) en de standaardweek.
 * Pure functies, geen React en geen opslag — zodat dit los te testen is.
 */
export interface ExamenPeriode {
    s1Start: string;
    s1Eind: string;
    s2Start: string;
    s2Eind: string;
}

export type PeriodeVeld = keyof ExamenPeriode;

/** De standaardgrenzen van het academiejaar (zie ACADEMIEJAAR in academicYear.ts). */
export function standaardPeriode(): ExamenPeriode {
    const [s1, s2] = semesterDefs(undefined);
    return { s1Start: s1.start, s1Eind: s1.eind, s2Start: s2.start, s2Eind: s2.eind };
}

/** Maakt van willekeurige opgeslagen data geldige grenzen; per ontbrekend of ongeldig veld de standaard. */
export function normalizePeriode(raw: unknown): ExamenPeriode {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const def = standaardPeriode();
    const pak = (k: PeriodeVeld) => (isIsoDate(r[k]) ? (r[k] as string) : def[k]);
    return { s1Start: pak('s1Start'), s1Eind: pak('s1Eind'), s2Start: pak('s2Start'), s2Eind: pak('s2Eind') };
}

/**
 * De grenzen die voor één opleiding effectief gelden: haar eigen grenzen als
 * ze die heeft, anders de algemene. De algemene grenzen zijn de regel — de
 * examenperiode is voor bijna alle opleidingen dezelfde en dan hoort de
 * beleidsmedewerker ze maar één keer in te stellen. Een opleiding die haar
 * examens elders legt zet er eenmalig eigen grenzen naast (de overrule).
 *
 * Ongeldige eigen grenzen worden genegeerd in plaats van halfweg toegepast:
 * bij een leeggemaakt datumveld val je terug op de algemene grenzen, niet op
 * een willekeurige mengvorm van beide.
 */
export function effectievePeriode(algemeen: ExamenPeriode, eigen?: ExamenPeriode): ExamenPeriode {
    return eigen && periodeGeldig(eigen) ? eigen : algemeen;
}

/** True zolang beide semesters een echte, vooruitlopende datumrange vormen. */
export function periodeGeldig(p: ExamenPeriode): boolean {
    return semesterGrensGeldig(p.s1Start, p.s1Eind) && semesterGrensGeldig(p.s2Start, p.s2Eind);
}

/** De semesters zoals ze effectief gelden: een ongeldige grens valt per semester terug op de standaard. */
export function effectieveSemesters(p: ExamenPeriode): SemesterDef[] {
    return semesterDefs(p);
}

/**
 * De examenweek van een semester: de laatste volledige week (maandag) vóór
 * het semestereinde. Het semestereinde zelf kan op een maandag vallen (bv.
 * 1 februari); de dag ervoor nemen houdt de week in de examenperiode.
 */
export function examenWeekVoor(eindIso: string): string {
    return toIsoDate(mondayOf(addDays(parseIsoDate(eindIso), -1)));
}

export interface ExamenWeek {
    id: 'S1' | 'S2';
    /** Bv. "Examens S1". */
    label: string;
    kort: 'S1' | 'S2';
    weekMaandag: string;
    weekNr: number;
    /** Toelichting voor tooltips. */
    omschrijving: string;
}

export function examenWeken(p: ExamenPeriode): ExamenWeek[] {
    return effectieveSemesters(p).map(sem => {
        const weekMaandag = examenWeekVoor(sem.eind);
        const ma = parseIsoDate(weekMaandag);
        const kort = `S${sem.nummer}` as 'S1' | 'S2';
        return {
            id: kort,
            label: `Examens ${kort}`,
            kort,
            weekMaandag,
            weekNr: isoWeekNumber(ma),
            omschrijving:
                `Examenweek ${sem.label.toLowerCase()}: week ${isoWeekNumber(ma)} ` +
                `(${formatDateBE(ma)} – ${formatDateBE(addDays(ma, 4))}), ` +
                `de laatste week vóór het semestereinde op ${formatDateBE(parseIsoDate(sem.eind))}`,
        };
    });
}

/**
 * De week waarop het overzicht standaard opent: de eerstvolgende examenweek
 * vanaf vandaag. Na de laatste examenweek van het jaar blijft die laatste
 * staan (de nieuwe jaargrenzen zijn dan nog niet ingesteld).
 */
export function standaardWeek(p: ExamenPeriode, vandaag: Date = new Date()): string {
    const wk = toIsoDate(mondayOf(vandaag));
    const weken = examenWeken(p);
    return weken.find(w => w.weekMaandag >= wk)?.weekMaandag ?? weken[weken.length - 1].weekMaandag;
}
