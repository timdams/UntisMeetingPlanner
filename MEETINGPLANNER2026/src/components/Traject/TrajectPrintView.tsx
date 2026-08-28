import { isActief, StudentTraject, TrajectSettings } from './types';
import { formatDateBE, parseIsoDate } from './dateUtils';
import { actievePeriode, allePeriodes, periodeLabelVoor } from './academicYear';
import styles from './Traject.module.css';

interface Props {
    traject: StudentTraject;
    settings: TrajectSettings;
}

// Kop van de afdruk: de naam van de actieve periode (semester of module) met
// haar datums, of enkel de datums bij een handmatig ingesteld bereik.
function periodeKop(settings: TrajectSettings): string {
    const datums = `${formatDateBE(parseIsoDate(settings.semesterStart))} – ${formatDateBE(parseIsoDate(settings.semesterEind))}`;
    const match = actievePeriode(
        allePeriodes(settings.periodeGrenzen),
        settings.semesterStart,
        settings.semesterEind
    );
    return match ? `${match.label} (${datums})` : `Periode ${datums}`;
}

// Per klasgroep de OLODs mét de periode waarin de student ze daar volgt,
// bv. "Web Development (M2)". Het hele traject wordt afgedrukt, niet enkel de
// actieve periode: de afdruk is het overzicht voor het volledige jaar.
// Gedeactiveerde selecties staan er niet bij: die tellen ook in het rooster
// niet mee.
function groupByKlas(traject: StudentTraject, settings: TrajectSettings): Map<string, string[]> {
    const byKlas = new Map<string, string[]>();
    [...traject]
        .filter(isActief)
        .sort(
            (a, b) =>
                a.klasgroep.localeCompare(b.klasgroep) ||
                a.van.localeCompare(b.van) ||
                a.olodNaam.localeCompare(b.olodNaam)
        )
        .forEach(s => {
            const arr = byKlas.get(s.klasgroep) ?? [];
            arr.push(`${s.olodNaam} (${periodeLabelVoor(s.van, s.tot, settings.periodeGrenzen).kort})`);
            byKlas.set(s.klasgroep, arr);
        });
    return byKlas;
}

export function buildTrajectClipboardText(
    traject: StudentTraject,
    settings: TrajectSettings
): string {
    const byKlas = groupByKlas(traject, settings);
    const aantal = traject.filter(isActief).length;
    const uit = traject.length - aantal;

    const lines: string[] = [];
    lines.push('Studenttraject');
    lines.push(
        `${periodeKop(settings)} · Afgedrukt op ${new Date().toLocaleDateString('nl-BE')}`
    );
    lines.push('');
    lines.push(`OLODs (${aantal})`);
    lines.push('');

    if (aantal === 0) {
        lines.push('Geen OLODs in het traject.');
    } else {
        const entries = Array.from(byKlas.entries());
        entries.forEach(([klas, olods], idx) => {
            lines.push(klas);
            olods.forEach(o => lines.push(`  • ${o}`));
            if (idx < entries.length - 1) lines.push('');
        });
    }

    if (uit > 0) {
        lines.push('');
        lines.push(`(${uit} gedeactiveerde OLOD${uit === 1 ? '' : 's'} niet meegeteld.)`);
    }

    return lines.join('\n');
}

export function TrajectPrintView({ traject, settings }: Props) {
    const byKlas = groupByKlas(traject, settings);
    const aantal = traject.filter(isActief).length;
    const uit = traject.length - aantal;

    return (
        <div className={styles.printRoot}>
            <div className={styles.printHeader}>
                <h1>Studenttraject</h1>
                <div>
                    {periodeKop(settings)}
                    {' · '}Afgedrukt op {new Date().toLocaleDateString('nl-BE')}
                </div>
            </div>

            <div className={styles.printOlodList}>
                <h2>OLODs ({aantal})</h2>
                {aantal === 0 ? (
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
                {uit > 0 && (
                    <div className={styles.printNoot}>
                        {uit} gedeactiveerde OLOD{uit === 1 ? '' : 's'} niet meegeteld.
                    </div>
                )}
            </div>
        </div>
    );
}
