import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Eye, X } from 'lucide-react';
import type { Lesblok } from './types';
import {
    addDays,
    DAG_HEADERS,
    DAY_START_HOUR,
    formatDateBE,
    formatTime,
    gridEndHour,
    isoWeekNumber,
    sameDay,
} from './dateUtils';
import { layoutDay } from './layout';
import { LesblokIcon } from './LesblokIcon';
import styles from './Traject.module.css';

interface Props {
    weekMonday: Date;
    // De blokken van deze week zoals het overzicht ze toont (inclusief de
    // preview-blokken), ongefilterd op dag.
    blokken: Lesblok[];
    conflictMap: Map<Lesblok, Lesblok[]>;
    ghostSet: Set<Lesblok>;
    wegSet: Set<Lesblok>;
    colorOf: (olodNaam: string) => string;
    onClose: () => void;
}

function topPct(d: Date, totalMin: number): number {
    const m = (d.getHours() - DAY_START_HOUR) * 60 + d.getMinutes();
    return Math.max(0, Math.min(100, (m / totalMin) * 100));
}

function heightPct(start: Date, eind: Date, totalMin: number): number {
    const m =
        (eind.getHours() - DAY_START_HOUR) * 60 +
        eind.getMinutes() -
        ((start.getHours() - DAY_START_HOUR) * 60 + start.getMinutes());
    return Math.max(2, Math.min(100, (m / totalMin) * 100));
}

/**
 * Vergrote, alleen-lezen weergave van één weekstrook uit het studentoverzicht:
 * hetzelfde rooster als het miniatuur, maar op volle hoogte en met alle
 * informatie uitgeschreven (OLOD, klasgroep, type, uren, lokaal). Bewust
 * zonder klikacties — aanpassen gebeurt in het klasgroeprooster.
 */
export function WeekZoom({
    weekMonday,
    blokken,
    conflictMap,
    ghostSet,
    wegSet,
    colorOf,
    onClose,
}: Props) {
    const closeRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const dagen = useMemo(
        () => Array.from({ length: 5 }, (_, i) => addDays(weekMonday, i)),
        [weekMonday]
    );

    // De grid rekt uit tot het laatste lesuur van déze week, zodat de blokken
    // zoveel mogelijk ruimte krijgen.
    const dayEndHour = useMemo(() => gridEndHour(blokken), [blokken]);
    const totalMin = (dayEndHour - DAY_START_HOUR) * 60;

    // Legende: elk vak in deze week met de klasgroep(en) waar het gevolgd wordt.
    const legende = useMemo(() => {
        const map = new Map<string, Set<string>>();
        for (const b of blokken) {
            const set = map.get(b.olodNaam);
            if (set) set.add(b.klasgroep);
            else map.set(b.olodNaam, new Set([b.klasgroep]));
        }
        return Array.from(map.entries())
            .map(([olodNaam, klassen]) => ({
                olodNaam,
                klasgroepen: Array.from(klassen).sort((a, b) => a.localeCompare(b)),
            }))
            .sort((a, b) => a.olodNaam.localeCompare(b.olodNaam));
    }, [blokken]);

    return createPortal(
        <div className={styles.zoomBackdrop} onClick={onClose}>
            <div
                className={styles.zoomDialog}
                role="dialog"
                aria-modal="true"
                aria-label={`Week ${isoWeekNumber(weekMonday)} — vergroot rooster`}
                onClick={e => e.stopPropagation()}
            >
                <div className={styles.zoomHeaderBar}>
                    <span className={styles.zoomTitle}>Week {isoWeekNumber(weekMonday)}</span>
                    <span className={styles.zoomSubtitle}>
                        {formatDateBE(weekMonday)} – {formatDateBE(addDays(weekMonday, 4))}
                    </span>
                    <span className={styles.zoomBadge}>Alleen-lezen</span>
                    <button
                        ref={closeRef}
                        type="button"
                        className={styles.zoomClose}
                        onClick={onClose}
                        title="Sluiten (Esc)"
                        aria-label="Sluiten"
                    >
                        <X size={18} />
                    </button>
                </div>

                {blokken.length === 0 ? (
                    <div className={styles.zoomEmpty}>Geen lessen in deze week.</div>
                ) : (
                    <div className={styles.zoomGrid}>
                        <div className={styles.zoomHeaderCell}></div>
                        {dagen.map((d, i) => (
                            <div key={i} className={styles.zoomHeaderCell}>
                                {DAG_HEADERS[i]} {d.getDate()}/{d.getMonth() + 1}
                            </div>
                        ))}

                        <div className={styles.zoomTimeCol}>
                            {Array.from({ length: dayEndHour - DAY_START_HOUR + 1 }).map((_, i) => (
                                <div
                                    key={i}
                                    className={styles.zoomTimeLabel}
                                    style={{ top: `${((i * 60) / totalMin) * 100}%` }}
                                >
                                    {DAY_START_HOUR + i}:00
                                </div>
                            ))}
                        </div>

                        {dagen.map((d, di) => {
                            const dayBlokken = blokken.filter(b => sameDay(b.start, d));
                            const laidOut = layoutDay(dayBlokken);
                            return (
                                <div key={di} className={styles.zoomDayCol}>
                                    {Array.from({ length: dayEndHour - DAY_START_HOUR }).map((_, i) => (
                                        <div
                                            key={i}
                                            className={styles.zoomGridLine}
                                            style={{ top: `${(((i + 1) * 60) / totalMin) * 100}%` }}
                                        />
                                    ))}
                                    {laidOut.map(({ blok: b, col, cols }, bi) => {
                                        const conflictsFor = conflictMap.get(b);
                                        const ghost = ghostSet.has(b);
                                        const weg = wegSet.has(b);
                                        const widthPct = 100 / cols;
                                        const leftPct = col * widthPct;
                                        const tip =
                                            (ghost
                                                ? 'Preview — komt erbij bij wissel\n'
                                                : weg
                                                ? 'Preview — vervalt bij wissel\n'
                                                : '') +
                                            `${b.olodNaam}\n${b.klasgroep}${b.type ? ` · ${b.type}` : ''}` +
                                            `\n${formatTime(b.start)}–${formatTime(b.eind)}` +
                                            (b.lokaal ? `\n${b.lokaal}` : '') +
                                            (conflictsFor
                                                ? '\n\n⚠ Conflict met:\n' +
                                                  conflictsFor
                                                      .map(
                                                          o =>
                                                              `• ${o.olodNaam} (${o.klasgroep}${o.type ? `, ${o.type}` : ''})` +
                                                              ` · ${formatTime(o.start)}–${formatTime(o.eind)}`
                                                      )
                                                      .join('\n')
                                                : '');
                                        return (
                                            <div
                                                key={bi}
                                                className={`${styles.zoomBlok} ${conflictsFor ? styles.zoomBlokConflict : ''} ${ghost ? styles.zoomBlokGhost : ''} ${weg ? styles.zoomBlokWeg : ''}`}
                                                style={{
                                                    top: `${topPct(b.start, totalMin)}%`,
                                                    height: `${heightPct(b.start, b.eind, totalMin)}%`,
                                                    left: `calc(${leftPct}% + 3px)`,
                                                    width: `calc(${widthPct}% - 6px)`,
                                                    backgroundColor: colorOf(b.olodNaam),
                                                }}
                                                title={tip}
                                            >
                                                <div className={styles.zoomBlokTime}>
                                                    <LesblokIcon type={b.type} size={13} strokeWidth={2.5} />
                                                    {formatTime(b.start)}–{formatTime(b.eind)}
                                                    {conflictsFor && (
                                                        <AlertTriangle
                                                            size={13}
                                                            strokeWidth={2.5}
                                                            className={styles.zoomBlokConflictIcon}
                                                        />
                                                    )}
                                                    {(ghost || weg) && <Eye size={13} strokeWidth={2.5} />}
                                                </div>
                                                <div className={styles.zoomBlokNaam}>{b.olodNaam}</div>
                                                <div className={styles.zoomBlokMeta}>{b.klasgroep}</div>
                                                {b.type && <div className={styles.zoomBlokMeta}>{b.type}</div>}
                                                {b.lokaal && <div className={styles.zoomBlokMeta}>{b.lokaal}</div>}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                )}

                {legende.length > 0 && (
                    <div className={styles.zoomLegend}>
                        {legende.map(({ olodNaam, klasgroepen }) => (
                            <span key={olodNaam} className={styles.legendChip}>
                                <span
                                    className={styles.legendSwatch}
                                    style={{ backgroundColor: colorOf(olodNaam) }}
                                />
                                {olodNaam}
                                <span className={styles.zoomLegendKlas}>{klasgroepen.join(', ')}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
