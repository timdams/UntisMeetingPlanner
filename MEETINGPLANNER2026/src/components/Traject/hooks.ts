import { useState, useEffect, useCallback } from 'react';
import { TrajectSettings, StudentTraject, KleurMap, OLODSelectie, Lesblok } from './types';
import type { TrajectPreset } from './trajectShare';
import {
    academiejaarBereik,
    actievePeriode,
    allePeriodes,
    defaultSemesterPeriode,
    effectieveGrenzen,
    periodesVoor,
    valtBinnenAcademiejaar,
    type PeriodeGrenzen,
    type PeriodeType,
} from './academicYear';
import { datumInBereik, isIsoDate, parseIsoDate } from './dateUtils';

const KEY_SETTINGS = 'traject_settings';
const KEY_TRAJECT = 'traject_student';
const KEY_KLEUR = 'traject_kleurmap';
const KEY_MIGRATION = 'traject_migration_version';
const KEY_LAST_BACKUP = 'traject_last_backup';
const KEY_BEWAARD = 'traject_bewaard';

// Verhoog dit nummer bij een breaking change in opgeslagen data. runTrajectMigrations()
// draait dan eenmalig de bijhorende opkuis voor bestaande gebruikers.
//   v1 — academiejaar-update: klasgroep-shortlist (oude resource-IDs) wissen.
//   v2 — semesterperiode die buiten het academiejaar valt (oude today-based
//        default) resetten naar het lopende semester van het nieuwe jaar.
// Nieuwe velden die enkel een standaardwaarde nodig hebben (periodeType,
// periodeGrenzen, van/tot op een selectie) vergen géén migratie: die vult
// normalizeSettings()/normalizeTraject() bij elke load aan.
const CURRENT_MIGRATION = 2;

// Genereert een unieke kleur per allocatie-index via golden-angle hue-distributie.
// Combineert met drie (saturation, lightness)-banden zodat ook hue-buren visueel verschillen.
function allocateColor(index: number): string {
    const hue = (index * 137.508) % 360;
    const band = index % 3;
    const sat = band === 0 ? 70 : band === 1 ? 82 : 55;
    const light = band === 0 ? 48 : band === 1 ? 38 : 58;
    return `hsl(${hue.toFixed(1)}, ${sat}%, ${light}%)`;
}

/**
 * Maakt van willekeurige (oudere of onvolledige) opgeslagen instellingen een
 * volledig TrajectSettings-object. Ontbrekende velden krijgen hun standaard:
 * lege klasgroep-shortlist, het lopende semester als actieve periode,
 * semester-indeling en de grensdatums van het standaard-academiejaar (met de
 * modulegrenzen halverwege elk semester). Een onbruikbare grens (leeg veld, of
 * een semester dat achteruit loopt) valt op diezelfde standaard terug.
 */
export function normalizeSettings(raw: unknown): TrajectSettings {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const klasgroepen = Array.isArray(r.mijnOpleidingKlasgroepen)
        ? r.mijnOpleidingKlasgroepen.filter((x): x is string => typeof x === 'string')
        : [];
    // `moduleGrenzen` is de historische naam: dat veld bevatte enkel m2Start en
    // m4Start, want de semestergrenzen lagen toen vast in ACADEMIEJAAR. Die twee
    // waarden blijven geldig; de semestervelden vult effectieveGrenzen aan.
    const ruweGrenzen = (r.periodeGrenzen && typeof r.periodeGrenzen === 'object'
        ? r.periodeGrenzen
        : r.moduleGrenzen && typeof r.moduleGrenzen === 'object'
          ? r.moduleGrenzen
          : {}) as Record<string, unknown>;
    const periodeGrenzen = effectieveGrenzen(ruweGrenzen);
    const { start, eind } = defaultSemesterPeriode(new Date(), periodeGrenzen);
    return {
        mijnOpleidingKlasgroepen: klasgroepen,
        semesterStart: isIsoDate(r.semesterStart) ? r.semesterStart : start,
        semesterEind: isIsoDate(r.semesterEind) ? r.semesterEind : eind,
        periodeType: r.periodeType === 'module' ? 'module' : 'semester',
        periodeGrenzen,
    };
}

/**
 * Maakt van een opgeslagen traject een lijst geldige OLOD-selecties. Selecties
 * van vóór de periode-switcher hebben geen `van`/`tot`; die telden toen in elke
 * getoonde periode, dus ze krijgen het volledige academiejaar als bereik.
 */
export function normalizeTraject(raw: unknown): StudentTraject {
    if (!Array.isArray(raw)) return [];
    const jaar = academiejaarBereik();
    const out: StudentTraject = [];
    // Identieke selecties (zelfde vak, klasgroep én periode) horen maar één
    // keer in het traject; oudere opslag kan er dubbele bevatten.
    const gezien = new Set<string>();
    for (const item of raw) {
        const it = (item && typeof item === 'object' ? item : null) as Record<string, unknown> | null;
        if (!it || typeof it.klasgroep !== 'string' || typeof it.olodNaam !== 'string') continue;
        const sel: OLODSelectie = {
            klasgroep: it.klasgroep,
            olodNaam: it.olodNaam,
            van: isIsoDate(it.van) ? it.van : jaar.van,
            tot: isIsoDate(it.tot) ? it.tot : jaar.tot,
        };
        const key = selectieKey(sel);
        if (gezien.has(key)) continue;
        gezien.add(key);
        out.push(sel);
    }
    return out;
}

function loadJSON<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

function persist<T>(key: string, value: T) {
    localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Eenmalige migraties van in localStorage opgeslagen traject-data. Idempotent:
 * wordt afgeschermd door een opgeslagen versienummer, dus draait per gebruiker
 * maar één keer per migratie.
 *
 * Moet door {@link App} worden aangeroepen vóór {@link applyTrajectSettingsPreset},
 * zodat een verse trajectbegeleider-link de zonet gewiste klasgroepen weer mag
 * invullen (de preset bevat klasgroepen van het nieuwe academiejaar).
 *
 * v1 — na de academiejaar-update bevat de opgeslagen klasgroep-shortlist
 * displayNames van het vorige jaar; de bijhorende resource-IDs kloppen niet meer.
 * We wissen die selectie één keer zodat bestaande gebruikers hun klasgroepen
 * opnieuw kiezen tegen het nieuwe jaar.
 *
 * v2 — de oude today-based standaard semesterperiode valt in het vorige
 * academiejaar (start = dag van installatie). Valt start of einde buiten het
 * nieuwe academiejaar, dan resetten we de periode naar het lopende semester,
 * zodat zowel het klasgroeprooster als het studentoverzicht in het juiste jaar
 * openen. Een periode die al binnen het academiejaar valt (bewust ingesteld)
 * laten we ongemoeid.
 *
 * Het studenttraject en de kleurmap blijven in beide gevallen ongemoeid.
 */
export function runTrajectMigrations(): void {
    let version = 0;
    try {
        version = Number(localStorage.getItem(KEY_MIGRATION)) || 0;
    } catch {
        return; // localStorage onbeschikbaar — niets te migreren
    }
    if (version >= CURRENT_MIGRATION) return;

    try {
        const raw = localStorage.getItem(KEY_SETTINGS);
        if (raw) {
            const parsed = JSON.parse(raw) as TrajectSettings;
            let next = parsed;

            // v1 — klasgroep-shortlist van vorig academiejaar wissen.
            if (
                version < 1 &&
                Array.isArray(next.mijnOpleidingKlasgroepen) &&
                next.mijnOpleidingKlasgroepen.length > 0
            ) {
                next = { ...next, mijnOpleidingKlasgroepen: [] };
            }

            // v2 — semesterperiode buiten het academiejaar resetten.
            if (version < 2) {
                const startBuiten =
                    !next.semesterStart || !valtBinnenAcademiejaar(parseIsoDate(next.semesterStart));
                const eindBuiten =
                    !next.semesterEind || !valtBinnenAcademiejaar(parseIsoDate(next.semesterEind));
                if (startBuiten || eindBuiten) {
                    const { start, eind } = defaultSemesterPeriode();
                    next = { ...next, semesterStart: start, semesterEind: eind };
                }
            }

            if (next !== parsed) persist(KEY_SETTINGS, next);
        }
        localStorage.setItem(KEY_MIGRATION, String(CURRENT_MIGRATION));
    } catch {
        // Schrijven mislukt — versie niet bumpen, volgende keer opnieuw proberen
    }
}

/**
 * Past een gedeelde preset (klasgroep-shortlist + actieve periode, en — bij
 * een link van na de periode-switcher — de indeling en grensdatums) toe op
 * de opgeslagen instellingen. Wordt door {@link App} aangeroepen vóór React de
 * hooks initialiseert, zodat een student via een trajectbegeleider-link meteen
 * de juiste klasgroepen ziet. Ontbreekt de indeling in de link (oudere link),
 * dan blijft de huidige indeling van de student staan. Het studenttraject en
 * de kleurmap blijven ongemoeid.
 */
export function applyTrajectSettingsPreset(preset: TrajectPreset): void {
    const current = normalizeSettings(loadJSON<unknown>(KEY_SETTINGS, null));
    persist(KEY_SETTINGS, {
        ...current,
        mijnOpleidingKlasgroepen: preset.mijnOpleidingKlasgroepen,
        semesterStart: preset.semesterStart,
        semesterEind: preset.semesterEind,
        periodeType: preset.periodeType ?? current.periodeType,
        periodeGrenzen: preset.periodeGrenzen ?? current.periodeGrenzen,
    });
}

// Bij het wisselen van indeling houden we de "zelfde" periode actief: een
// semester wordt zijn eerste module, een module wordt haar semester.
const PERIODE_BIJ_TYPEWISSEL: Record<string, string> = {
    S1: 'M1',
    S2: 'M3',
    M1: 'S1',
    M2: 'S1',
    M3: 'S2',
    M4: 'S2',
};

export function useTrajectSettings() {
    const [settings, setSettings] = useState<TrajectSettings>(() =>
        normalizeSettings(loadJSON<unknown>(KEY_SETTINGS, null))
    );

    useEffect(() => {
        persist(KEY_SETTINGS, settings);
    }, [settings]);

    const toggleKlasgroep = useCallback((klasgroep: string) => {
        setSettings(s => {
            const exists = s.mijnOpleidingKlasgroepen.includes(klasgroep);
            return {
                ...s,
                mijnOpleidingKlasgroepen: exists
                    ? s.mijnOpleidingKlasgroepen.filter(k => k !== klasgroep)
                    : [...s.mijnOpleidingKlasgroepen, klasgroep].sort((a, b) => a.localeCompare(b)),
            };
        });
    }, []);

    const setSemesterStart = useCallback((iso: string) => {
        setSettings(s => ({ ...s, semesterStart: iso }));
    }, []);

    const setSemesterEind = useCallback((iso: string) => {
        setSettings(s => ({ ...s, semesterEind: iso }));
    }, []);

    // Zet start én einde in één keer — gebruikt door de periode-snelkeuze.
    const setSemesterPeriode = useCallback((start: string, eind: string) => {
        setSettings(s => ({ ...s, semesterStart: start, semesterEind: eind }));
    }, []);

    // Wisselt tussen semester- en module-indeling. Was de actieve periode exact
    // een snelkeuze-knop, dan springt ze mee naar de overeenkomstige knop van de
    // nieuwe indeling; een handmatig bereik blijft staan.
    const setPeriodeType = useCallback((type: PeriodeType) => {
        setSettings(s => {
            if (s.periodeType === type) return s;
            const oud = actievePeriode(periodesVoor(s.periodeType, s.periodeGrenzen), s.semesterStart, s.semesterEind);
            const nieuwId = oud ? PERIODE_BIJ_TYPEWISSEL[oud.id] : undefined;
            const nieuw = nieuwId
                ? periodesVoor(type, s.periodeGrenzen).find(p => p.id === nieuwId)
                : undefined;
            return {
                ...s,
                periodeType: type,
                semesterStart: nieuw ? nieuw.start : s.semesterStart,
                semesterEind: nieuw ? nieuw.eind : s.semesterEind,
            };
        });
    }, []);

    // Verzet een of meer grensdatums (semester- of modulegrens). Was de actieve
    // periode exact een van de benoemde periodes, dan volgt ze haar nieuwe
    // grenzen; een handmatig ingesteld bereik blijft staan.
    const setPeriodeGrenzen = useCallback((grenzen: PeriodeGrenzen) => {
        setSettings(s => {
            const oud = actievePeriode(allePeriodes(s.periodeGrenzen), s.semesterStart, s.semesterEind);
            const nieuw = oud ? allePeriodes(grenzen).find(p => p.id === oud.id) : undefined;
            return {
                ...s,
                periodeGrenzen: grenzen,
                semesterStart: nieuw ? nieuw.start : s.semesterStart,
                semesterEind: nieuw ? nieuw.eind : s.semesterEind,
            };
        });
    }, []);

    const replaceSettings = useCallback((next: TrajectSettings) => {
        setSettings(normalizeSettings(next));
    }, []);

    // Vervangt de volledige klasgroep-shortlist in één keer — gebruikt door
    // "Selecteer alle" / "Selecteer geen" die op de gefilterde lijst werken.
    const setKlasgroepen = useCallback((next: string[]) => {
        setSettings(s => ({
            ...s,
            mijnOpleidingKlasgroepen: [...next].sort((a, b) => a.localeCompare(b)),
        }));
    }, []);

    return {
        settings,
        toggleKlasgroep,
        setSemesterStart,
        setSemesterEind,
        setSemesterPeriode,
        setPeriodeType,
        setPeriodeGrenzen,
        replaceSettings,
        setKlasgroepen,
    };
}

// Tijdstip (ISO) van de laatste back-upexport. Voedt enkel de herinnering in
// de instellingen ("Laatste back-up: …"); zit niet in de back-up zelf en
// wordt niet gewist door reset of import.
export function useLastBackup() {
    const [lastBackup, setLastBackup] = useState<string | null>(() =>
        loadJSON<string | null>(KEY_LAST_BACKUP, null)
    );

    const markBackup = useCallback((iso: string) => {
        setLastBackup(iso);
        persist(KEY_LAST_BACKUP, iso);
    }, []);

    return { lastBackup, markBackup };
}

// Een traject dat de gebruiker onder een eigen naam bewaarde om later terug
// te laden: de OLOD-selecties samen met de instellingen waar ze bij horen
// (klasgroep-shortlist, actieve periode, semester/module-indeling en
// grensdatums). De kleurmap zit er niet bij — die is cosmetisch en wordt
// per OLOD automatisch opnieuw toegewezen.
export interface BewaardTraject {
    id: string;
    naam: string;
    bewaardOp: string; // ISO-tijdstip
    // Ontbreekt enkel bij items van vóór de koppeling aan instellingen; bij
    // het laden blijven de huidige instellingen dan staan.
    settings?: TrajectSettings;
    traject: StudentTraject;
}

function normalizeBewaardeTrajecten(raw: unknown): BewaardTraject[] {
    if (!Array.isArray(raw)) return [];
    const out: BewaardTraject[] = [];
    for (const item of raw) {
        const it = (item && typeof item === 'object' ? item : null) as Record<string, unknown> | null;
        if (!it || typeof it.id !== 'string' || typeof it.naam !== 'string') continue;
        out.push({
            id: it.id,
            naam: it.naam,
            bewaardOp: typeof it.bewaardOp === 'string' ? it.bewaardOp : new Date(0).toISOString(),
            settings:
                it.settings && typeof it.settings === 'object' ? normalizeSettings(it.settings) : undefined,
            traject: normalizeTraject(it.traject),
        });
    }
    return out;
}

function nieuwBewaardId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Namen van bewaarde trajecten vergelijken we hoofdletter- en accentongevoelig,
// zodat "Traject A" en "traject a" hetzelfde item overschrijven.
export function zelfdeTrajectNaam(a: string, b: string): boolean {
    return a.trim().localeCompare(b.trim(), 'nl', { sensitivity: 'base' }) === 0;
}

// Lijst van bewaarde trajecten (localStorage). Wordt niet gewist door reset
// of import: dat is precies waar ze voor dienen.
export function useBewaardeTrajecten() {
    const [bewaard, setBewaard] = useState<BewaardTraject[]>(() =>
        normalizeBewaardeTrajecten(loadJSON<unknown>(KEY_BEWAARD, null))
    );

    useEffect(() => {
        persist(KEY_BEWAARD, bewaard);
    }, [bewaard]);

    // Bewaart het traject plus zijn instellingen onder de naam. Met
    // `overschrijfId` vervangt het een bestaand item (zelfde naam) in plaats
    // van er een tweede naast te zetten.
    const bewaar = useCallback(
        (naam: string, settings: TrajectSettings, traject: StudentTraject, overschrijfId?: string) => {
        const item: BewaardTraject = {
            id: overschrijfId ?? nieuwBewaardId(),
            naam: naam.trim(),
            bewaardOp: new Date().toISOString(),
            settings: normalizeSettings(settings),
            traject: normalizeTraject(traject),
        };
        setBewaard(lijst =>
            overschrijfId && lijst.some(x => x.id === overschrijfId)
                ? lijst.map(x => (x.id === overschrijfId ? item : x))
                : [...lijst, item]
        );
        },
        []
    );

    const verwijder = useCallback((id: string) => {
        setBewaard(lijst => lijst.filter(x => x.id !== id));
    }, []);

    return { bewaard, bewaar, verwijder };
}

// Unieke sleutel van een selectie (alle vier velden) — voor React-keys en
// statuskaarten.
export function selectieKey(sel: OLODSelectie): string {
    return `${sel.klasgroep}::${sel.olodNaam}::${sel.van}::${sel.tot}`;
}

function sameSelectie(a: OLODSelectie, b: OLODSelectie) {
    return (
        a.klasgroep === b.klasgroep &&
        a.olodNaam === b.olodNaam &&
        a.van === b.van &&
        a.tot === b.tot
    );
}

function selectieDieDekt(
    traject: StudentTraject,
    klasgroep: string,
    olodNaam: string,
    datum: Date
): OLODSelectie | null {
    return (
        traject.find(
            x => x.klasgroep === klasgroep && x.olodNaam === olodNaam && datumInBereik(datum, x.van, x.tot)
        ) ?? null
    );
}

// De selectie waarop een klik op een lesblok slaat: de selectie die de datum
// van het blok dekt, of anders de selectie voor precies het actieve bereik.
// Die tweede tak vangt een blok in een week buiten de actieve periode op: een
// klik daar voegt een selectie voor de actieve periode toe, en een volgende
// klik moet die dan ook weer weghalen in plaats van een dubbel toe te voegen.
function selectieVoorBlok(
    traject: StudentTraject,
    klasgroep: string,
    olodNaam: string,
    datum: Date,
    bereik: { van: string; tot: string }
): OLODSelectie | null {
    return (
        selectieDieDekt(traject, klasgroep, olodNaam, datum) ??
        traject.find(
            x =>
                x.klasgroep === klasgroep &&
                x.olodNaam === olodNaam &&
                x.van === bereik.van &&
                x.tot === bereik.tot
        ) ??
        null
    );
}

export function useStudentTraject() {
    const [traject, setTraject] = useState<StudentTraject>(() =>
        normalizeTraject(loadJSON<unknown>(KEY_TRAJECT, null))
    );

    useEffect(() => {
        persist(KEY_TRAJECT, traject);
    }, [traject]);

    // Klik op een lesblok: valt het blok onder een bestaande selectie van dit
    // vak bij deze klasgroep (of bestaat die selectie al voor het meegegeven
    // bereik), dan verdwijnt die selectie (voor haar hele periode); anders
    // komt er een selectie bij voor het meegegeven bereik — de periode die op
    // dat moment actief is. Een vak staat zo nooit dubbel in het traject.
    const toggleBlok = useCallback((blok: Lesblok, bereik: { van: string; tot: string }) => {
        setTraject(t => {
            const bestaande = selectieVoorBlok(t, blok.klasgroep, blok.olodNaam, blok.start, bereik);
            if (bestaande) return t.filter(x => !sameSelectie(x, bestaande));
            return [
                ...t,
                { klasgroep: blok.klasgroep, olodNaam: blok.olodNaam, van: bereik.van, tot: bereik.tot },
            ];
        });
    }, []);

    // De selectie die een klik op een lesblok (op de gegeven datum, bij het
    // gegeven actieve bereik) zou weghalen, of null — spiegelt toggleBlok,
    // zodat het rooster precies die blokken als geselecteerd toont.
    const selectieVoor = useCallback(
        (klasgroep: string, olodNaam: string, datum: Date, bereik: { van: string; tot: string }) =>
            selectieVoorBlok(traject, klasgroep, olodNaam, datum, bereik),
        [traject]
    );

    const remove = useCallback((sel: OLODSelectie) => {
        setTraject(t => t.filter(x => !sameSelectie(x, sel)));
    }, []);

    // Wijzigt de periode van een bestaande selectie (bv. van het hele semester
    // naar enkel module 2). Bestaat er al een identieke selectie met de nieuwe
    // periode, dan valt de gewijzigde ermee samen.
    const setPeriode = useCallback((sel: OLODSelectie, van: string, tot: string) => {
        setTraject(t => {
            const nieuw: OLODSelectie = { ...sel, van, tot };
            const bestaat = t.some(x => !sameSelectie(x, sel) && sameSelectie(x, nieuw));
            return bestaat
                ? t.filter(x => !sameSelectie(x, sel))
                : t.map(x => (sameSelectie(x, sel) ? nieuw : x));
        });
    }, []);

    // Verhuist een bestaande selectie naar een andere klasgroep (zelfde vak,
    // zelfde periode). Bestaat er al een identieke selectie bij die klasgroep,
    // dan valt de gewijzigde ermee samen.
    const setKlasgroep = useCallback((sel: OLODSelectie, klasgroep: string) => {
        setTraject(t => {
            const nieuw: OLODSelectie = { ...sel, klasgroep };
            const bestaat = t.some(x => !sameSelectie(x, sel) && sameSelectie(x, nieuw));
            return bestaat
                ? t.filter(x => !sameSelectie(x, sel))
                : t.map(x => (sameSelectie(x, sel) ? nieuw : x));
        });
    }, []);

    const reset = useCallback(() => setTraject([]), []);

    const replaceTraject = useCallback((next: StudentTraject) => {
        setTraject(normalizeTraject(next));
    }, []);

    return { traject, toggleBlok, selectieVoor, remove, setPeriode, setKlasgroep, reset, replaceTraject };
}

export function useKleurMap() {
    const [map, setMap] = useState<KleurMap>(() => loadJSON<KleurMap>(KEY_KLEUR, {}));

    useEffect(() => {
        persist(KEY_KLEUR, map);
    }, [map]);

    const ensureColor = useCallback((olodNaam: string): void => {
        setMap(m => {
            if (m[olodNaam]) return m;
            return { ...m, [olodNaam]: allocateColor(Object.keys(m).length) };
        });
    }, []);

    const colorOf = useCallback((olodNaam: string): string => {
        return map[olodNaam] ?? allocateColor(0);
    }, [map]);

    const replaceMap = useCallback((next: KleurMap) => {
        setMap(next);
    }, []);

    const resetColors = useCallback(() => {
        setMap({});
    }, []);

    return { map, ensureColor, colorOf, replaceMap, resetColors };
}
