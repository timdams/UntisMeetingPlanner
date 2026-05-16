import { TrajectSettings, StudentTraject, KleurMap } from './types';

export interface TrajectBackup {
    version: 1;
    exportedAt: string;
    settings: TrajectSettings;
    traject: StudentTraject;
    kleurmap: KleurMap;
}

export function buildBackup(
    settings: TrajectSettings,
    traject: StudentTraject,
    kleurmap: KleurMap
): TrajectBackup {
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        settings,
        traject,
        kleurmap,
    };
}

export function parseBackup(raw: string): TrajectBackup {
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error('Bestand bevat geen geldige JSON.');
    }
    if (!data || typeof data !== 'object') {
        throw new Error('Ongeldig bestand: geen object.');
    }
    const d = data as Record<string, unknown>;
    if (d.version !== 1) {
        throw new Error(`Niet-ondersteunde back-upversie: ${String(d.version)}`);
    }

    const s = d.settings as Record<string, unknown> | undefined;
    if (
        !s ||
        !Array.isArray(s.mijnOpleidingKlasgroepen) ||
        !s.mijnOpleidingKlasgroepen.every(x => typeof x === 'string') ||
        typeof s.semesterStart !== 'string' ||
        typeof s.semesterEind !== 'string'
    ) {
        throw new Error('Ongeldige instellingen in back-up.');
    }

    if (!Array.isArray(d.traject)) {
        throw new Error('Ongeldig traject in back-up.');
    }
    for (const item of d.traject) {
        const it = item as Record<string, unknown> | null;
        if (!it || typeof it.klasgroep !== 'string' || typeof it.olodNaam !== 'string') {
            throw new Error('Ongeldige OLOD-selectie in traject.');
        }
    }

    const km = d.kleurmap;
    if (!km || typeof km !== 'object' || Array.isArray(km)) {
        throw new Error('Ongeldige kleurmap in back-up.');
    }
    for (const v of Object.values(km as Record<string, unknown>)) {
        if (typeof v !== 'string') {
            throw new Error('Ongeldige kleurwaarde in kleurmap.');
        }
    }

    return {
        version: 1,
        exportedAt: typeof d.exportedAt === 'string' ? d.exportedAt : new Date().toISOString(),
        settings: {
            mijnOpleidingKlasgroepen: s.mijnOpleidingKlasgroepen as string[],
            semesterStart: s.semesterStart,
            semesterEind: s.semesterEind,
        },
        traject: d.traject as StudentTraject,
        kleurmap: km as KleurMap,
    };
}

export function downloadBackup(filename: string, backup: TrajectBackup) {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function backupFilename(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `trajectplanner-backup-${y}-${m}-${d}.json`;
}
