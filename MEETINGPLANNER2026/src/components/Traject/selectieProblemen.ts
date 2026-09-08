import { actievePeriode, allePeriodes } from './academicYear';
import { selectieKey } from './hooks';
import type { OLODSelectie, StudentTraject, TrajectSettings } from './types';

/**
 * De velden waartegen een selectie afgetoetst wordt. Bewust enkel deze drie en
 * niet de volledige `TrajectSettings`: zo kan dezelfde controle ook op een
 * *ander* profiel losgelaten worden ("wat klopt er straks niet meer als ik
 * daarnaartoe wissel?"), niet enkel op de set die nu actief is.
 */
export type SetInstellingen = Pick<
    TrajectSettings,
    'mijnOpleidingKlasgroepen' | 'periodeType' | 'periodeGrenzen'
>;

// Waarin een selectie botst met de instellingen waaronder ze nu bekeken wordt.
// Alle drie ontstaan op dezelfde manier: de keuze is gemaakt onder één set
// (klasgroepen + grensdatums + indeling) en wordt gelezen onder een andere —
// na een profielwissel waarbij het traject behouden bleef, maar evengoed na een
// back-up-import, een geopend dossier of een grensdatum die met de hand
// verzet is.
//
// 'klasgroep-buiten-lijst' → de klasgroep van de selectie staat niet in de
//                            shortlist van deze set: haar rooster is hier niet
//                            te openen, dus het vak is niet meer na te kijken.
// 'periode-onbekend'       → het bereik valt op geen enkele periodegrens van
//                            deze set (andere grensdatums, of een bereik uit
//                            oudere opslag dat het hele jaar beslaat).
// 'module-in-semesterset'  → het bereik is één module, terwijl deze set per
//                            semester werkt: het vak stopt halverwege, en de
//                            periode-kiezer staat in semestermodus niet open om
//                            dat recht te zetten.
export type SelectieProbleem =
    | 'klasgroep-buiten-lijst'
    | 'periode-onbekend'
    | 'module-in-semesterset';

/**
 * Wat er aan één selectie niet klopt onder `set`. Lege lijst = in orde.
 *
 * Bewust ook voor **gedeactiveerde** selecties: anders dan de lessencontrole
 * ({@link selectieStatussen}) gaat het hier niet over lessen in het rooster
 * maar over de keuze zelf, en die verwijst evengoed naar een klasgroep of een
 * periode die deze set niet kent wanneer ze geparkeerd staat.
 */
export function selectieProblemen(sel: OLODSelectie, set: SetInstellingen): SelectieProbleem[] {
    const problemen: SelectieProbleem[] = [];

    // Een lege shortlist is geen oordeel maar een lege set (een verse browser,
    // of instellingen die nog ingevuld moeten worden): dan zou élk vak een
    // waarschuwing krijgen, en dat zegt niets.
    if (
        set.mijnOpleidingKlasgroepen.length > 0 &&
        !set.mijnOpleidingKlasgroepen.includes(sel.klasgroep)
    ) {
        problemen.push('klasgroep-buiten-lijst');
    }

    // Tegen álle benoemde periodes van deze set, niet enkel die van haar
    // indeling: in modulemodus is een volledig semester een geldige keuze (zo
    // staat een semestervak in het traject).
    const periode = actievePeriode(allePeriodes(set.periodeGrenzen), sel.van, sel.tot);
    if (!periode) problemen.push('periode-onbekend');
    else if (set.periodeType === 'semester' && periode.id.startsWith('M')) {
        problemen.push('module-in-semesterset');
    }

    return problemen;
}

/**
 * Dezelfde controle over het hele traject, als kaart op {@link selectieKey} —
 * dezelfde vorm als de statuskaart van paneel ③, zodat de lijst er per rij in
 * kan opzoeken. Selecties zonder problemen staan er niet in.
 */
export function trajectProblemen(
    traject: StudentTraject,
    set: SetInstellingen
): Map<string, SelectieProbleem[]> {
    const out = new Map<string, SelectieProbleem[]>();
    for (const sel of traject) {
        const problemen = selectieProblemen(sel, set);
        if (problemen.length > 0) out.set(selectieKey(sel), problemen);
    }
    return out;
}

/**
 * Hoeveel vakken er onder `set` een waarschuwing zouden krijgen. Voedt de
 * profielwissel-dialoog (wat kost het om het traject te behouden?) en het
 * strookje boven de OLOD-lijst.
 */
export function aantalMetProbleem(traject: StudentTraject, set: SetInstellingen): number {
    return traject.reduce((n, sel) => n + (selectieProblemen(sel, set).length > 0 ? 1 : 0), 0);
}
