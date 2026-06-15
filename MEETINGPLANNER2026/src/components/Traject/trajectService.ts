import { untisService } from '../../services/UntisService';
import { ClassGroup, RosterEntry } from '../../types';
import { Lesblok, TrajectUntisService } from './types';

interface RangeCache {
    van: number;
    tot: number;
    blokken: Lesblok[];
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
        if (cached && cached.van <= van.getTime() && cached.tot >= tot.getTime()) {
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
        const entries: RosterEntry[] = [];
        let geslaagd = 0;
        let eersteFout: unknown = null;
        for (const r of perSegment) {
            if (r.status === 'fulfilled') {
                geslaagd++;
                entries.push(...r.value);
            } else if (eersteFout === null) {
                eersteFout = r.reason;
            }
        }
        if (geslaagd === 0 && eersteFout !== null) {
            throw eersteFout;
        }

        const blokken: Lesblok[] = entries.map(e => {
            const olod = (e.lessonText?.split(',')[0]?.trim()) || 'Onbekend';
            return {
                klasgroep,
                olodNaam: olod,
                type: e.info?.trim() || undefined,
                start: new Date(e.start),
                eind: new Date(e.end),
                lokaal: undefined,
            };
        });

        // Merge with existing range cache if any; widen to the union.
        const prev = this.rangeByKlasgroep.get(klasgroep);
        if (prev) {
            const newVan = Math.min(prev.van, van.getTime());
            const newTot = Math.max(prev.tot, tot.getTime());
            const merged = this.mergeBlokken(prev.blokken, blokken, van.getTime(), tot.getTime());
            this.rangeByKlasgroep.set(klasgroep, { van: newVan, tot: newTot, blokken: merged });
        } else {
            this.rangeByKlasgroep.set(klasgroep, {
                van: van.getTime(),
                tot: tot.getTime(),
                blokken,
            });
        }

        return this.slice(blokken, van, tot);
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

    invalidate() {
        this.classCache = null;
        this.classesInflight = null;
        this.rangeByKlasgroep.clear();
        this.inflight.clear();
    }
}

export const trajectUntisService: TrajectUntisService & { invalidate(): void } =
    new TrajectUntisAdapter();
