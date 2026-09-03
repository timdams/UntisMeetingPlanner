import { useCallback, useEffect, useState } from 'react';
import { isIsoDate, mondayOf, parseIsoDate, toIsoDate } from '../Traject/dateUtils';
import {
    effectievePeriode,
    normalizePeriode,
    standaardPeriode,
    standaardWeek,
    type ExamenPeriode,
    type PeriodeVeld,
} from './periode';
import { sorteerKlasgroepen, type ExamenActief, type Jaargroep, type Opleiding } from './types';

// Opslagsleutels dragen het prefix `examen_` — de Traject Planner deelt
// dezelfde localStorage en gebruikt `traject_`.
const KEY_OPLEIDINGEN = 'examen_opleidingen';
const KEY_ACTIEF = 'examen_actief';
const KEY_PERIODE = 'examen_periode';
// Alleen-lezen: de eerste keer nemen we de semestergrenzen van de Traject
// Planner over, zodat dezelfde gebruiker ze niet twee keer hoeft in te geven.
const KEY_TRAJECT_SETTINGS = 'traject_settings';

function loadJSON<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

function persist<T>(key: string, value: T) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // localStorage onbeschikbaar of vol — de sessie werkt gewoon verder
    }
}

export function nieuwId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function stringLijst(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const uniek = new Set<string>();
    for (const x of raw) {
        if (typeof x === 'string' && x.trim()) uniek.add(x.trim());
    }
    return sorteerKlasgroepen(uniek);
}

/**
 * Maakt van willekeurige opgeslagen data een geldige jaargroep binnen een
 * opleiding: enkel klasgroepen die tot de opleiding behoren blijven staan, en
 * een klasgroep zit in hoogstens één jaargroep (de eerste wint).
 */
function normalizeJaargroep(raw: unknown, toegelaten: Set<string>, bezet: Set<string>): Jaargroep | null {
    const it = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
    if (!it) return null;
    const klasgroepen = stringLijst(it.klasgroepen).filter(k => toegelaten.has(k) && !bezet.has(k));
    klasgroepen.forEach(k => bezet.add(k));
    return {
        id: typeof it.id === 'string' && it.id ? it.id : nieuwId(),
        naam: typeof it.naam === 'string' ? it.naam : '',
        klasgroepen,
    };
}

export function normalizeOpleiding(raw: unknown): Opleiding | null {
    const it = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
    if (!it || typeof it.naam !== 'string') return null;
    const klasgroepen = stringLijst(it.klasgroepen);
    const toegelaten = new Set(klasgroepen);
    const bezet = new Set<string>();
    const jaargroepen: Jaargroep[] = [];
    if (Array.isArray(it.jaargroepen)) {
        for (const j of it.jaargroepen) {
            const jg = normalizeJaargroep(j, toegelaten, bezet);
            if (jg) jaargroepen.push(jg);
        }
    }
    const opleiding: Opleiding = {
        id: typeof it.id === 'string' && it.id ? it.id : nieuwId(),
        naam: it.naam,
        klasgroepen,
        jaargroepen,
    };
    // Het veld ontbreekt bij verreweg de meeste opleidingen: die volgen de
    // algemene grenzen. Enkel wanneer het er staat wordt het genormaliseerd —
    // een leeg object zou anders als "eigen grenzen" gelden.
    if (it.eigenPeriode && typeof it.eigenPeriode === 'object') {
        opleiding.eigenPeriode = normalizePeriode(it.eigenPeriode);
    }
    return opleiding;
}

export function normalizeOpleidingen(raw: unknown): Opleiding[] {
    if (!Array.isArray(raw)) return [];
    const out: Opleiding[] = [];
    const ids = new Set<string>();
    for (const item of raw) {
        const o = normalizeOpleiding(item);
        if (!o || ids.has(o.id)) continue;
        ids.add(o.id);
        out.push(o);
    }
    return out;
}

// ===== Semestergrenzen =====

function laadPeriode(): ExamenPeriode {
    const eigen = loadJSON<unknown>(KEY_PERIODE, null);
    if (eigen) return normalizePeriode(eigen);
    // Nog niets van onszelf: startwaarden uit de Traject Planner, als die er
    // zijn. Ontbreken ze of zijn ze ongeldig, dan gelden de standaarddatums.
    const traject = loadJSON<unknown>(KEY_TRAJECT_SETTINGS, null);
    const grenzen =
        traject && typeof traject === 'object'
            ? (traject as Record<string, unknown>).periodeGrenzen
            : null;
    return normalizePeriode(grenzen ?? null);
}

export function useExamenPeriode() {
    const [periode, setPeriode] = useState<ExamenPeriode>(laadPeriode);

    useEffect(() => {
        persist(KEY_PERIODE, periode);
    }, [periode]);

    // Ruwe invoer bewaren (ook leeg of ongeldig), zodat de gebruiker kan
    // corrigeren; wat effectief geldt bepaalt periode.ts.
    const zetGrens = useCallback((veld: PeriodeVeld, iso: string) => {
        setPeriode(p => (p[veld] === iso ? p : { ...p, [veld]: iso }));
    }, []);

    const herstel = useCallback(() => setPeriode(standaardPeriode()), []);

    return { periode, zetGrens, herstel };
}

/**
 * De grenzen die bij het opstarten voor de bewaarde opleiding gelden. Zonder
 * dit zou het overzicht openen op de algemene examenweek en die pas na de
 * eerste render corrigeren — met een zichtbare weeksprong en een overbodige
 * Untis-ophaling voor een opleiding met een eigen periode. Dezelfde keuze van
 * actieve opleiding als in ExamenOverzicht: de bewaarde, anders de eerste.
 */
function laadPeriodeVoor(opleidingId: string | null): ExamenPeriode {
    const lijst = normalizeOpleidingen(loadJSON<unknown>(KEY_OPLEIDINGEN, null));
    const opleiding = lijst.find(o => o.id === opleidingId) ?? lijst[0];
    return effectievePeriode(laadPeriode(), opleiding?.eigenPeriode);
}

function normalizeActief(raw: unknown): ExamenActief {
    const it = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    // Enkel een week die de gebruiker zelf koos blijft staan; anders opent het
    // overzicht op de eerstvolgende examenweek volgens de semestergrenzen.
    const gekozen = it.weekGekozen === true && isIsoDate(it.weekMaandag);
    const opleidingId = typeof it.opleidingId === 'string' ? it.opleidingId : null;
    return {
        opleidingId,
        weekMaandag: gekozen
            ? toIsoDate(mondayOf(parseIsoDate(it.weekMaandag as string)))
            : standaardWeek(laadPeriodeVoor(opleidingId)),
        weekGekozen: gekozen,
    };
}

/** Naam van een opleiding, hoofdletter- en accentongevoelig vergeleken. */
export function zelfdeNaam(a: string, b: string): boolean {
    return a.trim().localeCompare(b.trim(), 'nl', { sensitivity: 'base' }) === 0;
}

/** De klasgroepen van een opleiding die in geen enkele jaargroep zitten. */
export function nietIngedeeld(opleiding: Opleiding): string[] {
    const bezet = new Set(opleiding.jaargroepen.flatMap(j => j.klasgroepen));
    return opleiding.klasgroepen.filter(k => !bezet.has(k));
}

export function useOpleidingen() {
    const [opleidingen, setOpleidingen] = useState<Opleiding[]>(() =>
        normalizeOpleidingen(loadJSON<unknown>(KEY_OPLEIDINGEN, null))
    );

    useEffect(() => {
        persist(KEY_OPLEIDINGEN, opleidingen);
    }, [opleidingen]);

    const wijzig = useCallback((id: string, f: (o: Opleiding) => Opleiding) => {
        setOpleidingen(lijst => lijst.map(o => (o.id === id ? f(o) : o)));
    }, []);

    const voegToe = useCallback((naam: string): string => {
        const id = nieuwId();
        setOpleidingen(lijst => [...lijst, { id, naam: naam.trim(), klasgroepen: [], jaargroepen: [] }]);
        return id;
    }, []);

    const hernoem = useCallback(
        (id: string, naam: string) => wijzig(id, o => ({ ...o, naam: naam.trim() })),
        [wijzig]
    );

    const verwijder = useCallback((id: string) => {
        setOpleidingen(lijst => lijst.filter(o => o.id !== id));
    }, []);

    // Zet de overrule aan (met de meegegeven grenzen als startwaarde, meestal
    // de algemene) of weer uit. Uit betekent: het veld verdwijnt, zodat de
    // opleiding de algemene grenzen volgt zoals ze mee-evolueren.
    const zetEigenPeriode = useCallback(
        (id: string, periode: ExamenPeriode | null) =>
            wijzig(id, o => {
                if (!periode) {
                    if (!o.eigenPeriode) return o;
                    return { id: o.id, naam: o.naam, klasgroepen: o.klasgroepen, jaargroepen: o.jaargroepen };
                }
                return { ...o, eigenPeriode: { ...periode } };
            }),
        [wijzig]
    );

    // Wijzigt één grensdatum van de overrule. Ruwe invoer blijft staan (ook
    // leeg), net als bij de algemene grenzen; wat effectief geldt bepaalt
    // `effectievePeriode`.
    const zetEigenGrens = useCallback(
        (id: string, veld: PeriodeVeld, iso: string) =>
            wijzig(id, o =>
                !o.eigenPeriode || o.eigenPeriode[veld] === iso
                    ? o
                    : { ...o, eigenPeriode: { ...o.eigenPeriode, [veld]: iso } }
            ),
        [wijzig]
    );

    // Vervangt de klasgroepen van een opleiding; klasgroepen die verdwijnen
    // gaan ook uit hun jaargroep.
    const setKlasgroepen = useCallback(
        (id: string, klasgroepen: string[]) =>
            wijzig(id, o => {
                const nieuw = sorteerKlasgroepen(new Set(klasgroepen));
                const set = new Set(nieuw);
                return {
                    ...o,
                    klasgroepen: nieuw,
                    jaargroepen: o.jaargroepen.map(j => ({
                        ...j,
                        klasgroepen: j.klasgroepen.filter(k => set.has(k)),
                    })),
                };
            }),
        [wijzig]
    );

    const toggleKlasgroep = useCallback(
        (id: string, klasgroep: string) =>
            wijzig(id, o => {
                const bestaat = o.klasgroepen.includes(klasgroep);
                const nieuw = bestaat
                    ? o.klasgroepen.filter(k => k !== klasgroep)
                    : sorteerKlasgroepen([...o.klasgroepen, klasgroep]);
                return {
                    ...o,
                    klasgroepen: nieuw,
                    jaargroepen: bestaat
                        ? o.jaargroepen.map(j => ({
                              ...j,
                              klasgroepen: j.klasgroepen.filter(k => k !== klasgroep),
                          }))
                        : o.jaargroepen,
                };
            }),
        [wijzig]
    );

    const voegJaargroepToe = useCallback(
        (opleidingId: string, naam: string, klasgroepen: string[] = []): string => {
            const jid = nieuwId();
            wijzig(opleidingId, o => {
                const set = new Set(klasgroepen);
                return {
                    ...o,
                    jaargroepen: [
                        // Een klasgroep zit in hoogstens één jaargroep.
                        ...o.jaargroepen.map(j => ({
                            ...j,
                            klasgroepen: j.klasgroepen.filter(k => !set.has(k)),
                        })),
                        {
                            id: jid,
                            naam: naam.trim(),
                            klasgroepen: sorteerKlasgroepen(klasgroepen.filter(k => o.klasgroepen.includes(k))),
                        },
                    ],
                };
            });
            return jid;
        },
        [wijzig]
    );

    const hernoemJaargroep = useCallback(
        (opleidingId: string, jaargroepId: string, naam: string) =>
            wijzig(opleidingId, o => ({
                ...o,
                jaargroepen: o.jaargroepen.map(j => (j.id === jaargroepId ? { ...j, naam: naam.trim() } : j)),
            })),
        [wijzig]
    );

    const verwijderJaargroep = useCallback(
        (opleidingId: string, jaargroepId: string) =>
            wijzig(opleidingId, o => ({
                ...o,
                jaargroepen: o.jaargroepen.filter(j => j.id !== jaargroepId),
            })),
        [wijzig]
    );

    // Verhuist klasgroepen naar een jaargroep (of, met `null`, naar "niet
    // ingedeeld"). Ze verdwijnen uit elke andere jaargroep.
    const verplaatsKlasgroepen = useCallback(
        (opleidingId: string, klasgroepen: string[], naarJaargroepId: string | null) =>
            wijzig(opleidingId, o => {
                const set = new Set(klasgroepen.filter(k => o.klasgroepen.includes(k)));
                if (set.size === 0) return o;
                return {
                    ...o,
                    jaargroepen: o.jaargroepen.map(j => {
                        const zonder = j.klasgroepen.filter(k => !set.has(k));
                        if (j.id === naarJaargroepId) {
                            return { ...j, klasgroepen: sorteerKlasgroepen([...zonder, ...set]) };
                        }
                        return { ...j, klasgroepen: zonder };
                    }),
                };
            }),
        [wijzig]
    );

    const verplaatsKlasgroep = useCallback(
        (opleidingId: string, klasgroep: string, naarJaargroepId: string | null) =>
            verplaatsKlasgroepen(opleidingId, [klasgroep], naarJaargroepId),
        [verplaatsKlasgroepen]
    );

    // Vervangt de volledige indeling (bv. na een clustervoorstel).
    const vervangJaargroepen = useCallback(
        (opleidingId: string, jaargroepen: Array<{ naam: string; klasgroepen: string[] }>) =>
            wijzig(opleidingId, o => {
                const toegelaten = new Set(o.klasgroepen);
                const bezet = new Set<string>();
                return {
                    ...o,
                    jaargroepen: jaargroepen
                        .map(j => normalizeJaargroep(j, toegelaten, bezet))
                        .filter((j): j is Jaargroep => j !== null),
                };
            }),
        [wijzig]
    );

    // Neemt een opleiding over uit een deel-link. Met `vervangId` vervangt ze
    // een bestaande opleiding (zelfde naam) en behoudt die haar id, zodat de
    // actieve keuze blijft kloppen. Geeft het id van de (nieuwe) opleiding.
    const importeer = useCallback((opleiding: Opleiding, vervangId?: string): string => {
        const id = vervangId ?? nieuwId();
        const nieuw: Opleiding = normalizeOpleiding({ ...opleiding, id }) ?? {
            id,
            naam: opleiding.naam,
            klasgroepen: [],
            jaargroepen: [],
        };
        setOpleidingen(lijst =>
            vervangId && lijst.some(o => o.id === vervangId)
                ? lijst.map(o => (o.id === vervangId ? nieuw : o))
                : [...lijst, nieuw]
        );
        return id;
    }, []);

    return {
        opleidingen,
        voegToe,
        hernoem,
        verwijder,
        zetEigenPeriode,
        zetEigenGrens,
        setKlasgroepen,
        toggleKlasgroep,
        voegJaargroepToe,
        hernoemJaargroep,
        verwijderJaargroep,
        verplaatsKlasgroep,
        verplaatsKlasgroepen,
        vervangJaargroepen,
        importeer,
    };
}

export function useExamenActief() {
    const [actief, setActief] = useState<ExamenActief>(() =>
        normalizeActief(loadJSON<unknown>(KEY_ACTIEF, null))
    );

    useEffect(() => {
        persist(KEY_ACTIEF, actief);
    }, [actief]);

    const setOpleidingId = useCallback((opleidingId: string | null) => {
        setActief(a => (a.opleidingId === opleidingId ? a : { ...a, opleidingId }));
    }, []);

    // Neemt eender welke datum en zet de maandag van die week actief, als
    // bewuste keuze van de gebruiker. Een ISO-datum wordt als lokale datum
    // gelezen (new Date('YYYY-MM-DD') zou UTC-middernacht nemen en in een
    // westelijke tijdzone een dag opschuiven).
    const setWeek = useCallback((datum: Date | string) => {
        const d =
            typeof datum === 'string' ? (isIsoDate(datum) ? parseIsoDate(datum) : new Date(datum)) : datum;
        if (Number.isNaN(d.getTime())) return;
        const iso = toIsoDate(mondayOf(d));
        setActief(a => (a.weekMaandag === iso && a.weekGekozen ? a : { ...a, weekMaandag: iso, weekGekozen: true }));
    }, []);

    // Laat de week de standaard volgen (bv. na gewijzigde semestergrenzen)
    // zolang de gebruiker nog geen eigen keuze maakte.
    const volgStandaard = useCallback((iso: string) => {
        setActief(a => (a.weekGekozen || a.weekMaandag === iso ? a : { ...a, weekMaandag: iso }));
    }, []);

    return { actief, setOpleidingId, setWeek, volgStandaard };
}
