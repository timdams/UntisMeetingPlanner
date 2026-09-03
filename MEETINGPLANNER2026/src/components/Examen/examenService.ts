import { untisService } from '../../services/UntisService';
import type { ClassGroup, RosterEntry, UntisResource } from '../../types';
import { addDays, parseIsoDate } from '../Traject/dateUtils';
import type { ExamenBlok } from './types';

/**
 * Dunne adapter rond `untisService` voor het examenoverzicht. Bewust los van
 * de range-cache van de Traject Planner: die kleedt de blokken uit tot wat de
 * planner nodig heeft (geen lokaal, docent of status), en deze module mag de
 * Traject-code niet aanpassen. De eenheid is hier altijd één klasgroep in één
 * week (maandag t/m vrijdag).
 */

export interface WeekResultaat {
    blokken: ExamenBlok[];
    /** Tijdstip waarop deze week voor deze klasgroep bij Untis opgehaald werd. */
    opgehaaldOp: Date;
}

// Untis weigert (400 MULTIPLE_SCHOOLYEARS_IN_RANGE) zodra één request meer dan
// één schooljaar omspant; het nieuwe academiejaar begint voor Untis op
// 21 september. Een week die daaroverheen loopt splitsen we in twee calls.
const SCHOOLJAAR_CUTOFF_MAAND = 8; // september
const SCHOOLJAAR_CUTOFF_DAG = 21;

// getRoster serialiseert met toISOString() (UTC); op het middaguur blijft de
// kalenderdatum in elke realistische tijdzone gelijk.
function opMiddag(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function splitOpSchooljaar(maandag: Date, vrijdag: Date): Array<{ van: Date; tot: Date }> {
    const cutoff = new Date(maandag.getFullYear(), SCHOOLJAAR_CUTOFF_MAAND, SCHOOLJAAR_CUTOFF_DAG, 12, 0, 0, 0);
    const van = opMiddag(maandag);
    const tot = opMiddag(vrijdag);
    if (van.getTime() < cutoff.getTime() && tot.getTime() >= cutoff.getTime()) {
        return [
            { van, tot: opMiddag(addDays(cutoff, -1)) },
            { van: cutoff, tot },
        ];
    }
    return [{ van, tot }];
}

function namen(res: UntisResource[]): string | undefined {
    const uniek = Array.from(new Set(res.map(r => r.displayName).filter(Boolean)));
    return uniek.length > 0 ? uniek.join(', ') : undefined;
}

function toBlok(e: RosterEntry, klasgroep: string): ExamenBlok {
    // Zelfde vaknaam-afleiding als de Traject Planner (eerste vak), zodat een
    // merge-sleutel hier hetzelfde vak benoemt als daar.
    const olodNaam =
        e.subjects[0]?.displayName?.trim() ||
        e.lessonText?.split(',')[0]?.trim() ||
        'Onbekend';
    return {
        klasgroep,
        olodNaam,
        type: e.info?.trim() || undefined,
        start: new Date(e.start),
        eind: new Date(e.end),
        lokaal: namen(e.rooms),
        docent: namen(e.teachers),
        id: e.id || undefined,
        ids: e.ids && e.ids.length > 0 ? e.ids : undefined,
        klassen: e.classes.length > 0 ? e.classes.map(c => c.displayName) : undefined,
        status: e.status,
        untisType: e.type,
    };
}

class ExamenUntisAdapter {
    private classCache: ClassGroup[] | null = null;
    private classesInflight: Promise<ClassGroup[]> | null = null;
    private weekCache = new Map<string, WeekResultaat>();
    private inflight = new Map<string, Promise<WeekResultaat>>();

    private async classes(): Promise<ClassGroup[]> {
        if (this.classCache) return this.classCache;
        // Dedupe gelijktijdige aanroepen: acht klasgroepen vragen tegelijk de
        // klassenlijst op, en identieke parallelle filter-requests beantwoordt
        // Untis met een 400.
        if (!this.classesInflight) {
            this.classesInflight = untisService
                .getClasses()
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

    private sleutel(klasgroep: string, weekMaandag: string): string {
        return `${klasgroep}|${weekMaandag}`;
    }

    /**
     * De blokken van één klasgroep in de week die op `weekMaandag` (ISO-datum)
     * begint. Uit het geheugen zodra die week al eens opgehaald is; `vergeetWeek`
     * dwingt een verse ophaling af.
     */
    async getWeek(klasgroep: string, weekMaandag: string): Promise<WeekResultaat> {
        const key = this.sleutel(klasgroep, weekMaandag);
        const cached = this.weekCache.get(key);
        if (cached) return cached;
        const bezig = this.inflight.get(key);
        if (bezig) return bezig;

        const promise = this.fetchWeek(klasgroep, weekMaandag).then(res => {
            this.weekCache.set(key, res);
            return res;
        });
        this.inflight.set(key, promise);
        try {
            return await promise;
        } finally {
            this.inflight.delete(key);
        }
    }

    private async fetchWeek(klasgroep: string, weekMaandag: string): Promise<WeekResultaat> {
        const cs = await this.classes();
        const match = cs.find(c => c.displayName === klasgroep);
        if (!match) {
            throw new Error(`Klasgroep "${klasgroep}" niet gevonden in Untis (ander academiejaar?)`);
        }
        const maandag = parseIsoDate(weekMaandag);
        const vrijdag = addDays(maandag, 4);
        const segmenten = splitOpSchooljaar(maandag, vrijdag);

        // Een half opgehaalde week zou er compleet uitzien terwijl ze dat niet
        // is — voor een examenoverzicht is dat erger dan een foutmelding. Faalt
        // één segment, dan telt de hele klasgroep als "niet opgehaald".
        const perSegment = await Promise.all(
            segmenten.map(seg => untisService.getRoster(match.id, 'CLASS', seg.van, seg.tot))
        );
        const blokken = perSegment
            .flat()
            .map(e => toBlok(e, klasgroep))
            .sort((a, b) => a.start.getTime() - b.start.getTime() || a.olodNaam.localeCompare(b.olodNaam));
        return { blokken, opgehaaldOp: new Date() };
    }

    /** Wist de cache van één week (alle klasgroepen), zodat de volgende aanvraag opnieuw naar Untis gaat. */
    vergeetWeek(weekMaandag: string): void {
        for (const key of Array.from(this.weekCache.keys())) {
            if (key.endsWith(`|${weekMaandag}`)) this.weekCache.delete(key);
        }
    }

    invalidate(): void {
        this.classCache = null;
        this.classesInflight = null;
        this.weekCache.clear();
        this.inflight.clear();
    }
}

export const examenService = new ExamenUntisAdapter();

/** Leesbare fouttekst voor een mislukte ophaling (geen rauwe API-fout voor de gebruiker). */
export function foutTekst(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e ?? '');
    if (msg.includes('404') || msg.includes('400')) return 'rooster (nog) niet beschikbaar in Untis';
    if (msg.includes('Not authenticated') || msg.includes('Session expired')) return 'sessie verlopen — meld opnieuw aan';
    return msg || 'rooster ophalen mislukt';
}
