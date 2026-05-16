export const DAG_HEADERS = ['Ma', 'Di', 'Wo', 'Do', 'Vr'];

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
