import { Save, Trash2 } from 'lucide-react';
import type { BewaardTraject } from './hooks';
import { formatDateTime } from './dateUtils';
import { periodeLabelVoor } from './academicYear';
import { TopbarMenu, TopbarMenuItem } from './TopbarMenu';
import styles from './Traject.module.css';

interface Props {
    items: BewaardTraject[];
    // Naam van het geopende dossier, of null zolang het werk nog nergens bij
    // hoort. Staat als knoplabel in de contextbalk.
    actieveNaam: string | null;
    // Er staat werk open dat afwijkt van wat er bewaard is (oranje stip).
    nietBewaard: boolean;
    // Valt er iets te bewaren? Een leeg traject niet.
    kanBewaren: boolean;
    // Bewaren in het geopende dossier (of, zonder dossier, de naamdialoog).
    onBewaar: () => void;
    // Altijd de naamdialoog, om onder een andere naam te bewaren.
    onBewaarAls: () => void;
    // Laden en verwijderen vragen allebei eerst om bevestiging in een dialoog;
    // het menu sluit meteen, zodat de dialoog vrij staat.
    onLaad: (item: BewaardTraject) => void;
    onVerwijder: (item: BewaardTraject) => void;
}

// Korte typering van een bewaard dossier: aantal OLODs, aantal klasgroepen en
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
 * Het dossier-menu in de contextbalk. De knop draagt de naam van het geopende
 * dossier (de student waar je aan werkt), met een oranje stip zodra er werk
 * openstaat; het menu bevat alles wat je met dát dossier doet: bewaren, onder
 * een andere naam bewaren, en een ander bewaard dossier openen of weggooien.
 *
 * Bewust één control in plaats van de vroegere losse topbar-knoppen "Bewaar
 * traject" en "Laad traject ▾": beide gaan over hetzelfde object, en samen met
 * het label "Dossier" ernaast leest het als één ding — aan welk dossier werk
 * ik, en wat doe ik ermee. Het openen/sluiten zit in {@link TopbarMenu},
 * gedeeld met het overloopmenu van de appbalk.
 */
export function DossierMenu({
    items,
    actieveNaam,
    nietBewaard,
    kanBewaren,
    onBewaar,
    onBewaarAls,
    onLaad,
    onVerwijder,
}: Props) {
    const gesorteerd = items
        .slice()
        .sort((a, b) => a.naam.localeCompare(b.naam, 'nl', { sensitivity: 'base' }));

    return (
        <TopbarMenu
            align="left"
            btnClass={`${styles.dossierBtn} ${actieveNaam ? '' : styles.dossierBtnLeeg}`}
            label={
                <>
                    <span className={styles.dossierNaam}>{actieveNaam ?? 'nieuw dossier'}</span>
                    {nietBewaard && <span className={styles.trajectNaamStip} />}
                </>
            }
            title={
                actieveNaam
                    ? nietBewaard
                        ? `Je werkt aan "${actieveNaam}" — er zijn wijzigingen die nog niet bewaard zijn. Klik om te bewaren of een ander dossier te openen.`
                        : `Je werkt aan "${actieveNaam}" — alles is bewaard. Klik om een ander dossier te openen.`
                    : 'Dit werk hoort nog bij geen enkel bewaard dossier. Klik om het een naam te geven, of om een bewaard dossier te openen.'
            }
        >
            {close => (
                <div className={styles.laadMenuInhoud} aria-label="Dossier">
                    <TopbarMenuItem
                        icon={<Save size={14} />}
                        disabled={!kanBewaren}
                        hint="Ctrl+S"
                        title={
                            kanBewaren
                                ? actieveNaam
                                    ? `Wijzigingen bewaren in "${actieveNaam}"`
                                    : 'Dit dossier een naam geven en bewaren in deze browser'
                                : 'Er zijn nog geen vakken gekozen om te bewaren'
                        }
                        onClick={() => {
                            close();
                            onBewaar();
                        }}
                    >
                        {actieveNaam ? 'Bewaar' : 'Bewaar…'}
                    </TopbarMenuItem>
                    {actieveNaam && (
                        <TopbarMenuItem
                            disabled={!kanBewaren}
                            title="Bewaar dit werk als een nieuw dossier, onder een andere naam"
                            onClick={() => {
                                close();
                                onBewaarAls();
                            }}
                        >
                            Bewaar als…
                        </TopbarMenuItem>
                    )}

                    <div className={styles.menuScheiding} />

                    <div className={styles.laadMenuKop}>
                        Bewaarde dossiers{gesorteerd.length > 0 ? ` (${gesorteerd.length})` : ''}
                    </div>
                    {gesorteerd.length === 0 ? (
                        <div className={styles.laadMenuLeeg}>
                            Nog geen bewaarde dossiers. Gebruik <strong>Bewaar</strong> hierboven om
                            het huidige werk onder een naam te bewaren.
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
                                    title={`"${item.naam}" openen als huidig dossier`}
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
                                    title={`"${item.naam}" verwijderen uit de bewaarde dossiers`}
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
