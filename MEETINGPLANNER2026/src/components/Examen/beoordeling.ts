import { jaccard } from './cluster';
import type { JaargroepOverzicht } from './types';

/**
 * Is de getoonde week voor deze jaargroep wel een examenweek?
 *
 * De tool kan dat niet aan de blokken zelf zien — examens zijn in Untis gewone
 * OLODs. Wat ze wél kan zien: of de klasgroepen van één jaargroep deze week
 * hetzelfde rooster hebben. Dat is precies de belofte van een jaargroep. In een
 * examenweek zitten die klassen samen in dezelfde examens; in een gewone lesweek
 * heeft elke klasgroep haar eigen roosterpuzzel en valt er niets samen te voegen.
 *
 * Lopen de roosters sterk uiteen, dan is het overzicht zinloos druk: ofwel is
 * het geen examenweek, ofwel klopt de jaargroep niet meer. In beide gevallen is
 * stoppen met een uitleg beter dan een onleesbaar raster — de gebruiker kan het
 * altijd overrulen.
 */

// Onder deze gemiddelde paarsgewijze overeenkomst noemen we de roosters
// "totaal verschillend". Bewust laag: enkel duidelijke gevallen tegenhouden.
// Twee identieke klasgroepen naast één afwijkende geeft (1 + 0 + 0) / 3 = 0,33;
// een echte examenweek waarin één klas één examen mist zit rond 0,8.
export const LESWEEK_DREMPEL = 0.34;

export type WeekSoort =
    // De klasgroepen delen hun rooster: toon het raster.
    | 'examenweek'
    // Rooster opgehaald, maar geen enkel blok deze week.
    | 'geen-examens'
    // Roosters lopen sterk uiteen: waarschijnlijk een gewone lesweek.
    | 'lesweek'
    // Geen enkele klasgroep leverde een rooster op.
    | 'geen-rooster'
    // Nog aan het laden.
    | 'onbekend';

export interface Beoordeling {
    soort: WeekSoort;
    /** Gemiddelde paarsgewijze overeenkomst (0–1) tussen klasgroepen mét blokken, of null bij minder dan twee. */
    overeenkomst: number | null;
    /** Klasgroepen met een opgehaald rooster en minstens één blok. */
    metBlokken: string[];
    /** Klasgroepen met een opgehaald maar leeg rooster. */
    zonderBlokken: string[];
}

export function beoordeelJaargroep(o: JaargroepOverzicht): Beoordeling {
    const misluktOfOnbekend = new Set([...o.mislukt, ...o.onbekend]);
    const metRooster = o.jaargroep.klasgroepen.filter(k => !misluktOfOnbekend.has(k));

    // Weeksignatuur per klasgroep: de merge-sleutels van de examens waar ze in zit.
    const sigs = new Map<string, Set<string>>(metRooster.map(k => [k, new Set<string>()]));
    for (const ex of o.examens) {
        for (const d of ex.delen) sigs.get(d.klasgroep)?.add(ex.key);
    }

    const metBlokken = metRooster.filter(k => (sigs.get(k)?.size ?? 0) > 0);
    const zonderBlokken = metRooster.filter(k => (sigs.get(k)?.size ?? 0) === 0);

    // Klasgroepen zonder blokken tellen niet mee in de vergelijking: dat is een
    // eigen signaal (de "leeg"-afwijking), geen bewijs van een lesweek.
    let overeenkomst: number | null = null;
    if (metBlokken.length >= 2) {
        let som = 0;
        let paren = 0;
        for (let i = 0; i < metBlokken.length; i++) {
            for (let j = i + 1; j < metBlokken.length; j++) {
                som += jaccard(sigs.get(metBlokken[i])!, sigs.get(metBlokken[j])!);
                paren++;
            }
        }
        overeenkomst = som / paren;
    }

    const soort: WeekSoort =
        metRooster.length === 0
            ? o.onbekend.length > 0 && o.mislukt.length === 0
                ? 'onbekend'
                : 'geen-rooster'
            : metBlokken.length === 0
              ? 'geen-examens'
              : overeenkomst !== null && overeenkomst < LESWEEK_DREMPEL
                ? 'lesweek'
                : 'examenweek';

    return { soort, overeenkomst, metBlokken, zonderBlokken };
}

/** De overeenkomst als afgerond percentage, voor in een melding. */
export function overeenkomstPct(b: Beoordeling): number | null {
    return b.overeenkomst === null ? null : Math.round(b.overeenkomst * 100);
}

/**
 * Een week is "blended" wanneer sommige jaargroepen examens hebben en andere
 * niet. Dat is een normale situatie (niet elke opleiding examineert dezelfde
 * week), maar ze hoort expliciet vermeld te worden: een leeg raster mag nooit
 * als "vergeten" of "nog niet gepubliceerd" gelezen worden.
 */
export function isBlended(beoordelingen: Beoordeling[]): boolean {
    return (
        beoordelingen.some(b => b.soort === 'examenweek') &&
        beoordelingen.some(b => b.soort === 'geen-examens')
    );
}
