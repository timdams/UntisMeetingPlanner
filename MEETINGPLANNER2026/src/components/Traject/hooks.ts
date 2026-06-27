import { useState, useEffect, useCallback } from 'react';
import { TrajectSettings, StudentTraject, KleurMap, OLODSelectie } from './types';
import type { TrajectPreset } from './trajectShare';
import { defaultSemesterPeriode, valtBinnenAcademiejaar } from './academicYear';
import { parseIsoDate } from './dateUtils';

const KEY_SETTINGS = 'traject_settings';
const KEY_TRAJECT = 'traject_student';
const KEY_KLEUR = 'traject_kleurmap';
const KEY_MIGRATION = 'traject_migration_version';

// Verhoog dit nummer bij een breaking change in opgeslagen data. runTrajectMigrations()
// draait dan eenmalig de bijhorende opkuis voor bestaande gebruikers.
//   v1 — academiejaar-update: klasgroep-shortlist (oude resource-IDs) wissen.
//   v2 — semesterperiode die buiten het academiejaar valt (oude today-based
//        default) resetten naar het lopende semester van het nieuwe jaar.
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

// Verse-start instellingen: lege klasgroep-shortlist + het lopende semester van
// het geplande academiejaar (zie academicYear.ts). Reeds opgeslagen instellingen
// in localStorage blijven ongemoeid — dit geldt enkel voor een eerste gebruik.
function defaultSettings(): TrajectSettings {
    const { start, eind } = defaultSemesterPeriode();
    return {
        mijnOpleidingKlasgroepen: [],
        semesterStart: start,
        semesterEind: eind,
    };
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
 * Past een gedeelde preset (klasgroep-shortlist + semesterperiode) toe op de
 * opgeslagen instellingen. Wordt door {@link App} aangeroepen vóór React de
 * hooks initialiseert, zodat een student via een trajectbegeleider-link meteen
 * de juiste klasgroepen ziet. Het studenttraject en de kleurmap blijven ongemoeid.
 */
export function applyTrajectSettingsPreset(preset: TrajectPreset): void {
    const current = loadJSON<TrajectSettings>(KEY_SETTINGS, defaultSettings());
    persist(KEY_SETTINGS, {
        ...current,
        mijnOpleidingKlasgroepen: preset.mijnOpleidingKlasgroepen,
        semesterStart: preset.semesterStart,
        semesterEind: preset.semesterEind,
    });
}

export function useTrajectSettings() {
    const [settings, setSettings] = useState<TrajectSettings>(() =>
        loadJSON<TrajectSettings>(KEY_SETTINGS, defaultSettings())
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

    // Zet start én einde in één keer — gebruikt door de semester-snelkeuze.
    const setSemesterPeriode = useCallback((start: string, eind: string) => {
        setSettings(s => ({ ...s, semesterStart: start, semesterEind: eind }));
    }, []);

    const replaceSettings = useCallback((next: TrajectSettings) => {
        setSettings(next);
    }, []);

    const clearKlasgroepen = useCallback(() => {
        setSettings(s => ({ ...s, mijnOpleidingKlasgroepen: [] }));
    }, []);

    return {
        settings,
        toggleKlasgroep,
        setSemesterStart,
        setSemesterEind,
        setSemesterPeriode,
        replaceSettings,
        clearKlasgroepen,
    };
}

function sameSelectie(a: OLODSelectie, b: OLODSelectie) {
    return a.klasgroep === b.klasgroep && a.olodNaam === b.olodNaam;
}

export function useStudentTraject() {
    const [traject, setTraject] = useState<StudentTraject>(() =>
        loadJSON<StudentTraject>(KEY_TRAJECT, [])
    );

    useEffect(() => {
        persist(KEY_TRAJECT, traject);
    }, [traject]);

    const toggle = useCallback((sel: OLODSelectie) => {
        setTraject(t => {
            const exists = t.some(x => sameSelectie(x, sel));
            return exists ? t.filter(x => !sameSelectie(x, sel)) : [...t, sel];
        });
    }, []);

    const isSelected = useCallback(
        (sel: OLODSelectie) => traject.some(x => sameSelectie(x, sel)),
        [traject]
    );

    const reset = useCallback(() => setTraject([]), []);

    const replaceTraject = useCallback((next: StudentTraject) => {
        setTraject(next);
    }, []);

    return { traject, toggle, isSelected, reset, replaceTraject };
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
