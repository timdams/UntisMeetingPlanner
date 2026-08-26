import { FolderOpen, Trash2 } from 'lucide-react';
import type { BewaardTraject } from './hooks';
import { formatDateTime } from './dateUtils';
import { periodeLabelVoor } from './academicYear';
import { TopbarMenu } from './TopbarMenu';
import styles from './Traject.module.css';

interface Props {
    items: BewaardTraject[];
    // Laden en verwijderen vragen allebei eerst om bevestiging in een dialoog;
    // het menu sluit meteen, zodat de dialoog vrij staat.
    onLaad: (item: BewaardTraject) => void;
    onVerwijder: (item: BewaardTraject) => void;
}

// Korte typering van een bewaard traject: aantal OLODs, aantal klasgroepen en
// de actieve periode (S1, M2, …) uit de meebewaarde instellingen.
function samenvatting(item: BewaardTraject): string {
    const delen = [`${item.traject.length} ${item.traject.length === 1 ? 'OLOD' : 'OLODs'}`];
    if (item.settings) {
        const n = item.settings.mijnOpleidingKlasgroepen.length;
        delen.push(`${n} ${n === 1 ? 'klasgroep' : 'klasgroepen'}`);
        const periode = periodeLabelVoor(
            item.settings.semesterStart,
            item.settings.semesterEind,
            item.settings.periodeGrenzen
        );
        delen.push(item.settings.periodeType === 'module' ? `modules, ${periode.kort}` : periode.kort);
    }
    return delen.join(' · ');
}

/**
 * "Laad traject"-knop in de topbar met een uitklapmenu van alle in deze
 * browser bewaarde trajecten. Klik op een rij laadt dat traject; het
 * prullenbakje ernaast verwijdert het uit localStorage. Het openen/sluiten van
 * het menu zit in {@link TopbarMenu}, gedeeld met de andere topbar-menu's.
 */
export function LaadTrajectKnop({ items, onLaad, onVerwijder }: Props) {
    const gesorteerd = items
        .slice()
        .sort((a, b) => a.naam.localeCompare(b.naam, 'nl', { sensitivity: 'base' }));

    return (
        <TopbarMenu
            label={
                <>
                    <FolderOpen size={14} /> Laad traject
                    {items.length > 0 && <span className={styles.laadBadge}>{items.length}</span>}
                </>
            }
            title="Laad een eerder bewaard traject (of verwijder bewaarde trajecten)"
        >
            {close => (
                <div className={styles.laadMenuInhoud} aria-label="Bewaarde trajecten">
                    <div className={styles.laadMenuKop}>Bewaarde trajecten</div>
                    {gesorteerd.length === 0 ? (
                        <div className={styles.laadMenuLeeg}>
                            Nog geen bewaarde trajecten. Gebruik <strong>Bewaar traject</strong> om
                            het huidige traject onder een naam te bewaren.
                        </div>
                    ) : (
                        gesorteerd.map(item => (
                            <div key={item.id} className={styles.laadMenuItem}>
                                <button
                                    type="button"
                                    role="menuitem"
                                    className={styles.laadMenuLaad}
                                    onClick={() => {
                                        close();
                                        onLaad(item);
                                    }}
                                    title={`"${item.naam}" laden als huidig traject`}
                                >
                                    <div className={styles.laadMenuNaam}>{item.naam}</div>
                                    <div className={styles.laadMenuMeta}>
                                        {samenvatting(item)} · bewaard op {formatDateTime(new Date(item.bewaardOp))}
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    className={styles.olodListRemove}
                                    onClick={() => {
                                        close();
                                        onVerwijder(item);
                                    }}
                                    title={`"${item.naam}" verwijderen uit de bewaarde trajecten`}
                                    aria-label={`${item.naam} verwijderen`}
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            )}
        </TopbarMenu>
    );
}
