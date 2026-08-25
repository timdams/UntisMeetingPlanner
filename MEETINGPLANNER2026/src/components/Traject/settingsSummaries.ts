// Pure helpers voor het instellingenscherm: de één-regel-samenvattingen in de
// kaartkoppen en de groepering van de klasgroeplijst. Geen React, geen state,
// zodat dit los van de UI te testen is.

import { TrajectSettings } from './types';
import { effectieveModuleGrenzen } from './academicYear';
import { formatDateBE, formatDateTime, parseIsoDate } from './dateUtils';

export type SummaryTone = 'normal' | 'warn';

export interface CardSummary {
    text: string;
    tone: SummaryTone;
}

// "7 klasgroepen · 1ITAI1, 1ITVTAI_EA, 1ITVTAI_TI, +4" — verwacht de al
// natuurlijk gesorteerde selectie.
export function klasgroepenSummary(gesorteerd: string[]): CardSummary {
    const n = gesorteerd.length;
    if (n === 0) return { text: 'Nog geen klasgroepen gekozen', tone: 'warn' };
    const eerste = gesorteerd.slice(0, 3).join(', ');
    const rest = n > 3 ? `, +${n - 3}` : '';
    return {
        text: `${n} ${n === 1 ? 'klasgroep' : 'klasgroepen'} · ${eerste}${rest}`,
        tone: 'normal',
    };
}

// Gebruikt bewust de effectieve (gevalideerde) grenzen, zodat een lege of
// foute invoer toch een leesbare datum oplevert; de waarschuwing zelf komt
// via `grenzenOngeldig`.
export function periodeSummary(
    settings: Pick<TrajectSettings, 'periodeType' | 'moduleGrenzen'>,
    grenzenOngeldig: boolean
): CardSummary {
    if (settings.periodeType !== 'module') return { text: 'Semesters', tone: 'normal' };
    const g = effectieveModuleGrenzen(settings.moduleGrenzen);
    const basis =
        `Modules · M2 vanaf ${formatDateBE(parseIsoDate(g.m2Start))}` +
        ` · M4 vanaf ${formatDateBE(parseIsoDate(g.m4Start))}`;
    return grenzenOngeldig
        ? { text: `${basis} · grens ongeldig`, tone: 'warn' }
        : { text: basis, tone: 'normal' };
}

export function deelSummary(aantalKlasgroepen: number): CardSummary {
    if (aantalKlasgroepen === 0) return { text: 'Kies eerst klasgroepen', tone: 'warn' };
    return {
        text: `Link of QR-code voor ${aantalKlasgroepen} ${aantalKlasgroepen === 1 ? 'klasgroep' : 'klasgroepen'}`,
        tone: 'normal',
    };
}

// "nooit" is pas een waarschuwing zodra er iets te verliezen valt.
export function backupSummary(lastBackup: string | null, heeftData: boolean): CardSummary {
    const d = lastBackup ? new Date(lastBackup) : null;
    if (d && !Number.isNaN(d.getTime())) {
        return { text: `Laatste back-up: ${formatDateTime(d)}`, tone: 'normal' };
    }
    return { text: 'Laatste back-up: nooit', tone: heeftData ? 'warn' : 'normal' };
}

export interface KlasgroepGroep {
    label: string;
    items: string[];
}

// Groepeert klasgroepen op het eerste cijfer van hun naam ("1e jaar", "2e
// jaar", …); namen zonder leidend cijfer komen achteraan onder "Overige". De
// volgorde binnen een groep is die van de invoer, zodat het zoekfilter en
// "Selecteer alle/geen" op dezelfde zichtbare lijst blijven werken.
export function groepeerKlasgroepen(klasgroepen: string[]): KlasgroepGroep[] {
    const perJaar = new Map<string, string[]>();
    const overige: string[] = [];
    for (const k of klasgroepen) {
        const m = /^\s*(\d)/.exec(k);
        if (m) {
            const list = perJaar.get(m[1]) ?? [];
            list.push(k);
            perJaar.set(m[1], list);
        } else {
            overige.push(k);
        }
    }
    const groepen: KlasgroepGroep[] = Array.from(perJaar.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cijfer, items]) => ({ label: `${cijfer}e jaar`, items }));
    if (overige.length > 0) groepen.push({ label: 'Overige', items: overige });
    return groepen;
}
