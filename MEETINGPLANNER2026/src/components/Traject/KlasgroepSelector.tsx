import { useMemo } from 'react';
import { X } from 'lucide-react';
import { OLODSelectie, StudentTraject } from './types';
import styles from './Traject.module.css';

interface Props {
    klasgroepen: string[];
    actief: string | null;
    onSelect: (klasgroep: string) => void;
    traject: StudentTraject;
    colorOf: (olodNaam: string) => string;
    onRemoveOlod: (sel: OLODSelectie) => void;
}

export function KlasgroepSelector({
    klasgroepen,
    actief,
    onSelect,
    traject,
    colorOf,
    onRemoveOlod,
}: Props) {
    const gesorteerd = useMemo(
        () =>
            traject
                .slice()
                .sort((a, b) =>
                    a.klasgroep === b.klasgroep
                        ? a.olodNaam.localeCompare(b.olodNaam)
                        : a.klasgroep.localeCompare(b.klasgroep)
                ),
        [traject]
    );

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader}>Klasgroepen</div>
            <div className={styles.selectorList}>
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

            <div className={styles.olodListHeader}>
                Geselecteerde OLODs
                <span className={styles.olodListCount}>{traject.length}</span>
            </div>
            <div className={styles.olodList}>
                {gesorteerd.length === 0 ? (
                    <div className={styles.olodListEmpty}>
                        Klik in het rooster om OLODs toe te voegen.
                    </div>
                ) : (
                    gesorteerd.map(sel => (
                        <div
                            key={`${sel.klasgroep}::${sel.olodNaam}`}
                            className={styles.olodListItem}
                        >
                            <span
                                className={styles.olodListSwatch}
                                style={{ backgroundColor: colorOf(sel.olodNaam) }}
                            />
                            <div className={styles.olodListText}>
                                <div className={styles.olodListName} title={sel.olodNaam}>
                                    {sel.olodNaam}
                                </div>
                                <div className={styles.olodListKlas} title={sel.klasgroep}>
                                    {sel.klasgroep}
                                </div>
                            </div>
                            <button
                                type="button"
                                className={styles.olodListRemove}
                                onClick={() => onRemoveOlod(sel)}
                                title={`${sel.olodNaam} (${sel.klasgroep}) verwijderen uit het traject`}
                                aria-label="OLOD verwijderen"
                            >
                                <X size={13} />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
