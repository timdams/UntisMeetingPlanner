import { TrajectSettings, StudentTraject, KleurMap } from './types';
import { normalizeSettings, normalizeTraject, type Profiel } from './hooks';

export interface TrajectBackup {
    version: 1;
    exportedAt: string;
    settings: TrajectSettings;
    traject: StudentTraject;
    kleurmap: KleurMap;
    // De bewaarde instellingssets. Optioneel: back-ups van vóór de profielen
    // hebben dit veld niet, en dan blijven de profielen van de importerende
    // browser gewoon staan.
    profielen?: Profiel[];
}

export function buildBackup(
    settings: TrajectSettings,
    traject: StudentTraject,
    kleurmap: KleurMap,
    profielen: Profiel[] = []
): TrajectBackup {
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        settings,
        traject,
        kleurmap,
        profielen,
    };
}

// Versie 1 blijft geldig sinds de periode-switcher: de nieuwe velden
// (periodeType, periodeGrenzen, van/tot per selectie) zijn optioneel en krijgen
// bij het inlezen hun standaard via normalizeSettings()/normalizeTraject().
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
    if (
        s.periodeType !== undefined &&
        s.periodeType !== 'semester' &&
        s.periodeType !== 'module'
    ) {
        throw new Error('Ongeldige periode-indeling in back-up.');
    }

    if (!Array.isArray(d.traject)) {
        throw new Error('Ongeldig traject in back-up.');
    }
    for (const item of d.traject) {
        const it = item as Record<string, unknown> | null;
        if (!it || typeof it.klasgroep !== 'string' || typeof it.olodNaam !== 'string') {
            throw new Error('Ongeldige OLOD-selectie in traject.');
        }
        if (
            (it.van !== undefined && typeof it.van !== 'string') ||
            (it.tot !== undefined && typeof it.tot !== 'string')
        ) {
            throw new Error('Ongeldige periode bij een OLOD-selectie in traject.');
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

    // Profielen zijn optioneel (zie TrajectBackup). Een item zonder id of naam
    // slaan we over in plaats van het hele bestand af te keuren: de instellingen
    // en het traject zijn belangrijker dan een stukgelopen profiel.
    const profielen = Array.isArray(d.profielen)
        ? d.profielen
              .filter(
                  (x): x is Record<string, unknown> =>
                      !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).id === 'string' &&
                      typeof (x as Record<string, unknown>).naam === 'string'
              )
              .map(x => ({
                  id: x.id as string,
                  naam: x.naam as string,
                  bewaardOp:
                      typeof x.bewaardOp === 'string' ? x.bewaardOp : new Date(0).toISOString(),
                  settings: normalizeSettings(x.settings),
              }))
        : undefined;

    return {
        version: 1,
        exportedAt: typeof d.exportedAt === 'string' ? d.exportedAt : new Date().toISOString(),
        settings: normalizeSettings(s),
        traject: normalizeTraject(d.traject),
        kleurmap: km as KleurMap,
        profielen,
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
