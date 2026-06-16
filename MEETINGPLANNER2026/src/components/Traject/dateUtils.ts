import type { Lesblok } from './types';

export const DAG_HEADERS = ['Ma', 'Di', 'Wo', 'Do', 'Vr'];

/** Vroegste uur dat de roostergrid toont. */
export const DAY_START_HOUR = 8;
/** Standaard laatste uur (dagschool). */
export const DEFAULT_DAY_END_HOUR = 18;
/** Hoogste uur waartoe de grid mag uitrekken (avondschool). */
export const MAX_DAY_END_HOUR = 22;

/**
 * Bepaalt tot welk uur de roostergrid moet lopen voor een set lesblokken.
 * Standaard tot {@link DEFAULT_DAY_END_HOUR} (18u); zodra minstens één blok
 * later eindigt (avondschool) rekt de grid op tot het volgende hele uur,
 * begrensd op {@link MAX_DAY_END_HOUR} (22u).
 */
export function gridEndHour(blokken: Lesblok[]): number {
    let latestMin = DEFAULT_DAY_END_HOUR * 60;
    for (const b of blokken) {
        const m = b.eind.getHours() * 60 + b.eind.getMinutes();
        if (m > latestMin) latestMin = m;
    }
    const uur = Math.ceil(latestMin / 60);
    return Math.min(MAX_DAY_END_HOUR, Math.max(DEFAULT_DAY_END_HOUR, uur));
}

export function mondayOf(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 = sun
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
}

export function fridayEndOf(monday: Date): Date {
    const f = new Date(monday);
    f.setDate(monday.getDate() + 4);
    f.setHours(23, 59, 59, 999);
    return f;
}

export function addDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}

export function weeksBetween(start: Date, end: Date): Date[] {
    const out: Date[] = [];
    let cur = mondayOf(start);
    const stop = mondayOf(end);
    while (cur.getTime() <= stop.getTime()) {
        out.push(new Date(cur));
        cur = addDays(cur, 7);
    }
    return out;
}

export function sameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

export function inRange(d: Date, start: Date, end: Date): boolean {
    return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}

export function isoWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function formatDateBE(d: Date): string {
    return d.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit' });
}

export function formatTime(d: Date): string {
    return d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(d: Date): string {
    return d.toLocaleDateString('nl-BE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }) + ' ' + formatTime(d);
}

export function parseIsoDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
}
