// Eén bron van waarheid voor "welke lesblokken zitten er effectief in het
// traject, en welke overlappen elkaar". Zowel het studentoverzicht (paneel C)
// als de scoring van de bulk-klasgroepkiezer (paneel A) rekenen hiermee, zodat
// het conflictaantal in de kiezer exact overeenkomt met wat de wat-als-preview
// daarna toont.

import type { Conflict, Lesblok, OLODSelectie, StudentTraject } from './types';
import { datumInBereik } from './dateUtils';

export function overlapt(a: Lesblok, b: Lesblok): boolean {
    return a.start.getTime() < b.eind.getTime() && b.start.getTime() < a.eind.getTime();
}

/**
 * Alle paren lesblokken die elkaar in de tijd overlappen. Loopt over gesorteerde
 * startijden met een vroege break: zodra een volgend blok pas na het einde van
 * het huidige begint, kunnen de daaropvolgende dat ook niet meer raken.
 */
export function detectConflicts(blokken: Lesblok[]): Conflict[] {
    const conflicts: Conflict[] = [];
    const sorted = [...blokken].sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
            if (sorted[j].start.getTime() >= sorted[i].eind.getTime()) break;
            if (overlapt(sorted[i], sorted[j])) {
                conflicts.push({ a: sorted[i], b: sorted[j] });
            }
        }
    }
    return conflicts;
}

/**
 * De lesblokken die het traject effectief bevat: elk blok waarvan een selectie
 * van dat vak bij die klasgroep het blok in haar periode heeft. Twee selecties
 * kunnen elkaar overlappen (bv. een S1-keuze naast een M2-keuze van hetzelfde
 * vak); hetzelfde blok komt dan maar één keer in de lijst.
 */
export function effectieveBlokken(
    traject: StudentTraject,
    blokkenPerKlas: Record<string, Lesblok[]>,
    start: Date,
    eind: Date
): Lesblok[] {
    const perTuple = new Map<string, StudentTraject>();
    for (const s of traject) {
        const key = `${s.klasgroep}||${s.olodNaam}`;
        const arr = perTuple.get(key);
        if (arr) arr.push(s);
        else perTuple.set(key, [s]);
    }
    const out: Lesblok[] = [];
    for (const k of new Set(traject.map(s => s.klasgroep))) {
        const bs = blokkenPerKlas[k] ?? [];
        for (const b of bs) {
            const sels = perTuple.get(`${b.klasgroep}||${b.olodNaam}`);
            if (!sels) continue;
            if (b.start.getTime() < start.getTime() || b.eind.getTime() > eind.getTime()) continue;
            if (sels.some(s => datumInBereik(b.start, s.van, s.tot))) out.push(b);
        }
    }
    return out;
}

function zelfdeSelectie(a: OLODSelectie, b: OLODSelectie): boolean {
    return a.klasgroep === b.klasgroep && a.olodNaam === b.olodNaam && a.van === b.van && a.tot === b.tot;
}

/**
 * De lesblokken die bij een wissel van `sels` naar een andere klasgroep zouden
 * verdwijnen: die van de verhuizende selecties, tenzij een andere selectie van
 * hetzelfde vak bij dezelfde klasgroep ze ook dekt (bv. een S1-keuze naast de
 * verhuizende M2-keuze).
 */
export function wegBlokkenVoor(
    sels: OLODSelectie[],
    traject: StudentTraject,
    effectieve: Lesblok[]
): Set<Lesblok> {
    const out = new Set<Lesblok>();
    if (sels.length === 0) return out;
    const verhuist = (s: OLODSelectie) => sels.some(sel => zelfdeSelectie(sel, s));
    for (const sel of sels) {
        const anderen = traject.filter(
            s => s.klasgroep === sel.klasgroep && s.olodNaam === sel.olodNaam && !verhuist(s)
        );
        for (const b of effectieve) {
            if (b.klasgroep !== sel.klasgroep || b.olodNaam !== sel.olodNaam) continue;
            if (!datumInBereik(b.start, sel.van, sel.tot)) continue;
            if (anderen.some(s => datumInBereik(b.start, s.van, s.tot))) continue;
            out.add(b);
        }
    }
    return out;
}

function blokKey(b: Lesblok): string {
    return `${b.klasgroep}|${b.olodNaam}|${b.start.getTime()}`;
}

/**
 * De lesblokken die er bij een wissel van `sels` naar `klasgroep` zouden
 * bijkomen: uit het rooster van die klasgroep de lessen van elk verhuizend vak
 * binnen de periode van zijn selectie, zonder de blokken die al in het traject
 * zitten (bv. een bestaande keuze van hetzelfde vak bij de doelklasgroep).
 */
export function ghostBlokkenVoor(
    sels: OLODSelectie[],
    klasgroep: string,
    kandidaatBlokken: Lesblok[],
    effectieve: Lesblok[],
    start: Date,
    eind: Date
): Lesblok[] {
    if (sels.length === 0) return [];
    const aanwezig = new Set(effectieve.map(blokKey));
    const out: Lesblok[] = [];
    const gezien = new Set<string>();
    for (const b of kandidaatBlokken) {
        if (b.klasgroep !== klasgroep) continue;
        if (b.start.getTime() < start.getTime() || b.eind.getTime() > eind.getTime()) continue;
        if (!sels.some(s => s.olodNaam === b.olodNaam && datumInBereik(b.start, s.van, s.tot))) continue;
        const key = blokKey(b);
        if (aanwezig.has(key) || gezien.has(key)) continue;
        gezien.add(key);
        out.push(b);
    }
    return out;
}

/** Het rooster zoals het er na de wissel uitziet: bestaand − weg + ghost. */
export function scenarioBlokken(
    effectieve: Lesblok[],
    weg: Set<Lesblok>,
    ghost: Lesblok[]
): Lesblok[] {
    return ghost.length === 0 && weg.size === 0
        ? effectieve
        : [...effectieve.filter(b => !weg.has(b)), ...ghost];
}
