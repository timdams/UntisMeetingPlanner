import { Lesblok } from './types';

export interface LaidOut {
    blok: Lesblok;
    col: number;   // 0-based column index within its cluster
    cols: number;  // total columns used by the cluster
}

// Layout overlapping lesblokken side-by-side within a single day.
// Sweep blokken sorted by start; cluster everything that transitively
// overlaps, then assign each blok the lowest free column. The cluster's
// total column count is the highest column used inside it.
export function layoutDay(dayBlokken: Lesblok[]): LaidOut[] {
    if (dayBlokken.length === 0) return [];

    const sorted = [...dayBlokken].sort(
        (a, b) =>
            a.start.getTime() - b.start.getTime() ||
            a.eind.getTime() - b.eind.getTime()
    );

    type Item = { blok: Lesblok; col: number };
    const out: LaidOut[] = [];
    let cluster: Item[] = [];
    let clusterMaxEnd = -Infinity;

    const flush = () => {
        if (cluster.length === 0) return;
        const cols = Math.max(...cluster.map(i => i.col)) + 1;
        for (const i of cluster) out.push({ blok: i.blok, col: i.col, cols });
        cluster = [];
        clusterMaxEnd = -Infinity;
    };

    for (const b of sorted) {
        if (b.start.getTime() >= clusterMaxEnd) {
            flush();
        }

        // Lowest column whose last block ends at or before this block's start.
        const colEnds: number[] = [];
        for (const item of cluster) {
            const prev = colEnds[item.col] ?? -Infinity;
            colEnds[item.col] = Math.max(prev, item.blok.eind.getTime());
        }
        let col = 0;
        while ((colEnds[col] ?? -Infinity) > b.start.getTime()) col++;

        cluster.push({ blok: b, col });
        clusterMaxEnd = Math.max(clusterMaxEnd, b.eind.getTime());
    }
    flush();

    return out;
}
