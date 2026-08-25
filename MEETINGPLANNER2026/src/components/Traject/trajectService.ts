import { untisService } from '../../services/UntisService';
import { ClassGroup, RosterEntry } from '../../types';
import { Lesblok, TrajectUntisService } from './types';

interface Interval {
    van: number;
    tot: number;
}

// Per klasgroep bewaren we welke tijdsintervallen effectief opgehaald zijn.
// Vroeger was dit één unie-bereik (min van, max tot), maar wie eerst module 2
// en daarna module 4 bekijkt, kreeg zo het nooit-opgehaalde module 3 leeg uit
// de cache. Enkel een aanvraag die volledig binnen één gedekt interval valt
// wordt uit het geheugen geserveerd.
interface RangeCache {
    intervals: Interval[];
    blokken: Lesblok[];
}

// Opeenvolgende periodes verschillen 1 ms (23:59:59.999 → 00:00:00.000);
// intervallen die zo dicht op elkaar aansluiten tellen als één geheel.
const INTERVAL_JOIN_TOLERANCE_MS = 1000;

function voegIntervalToe(intervals: Interval[], nieuw: Interval): Interval[] {
    const out: Interval[] = [];
    let cur = { ...nieuw };
    for (const iv of intervals) {
        const raakt =
            iv.van <= cur.tot + INTERVAL_JOIN_TOLERANCE_MS &&
            cur.van <= iv.tot + INTERVAL_JOIN_TOLERANCE_MS;
        if (raakt) {
            cur = { van: Math.min(cur.van, iv.van), tot: Math.max(cur.tot, iv.tot) };
        } else {
            out.push(iv);
        }
    }
    out.push(cur);
    return out.sort((a, b) => a.van - b.van);
}

function isGedekt(intervals: Interval[], van: number, tot: number): boolean {
    return intervals.some(iv => iv.van <= van && iv.tot >= tot);
}

// Het deel van de aanvraag [van, tot] dat een (op de middag afgebakend)
// schooljaarsegment effectief dekt: van 00:00 op de eerste segmentdag t/m
// 23:59:59.999 op de laatste, geknipt op de aanvraag zelf.
function segmentDekking(seg: { van: Date; tot: Date }, van: Date, tot: Date): Interval {
    const dagStart = new Date(seg.van.getFullYear(), seg.van.getMonth(), seg.van.getDate(), 0, 0, 0, 0);
    const dagEind = new Date(seg.tot.getFullYear(), seg.tot.getMonth(), seg.tot.getDate(), 23, 59, 59, 999);
    return {
        van: Math.max(van.getTime(), dagStart.getTime()),
        tot: Math.min(tot.getTime(), dagEind.getTime()),
    };
}

// Untis weigert (400 MULTIPLE_SCHOOLYEARS_IN_RANGE) zodra één request meer dan
// één schooljaar omspant. De cutoff naar het nieuwe academiejaar ligt op
// 21 september — vanaf dan telt een datum bij het volgende schooljaar. Een
// semesterbereik kan over die grens heen lopen, dus splitsen we het bereik op
// 21 september en bevragen we elk segment apart.
//
// We mikken de segmentgrenzen op 12:00 lokaal: getRoster serialiseert met
// toISOString() (UTC), en vanaf het middaguur blijft de kalenderdatum in elke
// realistische tijdzone gelijk — zo valt de splitsing exact op 21 september
// zonder off-by-one.
const SCHOOLJAAR_CUTOFF_MAAND = 8; // maand 8 = september
const SCHOOLJAAR_CUTOFF_DAG = 21;

function atNoon(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function schooljaarGrensNa(d: Date): Date {
    const cutoffDitJaar = new Date(d.getFullYear(), SCHOOLJAAR_CUTOFF_MAAND, SCHOOLJAAR_CUTOFF_DAG, 12, 0, 0, 0);
    return d.getTime() < cutoffDitJaar.getTime()
        ? cutoffDitJaar
        : new Date(d.getFullYear() + 1, SCHOOLJAAR_CUTOFF_MAAND, SCHOOLJAAR_CUTOFF_DAG, 12, 0, 0, 0);
}

function splitOpSchooljaar(van: Date, tot: Date): Array<{ van: Date; tot: Date }> {
    const segments: Array<{ van: Date; tot: Date }> = [];
    const eind = atNoon(tot);
    let segStart = atNoon(van);
    while (segStart.getTime() <= eind.getTime()) {
        const syEnd = new Date(schooljaarGrensNa(segStart)); // cutoff van het volgende schooljaar
        syEnd.setDate(syEnd.getDate() - 1);                  // → laatste dag van dit schooljaar (20 sep)
        const segEnd = syEnd.getTime() < eind.getTime() ? syEnd : eind;
        segments.push({ van: segStart, tot: segEnd });
        segStart = new Date(segEnd);
        segStart.setDate(segStart.getDate() + 1);
    }
    return segments;
}

class TrajectUntisAdapter implements TrajectUntisService {
    private classCache: ClassGroup[] | null = null;
    private classesInflight: Promise<ClassGroup[]> | null = null;
    private rangeByKlasgroep = new Map<string, RangeCache>();
    private inflight = new Map<string, Promise<Lesblok[]>>();

    private async classes(): Promise<ClassGroup[]> {
        if (this.classCache) return this.classCache;
        // Dedupe concurrent callers: meerdere klasgroep-kolommen vragen tegelijk
        // de klassenlijst op. Zonder deze guard vuren we identieke filter-requests
        // parallel af, wat Untis met een 400 beantwoordt.
        if (!this.classesInflight) {
            this.classesInflight = untisService.getClasses()
                .then(cs => {
                    this.classCache = cs;
                    return cs;
                })
                .finally(() => {
                    this.classesInflight = null;
                });
        }
        return this.classesInflight;
    }

    async getKlasgroepen(): Promise<string[]> {
        const cs = await this.classes();
        return cs.map(c => c.displayName).sort((a, b) => a.localeCompare(b));
    }

    async getLesblokken(klasgroep: string, van: Date, tot: Date): Promise<Lesblok[]> {
        const cached = this.rangeByKlasgroep.get(klasgroep);
        if (cached && isGedekt(cached.intervals, van.getTime(), tot.getTime())) {
            return this.slice(cached.blokken, van, tot);
        }

        const key = `${klasgroep}|${van.toISOString()}|${tot.toISOString()}`;
        const existing = this.inflight.get(key);
        if (existing) return existing;

        const promise = this.fetchAndStore(klasgroep, van, tot);
        this.inflight.set(key, promise);
        try {
            return await promise;
        } finally {
            this.inflight.delete(key);
        }
    }

    private async fetchAndStore(klasgroep: string, van: Date, tot: Date): Promise<Lesblok[]> {
        const cs = await this.classes();
        const match = cs.find(c => c.displayName === klasgroep);
        if (!match) return [];

        // Splits het bereik op schooljaargrenzen: één segment binnen één
        // schooljaar → één call (ongewijzigd gedrag); een semester over
        // 21 september heen → meerdere calls die Untis wél accepteert.
        const segmenten = splitOpSchooljaar(van, tot);
        const perSegment = await Promise.allSettled(
            segmenten.map(seg => untisService.getRoster(match.id, 'CLASS', seg.van, seg.tot))
        );

        // Een segment kan ontbreken — bv. NOT_FOUND wanneer het rooster van een
        // nog niet gepubliceerd schooljaar wordt opgevraagd. Toon dan gewoon wat
        // er wél is; faal enkel als geen enkel segment lukte (dan bubbelt de
        // eerste fout door zodat StudentOverzicht een nette melding kan tonen).
        const gelukt: Array<{ dekking: Interval; entries: RosterEntry[] }> = [];
        let eersteFout: unknown = null;
        perSegment.forEach((r, i) => {
            if (r.status === 'fulfilled') {
                gelukt.push({ dekking: segmentDekking(segmenten[i], van, tot), entries: r.value });
            } else if (eersteFout === null) {
                eersteFout = r.reason;
            }
        });
        if (gelukt.length === 0 && eersteFout !== null) {
            throw eersteFout;
        }

        const toBlok = (e: RosterEntry): Lesblok => ({
            klasgroep,
            olodNaam: (e.lessonText?.split(',')[0]?.trim()) || 'Onbekend',
            type: e.info?.trim() || undefined,
            start: new Date(e.start),
            eind: new Date(e.end),
            lokaal: undefined,
        });

        // Enkel geslaagde segmenten worden als gedekt gemarkeerd. Het bereik van
        // een mislukt segment blijft ongedekt, zodat een latere aanvraag opnieuw
        // naar Untis gaat in plaats van leeg uit de cache te komen (bv. zodra
        // het rooster van semester 2 wél gepubliceerd is).
        let cache = this.rangeByKlasgroep.get(klasgroep) ?? { intervals: [], blokken: [] };
        const opgehaald: Lesblok[] = [];
        for (const seg of gelukt) {
            const fresh = seg.entries.map(toBlok);
            opgehaald.push(...fresh);
            cache = {
                intervals: voegIntervalToe(cache.intervals, seg.dekking),
                blokken: this.mergeBlokken(cache.blokken, fresh, seg.dekking.van, seg.dekking.tot),
            };
        }
        this.rangeByKlasgroep.set(klasgroep, cache);

        return this.slice(opgehaald, van, tot);
    }

    private slice(blokken: Lesblok[], van: Date, tot: Date): Lesblok[] {
        const vMs = van.getTime();
        const tMs = tot.getTime();
        return blokken.filter(b => b.start.getTime() <= tMs && b.eind.getTime() >= vMs);
    }

    // Keep all of prev that fall outside the newly-fetched range, plus all freshly fetched.
    private mergeBlokken(
        prev: Lesblok[],
        fresh: Lesblok[],
        van: number,
        tot: number
    ): Lesblok[] {
        const kept = prev.filter(b => b.eind.getTime() < van || b.start.getTime() > tot);
        return [...kept, ...fresh].sort((a, b) => a.start.getTime() - b.start.getTime());
    }

    // True zodra minstens een deel van [van, tot] voor deze klasgroep effectief
    // opgehaald is. Laat een consument onderscheiden tussen "geen lessen in
    // dit bereik" en "rooster van dit bereik (nog) niet beschikbaar".
    isDeelsGedekt(klasgroep: string, van: Date, tot: Date): boolean {
        const cached = this.rangeByKlasgroep.get(klasgroep);
        if (!cached) return false;
        const v = van.getTime();
        const t = tot.getTime();
        return cached.intervals.some(iv => iv.van <= t && iv.tot >= v);
    }

    invalidate() {
        this.classCache = null;
        this.classesInflight = null;
        this.rangeByKlasgroep.clear();
        this.inflight.clear();
    }
}

export const trajectUntisService: TrajectUntisService & {
    invalidate(): void;
    isDeelsGedekt(klasgroep: string, van: Date, tot: Date): boolean;
} = new TrajectUntisAdapter();
