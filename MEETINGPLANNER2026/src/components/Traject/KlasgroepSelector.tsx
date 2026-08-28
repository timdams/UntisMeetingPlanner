import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, ChevronDown, Eye, EyeOff, Info, Loader2, Sparkles, Trash2, X } from 'lucide-react';
import { isActief, Lesblok, OLODSelectie, StudentTraject } from './types';
import {
    matchtPeriode,
    periodeLabelVoor,
    periodeOptiesVoor,
    type PeriodeGrenzen,
    type PeriodeType,
} from './academicYear';
import { bereikOverlapt } from './dateUtils';
import { selectieKey } from './hooks';
import {
    useBulkAlternatieven,
    useKlasgroepAlternatieven,
    type BulkAlternatief,
    type KlasgroepAlternatief,
    type KlasgroepPreview,
    type SelectieStatus,
} from './useTrajectBlokken';
import { BevestigDialog, type DialogItem } from './TrajectDialogs';
import styles from './Traject.module.css';

interface Props {
    klasgroepen: string[];
    actief: string | null;
    onSelect: (klasgroep: string) => void;
    traject: StudentTraject;
    // Lesblokken van het volledige academiejaar per klasgroep in het traject —
    // nodig om te scoren wat een bulkwissel met de conflicten zou doen.
    blokkenPerKlas: Record<string, Lesblok[]>;
    colorOf: (olodNaam: string) => string;
    onRemoveOlod: (sel: OLODSelectie) => void;
    onSetPeriode: (sel: OLODSelectie, van: string, tot: string) => void;
    onSetKlasgroep: (sel: OLODSelectie, klasgroep: string) => void;
    // Bulkacties op de aangevinkte selecties.
    onBulkSetKlasgroep: (sels: OLODSelectie[], klasgroep: string) => void;
    onBulkRemove: (sels: OLODSelectie[]) => void;
    // Een OLOD tijdelijk uitschakelen: ze blijft in de lijst staan, maar telt
    // niet mee in het totaalrooster. De bulkvariant werkt op de aangevinkte set.
    onToggleActief: (sel: OLODSelectie) => void;
    onBulkSetActief: (sels: OLODSelectie[], actief: boolean) => void;
    // Wat-als-preview: de klasgroep waar de gebruiker in de kiezer over
    // beweegt (of null). Het studentoverzicht toont dan waar het vak zou vallen.
    onPreview: (preview: KlasgroepPreview | null) => void;
    // Per selectie (selectieKey) of ze geen lessen oplevert of nog niet
    // gecontroleerd kan worden; selecties zonder status zijn in orde.
    statussen: Map<string, SelectieStatus>;
    // De actieve periode van het werkblad — bepaalt welke selecties "in beeld" zijn.
    actiefBereik: { van: string; tot: string };
    // Indeling van de opleiding; enkel in modulemodus kan per selectie tussen
    // het hele semester en één module gekozen worden.
    periodeType: PeriodeType;
    // Nodig om de periode-badge van een selectie te benoemen (M1 … M4).
    periodeGrenzen: PeriodeGrenzen;
}

// Welke kiezer onder een selectie open staat: de periode-kiezer (badge) of
// de klasgroep-kiezer (klasgroepnaam). Hooguit één tegelijk.
type Kiezer = { key: string; soort: 'periode' | 'klasgroep' };

// Bevestiging die een bulkactie afwacht.
type BulkDialoog = { soort: 'verzet'; alternatief: BulkAlternatief } | { soort: 'verwijder' };

export function KlasgroepSelector({
    klasgroepen,
    actief,
    onSelect,
    traject,
    blokkenPerKlas,
    colorOf,
    onRemoveOlod,
    onSetPeriode,
    onSetKlasgroep,
    onBulkSetKlasgroep,
    onBulkRemove,
    onToggleActief,
    onBulkSetActief,
    onPreview,
    statussen,
    actiefBereik,
    periodeType,
    periodeGrenzen,
}: Props) {
    // Selectie waarvan een kiezer open staat. De sleutel bevat klasgroep én
    // periode; na een keuze volgt ze de gewijzigde selectie zodat de kiezer
    // open blijft en de gebruiker meteen een andere optie kan proberen.
    const [open, setOpen] = useState<Kiezer | null>(null);
    // Aangevinkte selecties (selectieKey) voor een bulkactie, en of de
    // bulk-klasgroepkiezer openstaat. Vluchtige UI-state: niet opgeslagen.
    const [gekozen, setGekozen] = useState<Set<string>>(new Set());
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkDialoog, setBulkDialoog] = useState<BulkDialoog | null>(null);
    const kiesbaar = periodeType === 'module';

    // Geen preview meer zodra een kiezer sluit of wisselt (de chips waar de
    // muis over stond bestaan dan niet meer), en evenmin na unmount.
    useEffect(() => {
        onPreview(null);
    }, [open, bulkOpen, onPreview]);
    useEffect(() => () => onPreview(null), [onPreview]);

    // Vakken die uit het traject verdwijnen (of van klasgroep/periode wisselen)
    // laten hun oude sleutel achter; die snoeien we weg zodat de teller klopt.
    const trajectKeys = useMemo(() => new Set(traject.map(selectieKey)), [traject]);
    useEffect(() => {
        setGekozen(g => {
            const next = new Set(Array.from(g).filter(k => trajectKeys.has(k)));
            return next.size === g.size ? g : next;
        });
    }, [trajectKeys]);

    const toggleKiezer = (key: string, soort: Kiezer['soort']) => {
        setBulkOpen(false);
        setOpen(o => (o && o.key === key && o.soort === soort ? null : { key, soort }));
    };

    const kiesPeriode = (sel: OLODSelectie, van: string, tot: string) => {
        onSetPeriode(sel, van, tot);
        setOpen({ key: selectieKey({ ...sel, van, tot }), soort: 'periode' });
    };

    const kiesKlasgroep = (sel: OLODSelectie, klasgroep: string) => {
        if (klasgroep === sel.klasgroep) return;
        onSetKlasgroep(sel, klasgroep);
        setOpen({ key: selectieKey({ ...sel, klasgroep }), soort: 'klasgroep' });
    };

    const toggleGekozen = (key: string) => {
        setGekozen(g => {
            const next = new Set(g);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const gesorteerd = useMemo(
        () =>
            traject
                .slice()
                .sort(
                    (a, b) =>
                        a.klasgroep.localeCompare(b.klasgroep) ||
                        a.olodNaam.localeCompare(b.olodNaam) ||
                        a.van.localeCompare(b.van)
                ),
        [traject]
    );

    const inPeriode = useMemo(
        () => traject.filter(s => bereikOverlapt(s.van, s.tot, actiefBereik.van, actiefBereik.tot)).length,
        [traject, actiefBereik.van, actiefBereik.tot]
    );

    const gedeactiveerd = useMemo(() => traject.filter(s => !isActief(s)).length, [traject]);

    // Kandidaat-klasgroepen worden enkel opgehaald voor de selectie waarvan de
    // klasgroep-kiezer open staat.
    const openKlasSel = useMemo(
        () => (open?.soort === 'klasgroep' ? traject.find(s => selectieKey(s) === open.key) ?? null : null),
        [open, traject]
    );
    const alternatieven = useKlasgroepAlternatieven(openKlasSel, klasgroepen);

    // ===== Bulkselectie =====

    const gekozenSels = useMemo(
        () => gesorteerd.filter(s => gekozen.has(selectieKey(s))),
        [gesorteerd, gekozen]
    );

    // Eén knop voor de hele aangevinkte set: staat er nog iets aan, dan zet ze
    // alles uit; staat alles uit, dan zet ze alles weer aan.
    const bulkNaarActief = gekozenSels.length > 0 && !gekozenSels.some(isActief);

    // Snelkeuze-chips: elke periode die in het traject voorkomt, met de
    // selecties die erin vallen. Zo staat "alles van M1" op één klik.
    const periodeGroepen = useMemo(() => {
        const map = new Map<string, { kort: string; label: string; keys: string[] }>();
        for (const s of gesorteerd) {
            const id = `${s.van}::${s.tot}`;
            const bestaand = map.get(id);
            if (bestaand) {
                bestaand.keys.push(selectieKey(s));
                continue;
            }
            const p = periodeLabelVoor(s.van, s.tot, periodeGrenzen);
            map.set(id, { kort: p.kort, label: p.label, keys: [selectieKey(s)] });
        }
        return Array.from(map.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([id, g]) => ({ id, ...g }));
    }, [gesorteerd, periodeGrenzen]);

    // Een groep aanklikken selecteert precies die groep; nog eens klikken wist
    // de selectie weer.
    const kiesGroep = (keys: string[]) => {
        setGekozen(g => {
            const zelfde = g.size === keys.length && keys.every(k => g.has(k));
            return zelfde ? new Set() : new Set(keys);
        });
    };

    const bulk = useBulkAlternatieven(
        bulkOpen ? gekozenSels : null,
        klasgroepen,
        traject,
        blokkenPerKlas,
        periodeGrenzen
    );

    const doeBulkVerzet = (a: BulkAlternatief) => {
        setBulkDialoog(null);
        onBulkSetKlasgroep(a.verhuizend, a.klasgroep);
        // De kiezer klapt na de wissel dicht: het resultaat staat nu in paneel C,
        // en een volgende poging verdient een verse vergelijking. De vakken
        // blijven wel aangevinkt (onder hun nieuwe sleutel), zodat er meteen een
        // volgende bulkactie op dezelfde set kan volgen.
        setBulkOpen(false);
        setGekozen(g => {
            const next = new Set(g);
            a.verhuizend.forEach(s => {
                next.delete(selectieKey(s));
                next.add(selectieKey({ ...s, klasgroep: a.klasgroep }));
            });
            return next;
        });
        onPreview(null);
    };

    // Verzet de aangevinkte vakken naar deze klasgroep. Geeft ze die klasgroep
    // niet allemaal, dan verhuizen enkel de gedekte — dat vraagt eerst een
    // bevestiging waarin de achterblijvers bij naam staan.
    const bulkVerzet = (a: BulkAlternatief) => {
        if (a.huidig || a.verhuizend.length === 0) return;
        if (a.ontbrekend.length > 0) setBulkDialoog({ soort: 'verzet', alternatief: a });
        else doeBulkVerzet(a);
    };

    const doeBulkVerwijder = () => {
        setBulkDialoog(null);
        onBulkRemove(gekozenSels);
        setGekozen(new Set());
        setBulkOpen(false);
    };

    // Opsomming van de aangevinkte vakken voor de bevestigingsdialoog, met hun
    // kleur uit het overzicht ernaast.
    const selsAlsItems = (sels: OLODSelectie[]): DialogItem[] =>
        sels.map(s => ({
            key: selectieKey(s),
            naam: s.olodNaam,
            kleur: colorOf(s.olodNaam),
            meta: `${s.klasgroep} · ${periodeLabelVoor(s.van, s.tot, periodeGrenzen).kort}${
                isActief(s) ? '' : ' · uit'
            }`,
        }));

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader}>
                <span className={styles.panelStap}>1</span>
                Klasgroepen
            </div>
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
                <span
                    className={styles.olodListCount}
                    title={
                        (inPeriode === traject.length
                            ? `${traject.length} in het traject`
                            : `${inPeriode} in de actieve periode, ${traject.length} in het volledige traject`) +
                        (gedeactiveerd > 0
                            ? `\n${gedeactiveerd} gedeactiveerd — die tellen niet mee in het totaalrooster`
                            : '')
                    }
                >
                    {inPeriode === traject.length ? traject.length : `${inPeriode} / ${traject.length}`}
                </span>
            </div>

            {periodeGroepen.length > 0 && (
                <div className={styles.olodSnelRij}>
                    <span className={styles.olodSnelLabel}>Snel kiezen:</span>
                    {periodeGroepen.map(g => (
                        <button
                            key={g.id}
                            type="button"
                            className={styles.olodSnelChip}
                            onClick={() => kiesGroep(g.keys)}
                            title={`Alle ${g.keys.length} vakken van ${g.label} aanvinken`}
                        >
                            {g.kort}
                            <span className={styles.olodOptieAantal}>{g.keys.length}</span>
                        </button>
                    ))}
                    <button
                        type="button"
                        className={styles.olodSnelChip}
                        onClick={() => kiesGroep(gesorteerd.map(selectieKey))}
                        title="Alle vakken van het traject aanvinken"
                    >
                        alles
                    </button>
                    {gekozen.size > 0 && (
                        <button
                            type="button"
                            className={styles.olodSnelChip}
                            onClick={() => setGekozen(new Set())}
                            title="Selectie wissen"
                        >
                            wis
                        </button>
                    )}
                </div>
            )}

            {gekozenSels.length > 0 && (
                <div className={styles.olodBulkZone}>
                    <div className={styles.olodBulkBar}>
                        <span className={styles.olodBulkCount}>
                            {gekozenSels.length} gekozen
                        </span>
                        <button
                            type="button"
                            className={`${styles.olodBulkKnop} ${bulkOpen ? styles.olodBulkKnopActief : ''}`}
                            onClick={() => {
                                setOpen(null);
                                setBulkOpen(o => !o);
                            }}
                            title="Deze vakken samen naar een andere klasgroep verzetten"
                            aria-expanded={bulkOpen}
                        >
                            <ArrowLeftRight size={12} /> Verzet naar…
                        </button>
                        <button
                            type="button"
                            className={styles.olodBulkKnop}
                            onClick={() => onBulkSetActief(gekozenSels, bulkNaarActief)}
                            title={
                                bulkNaarActief
                                    ? 'Deze vakken weer laten meetellen in het totaalrooster'
                                    : 'Deze vakken uit het totaalrooster halen — ze blijven wel in de lijst staan'
                            }
                            aria-label={bulkNaarActief ? 'Vakken activeren' : 'Vakken deactiveren'}
                        >
                            {bulkNaarActief ? <Eye size={12} /> : <EyeOff size={12} />}
                        </button>
                        <button
                            type="button"
                            className={styles.olodBulkKnop}
                            onClick={() => setBulkDialoog({ soort: 'verwijder' })}
                            title="Deze vakken uit het traject verwijderen"
                        >
                            <Trash2 size={12} />
                        </button>
                        <button
                            type="button"
                            className={styles.olodBulkKnop}
                            onClick={() => setGekozen(new Set())}
                            title="Selectie wissen"
                            aria-label="Selectie wissen"
                        >
                            <X size={12} />
                        </button>
                    </div>
                    {bulkOpen && (
                        <BulkKlasgroepKiezer
                            aantal={gekozenSels.length}
                            bulk={bulk}
                            onKies={bulkVerzet}
                            onPreview={onPreview}
                        />
                    )}
                </div>
            )}

            <div className={styles.olodList}>
                {gesorteerd.length === 0 ? (
                    <div className={styles.olodListEmpty}>
                        Klik in het rooster om OLODs toe te voegen.
                    </div>
                ) : (
                    gesorteerd.map(sel => {
                        const key = selectieKey(sel);
                        const periode = periodeLabelVoor(sel.van, sel.tot, periodeGrenzen);
                        const zichtbaar = bereikOverlapt(sel.van, sel.tot, actiefBereik.van, actiefBereik.tot);
                        const openPeriode = kiesbaar && open?.key === key && open.soort === 'periode';
                        const openKlas = open?.key === key && open.soort === 'klasgroep';
                        const status = statussen.get(key);
                        const waarschuwing = status === 'geen-lessen';
                        const badgeClass = `${styles.olodListPeriode} ${zichtbaar ? styles.olodListPeriodeActief : ''}`;
                        const badgeTitle = `${periode.label}: ${sel.van} t/m ${sel.tot}${zichtbaar ? '' : ' — buiten de actieve periode'}`;
                        const aangevinkt = gekozen.has(key);
                        const staatAan = isActief(sel);
                        return (
                            <div
                                key={key}
                                className={`${styles.olodListItem} ${waarschuwing ? styles.olodListItemWaarschuwing : ''} ${
                                    aangevinkt ? styles.olodListItemGekozen : ''
                                } ${staatAan ? '' : styles.olodListItemUit}`}
                            >
                                <input
                                    type="checkbox"
                                    className={styles.olodListCheck}
                                    checked={aangevinkt}
                                    onChange={() => toggleGekozen(key)}
                                    title={`${sel.olodNaam} aanvinken om samen met andere vakken van klasgroep te wisselen`}
                                    aria-label={`${sel.olodNaam} (${sel.klasgroep}, ${periode.kort}) aanvinken`}
                                />
                                <span
                                    className={styles.olodListSwatch}
                                    style={{ backgroundColor: colorOf(sel.olodNaam) }}
                                />
                                <div className={styles.olodListText}>
                                    <div className={styles.olodListName} title={sel.olodNaam}>
                                        {sel.olodNaam}
                                    </div>
                                    <div className={styles.olodListMeta}>
                                        {kiesbaar ? (
                                            <button
                                                type="button"
                                                className={`${badgeClass} ${styles.olodListPeriodeKnop}`}
                                                onClick={() => toggleKiezer(key, 'periode')}
                                                title={`${badgeTitle}\nKlik om te kiezen: hele semester of één module`}
                                                aria-expanded={openPeriode}
                                            >
                                                {periode.kort}
                                                <ChevronDown size={10} />
                                            </button>
                                        ) : (
                                            <span className={badgeClass} title={badgeTitle}>
                                                {periode.kort}
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            className={`${styles.olodListKlas} ${styles.olodListKlasKnop}`}
                                            onClick={() => toggleKiezer(key, 'klasgroep')}
                                            title={`${sel.klasgroep}\nKlik om dit vak in ${periode.kort} bij een andere klasgroep te volgen`}
                                            aria-expanded={openKlas}
                                        >
                                            <span>{sel.klasgroep}</span>
                                            <ChevronDown size={10} />
                                        </button>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className={`${styles.olodListToggle} ${staatAan ? '' : styles.olodListToggleUit}`}
                                    onClick={() => onToggleActief(sel)}
                                    title={
                                        staatAan
                                            ? `${sel.olodNaam} (${sel.klasgroep}, ${periode.kort}) uitschakelen — blijft in de lijst staan, maar verdwijnt uit het totaalrooster`
                                            : `${sel.olodNaam} (${sel.klasgroep}, ${periode.kort}) weer laten meetellen in het totaalrooster`
                                    }
                                    aria-label={staatAan ? 'OLOD deactiveren' : 'OLOD activeren'}
                                    aria-pressed={!staatAan}
                                >
                                    {staatAan ? <Eye size={13} /> : <EyeOff size={13} />}
                                </button>
                                <button
                                    type="button"
                                    className={styles.olodListRemove}
                                    onClick={() => onRemoveOlod(sel)}
                                    title={`${sel.olodNaam} (${sel.klasgroep}, ${periode.kort}) verwijderen uit het traject`}
                                    aria-label="OLOD verwijderen"
                                >
                                    <X size={13} />
                                </button>
                                {status === 'geen-lessen' && (
                                    <div className={`${styles.olodListStatus} ${styles.olodListStatusWaarschuwing}`} role="alert">
                                        <AlertTriangle size={12} />
                                        <span>
                                            Geen lessen van dit vak bij {sel.klasgroep} in {periode.kort}.
                                            {kiesbaar ? ' Kies een andere periode of klasgroep.' : ' Kies een andere klasgroep.'}
                                        </span>
                                    </div>
                                )}
                                {status === 'niet-beschikbaar' && (
                                    <div className={`${styles.olodListStatus} ${styles.olodListStatusInfo}`}>
                                        <Info size={12} />
                                        <span>Rooster van {periode.kort} nog niet beschikbaar — nog niet gecontroleerd.</span>
                                    </div>
                                )}
                                {openPeriode && (
                                    <div className={styles.olodPeriodeKiezer} role="group" aria-label="Periode van deze OLOD">
                                        {periodeOptiesVoor(sel.van, sel.tot, periodeGrenzen).map(p => {
                                            const isSemester = p.id.startsWith('S');
                                            const gekozen = matchtPeriode(p, sel.van, sel.tot);
                                            return (
                                                <button
                                                    key={p.id}
                                                    type="button"
                                                    className={`${styles.olodPeriodeOptie} ${gekozen ? styles.olodPeriodeOptieActief : ''}`}
                                                    onClick={() => kiesPeriode(sel, p.start, p.eind)}
                                                    title={`${p.label}: ${p.start} t/m ${p.eind}`}
                                                    aria-pressed={gekozen}
                                                >
                                                    {isSemester ? `Heel ${p.kort} (beide modules)` : `Enkel ${p.kort}`}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                {openKlas && (
                                    <KlasgroepKiezer
                                        sel={sel}
                                        periodeKort={periode.kort}
                                        alternatieven={alternatieven}
                                        onKies={k => kiesKlasgroep(sel, k)}
                                        onPreview={onPreview}
                                    />
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {bulkDialoog?.soort === 'verzet' && (
                <BevestigDialog
                    titel={`Verzetten naar ${bulkDialoog.alternatief.klasgroep}?`}
                    bericht={
                        <>
                            <strong>{bulkDialoog.alternatief.klasgroep}</strong> geeft{' '}
                            {bulkDialoog.alternatief.gedekt} van de {bulkDialoog.alternatief.totaal}{' '}
                            aangevinkte vakken in hun periode. Enkel die {bulkDialoog.alternatief.gedekt}{' '}
                            verhuizen; de rest blijft staan waar ze staat.
                        </>
                    }
                    itemsKop="Blijft bij de huidige klasgroep"
                    items={bulkDialoog.alternatief.ontbrekend.map(naam => ({
                        key: naam,
                        naam,
                        kleur: colorOf(naam),
                    }))}
                    bevestigLabel={`${bulkDialoog.alternatief.gedekt} ${
                        bulkDialoog.alternatief.gedekt === 1 ? 'vak' : 'vakken'
                    } verzetten`}
                    onBevestig={() => doeBulkVerzet(bulkDialoog.alternatief)}
                    onAnnuleer={() => setBulkDialoog(null)}
                />
            )}

            {bulkDialoog?.soort === 'verwijder' && (
                <BevestigDialog
                    titel={`${gekozenSels.length} ${
                        gekozenSels.length === 1 ? 'vak' : 'vakken'
                    } verwijderen?`}
                    bericht="Deze vakken verdwijnen uit het studenttraject. Je kan dat meteen daarna ongedaan maken."
                    itemsKop="Verdwijnt uit het traject"
                    items={selsAlsItems(gekozenSels)}
                    bevestigLabel="Verwijderen"
                    danger
                    onBevestig={doeBulkVerwijder}
                    onAnnuleer={() => setBulkDialoog(null)}
                />
            )}
        </div>
    );
}

interface BulkKiezerProps {
    aantal: number;
    // null zolang de roosters van de kandidaten nog laden.
    bulk: ReturnType<typeof useBulkAlternatieven>;
    onKies: (a: BulkAlternatief) => void;
    onPreview: (preview: KlasgroepPreview | null) => void;
}

/**
 * Kiezer voor een bulkwissel: elke klasgroep uit de shortlist met hoeveel van
 * de aangevinkte vakken ze geeft en hoeveel conflicten het traject na de
 * wissel zou tellen, beste eerst. Over een rij bewegen toont de wat-als-preview
 * in het studentoverzicht; klikken verzet de vakken.
 */
function BulkKlasgroepKiezer({ aantal, bulk, onKies, onPreview }: BulkKiezerProps) {
    if (bulk === null) {
        return (
            <div className={styles.olodPeriodeKiezer} role="group" aria-label="Klasgroep voor de aangevinkte vakken">
                <span className={styles.olodKiezerInfo}>
                    <Loader2 size={12} className="animate-spin" />
                    Klasgroepen vergelijken op {aantal} {aantal === 1 ? 'vak' : 'vakken'}…
                </span>
            </div>
        );
    }

    const { items, huidigeConflicten } = bulk;
    // Beste eerst: meeste vakken gedekt, dan minste conflicten, dan naam.
    // Klasgroepen zonder rooster zakken naar onderen.
    const gesorteerd = [...items].sort(
        (a, b) =>
            Number(b.beschikbaar) - Number(a.beschikbaar) ||
            b.gedekt - a.gedekt ||
            a.conflicten - b.conflicten ||
            a.klasgroep.localeCompare(b.klasgroep)
    );
    const bruikbaar = gesorteerd.filter(a => a.beschikbaar && (a.gedekt > 0 || a.huidig));
    const onbekend = gesorteerd.filter(a => !a.beschikbaar).map(a => a.klasgroep);
    // De aanrader: de eerste rij die iets verandert én er niet slechter van
    // wordt dan de huidige situatie.
    const beste = bruikbaar.find(a => !a.huidig && a.gedekt === aantal && a.conflicten <= huidigeConflicten) ?? null;

    return (
        <div className={styles.olodPeriodeKiezer} role="group" aria-label="Klasgroep voor de aangevinkte vakken">
            <span className={styles.olodKiezerInfo}>
                Verzet {aantal} {aantal === 1 ? 'vak' : 'vakken'} naar — nu {huidigeConflicten}{' '}
                {huidigeConflicten === 1 ? 'conflict' : 'conflicten'}
            </span>
            {bruikbaar.map(a => {
                const isBeste = beste?.klasgroep === a.klasgroep;
                const dekking = a.huidig
                    ? 'huidige klasgroep'
                    : `${a.gedekt}/${a.totaal} ${a.totaal === 1 ? 'vak' : 'vakken'}`;
                const score = `${a.conflicten} ${a.conflicten === 1 ? 'conflict' : 'conflicten'}`;
                const detail = a.huidig
                    ? `Alle aangevinkte vakken zitten al bij ${a.klasgroep}.`
                    : `${a.gedekt} van de ${a.totaal} aangevinkte vakken lopen bij ${a.klasgroep} in hun periode` +
                      ` (${a.lessen} ${a.lessen === 1 ? 'les' : 'lessen'}).` +
                      `\nNa de wissel: ${score} (nu ${huidigeConflicten}).` +
                      (a.ontbrekend.length > 0 ? `\nBlijft staan: ${a.ontbrekend.join(', ')}` : '');
                const preview = () =>
                    onPreview(
                        a.huidig ? null : { sels: a.verhuizend, klasgroep: a.klasgroep, blokken: a.blokken }
                    );
                const stopPreview = () => onPreview(null);
                return (
                    <button
                        key={a.klasgroep}
                        type="button"
                        className={`${styles.bulkOptie} ${a.huidig ? styles.olodPeriodeOptieActief : ''} ${
                            isBeste ? styles.bulkOptieBest : ''
                        }`}
                        onClick={() => onKies(a)}
                        onMouseEnter={preview}
                        onMouseLeave={stopPreview}
                        onFocus={preview}
                        onBlur={stopPreview}
                        title={detail}
                        disabled={a.huidig}
                        aria-pressed={a.huidig}
                    >
                        {isBeste && <Sparkles size={11} className={styles.bulkOptieBestIcon} />}
                        <span className={styles.bulkOptieNaam}>{a.klasgroep}</span>
                        <span className={styles.bulkOptieScore}>
                            {dekking} ·{' '}
                            <span className={a.conflicten > huidigeConflicten ? styles.bulkOptieSlechter : ''}>
                                {score}
                            </span>
                        </span>
                    </button>
                );
            })}
            {bruikbaar.length <= 1 && (
                <span className={styles.olodKiezerInfo}>
                    <Info size={12} />
                    Geen andere klasgroep uit je shortlist geeft deze vakken in hun periode.
                </span>
            )}
            {bruikbaar.length > 1 && (
                <span className={styles.olodKiezerInfo}>
                    <Eye size={12} />
                    Beweeg over een klasgroep om te zien waar de lessen dan vallen.
                </span>
            )}
            {onbekend.length > 0 && (
                <span className={styles.olodKiezerInfo}>
                    <Info size={12} />
                    Rooster nog niet beschikbaar voor {onbekend.join(', ')}.
                </span>
            )}
        </div>
    );
}

interface KiezerProps {
    sel: OLODSelectie;
    periodeKort: string;
    // null zolang de kandidaten nog laden.
    alternatieven: KlasgroepAlternatief[] | null;
    onKies: (klasgroep: string) => void;
    onPreview: (preview: KlasgroepPreview | null) => void;
}

// Kiezer met alle klasgroepen uit de shortlist waar dit vak in de periode
// van de selectie voorkomt. De huidige klasgroep staat er altijd bij (ook
// zonder lessen — dan staat de waarschuwing er al boven). Over een andere
// klasgroep bewegen toont een wat-als-preview in het studentoverzicht.
function KlasgroepKiezer({ sel, periodeKort, alternatieven, onKies, onPreview }: KiezerProps) {
    if (alternatieven === null) {
        return (
            <div className={styles.olodPeriodeKiezer} role="group" aria-label="Klasgroep van deze OLOD">
                <span className={styles.olodKiezerInfo}>
                    <Loader2 size={12} className="animate-spin" />
                    Klasgroepen controleren op {sel.olodNaam}…
                </span>
            </div>
        );
    }

    const opties = alternatieven.filter(a => a.klasgroep === sel.klasgroep || (a.beschikbaar && a.aantal > 0));
    const onbekend = alternatieven.filter(a => a.klasgroep !== sel.klasgroep && !a.beschikbaar).map(a => a.klasgroep);
    const heeftAlternatief = opties.some(a => a.klasgroep !== sel.klasgroep);

    return (
        <div className={styles.olodPeriodeKiezer} role="group" aria-label="Klasgroep van deze OLOD">
            {opties.map(a => {
                const huidig = a.klasgroep === sel.klasgroep;
                const lessen = a.beschikbaar
                    ? `${a.aantal} ${a.aantal === 1 ? 'les' : 'lessen'} van ${sel.olodNaam} in ${periodeKort}`
                    : `Rooster van ${periodeKort} nog niet beschikbaar`;
                const momenten = a.momenten.length > 0 ? `\n${a.momenten.join('\n')}` : '';
                const preview = () =>
                    onPreview(huidig ? null : { sels: [sel], klasgroep: a.klasgroep, blokken: a.blokken });
                const stopPreview = () => onPreview(null);
                return (
                    <button
                        key={a.klasgroep}
                        type="button"
                        className={`${styles.olodPeriodeOptie} ${huidig ? styles.olodPeriodeOptieActief : ''}`}
                        onClick={() => onKies(a.klasgroep)}
                        onMouseEnter={preview}
                        onMouseLeave={stopPreview}
                        onFocus={preview}
                        onBlur={stopPreview}
                        title={`${a.klasgroep}${huidig ? ' (huidige klasgroep)' : ''}: ${lessen}${momenten}`}
                        aria-pressed={huidig}
                    >
                        {a.klasgroep}
                        {a.beschikbaar && <span className={styles.olodOptieAantal}>{a.aantal}</span>}
                    </button>
                );
            })}
            {heeftAlternatief ? (
                <span className={styles.olodKiezerInfo}>
                    <Eye size={12} />
                    Beweeg over een klasgroep om te zien waar de lessen in het traject vallen.
                </span>
            ) : (
                <span className={styles.olodKiezerInfo}>
                    <Info size={12} />
                    Geen andere klasgroep uit je shortlist geeft dit vak in {periodeKort}.
                </span>
            )}
            {onbekend.length > 0 && (
                <span className={styles.olodKiezerInfo}>
                    <Info size={12} />
                    Rooster van {periodeKort} nog niet beschikbaar voor {onbekend.join(', ')}.
                </span>
            )}
        </div>
    );
}
