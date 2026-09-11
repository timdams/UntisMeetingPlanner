import { untisService } from '../../services/UntisService';
import { ClassGroup, RosterEntry } from '../../types';
import { academiejaarBereik } from './academicYear';
import { periodeBereik } from './dateUtils';
import { Lesblok, TrajectUntisService } from './types';

// ===== Zuinig met Untis =====
//
// Op drukke dagen werken tientallen trajectbegeleiders tegelijk met de tool,
// en elke roostervraag gaat via de proxy rechtstreeks naar de Untis-server van
// de school. De adapter houdt het aantal calls daarom zo laag mogelijk:
//
//   1. Ophaalvenster — een klasgroep wordt meteen voor het hele academiejaar
//      opgehaald, ook als er maar één week gevraagd wordt. Week, module,
//      semester en jaar komen daarna allemaal uit het geheugen.
//   2. Enkel de gaten — wat al gedekt is of al onderweg, wordt niet opnieuw
//      gevraagd; een aanvraag die binnen een lopende ophaling valt, wacht
//      daarop in plaats van zelf te vuren.
//   3. Afkoeling — een mislukt stuk wordt een tijd niet opnieuw geprobeerd,
//      zodat een overbelaste Untis niet nog harder bestookt wordt.
//   4. Wachtrij — hoogstens MAX_GELIJKTIJDIG roostercalls tegelijk per tab.
//   5. Opslag — opgehaalde roosters gaan ook naar IndexedDB, zodat een
//      herlading of een tweede tab niet van nul begint.

const MAX_GELIJKTIJDIG = 4;
// Hoe lang een mislukt stuk met rust gelaten wordt. Een 400/404 betekent bij
// Untis "(nog) niet beschikbaar" (bv. een rooster dat nog niet gepubliceerd
// is): dat verandert niet binnen de minuut. Al het andere (5xx, netwerk,
// sessie) is mogelijk tijdelijk.
const AFKOELING_FOUT_MS = 60 * 1000;
const AFKOELING_NIET_BESCHIKBAAR_MS = 15 * 60 * 1000;
// Hoe lang een opgehaald rooster over een herlading heen bruikbaar blijft.
// Binnen één sessie blijft het geheugen gewoon geldig tot een herlading.
const BEWAAR_TTL_MS = 60 * 60 * 1000;

interface Interval {
    van: number;
    tot: number;
}

// Een roostercall die nog loopt. `klaar` faalt nooit: het resultaat (of de
// fout) landt in de cache van de klasgroep.
interface Onderweg {
    iv: Interval;
    klaar: Promise<void>;
}

// Een stuk dat mislukte en tot `totMs` niet opnieuw geprobeerd wordt.
interface Afkoeling {
    iv: Interval;
    totMs: number;
    fout: unknown;
}

// Per klasgroep bewaren we welke tijdsintervallen effectief opgehaald zijn.
// Vroeger was dit één unie-bereik (min van, max tot), maar wie eerst module 2
// en daarna module 4 bekijkt, kreeg zo het nooit-opgehaalde module 3 leeg uit
// de cache. Enkel een aanvraag die volledig binnen één gedekt interval valt
// wordt uit het geheugen geserveerd. Alle intervallen zijn op hele dagen
// afgebakend (00:00 t/m 23:59:59.999), want Untis levert steeds hele dagen.
interface KlasCache {
    intervals: Interval[];
    blokken: Lesblok[];
    onderweg: Onderweg[];
    afkoeling: Afkoeling[];
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

function overlapt(iv: Interval, van: number, tot: number): boolean {
    return iv.van <= tot && iv.tot >= van;
}

function dagStart(ms: number): number {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

function dagEind(ms: number): number {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

// De delen van `venster` die door geen enkel interval uit `bezet` gedekt
// worden. Omdat alles op hele dagen valt, loopt ook elk gat van 00:00 tot
// 23:59:59.999.
function openGaten(venster: Interval, bezet: Interval[]): Interval[] {
    const gaten: Interval[] = [];
    let cursor = venster.van;
    for (const b of [...bezet].sort((x, y) => x.van - y.van)) {
        if (b.tot < cursor || b.van > venster.tot) continue;
        if (b.van > cursor + INTERVAL_JOIN_TOLERANCE_MS) gaten.push({ van: cursor, tot: b.van - 1 });
        cursor = Math.max(cursor, b.tot + 1);
        if (cursor > venster.tot) return gaten;
    }
    if (cursor <= venster.tot) gaten.push({ van: cursor, tot: venster.tot });
    return gaten;
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

// Eerste dag (00:00) van het Untis-schooljaar waarin `ms` valt.
function schooljaarBegin(ms: number): number {
    const jaar = new Date(ms).getFullYear();
    const cutoff = new Date(jaar, SCHOOLJAAR_CUTOFF_MAAND, SCHOOLJAAR_CUTOFF_DAG).getTime();
    return ms >= cutoff ? cutoff : new Date(jaar - 1, SCHOOLJAAR_CUTOFF_MAAND, SCHOOLJAAR_CUTOFF_DAG).getTime();
}

// Laatste moment (20 september, 23:59:59.999) van het Untis-schooljaar waarin
// `ms` valt.
function schooljaarEinde(ms: number): number {
    const jaar = new Date(ms).getFullYear();
    const cutoff = new Date(jaar, SCHOOLJAAR_CUTOFF_MAAND, SCHOOLJAAR_CUTOFF_DAG).getTime();
    const volgende = ms >= cutoff ? new Date(jaar + 1, SCHOOLJAAR_CUTOFF_MAAND, SCHOOLJAAR_CUTOFF_DAG).getTime() : cutoff;
    return volgende - 1;
}

// Wat er effectief opgehaald wordt voor een aanvraag: het academiejaar
// (volgens de standaardgrenzen), maar enkel binnen de Untis-schooljaren die de
// aanvraag zelf raakt. Een week in oktober haalt zo in één call het hele jaar
// vanaf 21 september op, zonder er het staartje van 1–20 september (een ander
// Untis-schooljaar, dus een extra call) bij te sleuren. Valt de aanvraag
// buiten het academiejaar, dan blijft ze wat ze is. Wie de grenzen verlegt tot
// voorbij het standaardjaar, krijgt dat extra stuk gewoon als apart gat.
function ophaalVenster(aanvraag: Interval): Interval {
    const bereik = academiejaarBereik();
    const { van, tot } = periodeBereik(bereik.van, bereik.tot);
    const jaar: Interval = { van: van.getTime(), tot: tot.getTime() };
    if (!overlapt(jaar, aanvraag.van, aanvraag.tot)) return aanvraag;
    return {
        van: Math.min(aanvraag.van, Math.max(jaar.van, schooljaarBegin(aanvraag.van))),
        tot: Math.max(aanvraag.tot, Math.min(jaar.tot, schooljaarEinde(aanvraag.tot))),
    };
}

function afkoelTijd(fout: unknown): number {
    const msg = fout instanceof Error ? fout.message : String(fout ?? '');
    return msg.includes('400') || msg.includes('404') ? AFKOELING_NIET_BESCHIKBAAR_MS : AFKOELING_FOUT_MS;
}

function toBlok(klasgroep: string, e: RosterEntry): Lesblok {
    return {
        klasgroep,
        olodNaam: (e.lessonText?.split(',')[0]?.trim()) || 'Onbekend',
        type: e.info?.trim() || undefined,
        start: new Date(e.start),
        eind: new Date(e.end),
        lokaal: undefined,
    };
}

function slice(blokken: Lesblok[], van: number, tot: number): Lesblok[] {
    return blokken.filter(b => b.start.getTime() <= tot && b.eind.getTime() >= van);
}

// Keep all of prev that fall outside the newly-fetched range, plus all freshly fetched.
function mergeBlokken(prev: Lesblok[], fresh: Lesblok[], van: number, tot: number): Lesblok[] {
    const kept = prev.filter(b => b.eind.getTime() < van || b.start.getTime() > tot);
    return [...kept, ...fresh].sort((a, b) => a.start.getTime() - b.start.getTime());
}

// Klasgroep-IDs en roosters horen bij één Untis-schooljaar; de opslag houdt ze
// daarom per schooljaar gescheiden.
function schooljaarSleutel(): string {
    return untisService.getActiveSchoolYearName() ?? 'onbekend';
}

// ===== Opslag (IndexedDB) =====
//
// Elk opgehaald stuk wordt als één record bewaard. localStorage is te klein
// (een jaarrooster van een lange shortlist loopt al snel in de megabytes),
// IndexedDB niet. Alles is best effort: privémodus, een volle schijf of een
// geblokkeerde database mag een roosteraanvraag nooit laten mislukken — dan
// werkt de adapter gewoon enkel uit het geheugen.

const IDB_NAAM = 'trajectplanner-roosters';
const IDB_STORE = 'segmenten';
// Verhoog bij een wijziging aan de vorm van wat er bewaard wordt: oudere
// records worden dan bij de volgende load weggegooid.
const OPSLAG_FORMAAT = 1;

interface BewaardSegment {
    key: string;
    formaat: number;
    schooljaar: string;
    klasgroep: string;
    van: number;
    tot: number;
    op: number; // tijdstip van ophalen (ms)
    // Compact: olodNaam, type, start, eind.
    blokken: Array<{ o: string; t?: string; s: number; e: number }>;
}

class RoosterOpslag {
    private db: Promise<IDBDatabase | null> | null = null;

    private open(): Promise<IDBDatabase | null> {
        if (!this.db) {
            this.db = new Promise<IDBDatabase | null>(resolve => {
                try {
                    if (typeof indexedDB === 'undefined') {
                        resolve(null);
                        return;
                    }
                    const req = indexedDB.open(IDB_NAAM, 1);
                    req.onupgradeneeded = () => {
                        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
                            req.result.createObjectStore(IDB_STORE, { keyPath: 'key' });
                        }
                    };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => resolve(null);
                    req.onblocked = () => resolve(null);
                } catch {
                    resolve(null);
                }
            });
        }
        return this.db;
    }

    // De nog verse stukken van dit schooljaar, oudste eerst: overlapt een
    // recenter stuk een ouder, dan wint zo het recentere. Vervallen records en
    // records van een ander schooljaar of formaat worden meteen opgeruimd.
    async laad(schooljaar: string): Promise<Array<{ klasgroep: string; iv: Interval; blokken: Lesblok[] }>> {
        const db = await this.open();
        if (!db) return [];
        const alles = await new Promise<BewaardSegment[]>(resolve => {
            try {
                const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAll();
                req.onsuccess = () => resolve((req.result ?? []) as BewaardSegment[]);
                req.onerror = () => resolve([]);
            } catch {
                resolve([]);
            }
        });
        const nu = Date.now();
        const bruikbaar: BewaardSegment[] = [];
        const weg: string[] = [];
        for (const s of alles) {
            const vers = s.op <= nu && nu - s.op < BEWAAR_TTL_MS;
            if (s.formaat === OPSLAG_FORMAAT && s.schooljaar === schooljaar && vers && Array.isArray(s.blokken)) {
                bruikbaar.push(s);
            } else if (typeof s.key === 'string') {
                weg.push(s.key);
            }
        }
        if (weg.length > 0) this.schrijf(store => weg.forEach(k => store.delete(k)));
        return bruikbaar
            .sort((a, b) => a.op - b.op)
            .map(s => ({
                klasgroep: s.klasgroep,
                iv: { van: s.van, tot: s.tot },
                blokken: s.blokken.map(b => ({
                    klasgroep: s.klasgroep,
                    olodNaam: b.o,
                    type: b.t,
                    start: new Date(b.s),
                    eind: new Date(b.e),
                    lokaal: undefined,
                })),
            }));
    }

    bewaar(schooljaar: string, klasgroep: string, iv: Interval, blokken: Lesblok[]): void {
        const rec: BewaardSegment = {
            key: `${schooljaar}|${klasgroep}|${iv.van}|${iv.tot}`,
            formaat: OPSLAG_FORMAAT,
            schooljaar,
            klasgroep,
            van: iv.van,
            tot: iv.tot,
            op: Date.now(),
            blokken: blokken.map(b => ({ o: b.olodNaam, t: b.type, s: b.start.getTime(), e: b.eind.getTime() })),
        };
        this.schrijf(store => store.put(rec));
    }

    wis(): void {
        this.schrijf(store => store.clear());
    }

    private schrijf(werk: (store: IDBObjectStore) => void): void {
        this.open()
            .then(db => {
                if (!db) return;
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.onerror = () => undefined;
                werk(tx.objectStore(IDB_STORE));
            })
            .catch(() => undefined);
    }
}

class TrajectUntisAdapter implements TrajectUntisService {
    private classCache: ClassGroup[] | null = null;
    private classesInflight: Promise<ClassGroup[]> | null = null;
    private perKlasgroep = new Map<string, KlasCache>();
    private opslag = new RoosterOpslag();
    private hydratie: Promise<void> | null = null;
    // Wachtrij voor roostercalls (zie MAX_GELIJKTIJDIG).
    private lopend = 0;
    private wachtrij: Array<() => void> = [];

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

    private cacheVan(klasgroep: string): KlasCache {
        let cache = this.perKlasgroep.get(klasgroep);
        if (!cache) {
            cache = { intervals: [], blokken: [], onderweg: [], afkoeling: [] };
            this.perKlasgroep.set(klasgroep, cache);
        }
        return cache;
    }

    // Laadt eenmalig per sessie wat er nog vers in de opslag zit.
    private hydrateer(): Promise<void> {
        if (!this.hydratie) {
            this.hydratie = this.opslag
                .laad(schooljaarSleutel())
                .then(stukken => {
                    for (const s of stukken) this.neemOp(this.cacheVan(s.klasgroep), s.iv, s.blokken);
                })
                .catch(() => undefined);
        }
        return this.hydratie;
    }

    async getLesblokken(klasgroep: string, van: Date, tot: Date): Promise<Lesblok[]> {
        await this.hydrateer();
        const vMs = van.getTime();
        const tMs = tot.getTime();
        const vooraf = this.perKlasgroep.get(klasgroep);
        if (vooraf && isGedekt(vooraf.intervals, vMs, tMs)) {
            return slice(vooraf.blokken, vMs, tMs);
        }

        const cs = await this.classes();
        const match = cs.find(c => c.displayName === klasgroep);
        if (!match) return [];

        // Vanaf hier loopt alles synchroon tot de nieuwe calls als "onderweg"
        // geregistreerd staan: een aanvraag die meteen daarna binnenkomt, ziet
        // ze dan al en wacht erop in plaats van zelf te vuren.
        const cache = this.cacheVan(klasgroep);
        const nu = Date.now();
        cache.afkoeling = cache.afkoeling.filter(a => a.totMs > nu);
        const bezet = [
            ...cache.intervals,
            ...cache.onderweg.map(o => o.iv),
            ...cache.afkoeling.map(a => a.iv),
        ];
        const aanvraag: Interval = { van: dagStart(vMs), tot: dagEind(tMs) };
        // Enkel als de aanvraag zelf nog een open gat heeft, gaat er iets naar
        // Untis — en dan meteen voor het hele ophaalvenster.
        if (openGaten(aanvraag, bezet).length > 0) {
            for (const gat of openGaten(ophaalVenster(aanvraag), bezet)) {
                this.haalOp(cache, klasgroep, match.id, gat);
            }
        }

        await Promise.all(cache.onderweg.filter(o => overlapt(o.iv, vMs, tMs)).map(o => o.klaar));

        // Toon wat er van het bereik wél is; faal enkel als er helemaal niets
        // van binnenkwam (dan bubbelt de fout door zodat de consument een nette
        // melding kan tonen). Een stuk dat afkoelt, telt zo als "niet
        // beschikbaar" zonder dat Untis opnieuw gevraagd wordt.
        if (cache.intervals.some(iv => overlapt(iv, vMs, tMs))) {
            return slice(cache.blokken, vMs, tMs);
        }
        const afgekoeld = cache.afkoeling.find(a => overlapt(a.iv, vMs, tMs));
        throw afgekoeld ? afgekoeld.fout : new Error('Rooster ophalen mislukt');
    }

    // Vuurt de calls voor één gat af, gesplitst op schooljaargrenzen. Elk
    // segment wordt meteen als "onderweg" geregistreerd; lukt het, dan telt het
    // als gedekt en gaat het naar de opslag, mislukt het, dan koelt het af.
    private haalOp(cache: KlasCache, klasgroep: string, id: number, gat: Interval): void {
        for (const seg of splitOpSchooljaar(new Date(gat.van), new Date(gat.tot))) {
            const iv: Interval = { van: dagStart(seg.van.getTime()), tot: dagEind(seg.tot.getTime()) };
            const onderweg: Onderweg = {
                iv,
                klaar: this.inWachtrij(() => untisService.getRoster(id, 'CLASS', seg.van, seg.tot))
                    .then(
                        entries => {
                            const fresh = entries.map(e => toBlok(klasgroep, e));
                            this.neemOp(cache, iv, fresh);
                            this.opslag.bewaar(schooljaarSleutel(), klasgroep, iv, fresh);
                        },
                        fout => {
                            cache.afkoeling.push({ iv, totMs: Date.now() + afkoelTijd(fout), fout });
                        }
                    )
                    .finally(() => {
                        cache.onderweg = cache.onderweg.filter(o => o !== onderweg);
                    }),
            };
            cache.onderweg.push(onderweg);
        }
    }

    private neemOp(cache: KlasCache, iv: Interval, fresh: Lesblok[]): void {
        cache.intervals = voegIntervalToe(cache.intervals, iv);
        cache.blokken = mergeBlokken(cache.blokken, fresh, iv.van, iv.tot);
        cache.afkoeling = cache.afkoeling.filter(a => !overlapt(a.iv, iv.van, iv.tot));
    }

    // Laat hoogstens MAX_GELIJKTIJDIG taken tegelijk lopen. Een vrijgekomen
    // plaats gaat rechtstreeks naar de volgende in de rij, zodat een nieuwkomer
    // er niet tussen kan glippen.
    private async inWachtrij<T>(taak: () => Promise<T>): Promise<T> {
        if (this.lopend < MAX_GELIJKTIJDIG) {
            this.lopend++;
        } else {
            await new Promise<void>(r => this.wachtrij.push(r));
        }
        try {
            return await taak();
        } finally {
            const volgende = this.wachtrij.shift();
            if (volgende) volgende();
            else this.lopend--;
        }
    }

    // True zodra minstens een deel van [van, tot] voor deze klasgroep effectief
    // opgehaald is. Laat een consument onderscheiden tussen "geen lessen in
    // dit bereik" en "rooster van dit bereik (nog) niet beschikbaar".
    isDeelsGedekt(klasgroep: string, van: Date, tot: Date): boolean {
        const cached = this.perKlasgroep.get(klasgroep);
        if (!cached) return false;
        const v = van.getTime();
        const t = tot.getTime();
        return cached.intervals.some(iv => overlapt(iv, v, t));
    }

    invalidate() {
        this.classCache = null;
        this.classesInflight = null;
        this.perKlasgroep.clear();
        // Ook de opslag leeg: wie alles wil vergeten, wil na een herlading geen
        // oude roosters terug.
        this.hydratie = Promise.resolve();
        this.opslag.wis();
    }
}

export const trajectUntisService: TrajectUntisService & {
    invalidate(): void;
    isDeelsGedekt(klasgroep: string, van: Date, tot: Date): boolean;
} = new TrajectUntisAdapter();
