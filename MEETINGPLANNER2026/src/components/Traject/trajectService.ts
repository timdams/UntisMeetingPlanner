import { untisService } from '../../services/UntisService';
import { ClassGroup } from '../../types';
import { Lesblok, TrajectUntisService } from './types';

interface RangeCache {
    van: number;
    tot: number;
    blokken: Lesblok[];
}

class TrajectUntisAdapter implements TrajectUntisService {
    private classCache: ClassGroup[] | null = null;
    private rangeByKlasgroep = new Map<string, RangeCache>();
    private inflight = new Map<string, Promise<Lesblok[]>>();

    private async classes(): Promise<ClassGroup[]> {
        if (!this.classCache) {
            this.classCache = await untisService.getClasses();
        }
        return this.classCache;
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

        const entries = await untisService.getRoster(match.id, 'CLASS', van, tot);
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
        this.rangeByKlasgroep.clear();
        this.inflight.clear();
    }
}

export const trajectUntisService: TrajectUntisService & { invalidate(): void } =
    new TrajectUntisAdapter();
