import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Info, X } from 'lucide-react';
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
import type { SelectieStatus } from './useTrajectBlokken';
import styles from './Traject.module.css';

interface Props {
    klasgroepen: string[];
    actief: string | null;
    onSelect: (klasgroep: string) => void;
    traject: StudentTraject;
    colorOf: (olodNaam: string) => string;
    onRemoveOlod: (sel: OLODSelectie) => void;
    onSetPeriode: (sel: OLODSelectie, van: string, tot: string) => void;
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

export function KlasgroepSelector({
    klasgroepen,
    actief,
    onSelect,
    traject,
    colorOf,
    onRemoveOlod,
    onSetPeriode,
    statussen,
    actiefBereik,
    periodeType,
    moduleGrenzen,
}: Props) {
    // Selectie waarvan de periode-kiezer open staat. De sleutel bevat de
    // periode; na een keuze volgt ze de gewijzigde selectie zodat de kiezer
    // open blijft en de gebruiker meteen een andere optie kan proberen.
    const [openKey, setOpenKey] = useState<string | null>(null);
    const kiesbaar = periodeType === 'module';

    const kiesPeriode = (sel: OLODSelectie, van: string, tot: string) => {
        onSetPeriode(sel, van, tot);
        setOpenKey(selectieKey({ ...sel, van, tot }));
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
                        const open = kiesbaar && openKey === key;
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
                                                onClick={() => setOpenKey(open ? null : key)}
                                                title={`${badgeTitle}\nKlik om te kiezen: hele semester of één module`}
                                                aria-expanded={open}
                                            >
                                                {periode.kort}
                                                <ChevronDown size={10} />
                                            </button>
                                        ) : (
                                            <span className={badgeClass} title={badgeTitle}>
                                                {periode.kort}
                                            </span>
                                        )}
                                        <span className={styles.olodListKlas} title={sel.klasgroep}>
                                            {sel.klasgroep}
                                        </span>
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
                                {open && (
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
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
