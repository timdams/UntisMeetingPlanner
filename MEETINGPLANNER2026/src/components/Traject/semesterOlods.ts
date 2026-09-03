// Semestervakken in modulemodus.
//
// Een opleiding die per module plant, heeft soms tóch een OLOD dat over beide
// modules van een semester loopt. De trajectbegeleider markeert zo'n vak in het
// werkblad; de tag geldt voor de OLOD-*naam*, dus voor elke klasgroep waar dat
// vak in voorkomt (het is een eigenschap van het vak, niet van één keuze).
//
// Gevolgen van de tag (allemaal enkel in modulemodus — in semestermodus loopt
// alles al over het hele semester en betekent ze niets):
//   - een keuze voor zo'n vak beslaat altijd het hele semester, ook wanneer de
//     actieve periode M1 of M2 is;
//   - de periode-kiezer van paneel ③ laat er geen module meer voor kiezen;
//   - bestaande module-keuzes worden op het moment van taggen verbreed.
//
// De tags zelf zitten in TrajectSettings.semesterOlods, zodat ze meereizen met
// een back-up, een bewaard traject en de student-link.

import { semesterPeriodes, type GrenzenInput, type Periode } from './academicYear';
import type { OLODSelectie, StudentTraject } from './types';

/** Een bereik zoals een OLOD-selectie het draagt (inclusieve ISO-datums). */
export interface Bereik {
    van: string;
    tot: string;
}

/**
 * Maakt van willekeurige opgeslagen data een bruikbare lijst getagde
 * OLOD-namen: enkel niet-lege strings, ontdubbeld en gesorteerd, zodat twee
 * gelijke instellingen ook dezelfde vingerafdruk opleveren.
 */
export function normalizeSemesterOlods(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const uniek = new Set<string>();
    for (const x of raw) {
        if (typeof x !== 'string') continue;
        const naam = x.trim();
        if (naam) uniek.add(naam);
    }
    return Array.from(uniek).sort((a, b) => a.localeCompare(b));
}

/** Is dit vak als semestervak gemarkeerd? */
export function isSemesterOlod(olodNaam: string, semesterOlods: readonly string[]): boolean {
    return semesterOlods.includes(olodNaam);
}

/** Zet de tag van één vak aan of uit; geeft altijd een genormaliseerde lijst terug. */
export function metSemesterOlod(
    semesterOlods: readonly string[],
    olodNaam: string,
    aan: boolean
): string[] {
    const zonder = semesterOlods.filter(x => x !== olodNaam);
    return normalizeSemesterOlods(aan ? [...zonder, olodNaam] : zonder);
}

/**
 * Het semester waar dit bereik volledig in past, of null.
 *
 * Bewust "past volledig in" en niet "overlapt met": de twee semesters delen hun
 * grensdag (het einde van semester 1 is de start van semester 2), dus overlap
 * wijst ook naar het buursemester zodra een bereik tot op die dag loopt — en
 * een module 2 die exact op de semestergrens eindigt hoort gewoon bij haar
 * eigen semester. Een bereik dat de grens écht oversteekt (een selectie over
 * het volledige academiejaar) past nergens volledig in en levert null: dat mag
 * niet naar één semester versmald worden.
 */
export function semesterVoorBereik(
    van: string,
    tot: string,
    grenzen: GrenzenInput | undefined
): Periode | null {
    return semesterPeriodes(grenzen).find(s => van >= s.start && tot <= s.eind) ?? null;
}

/**
 * Het bereik dat een semestervak moet krijgen: het volledige semester waar het
 * meegegeven bereik in valt. Valt het bereik buiten elk semester of overspant
 * het er meerdere (volledig academiejaar), dan blijft het ongemoeid — versmallen
 * zou dan keuzes wegnemen in plaats van ze te verbreden.
 */
export function semesterBereikVoor(
    van: string,
    tot: string,
    grenzen: GrenzenInput | undefined
): Bereik {
    const sem = semesterVoorBereik(van, tot, grenzen);
    return sem ? { van: sem.start, tot: sem.eind } : { van, tot };
}

/** True zodra dit bereik al precies een heel semester beslaat. */
export function isSemesterBereik(
    van: string,
    tot: string,
    grenzen: GrenzenInput | undefined
): boolean {
    return semesterPeriodes(grenzen).some(s => s.start === van && s.eind === tot);
}

/**
 * Verbreedt elke keuze van dit vak naar haar volledige semester — wat er
 * gebeurt op het moment dat de gebruiker het vak als semestervak markeert.
 * Keuzes die daardoor identiek worden (bv. M1 en M2 bij dezelfde klasgroep)
 * smelten samen; de eerste in de lijst wint, zoals bij een bulk-klasgroepwissel.
 *
 * Keuzes bij verschillende klasgroepen in hetzelfde semester blijven allebei
 * staan: er gaat niets verloren, en paneel ③ waarschuwt erover
 * ({@link botsendeKlasgroepen}).
 */
export function verbreedNaarSemesters(
    traject: StudentTraject,
    olodNaam: string,
    grenzen: GrenzenInput | undefined
): StudentTraject {
    const gezien = new Set<string>();
    const out: StudentTraject = [];
    for (const sel of traject) {
        const nieuw =
            sel.olodNaam === olodNaam
                ? { ...sel, ...semesterBereikVoor(sel.van, sel.tot, grenzen) }
                : sel;
        const key = `${nieuw.klasgroep}::${nieuw.olodNaam}::${nieuw.van}::${nieuw.tot}`;
        if (gezien.has(key)) continue;
        gezien.add(key);
        out.push(nieuw);
    }
    return out;
}

/**
 * De andere klasgroepen waar hetzelfde vak in een overlappende periode gekozen
 * is. Voor een semestervak is dat een fout die de gebruiker moet oplossen: het
 * vak loopt dan twee keer naast elkaar. Leeg = in orde.
 */
export function botsendeKlasgroepen(traject: StudentTraject, sel: OLODSelectie): string[] {
    const uniek = new Set<string>();
    for (const x of traject) {
        if (x.olodNaam !== sel.olodNaam || x.klasgroep === sel.klasgroep) continue;
        // Strikte overlap: semester 1 en 2 delen hun grensdag, dus hetzelfde vak
        // in S1 bij de ene en in S2 bij de andere klasgroep is geen botsing.
        if (x.van < sel.tot && sel.van < x.tot) uniek.add(x.klasgroep);
    }
    return Array.from(uniek).sort((a, b) => a.localeCompare(b));
}
