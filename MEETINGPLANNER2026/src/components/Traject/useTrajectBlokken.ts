import { useEffect, useMemo, useState } from 'react';
import { Lesblok, OLODSelectie, StudentTraject } from './types';
import { trajectUntisService } from './trajectService';
import { academiejaarBereik } from './academicYear';
import { datumInBereik, periodeBereik } from './dateUtils';
import { selectieKey } from './hooks';

/**
 * Haalt voor elke klasgroep in het traject de lesblokken van het volledige
 * academiejaar op. Eén bron voor het jaaroverzicht (paneel C) én voor de
 * controle in de OLOD-lijst (paneel A) of een selectie wel lessen heeft.
 *
 * Tijdens een herlading (bv. een nieuwe klasgroep erbij) blijft de vorige
 * kaart staan, zodat de statussen van al geladen klasgroepen niet flikkeren.
 */
export function useTrajectBlokken(traject: StudentTraject, ensureColor: (olodNaam: string) => void) {
    const [blokkenPerKlas, setBlokkenPerKlas] = useState<Record<string, Lesblok[]>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const jaar = useMemo(() => academiejaarBereik(), []);
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
