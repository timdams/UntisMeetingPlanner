import { useState, useEffect, useCallback } from 'react';
import { TrajectSettings, StudentTraject, KleurMap, OLODSelectie } from './types';

const KEY_SETTINGS = 'traject_settings';
const KEY_TRAJECT = 'traject_student';
const KEY_KLEUR = 'traject_kleurmap';

const PALETTE = [
    '#E11D48', '#2563EB', '#059669', '#D97706', '#7C3AED',
    '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#0D9488',
    '#9333EA', '#CA8A04',
];

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function plusMonthsIso(months: number): string {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
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

export function useTrajectSettings() {
    const [settings, setSettings] = useState<TrajectSettings>(() =>
        loadJSON<TrajectSettings>(KEY_SETTINGS, {
            mijnOpleidingKlasgroepen: [],
            semesterStart: todayIso(),
            semesterEind: plusMonthsIso(5),
        })
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

    return { settings, toggleKlasgroep, setSemesterStart, setSemesterEind };
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

    return { traject, toggle, isSelected, reset };
}

export function useKleurMap() {
    const [map, setMap] = useState<KleurMap>(() => loadJSON<KleurMap>(KEY_KLEUR, {}));

    useEffect(() => {
        persist(KEY_KLEUR, map);
    }, [map]);

    const ensureColor = useCallback((olodNaam: string): string => {
        if (map[olodNaam]) return map[olodNaam];
        // Allocate next color in palette (cycle if exhausted)
        const used = new Set(Object.values(map));
        const free = PALETTE.find(c => !used.has(c)) ?? PALETTE[Object.keys(map).length % PALETTE.length];
        setMap(m => (m[olodNaam] ? m : { ...m, [olodNaam]: free }));
        return free;
    }, [map]);

    const colorOf = useCallback((olodNaam: string): string => {
        return map[olodNaam] ?? PALETTE[0];
    }, [map]);

    return { map, ensureColor, colorOf };
}
