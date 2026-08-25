import { Periode, matchtPeriode } from './academicYear';
import styles from './Traject.module.css';

interface Props {
    periodes: Periode[];
    actieveStart: string;
    actieveEind: string;
    onKies: (p: Periode) => void;
    // Compacte variant voor de topbar: korte labels (S1, M2, …), geen marges.
    compact?: boolean;
}

// Snelkeuze-knoppen voor de actieve periode. De knop licht op wanneer de
// opgeslagen periode exact met de knop overeenkomt; een handmatig ingesteld
// bereik heeft dus geen actieve knop.
export function PeriodeSwitcher({ periodes, actieveStart, actieveEind, onKies, compact = false }: Props) {
    return (
        <div
            className={compact ? styles.periodeSwitcherCompact : styles.semesterBtnRow}
            role="group"
            aria-label="Periode"
        >
            {periodes.map(p => {
                const actief = matchtPeriode(p, actieveStart, actieveEind);
                return (
                    <button
                        key={p.id}
                        type="button"
                        className={`${styles.toolbarBtn} ${compact ? styles.periodeBtnCompact : ''} ${actief ? styles.semesterBtnActief : ''}`}
                        onClick={() => onKies(p)}
                        title={`${p.label}: ${p.start} t/m ${p.eind}`}
                        aria-pressed={actief}
                    >
                        {compact ? p.kort : p.label}
                    </button>
                );
            })}
        </div>
    );
}
