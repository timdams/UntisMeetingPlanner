import { useEffect, useMemo, useState } from 'react';
import { isActief, Lesblok, OLODSelectie, StudentTraject } from './types';
import { trajectUntisService } from './trajectService';
import { academiejaarBereik, type GrenzenInput } from './academicYear';
import {
    detectConflicts,
    effectieveBlokken,
    ghostBlokkenVoor,
    scenarioBlokken,
    wegBlokkenVoor,
} from './conflicts';
import { DAG_HEADERS, datumInBereik, formatTime, periodeBereik } from './dateUtils';
import { selectieKey } from './hooks';

/**
 * Haalt voor elke klasgroep in het traject de lesblokken van het volledige
 * academiejaar op. Eén bron voor het jaaroverzicht (paneel C) én voor de
 * controle in de OLOD-lijst (paneel A) of een selectie wel lessen heeft.
 *
 * Tijdens een herlading (bv. een nieuwe klasgroep erbij) blijft de vorige
 * kaart staan, zodat de statussen van al geladen klasgroepen niet flikkeren.
 */
export function useTrajectBlokken(
    traject: StudentTraject,
    ensureColor: (olodNaam: string) => void,
    // De ingestelde grensdatums bepalen hoe ver het academiejaar loopt; zonder
    // meegegeven grenzen geldt het standaardjaar.
    grenzen?: GrenzenInput
) {
    const [blokkenPerKlas, setBlokkenPerKlas] = useState<Record<string, Lesblok[]>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const jaar = useMemo(() => academiejaarBereik(grenzen), [grenzen]);
    const { van, tot } = useMemo(() => periodeBereik(jaar.van, jaar.tot), [jaar]);

    const klasgroepen = useMemo(
        () => Array.from(new Set(traject.map(s => s.klasgroep))),
        [traject]
    );

    useEffect(() => {
        if (klasgroepen.length === 0) {
            setBlokkenPerKlas({});
            return;
        }
        let cancelled = false;
        setBusy(true);
        setError(null);
        Promise.all(
            klasgroepen.map(k =>
                trajectUntisService
                    .getLesblokken(k, van, tot)
                    .then(bs => [k, bs] as const)
            )
        )
            .then(results => {
                if (cancelled) return;
                const map: Record<string, Lesblok[]> = {};
                results.forEach(([k, bs]) => {
                    map[k] = bs;
                    bs.forEach(b => ensureColor(b.olodNaam));
                });
                setBlokkenPerKlas(map);
            })
            .catch(e => {
                if (cancelled) return;
                // Untis weigert bereiken die nog niet beschikbaar zijn met een
                // 400 (meerdere schooljaren) of 404 (rooster nog niet
                // gepubliceerd); toon testers geen rauwe API-fout.
                const msg: string = e?.message ?? '';
                const nogNietBeschikbaar = msg.includes('400') || msg.includes('404');
                setError(nogNietBeschikbaar ? 'later beschikbaar' : (msg || 'Rooster ophalen mislukt'));
            })
            .finally(() => {
                if (!cancelled) setBusy(false);
            });
        return () => {
            cancelled = true;
        };
    }, [klasgroepen.join('|'), van.getTime(), tot.getTime()]);

    return { blokkenPerKlas, busy, error };
}

// 'geen-lessen'      → het rooster van die periode is gekend, maar bevat geen
//                      enkele les van dit vak bij deze klasgroep (bv. na een
//                      wissel naar een module waarin het vak niet loopt).
// 'niet-beschikbaar' → het rooster van die periode kon (nog) niet opgehaald
//                      worden, dus de controle is niet mogelijk.
export type SelectieStatus = 'geen-lessen' | 'niet-beschikbaar';

/**
 * Bepaalt per selectie of ze effectief lessen oplevert. Selecties waarvan de
 * klasgroep nog niet geladen is krijgen geen status (geen vals alarm tijdens
 * het laden).
 */
export function selectieStatussen(
    traject: StudentTraject,
    blokkenPerKlas: Record<string, Lesblok[]>
): Map<string, SelectieStatus> {
    const out = new Map<string, SelectieStatus>();
    for (const sel of traject) {
        // Een gedeactiveerde selectie hoort bewust niet in het rooster: geen
        // waarschuwing over lessen die toch niet meetellen.
        if (!isActief(sel)) continue;
        const bs = blokkenPerKlas[sel.klasgroep];
        if (!bs) continue;
        if (heeftLessen(sel, bs)) continue;
        const { van, tot } = periodeBereik(sel.van, sel.tot);
        out.set(
            selectieKey(sel),
            trajectUntisService.isDeelsGedekt(sel.klasgroep, van, tot) ? 'geen-lessen' : 'niet-beschikbaar'
        );
    }
    return out;
}

function heeftLessen(sel: OLODSelectie, blokken: Lesblok[]): boolean {
    return blokken.some(b => b.olodNaam === sel.olodNaam && datumInBereik(b.start, sel.van, sel.tot));
}

// Eén kandidaat-klasgroep voor een selectie: hoeveel lessen van het vak ze in
// de periode van de selectie geeft, plus de wekelijkse lesmomenten (voor de
// tooltip). `beschikbaar` is false als haar rooster voor die periode (nog)
// niet opgehaald kon worden — dan zegt `aantal` niets.
export interface KlasgroepAlternatief {
    klasgroep: string;
    aantal: number;
    momenten: string[]; // bv. ["Ma 08:30–10:30", "Do 13:30–15:30"]
    beschikbaar: boolean;
    // De lessen zelf (van het vak, bij deze klasgroep, in de periode) — voedt
    // de wat-als-preview in het studentoverzicht.
    blokken: Lesblok[];
}

// Wat-als-preview: de gebruiker beweegt in een klasgroep-kiezer over een
// andere klasgroep; het studentoverzicht toont dan waar de lessen van de
// verhuizende selecties bij `klasgroep` zouden vallen, vóór de wissel
// effectief gebeurt. `sels` bevat één selectie bij de kiezer per vak, en de
// hele aangevinkte set bij de bulk-kiezer.
export interface KlasgroepPreview {
    sels: OLODSelectie[];
    klasgroep: string;
    blokken: Lesblok[];
}

function alternatiefVoor(klasgroep: string, olodNaam: string, blokken: Lesblok[]): KlasgroepAlternatief {
    const match = blokken
        .filter(b => b.olodNaam === olodNaam)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    // Unieke (weekdag, start–eind)-combinaties, gesorteerd op dag en beginuur.
    const perMoment = new Map<string, { volgorde: number; label: string }>();
    for (const b of match) {
        const dag = (b.start.getDay() + 6) % 7;
        const label = `${DAG_HEADERS[dag] ?? '?'} ${formatTime(b.start)}–${formatTime(b.eind)}`;
        if (!perMoment.has(label)) {
            perMoment.set(label, { volgorde: dag * 24 * 60 + b.start.getHours() * 60 + b.start.getMinutes(), label });
        }
    }
    const momenten = Array.from(perMoment.values())
        .sort((a, b) => a.volgorde - b.volgorde)
        .map(m => m.label);
    return { klasgroep, aantal: match.length, momenten, beschikbaar: true, blokken: match };
}

/**
 * Bepaalt voor een selectie bij welke klasgroepen uit de shortlist hetzelfde
 * vak in dezelfde periode voorkomt — voedt de klasgroep-kiezer in paneel A.
 * Wordt lui opgehaald: enkel zodra een selectie (`sel`) is opengeklapt. De
 * eigen klasgroep van de selectie zit altijd bij de kandidaten, ook als ze
 * niet (meer) in de shortlist staat. Dankzij de range-cache van de adapter
 * komen klasgroepen die al in het traject zitten uit het geheugen.
 *
 * Geeft `null` terug zolang de kandidaten van deze selectie nog laden.
 */
export function useKlasgroepAlternatieven(
    sel: OLODSelectie | null,
    shortlist: string[]
): KlasgroepAlternatief[] | null {
    const [result, setResult] = useState<{ key: string; items: KlasgroepAlternatief[] } | null>(null);

    // De klasgroep zelf hoort niet in de sleutel: na een wissel blijft het
    // resultaat geldig (zelfde vak, zelfde periode, zelfde kandidaten).
    const key = sel ? `${sel.olodNaam}::${sel.van}::${sel.tot}` : null;
    const kandidaten = useMemo(() => {
        const set = new Set(shortlist);
        if (sel) set.add(sel.klasgroep);
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [shortlist.join('|'), sel?.klasgroep]);
    const kandidatenKey = kandidaten.join('|');
    const volledigeKey = key ? `${key}##${kandidatenKey}` : null;

    useEffect(() => {
        if (!sel || !volledigeKey) return;
        let cancelled = false;
        const { van, tot } = periodeBereik(sel.van, sel.tot);
        const olodNaam = sel.olodNaam;
        Promise.all(
            kandidaten.map(k =>
                trajectUntisService
                    .getLesblokken(k, van, tot)
                    .then(bs => alternatiefVoor(k, olodNaam, bs))
                    .catch((): KlasgroepAlternatief => ({ klasgroep: k, aantal: 0, momenten: [], beschikbaar: false, blokken: [] }))
            )
        ).then(items => {
            if (cancelled) return;
            setResult({ key: volledigeKey, items });
        });
        return () => {
            cancelled = true;
        };
    }, [volledigeKey]);

    return result && result.key === volledigeKey ? result.items : null;
}

// Eén kandidaat-klasgroep voor een bulkwissel: hoeveel van de aangevinkte
// vakken ze in hun eigen periode geeft, en hoe het traject eruit zou zien als
// die vakken naar haar verhuizen.
export interface BulkAlternatief {
    klasgroep: string;
    gedekt: number;   // aantal aangevinkte vakken dat deze klasgroep geeft
    totaal: number;   // aantal aangevinkte vakken
    lessen: number;   // aantal lesblokken dat erbij zou komen
    conflicten: number; // totaal aantal conflicten ná de wissel
    beschikbaar: boolean; // false zodra haar rooster niet opgehaald kon worden
    // True wanneer er niets zou veranderen: alle gedekte vakken zitten hier al.
    huidig: boolean;
    // De selecties die effectief van klasgroep veranderen — voedt zowel de
    // wat-als-preview als de wissel zelf.
    verhuizend: OLODSelectie[];
    // De lessen die erbij zouden komen (ghost-blokjes in het overzicht).
    blokken: Lesblok[];
    // Vakken die deze klasgroep in hun periode niet geeft en dus blijven staan.
    ontbrekend: string[];
}

export interface BulkAlternatieven {
    items: BulkAlternatief[];
    // Het aantal conflicten in het traject zoals het nu is — referentiepunt
    // naast de score van elke kandidaat.
    huidigeConflicten: number;
}

/**
 * Scoort elke klasgroep uit de shortlist als doel voor een bulkwissel van de
 * aangevinkte selecties. Voedt de bulk-kiezer in paneel A.
 *
 * De roosters worden lui opgehaald zodra de kiezer opengaat, per kandidaat één
 * keer voor het **volledige academiejaar** — dezelfde range als
 * {@link useTrajectBlokken}, zodat de range-aware cache van de adapter
 * klasgroepen die al in het traject zitten meteen uit het geheugen serveert.
 * Het scoren zelf gebeurt daarna zonder nieuwe fetch, ook na een wissel.
 *
 * Geeft `null` zolang er niets aangevinkt is of de roosters nog laden.
 */
export function useBulkAlternatieven(
    sels: OLODSelectie[] | null,
    shortlist: string[],
    traject: StudentTraject,
    blokkenPerKlas: Record<string, Lesblok[]>,
    grenzen?: GrenzenInput
): BulkAlternatieven | null {
    const [roosters, setRoosters] = useState<{
        key: string;
        perKlas: Record<string, Lesblok[] | null>;
    } | null>(null);

    const jaar = useMemo(() => academiejaarBereik(grenzen), [grenzen]);
    const { van, tot } = useMemo(() => periodeBereik(jaar.van, jaar.tot), [jaar]);

    const actief = sels !== null && sels.length > 0;
    const eigenKlasgroepen = (sels ?? []).map(s => s.klasgroep).sort().join('|');
    const kandidaten = useMemo(() => {
        const set = new Set(shortlist);
        (sels ?? []).forEach(s => set.add(s.klasgroep));
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [shortlist.join('|'), eigenKlasgroepen]);
    const key = `${kandidaten.join('|')}##${van.getTime()}-${tot.getTime()}`;

    useEffect(() => {
        if (!actief) return;
        let cancelled = false;
        Promise.all(
            kandidaten.map(k =>
                trajectUntisService
                    .getLesblokken(k, van, tot)
                    .then(bs => [k, bs] as const)
                    // Rooster (nog) niet beschikbaar: die klasgroep krijgt geen
                    // score in plaats van een vals nulresultaat.
                    .catch(() => [k, null] as const)
            )
        ).then(results => {
            if (cancelled) return;
            const perKlas: Record<string, Lesblok[] | null> = {};
            results.forEach(([k, bs]) => {
                perKlas[k] = bs;
            });
            setRoosters({ key, perKlas });
        });
        return () => {
            cancelled = true;
        };
    }, [actief, key]);

    return useMemo(() => {
        if (!actief || !sels || !roosters || roosters.key !== key) return null;
        const effectieve = effectieveBlokken(traject, blokkenPerKlas, van, tot);
        const huidigeConflicten = detectConflicts(effectieve).length;
        const items = kandidaten.map<BulkAlternatief>(k => {
            const bs = roosters.perKlas[k];
            if (!bs) {
                return {
                    klasgroep: k,
                    gedekt: 0,
                    totaal: sels.length,
                    lessen: 0,
                    conflicten: huidigeConflicten,
                    beschikbaar: false,
                    huidig: false,
                    verhuizend: [],
                    blokken: [],
                    ontbrekend: sels.map(s => s.olodNaam),
                };
            }
            const gedekt = sels.filter(s =>
                bs.some(b => b.olodNaam === s.olodNaam && datumInBereik(b.start, s.van, s.tot))
            );
            // Vakken die hier al zitten veranderen niet van klasgroep: zij
            // horen niet bij de weg- of ghost-blokken van het scenario.
            const verhuizend = gedekt.filter(s => s.klasgroep !== k);
            const weg = wegBlokkenVoor(verhuizend, traject, effectieve);
            const ghost = ghostBlokkenVoor(verhuizend, k, bs, effectieve, van, tot);
            return {
                klasgroep: k,
                gedekt: gedekt.length,
                totaal: sels.length,
                lessen: ghost.length,
                conflicten: detectConflicts(scenarioBlokken(effectieve, weg, ghost)).length,
                beschikbaar: true,
                huidig: verhuizend.length === 0,
                verhuizend,
                blokken: ghost,
                ontbrekend: sels.filter(s => !gedekt.includes(s)).map(s => s.olodNaam),
            };
        });
        return { items, huidigeConflicten };
    }, [actief, sels, roosters, key, traject, blokkenPerKlas, van, tot, kandidaten]);
}
