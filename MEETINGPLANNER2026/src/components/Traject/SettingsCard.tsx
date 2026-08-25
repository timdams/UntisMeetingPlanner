import type { ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import styles from './Traject.module.css';
import type { CardSummary } from './settingsSummaries';

interface SettingsCardProps {
    id: string;
    icon: ReactNode;
    title: string;
    summary: CardSummary;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
}

// Inklapbare instellingenkaart. De kop is een echte knop (gecontroleerd door
// de ouder) en toont altijd een live samenvatting, zodat het scherm ook met
// alles dichtgeklapt als overzicht leesbaar blijft.
export function SettingsCard({ id, icon, title, summary, open, onToggle, children }: SettingsCardProps) {
    const bodyId = `settings-card-${id}`;
    const warn = summary.tone === 'warn';
    return (
        <section className={styles.card}>
            <button
                type="button"
                className={styles.cardHeader}
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={onToggle}
            >
                <span className={styles.cardIcon}>{icon}</span>
                <span className={styles.cardTitle}>{title}</span>
                <span className={`${styles.cardSummary} ${warn ? styles.cardSummaryWarn : ''}`}>
                    {warn && <AlertTriangle size={14} />}
                    <span className={styles.cardSummaryText}>{summary.text}</span>
                </span>
                <span className={styles.cardChevron}>
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
            </button>
            {open && (
                <div id={bodyId} className={styles.cardBody}>
                    {children}
                </div>
            )}
        </section>
    );
}

interface UitlegProps {
    label?: string;
    children: ReactNode;
}

// Ongecontroleerde disclosure voor uitleg of geavanceerde bediening. Native
// <details>: toetsenbord en screenreader werken vanzelf, geen extra state, en
// de inhoud (bv. date-inputs) blijft gewoon in de DOM.
export function Uitleg({ label = 'Meer uitleg', children }: UitlegProps) {
    return (
        <details className={styles.uitleg}>
            <summary className={styles.uitlegSummary}>
                <ChevronRight size={14} className={styles.uitlegChevron} />
                {label}
            </summary>
            <div className={styles.uitlegBody}>{children}</div>
        </details>
    );
}
