import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ClipboardList, Circle, Minus, Trash2, X } from 'lucide-react';
import {
    aantalGeregeld,
    parseProgramma,
    type ProgrammaRegel,
    type ProgrammaStand,
} from './programma';
import styles from './Traject.module.css';

interface PlakProps {
    // De lijst zoals ze nu is: het tekstvak begint ermee, zodat bijwerken
    // hetzelfde venster is als plakken.
    huidig: string[];
    onKlaar: (lijst: string[]) => void;
    onClose: () => void;
}

/**
 * Het tekstvak waarin het programma van de student geplakt wordt: één OLOD per
 * regel, zoals het uit een studiefiche of een mail komt. Geen kolommen, geen
 * codes, geen periodes — de wizard zoekt zelf uit in welke periode elk vak zit.
 */
export function PlakProgrammaDialoog({ huidig, onKlaar, onClose }: PlakProps) {
    const [tekst, setTekst] = useState(() => huidig.join('\n'));
    const veld = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        veld.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Meelezen terwijl er getypt of geplakt wordt: zo is vóór het bevestigen al
    // te zien hoeveel regels er overblijven na het opkuisen.
    const lijst = useMemo(() => parseProgramma(tekst), [tekst]);

    return createPortal(
        <div className={styles.koppelBackdrop}>
            <div
                className={styles.plakDialog}
                role="dialog"
                aria-modal="true"
                aria-label="Programma plakken"
            >
                <div className={styles.zoomHeaderBar}>
                    <ClipboardList size={16} />
                    <span className={styles.zoomTitle}>Plak het programma</span>
                    <div className={styles.zoomSpacer} />
                    <button
                        type="button"
                        className={styles.zoomClose}
                        onClick={onClose}
                        title="Sluiten (Esc)"
                        aria-label="Sluiten"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className={styles.plakBody}>
                    <p className={styles.koppelIntro}>
                        Eén OLOD per regel. De wizard duidt meteen de vakken aan die in de periode
                        waar je nu in staat lesgegeven worden; de rest blijft in de lijst staan tot
                        je naar de module of het semester gaat waar ze wél in zitten. Streepjes en
                        nummering vooraan mogen blijven staan.
                    </p>
                    <textarea
                        ref={veld}
                        className={styles.plakVeld}
                        value={tekst}
                        onChange={e => setTekst(e.target.value)}
                        spellCheck={false}
                        placeholder={'Programmeren 1\nWebtechnologie\nWiskunde voor IT\n…'}
                        aria-label="Het programma, één OLOD per regel"
                    />
                    <div className={styles.wizVoetnoot}>
                        {lijst.length === 0
                            ? 'Nog niets geplakt.'
                            : `${lijst.length} ${lijst.length === 1 ? 'OLOD' : 'OLODs'} in de lijst.`}
                    </div>
                </div>

                <div className={styles.wizVoet}>
                    <span className={styles.wizVoetHint}>
                        De lijst stuurt niets aan: ze duidt vakken aan en houdt bij wat al geregeld
                        is. Je blijft zelf beslissen wat er in het traject komt.
                    </span>
                    <button
                        type="button"
                        className={`${styles.koppelVraagNee} ${styles.plakAnnuleer}`}
                        onClick={onClose}
                    >
                        Annuleren
                    </button>
                    <button
                        type="button"
                        className={styles.wizOverneemKnop}
                        onClick={() => onKlaar(lijst)}
                    >
                        <Check size={14} />
                        {lijst.length === 0 ? 'Lijst wissen' : 'Lijst gebruiken'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

interface PaneelProps {
    regels: ProgrammaRegel[];
    // Wat er in de wizard aangeduid staat — enkel om te tonen of een gevonden
    // vak ook effectief mee in de puzzel zit.
    gekozen: Set<string>;
    // De naam van de actieve periode, voor de zinnen die erover gaan.
    periodeNaam: string;
    onBewerk: () => void;
    onWis: () => void;
}

const UITLEG: Record<ProgrammaStand, string> = {
    traject: 'Staat al in het studenttraject.',
    gevonden: 'Wordt in deze periode gegeven en is aangeduid.',
    meerdere: 'Meer dan één vak in deze periode past op deze regel — duid zelf aan welk.',
    onbekend: 'Geen vak met deze naam in deze periode. Vermoedelijk een andere module of semester.',
};

/**
 * De checklist naast de wizard: het geplakte programma, regel per regel, met
 * de stand van zaken in de periode waar de wizard nu in staat.
 *
 * Groen is "geregeld": het vak staat al in het traject, of het is hier gevonden
 * en aangeduid. Kleurloos is "hier niet te vinden" — dat is geen fout, enkel
 * een vak dat in een andere periode thuishoort. Wissel van periode en de lijst
 * zoekt opnieuw, zodat het hele jaar in één zitting afgevinkt raakt.
 */
export function ProgrammaPaneel({ regels, gekozen, periodeNaam, onBewerk, onWis }: PaneelProps) {
    const geregeld = aantalGeregeld(regels);
    const open = regels.length - geregeld;
    // De twee redenen waarom een regel openstaat, vragen om een ander antwoord:
    // elders zoeken, of hier zelf aanduiden.
    const elders = regels.filter(r => r.stand === 'onbekend').length;
    const dubbel = regels.filter(r => r.stand === 'meerdere').length;

    return (
        <aside className={styles.progPaneel} aria-label="Het geplakte programma">
            <div className={styles.progKop}>
                <ClipboardList size={13} />
                <span className={styles.progKopTitel}>Programma</span>
                <span
                    className={styles.progTeller}
                    title={`${geregeld} van de ${regels.length} regels is geregeld; ${open} nog niet.`}
                >
                    {geregeld}/{regels.length}
                </span>
                <button type="button" className={styles.progKopKnop} onClick={onBewerk}>
                    Bewerk
                </button>
                <button
                    type="button"
                    className={styles.progKopKnop}
                    onClick={onWis}
                    title="De lijst weghalen. Je aangeduide vakken blijven staan."
                    aria-label="Lijst wissen"
                >
                    <Trash2 size={12} />
                </button>
            </div>

            <div className={styles.progLijst}>
                {regels.map(r => {
                    // Een vak dat hier gevonden is maar dat de gebruiker daarna
                    // zelf uitvinkte, mag niet groen blijven staan: dan zou de
                    // lijst iets beweren wat de puzzel niet doet.
                    const aan = r.stand !== 'gevonden' || gekozen.has(r.match as string);
                    const klasse =
                        r.stand === 'traject'
                            ? styles.progRegelTraject
                            : r.stand === 'gevonden'
                              ? aan
                                  ? styles.progRegelGevonden
                                  : styles.progRegelUit
                              : r.stand === 'meerdere'
                                ? styles.progRegelMeerdere
                                : styles.progRegelOnbekend;
                    return (
                        <div
                            key={r.naam}
                            className={`${styles.progRegel} ${klasse}`}
                            title={
                                (r.stand === 'gevonden' && !aan
                                    ? 'Wordt in deze periode gegeven, maar je hebt het vak uitgevinkt.'
                                    : UITLEG[r.stand]) +
                                (r.match && r.match !== r.naam ? `\nHeet hier: ${r.match}` : '') +
                                (r.kandidaten ? `\n${r.kandidaten.join(', ')}` : '')
                            }
                        >
                            <span className={styles.progIcoon}>
                                {r.stand === 'traject' ? (
                                    <Check size={12} strokeWidth={3} />
                                ) : r.stand === 'gevonden' ? (
                                    aan ? (
                                        <Check size={12} strokeWidth={2.5} />
                                    ) : (
                                        <Circle size={10} />
                                    )
                                ) : r.stand === 'meerdere' ? (
                                    <AlertTriangle size={11} />
                                ) : (
                                    <Minus size={11} />
                                )}
                            </span>
                            <span className={styles.progNaam}>{r.naam}</span>
                        </div>
                    );
                })}
            </div>

            <div className={styles.progVoet}>
                {open === 0 ? (
                    'Alles uit de lijst is geregeld.'
                ) : (
                    <>
                        {elders > 0 && (
                            <div>
                                {elders} {elders === 1 ? 'regel hoort' : 'regels horen'} niet bij{' '}
                                {periodeNaam}. Wissel hierboven van periode: de lijst zoekt dan
                                opnieuw.
                            </div>
                        )}
                        {dubbel > 0 && (
                            <div>
                                {dubbel} {dubbel === 1 ? 'regel past' : 'regels passen'} hier op meer
                                dan één vak — duid het zelf aan in stap 2.
                            </div>
                        )}
                    </>
                )}
            </div>
        </aside>
    );
}
