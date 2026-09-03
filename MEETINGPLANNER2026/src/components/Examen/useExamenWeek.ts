import { useCallback, useEffect, useState } from 'react';
import { examenService, foutTekst } from './examenService';
import type { KlasgroepResultaat } from './types';

/**
 * Haalt voor elke klasgroep van de opleiding de blokken van één week op
 * (parallel, via de weekcache van `examenService`). Per klasgroep een eigen
 * resultaat of fout — één klasgroep die faalt mag de rest niet tegenhouden,
 * maar moet wél als "zonder rooster" in het overzicht belanden.
 *
 * Bij een wissel van week of opleiding wordt het vorige resultaat meteen
 * gewist: het rooster van vorige week onder het label van deze week tonen
 * is precies de fout die dit overzicht niet mag maken.
 */
export function useExamenWeek(klasgroepen: string[], weekMaandag: string) {
    const [perKlas, setPerKlas] = useState<Record<string, KlasgroepResultaat>>({});
    // Oudste ophaaltijdstip van de gebruikte klasgroepen: de stempel op het
    // document moet het moment noemen waarop de data zeker nog klopte.
    const [opgehaaldOp, setOpgehaaldOp] = useState<Date | null>(null);
    const [busy, setBusy] = useState(false);
    const [versie, setVersie] = useState(0);

    const sleutel = klasgroepen.join('|');

    useEffect(() => {
        setPerKlas({});
        setOpgehaaldOp(null);
        if (klasgroepen.length === 0) {
            setBusy(false);
            return;
        }
        let cancelled = false;
        setBusy(true);
        Promise.allSettled(klasgroepen.map(k => examenService.getWeek(k, weekMaandag)))
            .then(results => {
                if (cancelled) return;
                const map: Record<string, KlasgroepResultaat> = {};
                let oudste: Date | null = null;
                results.forEach((r, i) => {
                    const k = klasgroepen[i];
                    if (r.status === 'fulfilled') {
                        map[k] = { blokken: r.value.blokken };
                        if (!oudste || r.value.opgehaaldOp.getTime() < oudste.getTime()) {
                            oudste = r.value.opgehaaldOp;
                        }
                    } else {
                        map[k] = { blokken: [], fout: foutTekst(r.reason) };
                    }
                });
                setPerKlas(map);
                setOpgehaaldOp(oudste);
            })
            .finally(() => {
                if (!cancelled) setBusy(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sleutel, weekMaandag, versie]);

    // Verse ophaling van deze week (alle klasgroepen), voorbij de cache.
    const herlaad = useCallback(() => {
        examenService.vergeetWeek(weekMaandag);
        setVersie(v => v + 1);
    }, [weekMaandag]);

    return { perKlas, opgehaaldOp, busy, herlaad };
}
