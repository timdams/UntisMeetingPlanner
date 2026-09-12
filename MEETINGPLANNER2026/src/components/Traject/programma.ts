// Het geplakte programma van de student: de lijst OLODs die hij dit jaar moet
// volgen, zoals de begeleider ze doorkreeg (uit een studiefiche, een mail, een
// kolom uit een rekenblad). Eén OLOD per regel, verder niets.
//
// De lijst is een **checklist naast de wizard**, geen tweede traject. Ze wordt
// nergens bewaard bij het traject, reist niet mee met een profiel of een
// back-up, en stuurt niets aan: ze duidt enkel de vakken aan die in de periode
// waar je nu in staat effectief lesgegeven worden, en toont van elke regel of
// ze al ergens terechtkwam. Wat niet in deze periode zit, blijft gewoon staan
// tot je naar de module of het semester gaat waar het wél in zit.
//
// Bewust een pure module zonder React: het matchen van namen is de hele kern en
// is zo los te lezen en te testen.

// Een geplakte lijst is een handvol vakken. De grens vangt enkel het ongeluk op
// waarbij iemand een heel document in het vak kiepert.
const MAX_REGELS = 300;

// Onder deze lengte wordt er niet meer op een stuk van de naam gematcht: een
// sleutel als "ai" zit in te veel namen om ergens iets over te zeggen.
const MIN_DEELLENGTE = 4;

/**
 * De vergelijksleutel van een naam: hoofdletters, accenten, leestekens en
 * dubbele spaties weg. Zo matcht "Programmeren I (deel 1)" met "Programmeren
 * I - deel 1" en "Sciënces" met "Sciences".
 */
export function sleutel(naam: string): string {
    return naam
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Van geplakte tekst naar een lijst OLOD-namen: één per regel, lege regels
 * eruit, dubbels eruit. Opsommingstekens en nummering vooraan worden
 * weggeknipt — wie uit een document plakt, plakt die mee.
 */
export function parseProgramma(tekst: string): string[] {
    const uit: string[] = [];
    const gezien = new Set<string>();
    for (const ruw of tekst.split(/\r?\n/)) {
        const naam = ruw
            .replace(/^[\s\-–—•*·>|]+/, '')
            .replace(/^\d+\s*[.)]\s*/, '')
            .replace(/[\s;,|]+$/, '')
            .trim();
        if (!naam) continue;
        const k = sleutel(naam);
        if (!k || gezien.has(k)) continue;
        gezien.add(k);
        uit.push(naam);
        if (uit.length >= MAX_REGELS) break;
    }
    return uit;
}

/**
 * De OLOD-namen waar deze geplakte regel op uitkomt.
 *
 * Eerst exact op sleutel; levert dat niets op, dan volstaat een treffer op een
 * stuk van de naam. Een geplakte regel draagt vaak nog wat mee ("Programmeren 1
 * (6 stp)") of is net korter dan de Untis-naam, en dat mag geen reden zijn om
 * ze niet te herkennen. Komt zo'n deeltreffer bij meer dan één vak uit, dan
 * wordt er niets gekozen: de lijst zegt dan dat de regel dubbelzinnig is, en de
 * gebruiker duidt zelf aan.
 */
export function zoekKandidaten(regel: string, namen: string[]): string[] {
    const k = sleutel(regel);
    if (!k) return [];
    const exact = namen.filter(n => sleutel(n) === k);
    if (exact.length > 0) return Array.from(new Set(exact));
    if (k.length < MIN_DEELLENGTE) return [];
    const deel = namen.filter(n => {
        const nk = sleutel(n);
        if (nk.length < MIN_DEELLENGTE) return false;
        return nk.includes(k) || k.includes(nk);
    });
    return Array.from(new Set(deel));
}

/** Wat de wizard over één geplakte regel weet. Zie {@link leesProgramma}. */
export type ProgrammaStand =
    // Dit vak staat al in het studenttraject (eender welke periode): klaar.
    | 'traject'
    // Eén vak in de actieve periode heet zo; de wizard duidt het aan.
    | 'gevonden'
    // Meer dan één vak in deze periode past op deze regel — met de hand kiezen.
    | 'meerdere'
    // Geen enkel vak in deze periode heet zo. Meestal: het zit in een andere
    // module of een ander semester.
    | 'onbekend';

export interface ProgrammaRegel {
    // De regel zoals ze geplakt werd — dat is wat de gebruiker herkent.
    naam: string;
    stand: ProgrammaStand;
    // De OLOD-naam waar de regel op uitkwam (de spelling van Untis), bij
    // 'traject' en 'gevonden'.
    match?: string;
    // Bij 'meerdere': de vakken waar de regel tussen zou moeten kiezen.
    kandidaten?: string[];
}

/**
 * Elke geplakte regel naast de vakken van de actieve periode en het traject
 * leggen.
 *
 * Het traject gaat voor: een vak dat er al in staat, is behandeld — ook als het
 * in een vorige module gekozen werd. Zo blijft een regel groen wanneer je in de
 * wizard naar de volgende periode wisselt, in plaats van opnieuw als "nog te
 * doen" op te lichten.
 *
 * @param programma   de geplakte regels
 * @param periodeVakken OLOD-namen die in de actieve periode lesgegeven worden
 * @param trajectNamen  OLOD-namen die al actief in het traject staan
 */
export function leesProgramma(
    programma: string[],
    periodeVakken: string[],
    trajectNamen: string[]
): ProgrammaRegel[] {
    return programma.map(naam => {
        const inTraject = zoekKandidaten(naam, trajectNamen);
        if (inTraject.length > 0) return { naam, stand: 'traject' as const, match: inTraject[0] };
        const hier = zoekKandidaten(naam, periodeVakken);
        if (hier.length === 1) return { naam, stand: 'gevonden' as const, match: hier[0] };
        if (hier.length > 1) return { naam, stand: 'meerdere' as const, kandidaten: hier };
        return { naam, stand: 'onbekend' as const };
    });
}

/** De vakken die dit programma in de actieve periode aanduidt. */
export function treffers(regels: ProgrammaRegel[]): string[] {
    return regels.filter(r => r.stand === 'gevonden').map(r => r.match as string);
}

/** Hoeveel regels er al ergens terechtkwamen — de teller in de kop. */
export function aantalGeregeld(regels: ProgrammaRegel[]): number {
    return regels.filter(r => r.stand === 'traject' || r.stand === 'gevonden').length;
}

// De lijst hoort bij de zitting, niet bij het traject: ze overleeft het sluiten
// en heropenen van de wizard, maar niet het afsluiten van het tabblad. Wat in
// localStorage staat, komt maanden later terug zonder dat iemand er nog om
// vroeg — dat is voor een checklist als deze meer last dan hulp.
const KEY_PROGRAMMA = 'traject_wizard_programma';

export function laadProgramma(): string[] {
    try {
        const raw = sessionStorage.getItem(KEY_PROGRAMMA);
        const lijst: unknown = raw ? JSON.parse(raw) : null;
        if (!Array.isArray(lijst)) return [];
        return lijst.filter((x): x is string => typeof x === 'string').slice(0, MAX_REGELS);
    } catch {
        return [];
    }
}

export function bewaarProgramma(lijst: string[]) {
    try {
        if (lijst.length === 0) sessionStorage.removeItem(KEY_PROGRAMMA);
        else sessionStorage.setItem(KEY_PROGRAMMA, JSON.stringify(lijst));
    } catch {
        // Geen opslag (private modus): de lijst leeft dan enkel zolang de
        // wizard openstaat. Geen reden om iets te melden.
    }
}
