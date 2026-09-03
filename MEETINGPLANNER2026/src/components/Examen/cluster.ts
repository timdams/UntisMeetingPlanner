import { formatTime } from '../Traject/dateUtils';
import { mergeKey } from './merge';
import { sorteerKlasgroepen, type ExamenBlok, type KlasgroepResultaat } from './types';

/**
 * Clustervoorstel: welke klasgroepen van een opleiding delen in deze week
 * hetzelfde rooster, en horen dus in één jaargroep?
 *
 * 1. Per klasgroep een weeksignatuur: de set merge-sleutels van haar blokken.
 * 2. Identieke signaturen vormen een exacte groep.
 * 3. Groepen die sterk overlappen (Jaccard ≥ drempel) worden samengevoegd,
 *    met de verschillen expliciet benoemd.
 * 4. Naam: gemeenschappelijk prefix van de klasgroepnamen.
 */

export interface ClusterVoorstel {
    naam: string;
    klasgroepen: string[];
    /** True wanneer alle klasgroepen exact hetzelfde rooster hebben. */
    exact: boolean;
    /** Leesbare beschrijving van de examens die niet voor de hele groep gelden. */
    verschillen: string[];
    /** True wanneer geen enkele klasgroep in de groep examens heeft in deze week. */
    leeg: boolean;
}

export const JACCARD_DREMPEL = 0.8;

export function weekSignatuur(blokken: ExamenBlok[]): Set<string> {
    return new Set(blokken.map(mergeKey));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    let gedeeld = 0;
    for (const x of a) if (b.has(x)) gedeeld++;
    const unie = a.size + b.size - gedeeld;
    return unie === 0 ? 1 : gedeeld / unie;
}

/** Gemeenschappelijk prefix van klasgroepnamen, ontdaan van losse scheidingstekens. */
export function gemeenschappelijkPrefix(namen: string[]): string {
    if (namen.length === 0) return '';
    let prefix = namen[0];
    for (const n of namen.slice(1)) {
        let i = 0;
        while (i < prefix.length && i < n.length && prefix[i].toLowerCase() === n[i].toLowerCase()) i++;
        prefix = prefix.slice(0, i);
        if (!prefix) break;
    }
    return prefix.replace(/[\s_\-./]+$/, '').trim();
}

interface Groep {
    klasgroepen: string[];
    signatuur: Set<string>;
    // Per merge-sleutel: welke klasgroepen van de groep het examen hebben.
    perSleutel: Map<string, Set<string>>;
}

function maakGroep(klasgroep: string, sig: Set<string>): Groep {
    const perSleutel = new Map<string, Set<string>>();
    for (const s of sig) perSleutel.set(s, new Set([klasgroep]));
    return { klasgroepen: [klasgroep], signatuur: new Set(sig), perSleutel };
}

function voegGroepenSamen(a: Groep, b: Groep): Groep {
    const perSleutel = new Map<string, Set<string>>();
    for (const [s, ks] of a.perSleutel) perSleutel.set(s, new Set(ks));
    for (const [s, ks] of b.perSleutel) {
        const bestaand = perSleutel.get(s);
        if (bestaand) ks.forEach(k => bestaand.add(k));
        else perSleutel.set(s, new Set(ks));
    }
    return {
        klasgroepen: [...a.klasgroepen, ...b.klasgroepen],
        signatuur: new Set([...a.signatuur, ...b.signatuur]),
        perSleutel,
    };
}

function beschrijfVerschillen(groep: Groep, blokPerSleutel: Map<string, ExamenBlok>): string[] {
    const out: string[] = [];
    const totaal = groep.klasgroepen.length;
    for (const [sleutel, ks] of groep.perSleutel) {
        if (ks.size === totaal) continue;
        const b = blokPerSleutel.get(sleutel);
        if (!b) continue;
        const dag = b.start.toLocaleDateString('nl-BE', { weekday: 'short', day: '2-digit', month: '2-digit' });
        out.push(
            `${b.olodNaam} (${dag} ${formatTime(b.start)}–${formatTime(b.eind)}): enkel ${sorteerKlasgroepen(ks).join(', ')}`
        );
    }
    return out.sort();
}

/**
 * Stelt jaargroepen voor op basis van de blokken van één week. Klasgroepen
 * waarvan het rooster niet opgehaald kon worden blijven buiten het voorstel
 * (de aanroeper meldt ze apart).
 */
export function stelJaargroepenVoor(
    klasgroepen: string[],
    perKlas: Record<string, KlasgroepResultaat | undefined>,
    drempel: number = JACCARD_DREMPEL
): ClusterVoorstel[] {
    const blokPerSleutel = new Map<string, ExamenBlok>();
    const groepen: Groep[] = [];
    const legeKlasgroepen: string[] = [];

    for (const k of klasgroepen) {
        const r = perKlas[k];
        if (!r || r.fout) continue;
        if (r.blokken.length === 0) {
            legeKlasgroepen.push(k);
            continue;
        }
        for (const b of r.blokken) {
            const s = mergeKey(b);
            if (!blokPerSleutel.has(s)) blokPerSleutel.set(s, b);
        }
        const sig = weekSignatuur(r.blokken);
        // Exacte groep: identieke signatuur.
        const exact = groepen.find(g => g.signatuur.size === sig.size && jaccard(g.signatuur, sig) === 1);
        if (exact) {
            exact.klasgroepen.push(k);
            for (const s of sig) exact.perSleutel.get(s)?.add(k);
        } else {
            groepen.push(maakGroep(k, sig));
        }
    }

    // Tweede pass: agglomeratief samenvoegen zolang het best overlappende
    // paar boven de drempel zit.
    let samengevoegd = true;
    while (samengevoegd && groepen.length > 1) {
        samengevoegd = false;
        let beste = { i: -1, j: -1, score: 0 };
        for (let i = 0; i < groepen.length; i++) {
            for (let j = i + 1; j < groepen.length; j++) {
                const score = jaccard(groepen[i].signatuur, groepen[j].signatuur);
                if (score >= drempel && score > beste.score) beste = { i, j, score };
            }
        }
        if (beste.i >= 0) {
            const nieuw = voegGroepenSamen(groepen[beste.i], groepen[beste.j]);
            groepen.splice(beste.j, 1);
            groepen.splice(beste.i, 1, nieuw);
            samengevoegd = true;
        }
    }

    const voorstellen: ClusterVoorstel[] = groepen.map(g => {
        const ks = sorteerKlasgroepen(g.klasgroepen);
        const verschillen = beschrijfVerschillen(g, blokPerSleutel);
        return {
            naam: gemeenschappelijkPrefix(ks),
            klasgroepen: ks,
            exact: verschillen.length === 0,
            verschillen,
            leeg: false,
        };
    });
    if (legeKlasgroepen.length > 0) {
        const ks = sorteerKlasgroepen(legeKlasgroepen);
        voorstellen.push({
            naam: gemeenschappelijkPrefix(ks),
            klasgroepen: ks,
            exact: true,
            verschillen: [],
            leeg: true,
        });
    }

    // Sorteer op eerste klasgroepnaam, en geef groepen zonder bruikbaar
    // prefix een volgnummer.
    voorstellen.sort((a, b) =>
        a.klasgroepen[0].localeCompare(b.klasgroepen[0], 'nl', { numeric: true, sensitivity: 'base' })
    );
    const gebruikt = new Set<string>();
    voorstellen.forEach((v, i) => {
        let naam = v.naam.length >= 2 ? v.naam : `Jaargroep ${i + 1}`;
        if (v.klasgroepen.length === 1) naam = v.klasgroepen[0];
        while (gebruikt.has(naam.toLowerCase())) naam = `${naam} (${i + 1})`;
        gebruikt.add(naam.toLowerCase());
        v.naam = naam;
    });
    return voorstellen;
}
