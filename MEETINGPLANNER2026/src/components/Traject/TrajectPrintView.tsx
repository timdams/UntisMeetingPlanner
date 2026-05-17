import { StudentTraject, TrajectSettings } from './types';
import { formatDateBE, parseIsoDate } from './dateUtils';
import styles from './Traject.module.css';

interface Props {
    traject: StudentTraject;
    settings: TrajectSettings;
}

function groupByKlas(traject: StudentTraject): Map<string, string[]> {
    const byKlas = new Map<string, string[]>();
    [...traject]
        .sort(
            (a, b) =>
                a.klasgroep.localeCompare(b.klasgroep) ||
                a.olodNaam.localeCompare(b.olodNaam)
        )
        .forEach(s => {
            const arr = byKlas.get(s.klasgroep) ?? [];
            arr.push(s.olodNaam);
            byKlas.set(s.klasgroep, arr);
        });
    return byKlas;
}

export function buildTrajectClipboardText(
    traject: StudentTraject,
    settings: TrajectSettings
): string {
    const start = parseIsoDate(settings.semesterStart);
    const eind = parseIsoDate(settings.semesterEind);
    const byKlas = groupByKlas(traject);

    const lines: string[] = [];
    lines.push('Studenttraject');
    lines.push(
        `Semester ${formatDateBE(start)} – ${formatDateBE(eind)} · Afgedrukt op ${new Date().toLocaleDateString('nl-BE')}`
    );
    lines.push('');
    lines.push(`OLODs (${traject.length})`);
    lines.push('');

    if (traject.length === 0) {
        lines.push('Geen OLODs in het traject.');
    } else {
        const entries = Array.from(byKlas.entries());
        entries.forEach(([klas, olods], idx) => {
            lines.push(klas);
            olods.forEach(o => lines.push(`  • ${o}`));
            if (idx < entries.length - 1) lines.push('');
        });
    }

    return lines.join('\n');
}

export function TrajectPrintView({ traject, settings }: Props) {
    const start = parseIsoDate(settings.semesterStart);
    const eind = parseIsoDate(settings.semesterEind);
    const byKlas = groupByKlas(traject);

    return (
        <div className={styles.printRoot}>
            <div className={styles.printHeader}>
                <h1>Studenttraject</h1>
                <div>
                    Semester {formatDateBE(start)} – {formatDateBE(eind)}
                    {' · '}Afgedrukt op {new Date().toLocaleDateString('nl-BE')}
                </div>
            </div>

            <div className={styles.printOlodList}>
                <h2>OLODs ({traject.length})</h2>
                {traject.length === 0 ? (
                    <div>Geen OLODs in het traject.</div>
                ) : (
                    Array.from(byKlas.entries()).map(([klas, olods]) => (
                        <div key={klas} className={styles.printKlasBlock}>
                            <h3>{klas}</h3>
                            <ul>
                                {olods.map(o => (
                                    <li key={o}>{o}</li>
                                ))}
                            </ul>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
