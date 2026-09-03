// Datamodel van de Examenoverzicht-module. Zie examenoverzicht.md.
//
// Terminologie: in deze module heet een opleidingstraject consequent
// `opleiding` — het woord "traject" is bezet door de Traject Planner (het
// studiepad van één student) en beide modules delen dezelfde opslagruimte.

import type { ExamenPeriode } from './periode';

/**
 * Eén roosterblok zoals Untis het voor één klasgroep teruggeeft, verrijkt met
 * de velden die het examenoverzicht nodig heeft. Structureel een superset van
 * `Lesblok` uit de Traject Planner, zodat pure helpers zoals `layoutDay` er
 * ongewijzigd op werken.
 */
export interface ExamenBlok {
    /** De klasgroep waarvoor dit blok opgehaald werd. */
    klasgroep: string;
    olodNaam: string;
    /** INFO-tag uit Untis, bv. "Theorie", "Labo"; undefined als onbekend. */
    type?: string;
    start: Date;
    eind: Date;
    /** ROOM-posities, met ", " samengevoegd. */
    lokaal?: string;
    /** TEACHER-posities, met ", " samengevoegd. */
    docent?: string;
    /** Eerste entry-id van Untis. */
    id?: number;
    /** Alle entry-ids van Untis. */
    ids?: number[];
    /** Alle CLASS-posities van de entry (kan meer klasgroepen bevatten dan de eigen). */
    klassen?: string[];
    /** Ruwe Untis-status, bv. REGULAR of CANCELLED. */
    status?: string;
    /** Ruwe Untis-type van de gridEntry. */
    untisType?: string;
}

/** Klasgroepen die (in examenweken) hetzelfde rooster delen en dus één raster krijgen. */
export interface Jaargroep {
    id: string;
    naam: string;
    klasgroepen: string[];
}

export interface Opleiding {
    id: string;
    naam: string;
    /** Alle klasgroepen van de opleiding (displayNames uit Untis). */
    klasgroepen: string[];
    /** Indeling in jaargroepen; klasgroepen die nergens in zitten worden apart getoond. */
    jaargroepen: Jaargroep[];
    /**
     * Eigen semestergrenzen die de algemene overrulen. Afwezig — het normale
     * geval — betekent: de algemene grenzen (`examen_periode`) gelden. Enkel
     * voor de opleiding die haar examens buiten de gemeenschappelijke
     * examenweken legt; zie `effectievePeriode()` in periode.ts.
     */
    eigenPeriode?: ExamenPeriode;
}

/** Wat de gebruiker nu bekijkt: welke opleiding en welke week (maandag, ISO-datum). */
export interface ExamenActief {
    opleidingId: string | null;
    weekMaandag: string;
    /**
     * True zodra de gebruiker zelf een week koos. Zolang dat niet gebeurde volgt
     * de week de standaard (eerstvolgende examenweek uit de semestergrenzen).
     */
    weekGekozen: boolean;
}

/** Resultaat van het ophalen van één klasgroep voor één week. */
export interface KlasgroepResultaat {
    blokken: ExamenBlok[];
    /** Gezet wanneer het rooster niet opgehaald kon worden; `blokken` is dan leeg. */
    fout?: string;
}

/** Eén klasgroep-aandeel in een samengevoegd examen. */
export interface ExamenDeel {
    klasgroep: string;
    lokaal?: string;
    docent?: string;
    status?: string;
    id?: number;
    blok: ExamenBlok;
}

/**
 * Eén examen in het raster van een jaargroep: alle blokken met dezelfde
 * merge-sleutel (start, einde, vak) over de klasgroepen van de jaargroep heen.
 * Draagt `klasgroep` (samengevoegde namen) zodat het object ook als `Lesblok`
 * bruikbaar is voor de overlap-layout.
 */
export interface Examen {
    key: string;
    olodNaam: string;
    start: Date;
    eind: Date;
    type?: string;
    /** Samengevoegde klasgroepnamen — enkel voor structurele compatibiliteit met Lesblok. */
    klasgroep: string;
    /** Klasgroepen van de jaargroep waarvoor dit examen geldt (natuurlijk gesorteerd). */
    klasgroepen: string[];
    delen: ExamenDeel[];
    /** Onderscheiden lokalen resp. docenten over alle delen. */
    lokalen: string[];
    docenten: string[];
    /** Klasgroepen met een opgehaald rooster waarin dit examen NIET voorkomt. */
    ontbrekend: string[];
    /** True wanneer het examen voor alle klasgroepen met een rooster geldt. */
    volledig: boolean;
    /**
     * Afwijkende Untis-status (bv. CANCELLED), of undefined als alles gewoon is.
     * Bij meerdere afwijkingen wint een annulering.
     */
    status?: string;
    /** Klasgroepen waarvoor die status geldt — een annulering voor één klas is er geen voor de andere. */
    statusKlasgroepen: string[];
    /** True wanneer de status voor alle klasgroepen van dit examen geldt. */
    statusVoorAlle: boolean;
}

export type Afwijking =
    | { soort: 'subset'; examen: Examen }
    | { soort: 'status'; examen: Examen }
    | { soort: 'mislukt'; klasgroep: string; fout: string }
    | { soort: 'leeg'; klasgroep: string };

export interface JaargroepOverzicht {
    jaargroep: Jaargroep;
    examens: Examen[];
    /** Klasgroepen waarvan het rooster niet opgehaald kon worden. */
    mislukt: string[];
    /** Klasgroepen met een opgehaald maar leeg rooster. */
    leeg: string[];
    /** Klasgroepen waarvan (nog) geen resultaat bekend is. */
    onbekend: string[];
    afwijkingen: Afwijking[];
}

/** Natuurlijke sortering van klasgroepnamen (1IT2 vóór 1IT10). */
export function sorteerKlasgroepen(namen: Iterable<string>): string[] {
    return Array.from(namen).sort((a, b) =>
        a.localeCompare(b, 'nl', { numeric: true, sensitivity: 'base' })
    );
}
