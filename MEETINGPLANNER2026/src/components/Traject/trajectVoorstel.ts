// De puzzel achter de wizard: kies voor elk gewenst vak één klasgroep, zo dat
// het weekrooster van de student klopt. Bewust een pure module zonder React —
// ze is te testen (en te herrekenen) zonder scherm.
//
// Twee dingen maken het probleem klein genoeg om exact op te lossen:
//  1. Er wordt niet per les gekozen maar per (vak, klasgroep): dat is ook het
//     datamodel van het traject.
//  2. Er wordt niet over het hele semester gepuzzeld maar over een handvol
//     **referentieweken**. Een rooster is meestal week na week hetzelfde (soms
//     met een even/oneven ritme), terwijl de eerste en laatste week van een
//     periode vaak atypisch zijn en er in elk semester losse eenmalige lessen
//     staan. Die mogen een voorstel niet kapotmaken.

import type { Lesblok } from './types';
import { overlapt } from './conflicts';
import { mondayOf, toIsoDate } from './dateUtils';

export type Voorkeur = 'conflictvrij' | 'compact';

// Wat een keuze "goed" maakt, en dus wat de gebruiker instelt. In beide standen
// tellen dezelfde drie maten mee; enkel hun onderlinge gewicht verschilt.
//  - conflictvrij: een botsing weegt altijd zwaarder dan eender welke winst in
//    compactheid — het voorstel botst dus alleen als het niet anders kan.
//  - compact: een lesdag minder mag één botsing per week kosten — twee niet.
// Tussenuren zijn in beide standen het laatste duwtje: ruwweg tien tussenuren
// per week wegen zo zwaar als één extra lesdag.
const WEGING: Record<Voorkeur, { conflict: number; dag: number; tussenuur: number }> = {
    conflictvrij: { conflict: 1000, dag: 10, tussenuur: 1 },
    compact: { conflict: 10, dag: 12, tussenuur: 1 },
};

/** Eén klasgroep als kandidaat voor een vak, met haar lessen in de referentieweken. */
export interface VoorstelOptie {
    klasgroep: string;
    blokken: Lesblok[];
}

/**
 * Eén keuze die de puzzel moet maken: normaal één vak, maar even goed een groep
 * vakken die samen bij dezelfde klasgroep horen (een lab — zie koppelGroepen.ts).
 * Die groep is hier bewust één variabele en geen extra kost: zo *kan* de solver
 * ze niet uit elkaar trekken, ook niet om een botsing te vermijden.
 *
 * `opties` is nooit leeg.
 */
export interface VoorstelVak {
    // Het label van deze keuze: de OLOD-naam, of de naam van de groep.
    olodNaam: string;
    // Bij een groep: de OLOD-namen die deze ene keuze invult. Ontbreekt bij een
    // gewoon vak, dat enkel zichzelf invult.
    leden?: string[];
    opties: VoorstelOptie[];
}

export interface VoorstelKeuze {
    olodNaam: string;
    // Zie {@link VoorstelVak.leden}.
    leden?: string[];
    klasgroep: string;
    blokken: Lesblok[];
    // Lessen van dit vak die met een ander gekozen vak botsen — zo wijst het
    // resultaat de boosdoeners aan in plaats van enkel een totaal te tonen.
    botsendeLessen: number;
}

export interface Voorstel {
    keuzes: VoorstelKeuze[];
    // Botsende lessenparen in de referentieweken samen.
    conflicten: number;
    // Weekdagen (ma–vr) waarop de student les heeft: de maat voor "compact".
    dagen: number;
    // Gemiddeld aantal tussenuren per week, op één decimaal.
    tussenuren: number;
    // True wanneer de zoektocht op haar knopen- of tijdslimiet stopte: het
    // voorstel is dan het beste dat gevonden werd, niet bewijsbaar het beste.
    afgekapt: boolean;
}

const MAX_KNOPEN = 2_000_000;
const MAX_MS = 1_000;

/** Aantal ingestelde bits: het aantal weekdagen in een dagmasker. */
function telBits(masker: number): number {
    let n = 0;
    let m = masker;
    while (m) {
        m &= m - 1;
        n++;
    }
    return n;
}

function dagMasker(blokken: Lesblok[]): number {
    let m = 0;
    for (const b of blokken) m |= 1 << ((b.start.getDay() + 6) % 7);
    return m;
}

/** Aantal botsende lessenparen tussen twee kandidaten. */
function botsingenTussen(a: Lesblok[], b: Lesblok[]): number {
    let n = 0;
    for (const x of a) {
        for (const y of b) {
            if (overlapt(x, y)) n++;
        }
    }
    return n;
}

/**
 * Totaal aantal tussenuren in de meegegeven lessen: per dag de gaten tussen
 * opeenvolgende lessen. Overlappende lessen leveren geen negatief gat op.
 */
function tussenurenVan(blokken: Lesblok[], aantalWeken: number): number {
    const perDag = new Map<string, Lesblok[]>();
    for (const b of blokken) {
        const key = toIsoDate(b.start);
        const lijst = perDag.get(key);
        if (lijst) lijst.push(b);
        else perDag.set(key, [b]);
    }
    let minuten = 0;
    for (const lijst of perDag.values()) {
        lijst.sort((x, y) => x.start.getTime() - y.start.getTime());
        let eindeVorige = lijst[0].eind.getTime();
        for (let i = 1; i < lijst.length; i++) {
            const gat = lijst[i].start.getTime() - eindeVorige;
            if (gat > 0) minuten += gat / 60000;
            eindeVorige = Math.max(eindeVorige, lijst[i].eind.getTime());
        }
    }
    return minuten / 60 / Math.max(1, aantalWeken);
}

/**
 * Zoekt de combinatie van klasgroepen die volgens `voorkeur` het best scoort.
 *
 * Backtracking over de vakken, met de minst flexibele vakken (de minste
 * kandidaat-klasgroepen) eerst en per vak de veelbelovendste klasgroep eerst.
 * Botsingen en lesdagen kunnen bij het verder invullen alleen maar toenemen,
 * dus hun tussenstand is een geldige ondergrens: zodra die het beste voorstel
 * tot nog toe evenaart, hoeft die tak niet verder. In de praktijk gaat het om
 * een tiental vakken met elk een handvol klasgroepen — dat is in milliseconden
 * rond. De harde limieten hieronder zijn er enkel om een pathologisch geval
 * (veel vakken, veel klasgroepen) niet de browser te laten blokkeren; het
 * antwoord is dan het beste dat gevonden werd, gemarkeerd met `afgekapt`.
 *
 * `aantalWeken` normaliseert de botsingen: met twee referentieweken telt een
 * wekelijkse botsing anders dubbel tegenover het aantal lesdagen.
 */
export function zoekVoorstel(
    vakken: VoorstelVak[],
    voorkeur: Voorkeur,
    aantalWeken: number
): Voorstel | null {
    if (vakken.length === 0) return null;

    // Minst flexibele vakken eerst: die snoeien de zoekboom het snelst.
    const orde = vakken
        .map((v, i) => ({ v, i }))
        .sort((a, b) => a.v.opties.length - b.v.opties.length || a.i - b.i)
        .map(x => x.v);

    const n = orde.length;
    const weging = WEGING[voorkeur];
    const weken = Math.max(1, aantalWeken);

    // botsingen[i][a][j][b] — vooraf berekend, want elke tak van de zoekboom
    // vraagt dezelfde paren opnieuw op.
    const botsingen: number[][][][] = orde.map((vi, i) =>
        vi.opties.map(oa =>
            orde.map((vj, j) =>
                j <= i ? [] : vj.opties.map(ob => botsingenTussen(oa.blokken, ob.blokken))
            )
        )
    );
    const maskers = orde.map(v => v.opties.map(o => dagMasker(o.blokken)));

    const keuze = new Array<number>(n).fill(0);
    let besteKeuze: number[] | null = null;
    let besteScore = Infinity;
    let knopen = 0;
    let afgekapt = false;
    const start = Date.now();

    const dfs = (idx: number, conflicten: number, masker: number) => {
        if (afgekapt) return;
        knopen++;
        if (knopen > MAX_KNOPEN || (knopen % 1024 === 0 && Date.now() - start > MAX_MS)) {
            afgekapt = true;
            return;
        }
        // Tussenuren blijven hier buiten: die kunnen bij het verder invullen
        // ook dálen (een les die precies in een gat past), dus ze horen niet in
        // een ondergrens. Nul is er een geldige ondergrens voor.
        const ondergrens = weging.conflict * (conflicten / weken) + weging.dag * telBits(masker);
        if (ondergrens >= besteScore) return;

        if (idx === n) {
            const alle: Lesblok[] = [];
            for (let i = 0; i < n; i++) alle.push(...orde[i].opties[keuze[i]].blokken);
            const score = ondergrens + weging.tussenuur * tussenurenVan(alle, weken);
            if (score < besteScore) {
                besteScore = score;
                besteKeuze = keuze.slice();
            }
            return;
        }

        // Per vak eerst de klasgroep die er het minst bij kost: dat zet snel een
        // scherpe bovengrens, waardoor de rest van de boom wegvalt.
        const kandidaten = orde[idx].opties.map((_, a) => {
            let extra = 0;
            for (let j = 0; j < idx; j++) {
                const rij = botsingen[j][keuze[j]][idx];
                extra += rij[a] ?? 0;
            }
            return { a, kost: weging.conflict * (extra / weken) + weging.dag * telBits(masker | maskers[idx][a]) };
        });
        kandidaten.sort((x, y) => x.kost - y.kost || x.a - y.a);

        for (const { a } of kandidaten) {
            let extra = 0;
            for (let j = 0; j < idx; j++) extra += botsingen[j][keuze[j]][idx][a] ?? 0;
            keuze[idx] = a;
            dfs(idx + 1, conflicten + extra, masker | maskers[idx][a]);
            if (afgekapt) return;
        }
    };

    dfs(0, 0, 0);
    if (!besteKeuze) return null;

    // De gevonden combinatie uitschrijven, met per vak hoeveel van zijn lessen
    // met een ander gekozen vak botsen.
    const gekozen: number[] = besteKeuze;
    const gekozenBlokken = orde.map((v, i) => v.opties[gekozen[i]]);
    const keuzes: VoorstelKeuze[] = gekozenBlokken.map((optie, i) => {
        const anderen = gekozenBlokken.filter((_, j) => j !== i).flatMap(o => o.blokken);
        return {
            olodNaam: orde[i].olodNaam,
            leden: orde[i].leden,
            klasgroep: optie.klasgroep,
            blokken: optie.blokken,
            botsendeLessen: optie.blokken.filter(b => anderen.some(o => overlapt(b, o))).length,
        };
    });

    let conflicten = 0;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            conflicten += botsingen[i][gekozen[i]][j][gekozen[j]] ?? 0;
        }
    }
    const alle = gekozenBlokken.flatMap(o => o.blokken);

    return {
        keuzes: keuzes.sort((a, b) => a.olodNaam.localeCompare(b.olodNaam)),
        conflicten,
        dagen: telBits(dagMasker(alle)),
        tussenuren: Math.round(tussenurenVan(alle, weken) * 10) / 10,
        afgekapt,
    };
}

// ===== Vakken uit de opgehaalde roosters =====

/** Eén vak zoals het uit de roosters van de shortlist komt. */
export interface VakInRoosters {
    olodNaam: string;
    // Klasgroepen die dit vak in de opgehaalde periode geven, alfabetisch.
    klasgroepen: string[];
    // Alle lessen van dit vak, bij alle klasgroepen.
    blokken: Lesblok[];
    lessen: number;
}

/**
 * Bundelt de opgehaalde roosters per vak. Eén definitie van "welke vakken geeft
 * mijn shortlist", gedeeld door de OLOD-zoeker en de wizard.
 */
export function vakkenUitRoosters(perKlas: Record<string, Lesblok[]>): VakInRoosters[] {
    const perOlod = new Map<string, { klasgroepen: Set<string>; blokken: Lesblok[] }>();
    for (const bs of Object.values(perKlas)) {
        for (const b of bs) {
            const v = perOlod.get(b.olodNaam);
            if (v) {
                v.klasgroepen.add(b.klasgroep);
                v.blokken.push(b);
            } else {
                perOlod.set(b.olodNaam, { klasgroepen: new Set([b.klasgroep]), blokken: [b] });
            }
        }
    }
    return Array.from(perOlod.entries())
        .map(([olodNaam, v]) => ({
            olodNaam,
            klasgroepen: Array.from(v.klasgroepen).sort((a, b) => a.localeCompare(b)),
            blokken: v.blokken,
            lessen: v.blokken.length,
        }))
        .sort((a, b) => a.olodNaam.localeCompare(b.olodNaam));
}

// ===== Referentieweken =====

/** Eén lesweek uit de periode, met hoeveel lessen de shortlist er samen geeft. */
export interface Lesweek {
    maandag: Date;
    lessen: number;
}

/**
 * De weken waarin de shortlist les geeft, op datum. Weken zonder les (vakantie,
 * blokperiode) komen er niet in: ze zijn nooit een goed ijkpunt.
 */
export function lesweken(perKlas: Record<string, Lesblok[]>): Lesweek[] {
    const perWeek = new Map<number, number>();
    for (const bs of Object.values(perKlas)) {
        for (const b of bs) {
            const ma = mondayOf(b.start).getTime();
            perWeek.set(ma, (perWeek.get(ma) ?? 0) + 1);
        }
    }
    return Array.from(perWeek.entries())
        .sort(([a], [b]) => a - b)
        .map(([ma, lessen]) => ({ maandag: new Date(ma), lessen }));
}

/** De mediaan van een reeks getallen (bij een even aantal het gemiddelde van de twee middelste). */
function mediaan(waarden: number[]): number {
    const s = [...waarden].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Het aantal lessen in een doorsneeweek van deze periode. De wizard zet er de
 * weken naast: merkbaar meer wijst op inhaallessen, merkbaar minder op een
 * feestdag — in beide gevallen een matig ijkpunt.
 */
export function mediaanLessen(weken: Lesweek[]): number {
    return weken.length === 0 ? 0 : mediaan(weken.map(w => w.lessen));
}

/**
 * Het voorstel voor de referentieweken: **twee opeenvolgende** lesweken uit het
 * midden van de periode die het dichtst bij een **gewone** week liggen.
 *
 * Twee weken, omdat een rooster met een even/oneven ritme anders half gelezen
 * wordt, en opeenvolgend omdat net dat ritme dan zichtbaar wordt. Uit het
 * midden, omdat de eerste en de laatste lesweek van een periode vaak atypisch
 * zijn (introductie, inhaallessen, examens).
 *
 * "Gewoon" is hier: zo weinig mogelijk afwijking van het **mediane** aantal
 * lessen. Bewust niet "de meeste lessen": een week met een feestdag telt er
 * minder, maar een week met een eenmalige inhaalles telt er méér — en net die
 * les is de reden dat er met referentieweken gewerkt wordt. De mediaan ligt
 * tussen beide uitschieters in en wijst dus de doorsneeweek aan.
 */
export function standaardWeken(weken: Lesweek[]): Date[] {
    if (weken.length <= 2) return weken.map(w => w.maandag);
    const normaal = mediaan(weken.map(w => w.lessen));
    const kandidaten = weken.slice(1, -1);
    if (kandidaten.length === 1) return [kandidaten[0].maandag];
    const afwijking = (i: number) => Math.abs(kandidaten[i].lessen - normaal);
    let beste = 0;
    let besteAfwijking = Infinity;
    for (let i = 0; i + 1 < kandidaten.length; i++) {
        const afw = afwijking(i) + afwijking(i + 1);
        if (afw < besteAfwijking) {
            besteAfwijking = afw;
            beste = i;
        }
    }
    return [kandidaten[beste].maandag, kandidaten[beste + 1].maandag];
}
