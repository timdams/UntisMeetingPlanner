import { Check, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { Profiel } from './hooks';
import { formatDateTime } from './dateUtils';
import { profielSamenvatting } from './settingsSummaries';
import { TopbarMenu, TopbarMenuItem } from './TopbarMenu';
import styles from './Traject.module.css';

interface Props {
    profielen: Profiel[];
    // Het profiel waarin gewerkt wordt, of null zolang de instellingen bij geen
    // enkel profiel horen.
    actief: Profiel | null;
    // De huidige instellingen wijken af van wat er in het actieve profiel zit
    // (oranje stip). Enkel zinvol met een actief profiel.
    gewijzigd: boolean;
    // Naar een ander profiel wisselen. De oproeper vraagt eerst om bevestiging
    // wanneer er OLOD-keuzes verloren gaan — het menu sluit meteen, zodat de
    // dialoog vrij staat.
    onKies: (p: Profiel) => void;
    // De huidige instellingen onder een (nieuwe) naam bewaren.
    onBewaarAls: () => void;
    // De huidige instellingen in het actieve profiel bewaren.
    onBijwerken: () => void;
    onVerwijder: (p: Profiel) => void;
}

/**
 * De profiel-switcher in de contextbalk: één knop met de naam van de actieve
 * instellingenset, en eronder de andere sets om naar over te schakelen.
 *
 * Bewust naast — en niet in — het dossiermenu: een **profiel** draagt alleen
 * instellingen (klasgroepen, periode-indeling, grensdatums, semestervakken) en
 * is herbruikbaar over studenten heen; een **dossier** is één student met zijn
 * OLOD-keuzes. Ze verschillen ook in gedrag: een dossier laden brengt een
 * traject mee, een profiel wisselen wist er net één.
 */
export function ProfielMenu({
    profielen,
    actief,
    gewijzigd,
    onKies,
    onBewaarAls,
    onBijwerken,
    onVerwijder,
}: Props) {
    const gesorteerd = profielen
        .slice()
        .sort((a, b) => a.naam.localeCompare(b.naam, 'nl', { sensitivity: 'base' }));

    return (
        <TopbarMenu
            align="left"
            btnClass={`${styles.dossierBtn} ${actief ? '' : styles.dossierBtnLeeg}`}
            label={
                <>
                    <SlidersHorizontal size={13} className={styles.profielBtnIcoon} />
                    <span className={styles.dossierNaam}>{actief?.naam ?? 'geen profiel'}</span>
                    {actief && gewijzigd && <span className={styles.trajectNaamStip} />}
                </>
            }
            title={
                actief
                    ? gewijzigd
                        ? `Je werkt met profiel "${actief.naam}" — de instellingen wijken af van wat er bewaard is. Klik om bij te werken of naar een ander profiel te wisselen.`
                        : `Je werkt met profiel "${actief.naam}". Klik om naar een ander profiel te wisselen.`
                    : 'Deze instellingen horen bij geen enkel profiel. Klik om ze te bewaren, of om een bewaard profiel te activeren.'
            }
        >
            {close => (
                <div className={styles.laadMenuInhoud} aria-label="Profiel">
                    <TopbarMenuItem
                        icon={<Save size={14} />}
                        title="Bewaar de huidige klasgroepen, periode-indeling en grensdatums als een profiel"
                        onClick={() => {
                            close();
                            onBewaarAls();
                        }}
                    >
                        Bewaar instellingen als profiel…
                    </TopbarMenuItem>
                    {actief && (
                        <TopbarMenuItem
                            disabled={!gewijzigd}
                            title={
                                gewijzigd
                                    ? `De huidige instellingen bewaren in "${actief.naam}"`
                                    : `"${actief.naam}" is al gelijk aan de huidige instellingen`
                            }
                            onClick={() => {
                                close();
                                onBijwerken();
                            }}
                        >
                            {gewijzigd ? `"${actief.naam}" bijwerken` : `"${actief.naam}" is bijgewerkt`}
                        </TopbarMenuItem>
                    )}

                    <div className={styles.menuScheiding} />

                    <div className={styles.laadMenuKop}>
                        Profielen{gesorteerd.length > 0 ? ` (${gesorteerd.length})` : ''}
                    </div>
                    {gesorteerd.length === 0 ? (
                        <div className={styles.laadMenuLeeg}>
                            Nog geen profielen. Stel je klasgroepen en periodes in en gebruik{' '}
                            <strong>Bewaar instellingen als profiel</strong> hierboven — daarna wissel
                            je hier met één klik.
                        </div>
                    ) : (
                        gesorteerd.map(p => {
                            const isActief = p.id === actief?.id;
                            return (
                                <div key={p.id} className={styles.laadMenuItem}>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className={`${styles.laadMenuLaad} ${isActief ? styles.laadMenuLaadActief : ''}`}
                                        disabled={isActief}
                                        onClick={() => {
                                            close();
                                            onKies(p);
                                        }}
                                        title={
                                            isActief
                                                ? `"${p.naam}" is het actieve profiel`
                                                : `Overschakelen naar "${p.naam}" — de gekozen OLODs worden gewist`
                                        }
                                    >
                                        <div className={styles.laadMenuNaam}>
                                            {isActief && <Check size={12} className={styles.profielVink} />}
                                            {p.naam}
                                        </div>
                                        <div className={styles.laadMenuMeta}>
                                            {profielSamenvatting(p.settings)} · bewaard op{' '}
                                            {formatDateTime(new Date(p.bewaardOp))}
                                        </div>
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.olodListRemove}
                                        onClick={() => {
                                            close();
                                            onVerwijder(p);
                                        }}
                                        title={`"${p.naam}" verwijderen uit de bewaarde profielen`}
                                        aria-label={`${p.naam} verwijderen`}
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </TopbarMenu>
    );
}
