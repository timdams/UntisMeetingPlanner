// Vakken die samen horen.
//
// Sommige opleidingen geven een groepje OLODs als één geheel: een lab dat je in
// zijn geheel bij één klasgroep volgt. Voor MCS zijn dat bijvoorbeeld de drie
// Sales-vakken — wie het Sales-lab volgt, volgt Accountmanagement, Markt en
// klant én Salestechnieken bij dezelfde klasgroep. De wizard koos vroeger per
// vak los een klasgroep en stelde dus geldig ogende roosters voor waarin één
// labvak bij een andere klasgroep zat.
//
// Twee dingen zijn hier bewust zo gebouwd:
//
//  1. **Nooit een naamregel tijdens het rekenen.** Er wordt uitsluitend een
//     expliciete, bewaarde lijst groepen gelezen. Het herkennen van groepen aan
//     de naam (alles vóór de dubbele punt) is enkel een *suggestieknop* in de
//     wizard: de gebruiker ziet en bevestigt wat er in de lijst komt. Zo kan
//     een naamgevingsafspraak van één opleiding nooit het voorstel van een
//     andere opleiding sturen. Staat de schakelaar uit of is de lijst leeg —
//     de toestand van elke bestaande gebruiker — dan verandert er niets.
//
//  2. **Een groep is één keuze, geen weging.** De groep gaat als één variabele
//     naar de solver, met als kandidaten enkel de klasgroepen die *alle*
//     aangevinkte leden geven. De koppeling kan dus niet wegwegen tegen een
//     botsing: botst er iets, dan moet het andere vak wijken. Kan het niet, dan
//     wordt de groep niet geplaatst en zegt de wizard waarom — liever geen
//     antwoord dan een stil gesplitst lab.
//
// De lijst zelf zit in TrajectSettings, zodat ze meereist met een back-up, een
// bewaard traject, een profiel en de deel-link. Zie ook semesterOlods.ts, dat
// op dezelfde manier een eigenschap van de opleiding bijhoudt.

import { bereikRaakt } from './dateUtils';
import { isActief, type Lesblok, type OLODSelectie, type StudentTraject } from './types';
import type { VakInRoosters, VoorstelVak } from './trajectVoorstel';

/** Een groep vakken die samen bij één klasgroep gevolgd moeten worden. */
export interface Koppelgroep {
    // De naam waaronder de groep in de wizard staat, bv. "Sales". Ze dient enkel
    // als label en als sleutel; ze hoeft met niets in Untis overeen te komen.
    naam: string;
    // De volledige OLOD-namen die tot de groep behoren.
    olods: string[];
}

export interface KoppelInstellingen {
    // Hoofdschakelaar. Staat ze uit, dan wordt de lijst genegeerd (maar niet
    // gewist): je kan de koppeling even uitzetten zonder je groepen kwijt te
    // spelen.
    actief: boolean;
    groepen: Koppelgroep[];
    // Ook over periodes heen dezelfde klasgroep: staat het lab in M1 bij D1,
    // dan mag de wizard het in M3 niet naar D7 verhuizen.
    overPeriodes: boolean;
}

/** Geen enkele koppeling — de standaard, en wat elke bestaande opslag oplevert. */
export const GEEN_KOPPELING: KoppelInstellingen = {
    actief: false,
    groepen: [],
    overPeriodes: false,
};

/** Het teken dat de suggestieknop gebruikt om een groepsnaam af te bakenen. */
const SCHEIDINGSTEKEN = ':';

/** Onder dit aantal leden is een groep zinloos: één vak koppelt aan niets. */
const MIN_LEDEN = 2;

const opNaam = (a: string, b: string) => a.localeCompare(b);

/**
 * Maakt van willekeurige opgeslagen data een bruikbare set koppelinstellingen.
 * Alles wat niet klopt verdwijnt stil: een groep zonder naam, een groep met
 * minder dan {@link MIN_LEDEN} vakken, een vak dat in twee groepen tegelijk zou
 * zitten (de eerste groep houdt het). Zo levert oudere opslag — waarin dit veld
 * gewoon ontbreekt — netjes {@link GEEN_KOPPELING} op.
 */
export function normalizeKoppelInstellingen(raw: unknown): KoppelInstellingen {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const groepen: Koppelgroep[] = [];
    const namen = new Set<string>();
    const bezet = new Set<string>();
    if (Array.isArray(r.groepen)) {
        for (const item of r.groepen) {
            const g = (item && typeof item === 'object' ? item : null) as Record<
                string,
                unknown
            > | null;
            if (!g || typeof g.naam !== 'string' || !Array.isArray(g.olods)) continue;
            const naam = g.naam.trim();
            if (!naam || namen.has(naam)) continue;
            const olods: string[] = [];
            for (const o of g.olods) {
                if (typeof o !== 'string') continue;
                const olod = o.trim();
                if (!olod || bezet.has(olod) || olods.includes(olod)) continue;
                olods.push(olod);
            }
            if (olods.length < MIN_LEDEN) continue;
            olods.sort(opNaam);
            olods.forEach(o => bezet.add(o));
            namen.add(naam);
            groepen.push({ naam, olods });
        }
    }
    groepen.sort((a, b) => opNaam(a.naam, b.naam));
    return {
        actief: r.actief === true,
        groepen,
        overPeriodes: r.overPeriodes === true,
    };
}

/** Doet de koppeling nu effectief iets? Zonder groepen valt er niets te koppelen. */
export function koppelingActief(inst: KoppelInstellingen): boolean {
    return inst.actief && inst.groepen.length > 0;
}

/** De groep waar dit vak in zit, of null. Geeft null zodra de schakelaar uit staat. */
export function groepVoorOlod(olodNaam: string, inst: KoppelInstellingen): Koppelgroep | null {
    if (!koppelingActief(inst)) return null;
    return inst.groepen.find(g => g.olods.includes(olodNaam)) ?? null;
}

/** Zet een groep in de lijst (op naam vervangen) en normaliseert het resultaat. */
export function metGroep(inst: KoppelInstellingen, groep: Koppelgroep): KoppelInstellingen {
    return normalizeKoppelInstellingen({
        ...inst,
        groepen: [...inst.groepen.filter(g => g.naam !== groep.naam), groep],
    });
}

/** Haalt een groep uit de lijst. */
export function zonderGroep(inst: KoppelInstellingen, naam: string): KoppelInstellingen {
    return normalizeKoppelInstellingen({
        ...inst,
        groepen: inst.groepen.filter(g => g.naam !== naam),
    });
}

/**
 * Groepen die de namen zelf suggereren: alles vóór de eerste dubbele punt is de
 * groepsnaam ("Sales: Salestechnieken" wordt "Sales"), en vanaf {@link MIN_LEDEN}
 * vakken met dezelfde kop is dat een voorstel.
 *
 * Uitdrukkelijk enkel een *voorstel*: de dubbele punt is een afspraak van één
 * opleiding, niet van de tool. Het resultaat gaat naar een lijstje dat de
 * gebruiker aan- of afvinkt; het rekenwerk kijkt nooit naar namen.
 */
export function stelGroepenVoor(olodNamen: readonly string[]): Koppelgroep[] {
    const perKop = new Map<string, string[]>();
    for (const naam of olodNamen) {
        const i = naam.indexOf(SCHEIDINGSTEKEN);
        if (i <= 0) continue;
        const kop = naam.slice(0, i).trim();
        const staart = naam.slice(i + 1).trim();
        if (!kop || !staart) continue;
        const lijst = perKop.get(kop);
        if (lijst) lijst.push(naam);
        else perKop.set(kop, [naam]);
    }
    return Array.from(perKop.entries())
        .filter(([, olods]) => olods.length >= MIN_LEDEN)
        .map(([naam, olods]) => ({ naam, olods: [...olods].sort(opNaam) }))
        .sort((a, b) => opNaam(a.naam, b.naam));
}

/**
 * De koppelinstellingen als vergelijkbare string, voor de vingerafdrukken van
 * een profiel en van een traject: groepen aanduiden verandert wat een voorstel
 * mag, en telt dus als niet-bewaard werk.
 */
export function koppelVingerafdruk(inst: KoppelInstellingen): string {
    const g = normalizeKoppelInstellingen(inst);
    if (!g.actief && g.groepen.length === 0) return '';
    return [
        g.actief ? 'aan' : 'uit',
        g.overPeriodes ? 'jaar' : 'periode',
        ...g.groepen.map(x => `${x.naam}>${x.olods.join('+')}`),
    ].join('|');
}

/**
 * Zet deze vakken samen in één groep — de handmatige weg: twee vakken op
 * elkaar slepen (of aanklikken) en bevestigen.
 *
 * Bestaat `naam` al, dan komen ze erbij; anders ontstaat de groep. Een vak dat
 * eerder in een ándere groep zat, verhuist: het hoort maar bij één groep tegelijk,
 * en zonder dit expliciet weg te halen zou het bij het normaliseren stil bij de
 * eerste groep blijven hangen.
 */
export function koppelSamen(
    inst: KoppelInstellingen,
    naam: string,
    olods: readonly string[]
): KoppelInstellingen {
    const schoon = naam.trim();
    const nieuw = olods.map(o => o.trim()).filter(Boolean);
    if (!schoon || nieuw.length === 0) return inst;

    const zonder = inst.groepen.map(g => ({
        ...g,
        olods: g.olods.filter(o => !nieuw.includes(o)),
    }));
    const bestaand = zonder.find(g => g.naam === schoon);
    const samen: Koppelgroep = {
        naam: schoon,
        olods: Array.from(new Set([...(bestaand?.olods ?? []), ...nieuw])),
    };
    return normalizeKoppelInstellingen({
        ...inst,
        groepen: [...zonder.filter(g => g.naam !== schoon), samen],
    });
}

/**
 * Een naam die deze vakken zelf al suggereren, of "" wanneer er niets zinnigs
 * te vinden is (dan typt de gebruiker er zelf een). Eerst de kop vóór de dubbele
 * punt wanneer ze die delen; anders het stuk tekst waarmee ze allemaal beginnen,
 * afgeknipt op een woordgrens zodat er geen half woord overblijft.
 */
export function voorstelNaam(olods: readonly string[]): string {
    if (olods.length === 0) return '';
    const koppen = olods.map(o => {
        const i = o.indexOf(SCHEIDINGSTEKEN);
        return i > 0 ? o.slice(0, i).trim() : null;
    });
    const eerste = koppen[0];
    if (eerste && koppen.every(k => k === eerste)) return eerste;

    let gemeen = olods[0];
    for (const o of olods.slice(1)) {
        let i = 0;
        while (i < gemeen.length && i < o.length && gemeen[i] === o[i]) i++;
        gemeen = gemeen.slice(0, i);
    }
    // Op een woordgrens afknippen: "Sales: Sales" mag geen "Sales: Sale" worden.
    const grens = Math.max(...[' ', ':', '-', '–', '/'].map(t => gemeen.lastIndexOf(t)));
    const kort = (grens > 0 ? gemeen.slice(0, grens) : gemeen).trim();
    return kort.length >= 3 ? kort : '';
}

/** Zijn dit exact dezelfde leden? Voedt "deze groep staat al in je lijst". */
export function zelfdeLeden(a: Koppelgroep, b: Koppelgroep): boolean {
    return a.olods.length === b.olods.length && a.olods.every(o => b.olods.includes(o));
}

// ===== De puzzel opbouwen =====

/** Waarom een groep niet geplaatst kon worden. */
export type OnmogelijkReden =
    // Geen enkele klasgroep uit de shortlist geeft álle aangevinkte leden.
    | 'geen-gemeenschappelijke-klasgroep'
    // Wel een gemeenschappelijke klasgroep, maar geen van hun lessen valt in de
    // gekozen referentieweken — hetzelfde geval als een los vak zonder les.
    | 'geen-les'
    // De groep ligt in een andere periode al bij een klasgroep vast (de
    // instelling "ook in de andere periodes dezelfde klasgroep"), en net die
    // klasgroep geeft niet alle aangevinkte leden.
    | 'vast-elders';

/** Een groep die de wizard niet kon plaatsen, met wat eraan scheelt. */
export interface OnmogelijkeGroep {
    naam: string;
    // De aangevinkte leden — niet noodzakelijk de hele groep: wie een
    // vrijstelling heeft, vinkt er maar twee van de drie aan.
    olods: string[];
    reden: OnmogelijkReden;
    // Per klasgroep welke van de aangevinkte leden ze wél geeft, best gedekt
    // eerst. Zo zie je meteen of het aan een ontbrekend vak of aan je shortlist
    // ligt. Leeg bij 'geen-les'.
    dekking: { klasgroep: string; olods: string[] }[];
    // Bij 'vast-elders': de klasgroep die elders vastligt.
    vast?: string;
}

/** De puzzel zoals ze aan de solver gegeven wordt, plus wat er buiten viel. */
export interface PuzzelInvoer {
    mee: VoorstelVak[];
    // Losse vakken zonder les in de referentieweken.
    zonderLes: string[];
    onmogelijk: OnmogelijkeGroep[];
}

/**
 * Zet de aangevinkte vakken om in keuzevariabelen voor de solver: losse vakken
 * blijven één variabele per vak, en elke groep met minstens twee aangevinkte
 * leden wordt er samen één.
 *
 * De kandidaten van een groep zijn de klasgroepen die alle aangevinkte leden
 * geven **over de volledige periode**, niet over de referentieweken. Dat is
 * bewust: geeft D1 in de twee ijkweken toevallig maar twee van de drie labvakken
 * (een les die uitvalt, een lab dat om de week draait), dan is D1 daarom nog
 * altijd de klasgroep waar je het hele lab volgt. De referentieweken bepalen
 * enkel welke lessen meetellen in het botsings- en compactheidsrekenwerk.
 *
 * Eén bewaking daarbij: een kandidaat zonder één enkele les in de ijkweken valt
 * af. Zo'n klasgroep zou anders met nul botsingen en nul lesdagen de puzzel
 * winnen — een blind voorstel op lessen die je niet ziet.
 */
export function bouwPuzzel(
    vakken: readonly VakInRoosters[],
    gekozen: ReadonlySet<string>,
    inWeken: (b: Lesblok) => boolean,
    inst: KoppelInstellingen,
    vast?: ReadonlyMap<string, string>
): PuzzelInvoer {
    const mee: VoorstelVak[] = [];
    const zonderLes: string[] = [];
    const onmogelijk: OnmogelijkeGroep[] = [];

    // De aangevinkte vakken verdelen over hun groep, of over "los".
    const los: VakInRoosters[] = [];
    const perGroep = new Map<string, VakInRoosters[]>();
    for (const vak of vakken) {
        if (!gekozen.has(vak.olodNaam)) continue;
        const groep = groepVoorOlod(vak.olodNaam, inst);
        if (!groep) {
            los.push(vak);
            continue;
        }
        const lijst = perGroep.get(groep.naam);
        if (lijst) lijst.push(vak);
        else perGroep.set(groep.naam, [vak]);
    }

    // Een groep waarvan maar één lid aangevinkt staat, koppelt aan niets: die
    // hoort gewoon als los vak in de puzzel (denk aan twee vrijstellingen).
    for (const [naam, leden] of Array.from(perGroep.entries())) {
        if (leden.length < MIN_LEDEN) {
            los.push(...leden);
            perGroep.delete(naam);
        }
    }

    for (const vak of los) {
        const opties = vak.klasgroepen
            .map(kg => ({
                klasgroep: kg,
                blokken: vak.blokken.filter(b => b.klasgroep === kg && inWeken(b)),
            }))
            .filter(o => o.blokken.length > 0);
        if (opties.length === 0) zonderLes.push(vak.olodNaam);
        else mee.push({ olodNaam: vak.olodNaam, opties });
    }

    for (const [naam, leden] of perGroep) {
        const olods = leden.map(v => v.olodNaam).sort(opNaam);

        // De klasgroepen die álle aangevinkte leden geven.
        let gemeen = leden[0].klasgroepen.filter(kg =>
            leden.every(v => v.klasgroepen.includes(kg))
        );
        if (gemeen.length === 0) {
            onmogelijk.push({
                naam,
                olods,
                reden: 'geen-gemeenschappelijke-klasgroep',
                dekking: dekkingVan(leden),
            });
            continue;
        }

        const vastKg = vast?.get(naam);
        if (vastKg) {
            if (!gemeen.includes(vastKg)) {
                onmogelijk.push({
                    naam,
                    olods,
                    reden: 'vast-elders',
                    dekking: dekkingVan(leden),
                    vast: vastKg,
                });
                continue;
            }
            gemeen = [vastKg];
        }

        const opties = gemeen
            .map(kg => ({
                klasgroep: kg,
                blokken: leden.flatMap(v => v.blokken.filter(b => b.klasgroep === kg && inWeken(b))),
            }))
            .filter(o => o.blokken.length > 0);
        if (opties.length === 0) {
            onmogelijk.push({ naam, olods, reden: 'geen-les', dekking: [] });
            continue;
        }

        mee.push({ olodNaam: naam, leden: olods, opties });
    }

    return { mee, zonderLes, onmogelijk };
}

/** Per klasgroep welke van deze vakken ze geeft, best gedekt eerst. */
function dekkingVan(leden: readonly VakInRoosters[]): { klasgroep: string; olods: string[] }[] {
    const perKlas = new Map<string, string[]>();
    for (const vak of leden) {
        for (const kg of vak.klasgroepen) {
            const lijst = perKlas.get(kg);
            if (lijst) lijst.push(vak.olodNaam);
            else perKlas.set(kg, [vak.olodNaam]);
        }
    }
    return Array.from(perKlas.entries())
        .map(([klasgroep, olods]) => ({ klasgroep, olods: olods.sort(opNaam) }))
        .sort((a, b) => b.olods.length - a.olods.length || opNaam(a.klasgroep, b.klasgroep));
}

/**
 * Alle OLOD-namen die de puzzel niet invult. Hun bestaande keuze in het traject
 * moet blijven staan: een voorstel overnemen mag geen keuze opeten die de
 * wizard zelf niet kan maken.
 */
export function nietGeplaatst(puzzel: PuzzelInvoer): string[] {
    return [...puzzel.zonderLes, ...puzzel.onmogelijk.flatMap(g => g.olods)];
}

// ===== Een groep die uit elkaar ligt =====

/** Waar de rest van de groep staat, wanneer dat niet dezelfde klasgroep is. */
export interface GesplitsteGroep {
    groep: Koppelgroep;
    // Per andere klasgroep de vakken van deze groep die daar staan.
    elders: { klasgroep: string; olods: string[] }[];
}

/**
 * Ligt de groep van deze selectie in dezelfde periode over meerdere klasgroepen
 * verspreid? Dan klopt het traject niet: een lab volg je in zijn geheel bij één
 * klasgroep.
 *
 * De wizard kan dit niet meer veroorzaken, maar met de hand klikken, een
 * geïmporteerde back-up of een ouder dossier wel — vandaar dezelfde controle op
 * de lijst zelf. Enkel **actieve** keuzes tellen mee; een geparkeerde keuze is
 * een scenario, geen tegenspraak.
 */
export function gesplitsteGroep(
    traject: StudentTraject,
    sel: OLODSelectie,
    inst: KoppelInstellingen
): GesplitsteGroep | null {
    const groep = groepVoorOlod(sel.olodNaam, inst);
    if (!groep || !isActief(sel)) return null;

    const perKlas = new Map<string, string[]>();
    for (const x of traject) {
        if (!isActief(x) || x.klasgroep === sel.klasgroep) continue;
        if (!groep.olods.includes(x.olodNaam)) continue;
        // Strikte overlap: twee periodes die enkel hun grensdag delen, staan
        // los van elkaar — een lab mag in M3 gerust bij een andere klasgroep
        // zitten dan in M1.
        if (!bereikRaakt(x.van, x.tot, sel.van, sel.tot)) continue;
        const lijst = perKlas.get(x.klasgroep);
        if (lijst && !lijst.includes(x.olodNaam)) lijst.push(x.olodNaam);
        else if (!lijst) perKlas.set(x.klasgroep, [x.olodNaam]);
    }
    if (perKlas.size === 0) return null;

    return {
        groep,
        elders: Array.from(perKlas.entries())
            .map(([klasgroep, olods]) => ({ klasgroep, olods: olods.sort(opNaam) }))
            .sort((a, b) => opNaam(a.klasgroep, b.klasgroep)),
    };
}

/**
 * De andere actieve keuzes van dezelfde groep in dezelfde periode die nog niet
 * bij `klasgroep` staan — wat er dus mee zou moeten verhuizen.
 */
export function groepsgenoten(
    traject: StudentTraject,
    sel: OLODSelectie,
    inst: KoppelInstellingen,
    klasgroep: string
): OLODSelectie[] {
    const groep = groepVoorOlod(sel.olodNaam, inst);
    if (!groep) return [];
    return traject.filter(
        x =>
            isActief(x) &&
            x.olodNaam !== sel.olodNaam &&
            x.klasgroep !== klasgroep &&
            groep.olods.includes(x.olodNaam) &&
            bereikRaakt(x.van, x.tot, sel.van, sel.tot)
    );
}

// ===== Over periodes heen =====

export interface VastElders {
    // Per groepsnaam de klasgroep die in andere periodes al vastligt.
    vast: Map<string, string>;
    // Groepen die in andere periodes zelf al bij meerdere klasgroepen staan:
    // daar valt niets af te dwingen, wel iets over te zeggen.
    verdeeld: { naam: string; klasgroepen: string[] }[];
}

/**
 * Waar de groepen elders in het jaar al vastliggen, voor de instelling "ook in
 * de andere periodes dezelfde klasgroep".
 *
 * Enkel **actieve** keuzes buiten de huidige periode tellen: een gedeactiveerde
 * keuze is een geparkeerd scenario en mag geen nieuwe puzzel dichttimmeren.
 */
export function vasteKlasgroepen(
    traject: StudentTraject,
    inst: KoppelInstellingen,
    huidigBereik: { van: string; tot: string }
): VastElders {
    const leeg: VastElders = { vast: new Map(), verdeeld: [] };
    if (!koppelingActief(inst) || !inst.overPeriodes) return leeg;

    const perGroep = new Map<string, Set<string>>();
    const telt = (sel: OLODSelectie) =>
        isActief(sel) && !bereikRaakt(sel.van, sel.tot, huidigBereik.van, huidigBereik.tot);
    for (const sel of traject) {
        if (!telt(sel)) continue;
        const groep = groepVoorOlod(sel.olodNaam, inst);
        if (!groep) continue;
        const set = perGroep.get(groep.naam);
        if (set) set.add(sel.klasgroep);
        else perGroep.set(groep.naam, new Set([sel.klasgroep]));
    }

    const vast = new Map<string, string>();
    const verdeeld: { naam: string; klasgroepen: string[] }[] = [];
    for (const [naam, set] of perGroep) {
        const klasgroepen = Array.from(set).sort(opNaam);
        if (klasgroepen.length === 1) vast.set(naam, klasgroepen[0]);
        else verdeeld.push({ naam, klasgroepen });
    }
    return { vast, verdeeld };
}
