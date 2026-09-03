import type { PeriodeGrenzen, PeriodeType } from './academicYear';

export interface Lesblok {
    klasgroep: string;
    olodNaam: string;
    type?: string;        // ruwe INFO-tag uit Untis, bv. "Theorie", "Labo"; undefined als onbekend
    start: Date;
    eind: Date;
    lokaal?: string;
}

// Een OLOD-keuze geldt voor één periode: de student volgt dit vak bij deze
// klasgroep tussen `van` en `tot` (inclusieve ISO-datums, meestal exact een
// semester of module). Zo kan hetzelfde vak in een volgende module bij een
// andere klasgroep gevolgd worden zonder dat beide keuzes elkaar overlappen.
export interface OLODSelectie {
    klasgroep: string;
    olodNaam: string;
    van: string;
    tot: string;
    // Een gedeactiveerde selectie blijft in de lijst staan (mét haar klasgroep
    // en periode), maar telt nergens mee: haar lessen verschijnen niet in het
    // totaalrooster, de conflictdetectie of de afdruk. Ontbreekt het veld, dan
    // is de selectie gewoon actief — zo blijven oudere opslag en back-ups
    // zonder dit veld werken.
    actief?: boolean;
}

/** Telt deze selectie mee in het rooster? Zie {@link OLODSelectie.actief}. */
export function isActief(sel: OLODSelectie): boolean {
    return sel.actief !== false;
}

export type StudentTraject = OLODSelectie[];

export interface TrajectSettings {
    mijnOpleidingKlasgroepen: string[];
    // De actieve periode (het bereik dat het werkblad toont). Historische
    // veldnamen: sinds de periode-switcher kan dit ook een module zijn.
    semesterStart: string;
    semesterEind: string;
    periodeType: PeriodeType;
    // Alle grensdatums van het academiejaar (semesterstart/-einde en de eerste
    // dag van module 2 en 4). Historische naam in oudere opslag: moduleGrenzen,
    // dat enkel de twee modulegrenzen bevatte — normalizeSettings leest die nog.
    periodeGrenzen: PeriodeGrenzen;
    // OLOD-namen die in modulemodus tóch over beide modules van hun semester
    // lopen. De gebruiker markeert ze in het werkblad (niet in de instellingen);
    // ze staan hier omdat het een eigenschap van de opleiding is die met een
    // back-up, een bewaard traject en de student-link mee moet reizen.
    // Zie semesterOlods.ts.
    semesterOlods: string[];
}

export type KleurMap = Record<string, string>;

export interface Conflict {
    a: Lesblok;
    b: Lesblok;
}

export interface TrajectUntisService {
    getKlasgroepen(): Promise<string[]>;
    getLesblokken(klasgroep: string, van: Date, tot: Date): Promise<Lesblok[]>;
}
