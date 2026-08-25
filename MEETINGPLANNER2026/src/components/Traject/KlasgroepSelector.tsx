import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Eye, Info, Loader2, X } from 'lucide-react';
import { OLODSelectie, StudentTraject } from './types';
import {
    matchtPeriode,
    periodeLabelVoor,
    periodeOptiesVoor,
    type ModuleGrenzen,
    type PeriodeType,
} from './academicYear';
import { bereikOverlapt } from './dateUtils';
import { selectieKey } from './hooks';
import {
    useKlasgroepAlternatieven,
    type KlasgroepAlternatief,
    type KlasgroepPreview,
    type SelectieStatus,
} from './useTrajectBlokken';
import styles from './Traject.module.css';

interface Props {
    klasgroepen: string[];
    actief: string | null;
    onSelect: (klasgroep: string) => void;
    traject: StudentTraject;
    colorOf: (olodNaam: string) => string;
    onRemoveOlod: (sel: OLODSelectie) => void;
    onSetPeriode: (sel: OLODSelectie, van: string, tot: string) => void;
    onSetKlasgroep: (sel: OLODSelectie, klasgroep: string) => void;
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
    moduleGrenzen: ModuleGrenzen;
}

// Welke kiezer onder een selectie open staat: de periode-kiezer (badge) of
// de klasgroep-kiezer (klasgroepnaam). Hooguit één tegelijk.
type Kiezer = { key: string; soort: 'periode' | 'klasgroep' };

export function KlasgroepSelector({
    klasgroepen,
    actief,
    onSelect,
    traject,
    colorOf,
    onRemoveOlod,
    onSetPeriode,
    onSetKlasgroep,
    onPreview,
    statussen,
    actiefBereik,
    periodeType,
    moduleGrenzen,
}: Props) {
    // Selectie waarvan een kiezer open staat. De sleutel bevat klasgroep én
    // periode; na een keuze volgt ze de gewijzigde selectie zodat de kiezer
    // open blijft en de gebruiker meteen een andere optie kan proberen.
    const [open, setOpen] = useState<Kiezer | null>(null);
    const kiesbaar = periodeType === 'module';

    // Geen preview meer zodra een kiezer sluit of wisselt (de chips waar de
    // muis over stond bestaan dan niet meer), en evenmin na unmount.
    useEffect(() => {
        onPreview(null);
    }, [open, onPreview]);
    useEffect(() => () => onPreview(null), [onPreview]);

    const toggleKiezer = (key: string, soort: Kiezer['soort']) => {
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

    // Kandidaat-klasgroepen worden enkel opgehaald voor de selectie waarvan de
    // klasgroep-kiezer open staat.
    const openKlasSel = useMemo(
        () => (open?.soort === 'klasgroep' ? traject.find(s => selectieKey(s) === open.key) ?? null : null),
        [open, traject]
    );
    const alternatieven = useKlasgroepAlternatieven(openKlasSel, klasgroepen);

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
                <span
                    className={styles.olodListCount}
                    title={
                        inPeriode === traject.length
                            ? `${traject.length} in het traject`
                            : `${inPeriode} in de actieve periode, ${traject.length} in het volledige traject`
                    }
                >
                    {inPeriode === traject.length ? traject.length : `${inPeriode} / ${traject.length}`}
                </span>
            </div>
            <div className={styles.olodList}>
                {gesorteerd.length === 0 ? (
                    <div className={styles.olodListEmpty}>
                        Klik in het rooster om OLODs toe te voegen.
                    </div>
                ) : (
                    gesorteerd.map(sel => {
                        const key = selectieKey(sel);
                        const periode = periodeLabelVoor(sel.van, sel.tot, moduleGrenzen);
                        const zichtbaar = bereikOverlapt(sel.van, sel.tot, actiefBereik.van, actiefBereik.tot);
                        const openPeriode = kiesbaar && open?.key === key && open.soort === 'periode';
                        const openKlas = open?.key === key && open.soort === 'klasgroep';
                        const status = statussen.get(key);
                        const waarschuwing = status === 'geen-lessen';
                        const badgeClass = `${styles.olodListPeriode} ${zichtbaar ? styles.olodListPeriodeActief : ''}`;
                        const badgeTitle = `${periode.label}: ${sel.van} t/m ${sel.tot}${zichtbaar ? '' : ' — buiten de actieve periode'}`;
                        return (
                            <div
                                key={key}
                                className={`${styles.olodListItem} ${waarschuwing ? styles.olodListItemWaarschuwing : ''}`}
                            >
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
                                        {periodeOptiesVoor(sel.van, sel.tot, moduleGrenzen).map(p => {
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
                    onPreview(huidig ? null : { sel, klasgroep: a.klasgroep, blokken: a.blokken });
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
