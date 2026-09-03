import type {
    Afwijking,
    Examen,
    ExamenBlok,
    ExamenDeel,
    Jaargroep,
    JaargroepOverzicht,
    KlasgroepResultaat,
} from './types';
import { sorteerKlasgroepen } from './types';

// ===== Untis-status =====

// Statussen die als "gewoon blok" tellen. Alles wat hier niet in staat wordt
// als afwijking getoond en benoemd — voor een examenoverzicht weegt een
// geannuleerd examen dat als gewoon blok verschijnt zwaarder dan wat ook.
// De precieze waarden worden in fase 0 op echte data geverifieerd; tot dan
// is de regel: onbekend = afwijkend, nooit stilzwijgend gewoon.
const NORMALE_STATUS = new Set(['', 'REGULAR', 'NORMAL', 'STANDARD', 'OK']);

export function isAfwijkendeStatus(status: string | undefined): boolean {
    if (!status) return false;
    return !NORMALE_STATUS.has(status.trim().toUpperCase());
}

export function isGeannuleerd(status: string | undefined): boolean {
    return !!status && status.toUpperCase().includes('CANCEL');
}

/** True wanneer het examen voor élke klasgroep in het raster geannuleerd is — enkel dan mag het blok als geheel "weg" tonen. */
export function isVolledigGeannuleerd(ex: Pick<Examen, 'status' | 'statusVoorAlle'>): boolean {
    return isGeannuleerd(ex.status) && ex.statusVoorAlle;
}

/** Korte omschrijving van een afwijkende status mét de klasgroepen waarvoor hij geldt, bv. "geannuleerd: 2TIB". */
export function statusOmschrijving(ex: Pick<Examen, 'status' | 'statusKlasgroepen' | 'statusVoorAlle'>): string | undefined {
    if (!ex.status) return undefined;
    const label = statusLabel(ex.status);
    return ex.statusVoorAlle ? label : `${label}: ${ex.statusKlasgroepen.join(', ')}`;
}

/** Korte Nederlandse benaming van een afwijkende status; onbekende waarden gaan ruw door. */
export function statusLabel(status: string): string {
    const u = status.trim().toUpperCase();
    if (u.includes('CANCEL')) return 'geannuleerd';
    if (u.includes('MOVED') || u.includes('SHIFT')) return 'verplaatst';
    if (u.includes('ROOM')) return 'lokaalwijziging';
    if (u.includes('SUBST')) return 'vervanging';
    if (u.includes('ADDITIONAL') || u.includes('EXTRA')) return 'extra';
    if (u.includes('CHANGE')) return 'gewijzigd';
    return status.trim().toLowerCase();
}

// ===== Samenvoegen =====

/**
 * Twee blokken zijn "hetzelfde examen" als start, einde en vak gelijk zijn.
 * Bewust niet op entry-id: of Untis dezelfde id teruggeeft wanneer je per
 * klasgroep bevraagt, is nog niet geverifieerd (fase 0).
 */
export function mergeKey(b: Pick<ExamenBlok, 'start' | 'eind' | 'olodNaam'>): string {
    return `${b.start.getTime()}|${b.eind.getTime()}|${b.olodNaam}`;
}

function uniek(waarden: Array<string | undefined>): string[] {
    const set = new Set<string>();
    for (const w of waarden) {
        if (!w) continue;
        for (const deel of w.split(',')) {
            const s = deel.trim();
            if (s) set.add(s);
        }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'nl', { numeric: true }));
}

function voegSamen(a: string | undefined, b: string | undefined): string | undefined {
    const u = uniek([a, b]);
    return u.length > 0 ? u.join(', ') : undefined;
}

/**
 * Bouwt het raster van één jaargroep: alle blokken van haar klasgroepen in de
 * week, samengevoegd op merge-sleutel, met per examen de klasgroepen waarvoor
 * het geldt en de afwijkingenlijst eronder. Klasgroepen zonder resultaat
 * (nog niet geladen) tellen nergens mee, zodat er geen vals alarm ontstaat.
 */
export function bouwJaargroepOverzicht(
    jaargroep: Jaargroep,
    perKlas: Record<string, KlasgroepResultaat | undefined>
): JaargroepOverzicht {
    const mislukt: Array<{ klasgroep: string; fout: string }> = [];
    const leeg: string[] = [];
    const onbekend: string[] = [];
    const metRooster: string[] = [];
    const map = new Map<string, Examen>();

    for (const k of jaargroep.klasgroepen) {
        const r = perKlas[k];
        if (!r) {
            onbekend.push(k);
            continue;
        }
        if (r.fout) {
            mislukt.push({ klasgroep: k, fout: r.fout });
            continue;
        }
        metRooster.push(k);
        if (r.blokken.length === 0) leeg.push(k);
        for (const b of r.blokken) {
            const key = mergeKey(b);
            let ex = map.get(key);
            if (!ex) {
                ex = {
                    key,
                    olodNaam: b.olodNaam,
                    start: b.start,
                    eind: b.eind,
                    type: b.type,
                    klasgroep: '',
                    klasgroepen: [],
                    delen: [],
                    lokalen: [],
                    docenten: [],
                    ontbrekend: [],
                    volledig: true,
                    statusKlasgroepen: [],
                    statusVoorAlle: false,
                };
                map.set(key, ex);
            }
            // Untis kan hetzelfde examen voor één klasgroep twee keer teruggeven
            // (bv. één entry per lokaal); die delen smelten samen.
            const bestaand = ex.delen.find(d => d.klasgroep === k);
            if (bestaand) {
                bestaand.lokaal = voegSamen(bestaand.lokaal, b.lokaal);
                bestaand.docent = voegSamen(bestaand.docent, b.docent);
                if (!isAfwijkendeStatus(bestaand.status) && isAfwijkendeStatus(b.status)) {
                    bestaand.status = b.status;
                }
            } else {
                const deel: ExamenDeel = {
                    klasgroep: k,
                    lokaal: b.lokaal,
                    docent: b.docent,
                    status: b.status,
                    id: b.id,
                    blok: b,
                };
                ex.delen.push(deel);
            }
            if (!ex.type && b.type) ex.type = b.type;
        }
    }

    const examens = Array.from(map.values());
    for (const ex of examens) {
        ex.klasgroepen = sorteerKlasgroepen(ex.delen.map(d => d.klasgroep));
        ex.klasgroep = ex.klasgroepen.join(', ');
        ex.delen.sort((a, b) => ex.klasgroepen.indexOf(a.klasgroep) - ex.klasgroepen.indexOf(b.klasgroep));
        ex.lokalen = uniek(ex.delen.map(d => d.lokaal));
        ex.docenten = uniek(ex.delen.map(d => d.docent));
        const heeft = new Set(ex.klasgroepen);
        ex.ontbrekend = metRooster.filter(k => !heeft.has(k));
        ex.volledig = ex.ontbrekend.length === 0;
        // Een annulering voor één klasgroep is er geen voor de andere: de
        // status draagt altijd de klasgroepen waarvoor hij geldt, en enkel
        // wanneer hij voor alle delen geldt mag het blok als geheel zo tonen.
        const afwijkend = ex.delen.filter(d => isAfwijkendeStatus(d.status));
        if (afwijkend.length > 0) {
            const geannuleerd = afwijkend.filter(d => isGeannuleerd(d.status));
            const gekozen = geannuleerd.length > 0 ? geannuleerd : afwijkend;
            ex.status = gekozen[0].status;
            ex.statusKlasgroepen = sorteerKlasgroepen(gekozen.map(d => d.klasgroep));
            ex.statusVoorAlle = gekozen.length === ex.delen.length;
        }
    }
    examens.sort(
        (a, b) =>
            a.start.getTime() - b.start.getTime() ||
            a.eind.getTime() - b.eind.getTime() ||
            a.olodNaam.localeCompare(b.olodNaam)
    );

    const afwijkingen: Afwijking[] = [];
    for (const ex of examens) {
        if (!ex.volledig) afwijkingen.push({ soort: 'subset', examen: ex });
    }
    for (const ex of examens) {
        if (ex.status) afwijkingen.push({ soort: 'status', examen: ex });
    }
    for (const m of mislukt) afwijkingen.push({ soort: 'mislukt', klasgroep: m.klasgroep, fout: m.fout });
    // Een leeg rooster is enkel het vermelden waard als andere klasgroepen
    // van dezelfde jaargroep wél examens hebben.
    if (examens.length > 0) {
        for (const k of leeg) afwijkingen.push({ soort: 'leeg', klasgroep: k });
    }

    return {
        jaargroep,
        examens,
        mislukt: mislukt.map(m => m.klasgroep),
        leeg,
        onbekend,
        afwijkingen,
    };
}

/**
 * De effectieve indeling van een opleiding voor het overzicht: de bewaarde
 * jaargroepen, gevolgd door elke niet-ingedeelde klasgroep als eigen groep —
 * zo valt geen enkele klasgroep stilzwijgend uit het overzicht.
 */
export function effectieveJaargroepen(
    jaargroepen: Jaargroep[],
    alleKlasgroepen: string[]
): Jaargroep[] {
    const bezet = new Set(jaargroepen.flatMap(j => j.klasgroepen));
    const los = alleKlasgroepen.filter(k => !bezet.has(k));
    return [
        ...jaargroepen.filter(j => j.klasgroepen.length > 0),
        ...los.map(k => ({ id: `los:${k}`, naam: k, klasgroepen: [k] })),
    ];
}

/** True voor een jaargroep die niet bewaard is maar uit een losse klasgroep is afgeleid. */
export function isLosseJaargroep(j: Jaargroep): boolean {
    return j.id.startsWith('los:');
}

// ===== Weergavehulpjes =====

/** Eén lokaal van een examen, met wie er lesgeeft en welke klasgroepen er zitten. */
export interface LokaalGroep {
    /** Undefined wanneer Untis geen lokaal meegaf. */
    lokaal?: string;
    docenten: string[];
    klasgroepen: string[];
}

/**
 * De delen van een examen gegroepeerd per lokaal. Binnen één examen is de
 * vaknaam overal dezelfde; wat de lezer nodig heeft is per lokaal wie er
 * toezicht houdt en welke klasgroepen er zitten. Gesorteerd op de eerste
 * klasgroep, zodat de volgorde overal in de tool dezelfde is.
 */
export function lokaalGroepen(ex: Examen): LokaalGroep[] {
    const map = new Map<string, LokaalGroep>();
    for (const d of ex.delen) {
        const sleutel = d.lokaal ?? '';
        let g = map.get(sleutel);
        if (!g) {
            g = { lokaal: d.lokaal, docenten: [], klasgroepen: [] };
            map.set(sleutel, g);
        }
        if (!g.klasgroepen.includes(d.klasgroep)) g.klasgroepen.push(d.klasgroep);
        for (const naam of uniek([d.docent])) {
            if (!g.docenten.includes(naam)) g.docenten.push(naam);
        }
    }
    const groepen = Array.from(map.values());
    for (const g of groepen) g.klasgroepen = sorteerKlasgroepen(g.klasgroepen);
    return groepen.sort((a, b) =>
        a.klasgroepen[0].localeCompare(b.klasgroepen[0], 'nl', { numeric: true, sensitivity: 'base' })
    );
}

export interface RegelOpties {
    /** Uit bij een jaargroep van één klasgroep: hun naam op elke regel herhalen is ruis. */
    klasgroepen?: boolean;
    /** Uit wanneer alle lokalen dezelfde docenten hebben; die staan dan één keer boven de lijst. */
    docenten?: boolean;
}

/**
 * De onderdelen van één lokaalregel, als losse stukken: "A.101", "De Smet J.",
 * "2TIA, 2TIB". Losse stukken omdat de weergave ertussen mag afbreken maar
 * nooit middenin een naam — "Janssens" op de ene regel en "P." op de volgende
 * leest als een andere persoon.
 */
export function lokaalDelen(g: LokaalGroep, opties: RegelOpties = {}): string[] {
    const { klasgroepen = true, docenten = true } = opties;
    const toonDocenten = docenten && g.docenten.length > 0;
    return [
        g.lokaal ?? (toonDocenten || !klasgroepen ? undefined : 'lokaal onbekend'),
        toonDocenten ? g.docenten.join(', ') : undefined,
        klasgroepen ? g.klasgroepen.join(', ') : undefined,
    ].filter((x): x is string => !!x);
}

/** Eén regel per lokaal: "A.101 · De Smet J. · 2TIA, 2TIB". */
export function lokaalRegel(g: LokaalGroep, opties: RegelOpties = {}): string {
    return lokaalDelen(g, opties).join(' · ');
}

/**
 * De docenten wanneer élk lokaal van dit examen dezelfde heeft, anders null.
 * Eén toezichthouder over drie lokalen hoort één keer vermeld, niet drie keer.
 */
export function gedeeldeDocenten(groepen: LokaalGroep[]): string[] | null {
    if (groepen.length < 2) return null;
    const eerste = groepen[0].docenten;
    if (eerste.length === 0) return null;
    const gelijk = groepen.every(
        g => g.docenten.length === eerste.length && g.docenten.every((d, i) => d === eerste[i])
    );
    return gelijk ? eerste : null;
}

// ===== Diagnose (fase 0) =====

export interface Telling {
    waarde: string;
    aantal: number;
}

export interface Diagnose {
    totaal: number;
    statussen: Telling[];
    types: Telling[];
    metLokaal: number;
    metDocent: number;
    /** Blokken waarvan de CLASS-posities méér bevatten dan de eigen klasgroep. */
    klassenMeerDanEigen: number;
    /** Samengevoegde examens (≥ 2 klasgroepen) waarvan alle delen dezelfde entry-id dragen, resp. niet. */
    idGedeeld: number;
    idVerschilt: number;
    voorbeelden: ExamenBlok[];
}

function tel(waarden: Array<string | undefined>): Telling[] {
    const map = new Map<string, number>();
    for (const w of waarden) {
        const k = w === undefined ? '(ontbreekt)' : w === '' ? '(leeg)' : w;
        map.set(k, (map.get(k) ?? 0) + 1);
    }
    return Array.from(map.entries())
        .map(([waarde, aantal]) => ({ waarde, aantal }))
        .sort((a, b) => b.aantal - a.aantal);
}

/**
 * Samenvatting van de ruwe Untis-velden van de geladen week, om de open
 * vragen van fase 0 (status, lokaal/docent-posities, gedeelde entry-ids,
 * CLASS-posities) op echte data te beantwoorden zonder de console.
 */
export function maakDiagnose(
    perKlas: Record<string, KlasgroepResultaat | undefined>,
    overzichten: JaargroepOverzicht[]
): Diagnose {
    const blokken: ExamenBlok[] = [];
    for (const k of Object.keys(perKlas)) {
        const r = perKlas[k];
        if (r && !r.fout) blokken.push(...r.blokken);
    }
    let idGedeeld = 0;
    let idVerschilt = 0;
    for (const o of overzichten) {
        for (const ex of o.examens) {
            if (ex.delen.length < 2) continue;
            const ids = ex.delen.map(d => d.id);
            if (ids.every(id => id !== undefined && id === ids[0])) idGedeeld++;
            else idVerschilt++;
        }
    }
    return {
        totaal: blokken.length,
        statussen: tel(blokken.map(b => b.status)),
        types: tel(blokken.map(b => b.untisType)),
        metLokaal: blokken.filter(b => !!b.lokaal).length,
        metDocent: blokken.filter(b => !!b.docent).length,
        klassenMeerDanEigen: blokken.filter(
            b => !!b.klassen && b.klassen.some(k => k !== b.klasgroep)
        ).length,
        idGedeeld,
        idVerschilt,
        voorbeelden: blokken.slice(0, 5),
    };
}
