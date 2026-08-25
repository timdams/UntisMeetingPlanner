import { useState, useEffect, useCallback } from 'react';
import { TrajectSettings, StudentTraject, KleurMap, OLODSelectie, Lesblok } from './types';
import type { TrajectPreset } from './trajectShare';
import {
    academiejaarBereik,
    actievePeriode,
    defaultModuleGrenzen,
    defaultSemesterPeriode,
    modulePeriodes,
    periodesVoor,
    valtBinnenAcademiejaar,
    type ModuleGrenzen,
    type PeriodeType,
} from './academicYear';
import { datumInBereik, isIsoDate, parseIsoDate } from './dateUtils';

const KEY_SETTINGS = 'traject_settings';
const KEY_TRAJECT = 'traject_student';
const KEY_KLEUR = 'traject_kleurmap';
const KEY_MIGRATION = 'traject_migration_version';
const KEY_LAST_BACKUP = 'traject_last_backup';

// Verhoog dit nummer bij een breaking change in opgeslagen data. runTrajectMigrations()
// draait dan eenmalig de bijhorende opkuis voor bestaande gebruikers.
//   v1 — academiejaar-update: klasgroep-shortlist (oude resource-IDs) wissen.
//   v2 — semesterperiode die buiten het academiejaar valt (oude today-based
//        default) resetten naar het lopende semester van het nieuwe jaar.
// Nieuwe velden die enkel een standaardwaarde nodig hebben (periodeType,
// moduleGrenzen, van/tot op een selectie) vergen géén migratie: die vult
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
 * semester-indeling en modulegrenzen halverwege elk semester.
 */
export function normalizeSettings(raw: unknown): TrajectSettings {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const { start, eind } = defaultSemesterPeriode();
    const klasgroepen = Array.isArray(r.mijnOpleidingKlasgroepen)
        ? r.mijnOpleidingKlasgroepen.filter((x): x is string => typeof x === 'string')
        : [];
    const grenzen = (r.moduleGrenzen && typeof r.moduleGrenzen === 'object'
        ? r.moduleGrenzen
        : {}) as Record<string, unknown>;
    const def = defaultModuleGrenzen();
    return {
        mijnOpleidingKlasgroepen: klasgroepen,
        semesterStart: typeof r.semesterStart === 'string' ? r.semesterStart : start,
        semesterEind: typeof r.semesterEind === 'string' ? r.semesterEind : eind,
        periodeType: r.periodeType === 'module' ? 'module' : 'semester',
        moduleGrenzen: {
            m2Start: isIsoDate(grenzen.m2Start) ? grenzen.m2Start : def.m2Start,
            m4Start: isIsoDate(grenzen.m4Start) ? grenzen.m4Start : def.m4Start,
        },
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
    for (const item of raw) {
        const it = (item && typeof item === 'object' ? item : null) as Record<string, unknown> | null;
        if (!it || typeof it.klasgroep !== 'string' || typeof it.olodNaam !== 'string') continue;
        out.push({
            klasgroep: it.klasgroep,
            olodNaam: it.olodNaam,
            van: isIsoDate(it.van) ? it.van : jaar.van,
            tot: isIsoDate(it.tot) ? it.tot : jaar.tot,
        });
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
 * een link van na de periode-switcher — de indeling en modulegrenzen) toe op
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
        moduleGrenzen: preset.moduleGrenzen ?? current.moduleGrenzen,
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
            const oud = actievePeriode(periodesVoor(s.periodeType, s.moduleGrenzen), s.semesterStart, s.semesterEind);
            const nieuwId = oud ? PERIODE_BIJ_TYPEWISSEL[oud.id] : undefined;
            const nieuw = nieuwId
                ? periodesVoor(type, s.moduleGrenzen).find(p => p.id === nieuwId)
                : undefined;
            return {
                ...s,
                periodeType: type,
                semesterStart: nieuw ? nieuw.start : s.semesterStart,
                semesterEind: nieuw ? nieuw.eind : s.semesterEind,
            };
        });
    }, []);

    // Was de actieve periode exact een module, dan volgt ze de nieuwe grenzen.
    const setModuleGrenzen = useCallback((grenzen: ModuleGrenzen) => {
        setSettings(s => {
            const oud = actievePeriode(modulePeriodes(s.moduleGrenzen), s.semesterStart, s.semesterEind);
            const nieuw = oud ? modulePeriodes(grenzen).find(p => p.id === oud.id) : undefined;
            return {
                ...s,
                moduleGrenzen: grenzen,
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
        setModuleGrenzen,
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

export function useStudentTraject() {
    const [traject, setTraject] = useState<StudentTraject>(() =>
        normalizeTraject(loadJSON<unknown>(KEY_TRAJECT, null))
    );

    useEffect(() => {
        persist(KEY_TRAJECT, traject);
    }, [traject]);

    // Klik op een lesblok: valt het blok onder een bestaande selectie van dit
    // vak bij deze klasgroep, dan verdwijnt die selectie (voor haar hele
    // periode); anders komt er een selectie bij voor het meegegeven bereik —
    // de periode die op dat moment actief is.
    const toggleBlok = useCallback((blok: Lesblok, bereik: { van: string; tot: string }) => {
        setTraject(t => {
            const bestaande = selectieDieDekt(t, blok.klasgroep, blok.olodNaam, blok.start);
            if (bestaande) return t.filter(x => !sameSelectie(x, bestaande));
            return [
                ...t,
                { klasgroep: blok.klasgroep, olodNaam: blok.olodNaam, van: bereik.van, tot: bereik.tot },
            ];
        });
    }, []);

    // De selectie waaronder een lesblok op de gegeven datum valt, of null.
    const selectieVoor = useCallback(
        (klasgroep: string, olodNaam: string, datum: Date) =>
            selectieDieDekt(traject, klasgroep, olodNaam, datum),
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

    const reset = useCallback(() => setTraject([]), []);

    const replaceTraject = useCallback((next: StudentTraject) => {
        setTraject(normalizeTraject(next));
    }, []);

    return { traject, toggleBlok, selectieVoor, remove, setPeriode, reset, replaceTraject };
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
