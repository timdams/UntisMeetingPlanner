// Pure helpers voor het instellingenscherm: de één-regel-samenvattingen in de
// kaartkoppen en de groepering van de klasgroeplijst. Geen React, geen state,
// zodat dit los van de UI te testen is.

import { TrajectSettings } from './types';
import { effectieveGrenzen, periodeLabelVoor } from './academicYear';
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
    settings: Pick<TrajectSettings, 'periodeType' | 'periodeGrenzen'>,
    grenzenOngeldig: boolean
): CardSummary {
    const g = effectieveGrenzen(settings.periodeGrenzen);
    const dag = (iso: string) => formatDateBE(parseIsoDate(iso));
    const basis =
        settings.periodeType === 'module'
            ? `Modules · M2 vanaf ${dag(g.m2Start)} · M4 vanaf ${dag(g.m4Start)}`
            : `Semesters · S1 ${dag(g.s1Start)}–${dag(g.s1Eind)} · S2 ${dag(g.s2Start)}–${dag(g.s2Eind)}`;
    return grenzenOngeldig
        ? { text: `${basis} · grens ongeldig`, tone: 'warn' }
        : { text: basis, tone: 'normal' };
}

// "7 klasgroepen · modules · M1" — de typering van één instellingenset. Gedeeld
// door het profielmenu in de contextbalk, de profielkaart in de instellingen en
// de bewaardialoog, zodat een profiel overal hetzelfde leest.
export function profielSamenvatting(settings: TrajectSettings): string {
    const n = settings.mijnOpleidingKlasgroepen.length;
    const periode = periodeLabelVoor(
        settings.semesterStart,
        settings.semesterEind,
        settings.periodeGrenzen
    );
    return [
        `${n} ${n === 1 ? 'klasgroep' : 'klasgroepen'}`,
        settings.periodeType === 'module' ? 'modules' : 'semesters',
        periode.kort,
    ].join(' · ');
}

// Kopregel van de profielkaart: hoeveel sets er bewaard zijn en in welke je
// werkt. Zonder profielen is dat geen waarschuwing — het is een gemak, geen
// verplichting.
export function profielenSummary(
    aantal: number,
    actieveNaam: string | null,
    gewijzigd: boolean
): CardSummary {
    if (aantal === 0) {
        return { text: 'Nog geen profielen — bewaar deze instellingen om snel te wisselen', tone: 'normal' };
    }
    const basis = `${aantal} ${aantal === 1 ? 'profiel' : 'profielen'}`;
    if (!actieveNaam) return { text: `${basis} · geen actief`, tone: 'normal' };
    return {
        text: `${basis} · actief: ${actieveNaam}${gewijzigd ? ' (gewijzigd)' : ''}`,
        tone: 'normal',
    };
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
