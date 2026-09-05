import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Save, SlidersHorizontal } from 'lucide-react';
import type { BewaardTraject, Profiel } from './hooks';
import { zelfdeNaam } from './hooks';
import { formatDateTime } from './dateUtils';
import styles from './Traject.module.css';

/** Eén regel in de opsomming van een bevestigingsdialoog. */
export interface DialogItem {
    key: string;
    naam: string;
    // Kleur van het vak (uit de kleurmap), zodat de lijst dezelfde codering
    // draagt als de panelen erachter.
    kleur?: string;
    meta?: string;
}

// Gedeelde schil: portal in document.body, verduisterde achtergrond, sluiten met
// Escape of een klik ernaast. Hetzelfde patroon als de klasgroep-kiezer en het
// weekzoomvenster, maar dan op dialooggrootte.
function DialogSchil({
    label,
    onSluit,
    children,
}: {
    label: string;
    onSluit: () => void;
    children: ReactNode;
}) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onSluit();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onSluit]);

    return createPortal(
        <div className={styles.zoomBackdrop} onClick={onSluit}>
            <div
                className={styles.dialoog}
                role="dialog"
                aria-modal="true"
                aria-label={label}
                onClick={e => e.stopPropagation()}
            >
                {children}
            </div>
        </div>,
        document.body
    );
}

function ItemLijst({ items }: { items: DialogItem[] }) {
    return (
        <ul className={styles.dialoogLijst}>
            {items.map(item => (
                <li key={item.key} className={styles.dialoogLijstItem}>
                    {item.kleur && (
                        <span className={styles.legendSwatch} style={{ backgroundColor: item.kleur }} />
                    )}
                    <span className={styles.dialoogLijstNaam}>{item.naam}</span>
                    {item.meta && <span className={styles.dialoogLijstMeta}>{item.meta}</span>}
                </li>
            ))}
        </ul>
    );
}

interface BevestigProps {
    titel: string;
    bericht: ReactNode;
    // Optionele opsomming (bv. de vakken die verdwijnen of blijven staan).
    items?: DialogItem[];
    // Tekst boven de opsomming.
    itemsKop?: string;
    bevestigLabel: string;
    // Rode bevestigknop; de focus start dan op Annuleren.
    danger?: boolean;
    onBevestig: () => void;
    onAnnuleer: () => void;
}

/**
 * Bevestigingsdialoog in de app zelf, in plaats van `window.confirm`: kan de
 * betrokken vakken bij naam en kleur tonen en leest als de rest van de tool.
 */
export function BevestigDialog({
    titel,
    bericht,
    items,
    itemsKop,
    bevestigLabel,
    danger = false,
    onBevestig,
    onAnnuleer,
}: BevestigProps) {
    // Bij een destructieve actie start de focus op de veilige knop, zodat een
    // reflexmatige Enter niets wist.
    const focusRef = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
        focusRef.current?.focus();
    }, []);

    return (
        <DialogSchil label={titel} onSluit={onAnnuleer}>
            <div className={styles.dialoogKop}>
                {danger && <AlertTriangle size={16} className={styles.dialoogKopIcoon} />}
                <span>{titel}</span>
            </div>
            <div className={styles.dialoogBody}>
                <div className={styles.dialoogTekst}>{bericht}</div>
                {items && items.length > 0 && (
                    <>
                        {itemsKop && <div className={styles.dialoogSubkop}>{itemsKop}</div>}
                        <ItemLijst items={items} />
                    </>
                )}
            </div>
            <div className={styles.dialoogVoet}>
                <button
                    ref={danger ? focusRef : undefined}
                    type="button"
                    className={styles.toolbarBtn}
                    onClick={onAnnuleer}
                >
                    Annuleren
                </button>
                <button
                    ref={danger ? undefined : focusRef}
                    type="button"
                    className={`${styles.toolbarBtn} ${danger ? styles.dialoogKnopDanger : styles.dialoogKnopPrimair}`}
                    onClick={onBevestig}
                >
                    {bevestigLabel}
                </button>
            </div>
        </DialogSchil>
    );
}

interface BewaarProps {
    voorstel: string;
    bewaarde: BewaardTraject[];
    aantalOlods: number;
    // `overschrijfId` is gezet wanneer de naam een bestaand traject raakt.
    onBewaar: (naam: string, overschrijfId?: string) => void;
    onAnnuleer: () => void;
}

/**
 * Dialoog achter "Bewaar traject": naam invullen, of een bestaand bewaard
 * traject aanklikken om te overschrijven. Vervangt de opeenvolging van
 * `window.prompt` + `window.confirm`, die de gebruiker twee losse systeempopups
 * gaf zonder te tonen wat er al bewaard staat.
 */
export function BewaarDialog({ voorstel, bewaarde, aantalOlods, onBewaar, onAnnuleer }: BewaarProps) {
    const [naam, setNaam] = useState(voorstel);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const gesorteerd = useMemo(
        () => bewaarde.slice().sort((a, b) => a.naam.localeCompare(b.naam, 'nl', { sensitivity: 'base' })),
        [bewaarde]
    );

    const schoon = naam.trim();
    const bestaand = useMemo(
        () => (schoon ? gesorteerd.find(x => zelfdeNaam(x.naam, schoon)) ?? null : null),
        [gesorteerd, schoon]
    );

    const bewaren = () => {
        if (!schoon) return;
        onBewaar(schoon, bestaand?.id);
    };

    return (
        <DialogSchil label="Traject bewaren" onSluit={onAnnuleer}>
            <div className={styles.dialoogKop}>
                <Save size={16} />
                <span>Traject bewaren</span>
            </div>
            <div className={styles.dialoogBody}>
                <div className={styles.dialoogTekst}>
                    Het huidige traject ({aantalOlods} {aantalOlods === 1 ? 'OLOD' : 'OLODs'}) wordt
                    samen met je klasgroepen en periode-instellingen in deze browser bewaard.
                </div>
                <label className={styles.dialoogVeld}>
                    <span>Naam</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={naam}
                        onChange={e => setNaam(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                bewaren();
                            }
                        }}
                        placeholder="bv. Jan Peeters"
                    />
                </label>

                {bestaand && (
                    <div className={styles.dialoogWaarschuwing} role="status">
                        <AlertTriangle size={13} />
                        <span>
                            Overschrijft <strong>{bestaand.naam}</strong> ({bestaand.traject.length}{' '}
                            {bestaand.traject.length === 1 ? 'OLOD' : 'OLODs'}, bewaard op{' '}
                            {formatDateTime(new Date(bestaand.bewaardOp))}).
                        </span>
                    </div>
                )}

                {gesorteerd.length > 0 && (
                    <>
                        <div className={styles.dialoogSubkop}>Of overschrijf een bestaand traject</div>
                        <div className={styles.dialoogKeuzeLijst}>
                            {gesorteerd.map(item => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={`${styles.dialoogKeuze} ${
                                        bestaand?.id === item.id ? styles.dialoogKeuzeActief : ''
                                    }`}
                                    onClick={() => setNaam(item.naam)}
                                    title={`De naam "${item.naam}" overnemen om dit traject te overschrijven`}
                                >
                                    <span className={styles.dialoogKeuzeNaam}>{item.naam}</span>
                                    <span className={styles.dialoogKeuzeMeta}>
                                        {item.traject.length}{' '}
                                        {item.traject.length === 1 ? 'OLOD' : 'OLODs'} ·{' '}
                                        {formatDateTime(new Date(item.bewaardOp))}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
            <div className={styles.dialoogVoet}>
                <button type="button" className={styles.toolbarBtn} onClick={onAnnuleer}>
                    Annuleren
                </button>
                <button
                    type="button"
                    className={`${styles.toolbarBtn} ${styles.dialoogKnopPrimair}`}
                    onClick={bewaren}
                    disabled={!schoon}
                >
                    {bestaand ? 'Overschrijven' : 'Bewaren'}
                </button>
            </div>
        </DialogSchil>
    );
}

interface ProfielProps {
    voorstel: string;
    profielen: Profiel[];
    // Eén regel die zegt wát er bewaard wordt ("7 klasgroepen · modules · M1"),
    // zodat de gebruiker niet moet raden welke instellingen in het profiel gaan.
    samenvatting: string;
    // `overschrijfId` is gezet wanneer de naam een bestaand profiel raakt.
    onBewaar: (naam: string, overschrijfId?: string) => void;
    onAnnuleer: () => void;
}

/**
 * Dialoog achter "Bewaar instellingen als profiel": naam invullen, of een
 * bestaand profiel aanklikken om bij te werken. Zelfde vorm als
 * {@link BewaarDialog}, maar bewust een eigen component: die gaat over één
 * student (OLODs), deze over een herbruikbare instellingenset.
 */
export function ProfielDialog({
    voorstel,
    profielen,
    samenvatting,
    onBewaar,
    onAnnuleer,
}: ProfielProps) {
    const [naam, setNaam] = useState(voorstel);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const gesorteerd = useMemo(
        () => profielen.slice().sort((a, b) => a.naam.localeCompare(b.naam, 'nl', { sensitivity: 'base' })),
        [profielen]
    );

    const schoon = naam.trim();
    const bestaand = useMemo(
        () => (schoon ? gesorteerd.find(x => zelfdeNaam(x.naam, schoon)) ?? null : null),
        [gesorteerd, schoon]
    );

    const bewaren = () => {
        if (!schoon) return;
        onBewaar(schoon, bestaand?.id);
    };

    return (
        <DialogSchil label="Profiel bewaren" onSluit={onAnnuleer}>
            <div className={styles.dialoogKop}>
                <SlidersHorizontal size={16} />
                <span>Instellingen bewaren als profiel</span>
            </div>
            <div className={styles.dialoogBody}>
                <div className={styles.dialoogTekst}>
                    Je huidige instellingen ({samenvatting}) worden onder deze naam bewaard. Vanuit
                    het werkblad wissel je er dan met één klik naartoe. Het studenttraject zit er
                    niet in — een profiel is herbruikbaar over studenten heen.
                </div>
                <label className={styles.dialoogVeld}>
                    <span>Naam</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={naam}
                        onChange={e => setNaam(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                bewaren();
                            }
                        }}
                        placeholder="bv. Flextraject avondgroepen"
                    />
                </label>

                {bestaand && (
                    <div className={styles.dialoogWaarschuwing} role="status">
                        <AlertTriangle size={13} />
                        <span>
                            Werkt <strong>{bestaand.naam}</strong> bij (bewaard op{' '}
                            {formatDateTime(new Date(bestaand.bewaardOp))}).
                        </span>
                    </div>
                )}

                {gesorteerd.length > 0 && (
                    <>
                        <div className={styles.dialoogSubkop}>Of werk een bestaand profiel bij</div>
                        <div className={styles.dialoogKeuzeLijst}>
                            {gesorteerd.map(item => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={`${styles.dialoogKeuze} ${
                                        bestaand?.id === item.id ? styles.dialoogKeuzeActief : ''
                                    }`}
                                    onClick={() => setNaam(item.naam)}
                                    title={`De naam "${item.naam}" overnemen om dat profiel bij te werken`}
                                >
                                    <span className={styles.dialoogKeuzeNaam}>{item.naam}</span>
                                    <span className={styles.dialoogKeuzeMeta}>
                                        {formatDateTime(new Date(item.bewaardOp))}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
            <div className={styles.dialoogVoet}>
                <button type="button" className={styles.toolbarBtn} onClick={onAnnuleer}>
                    Annuleren
                </button>
                <button
                    type="button"
                    className={`${styles.toolbarBtn} ${styles.dialoogKnopPrimair}`}
                    onClick={bewaren}
                    disabled={!schoon}
                >
                    {bestaand ? 'Bijwerken' : 'Bewaren'}
                </button>
            </div>
        </DialogSchil>
    );
}
