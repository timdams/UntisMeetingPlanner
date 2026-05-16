import styles from './Traject.module.css';

interface Props {
    klasgroepen: string[];
    actief: string | null;
    onSelect: (klasgroep: string) => void;
}

export function KlasgroepSelector({ klasgroepen, actief, onSelect }: Props) {
    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader}>Klasgroepen</div>
            <div className={styles.panelBody}>
                {klasgroepen.length === 0 ? (
                    <div className={styles.emptyState}>
                        Geen klasgroepen gemarkeerd. Stel ze in via Instellingen.
                    </div>
                ) : (
                    klasgroepen.map(k => (
                        <button
                            key={k}
                            type="button"
                            className={`${styles.selectorItem} ${
                                actief === k ? styles.selectorItemActive : ''
                            }`}
                            onClick={() => onSelect(k)}
                        >
                            {k}
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}
