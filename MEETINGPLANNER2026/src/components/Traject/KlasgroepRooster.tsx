import { useEffect, useState, useMemo, useRef } from 'react';
import { Lesblok, OLODSelectie } from './types';
import { trajectUntisService } from './trajectService';
import {
    addDays,
    DAG_HEADERS,
    DAY_START_HOUR,
    formatDateBE,
    formatTime,
    fridayEndOf,
    gridEndHour,
    mondayOf,
    sameDay,
} from './dateUtils';
import styles from './Traject.module.css';
import { Loader2, ChevronLeft, ChevronRight, CalendarClock } from 'lucide-react';
import { LesblokIcon } from './LesblokIcon';
import { layoutDay } from './layout';
import { defaultRoosterWeek } from './academicYear';

// Untis geeft 404 op roosterdata van een week buiten het geselecteerde
// academiejaar. We vangen die specifiek op met een begrijpelijke melding.
const OUTSIDE_YEAR_MSG = 'Deze week valt buiten het geselecteerde academiejaar. Ga naar een week van het juiste academiejaar.';

interface Props {
    klasgroep: string | null;
    initialWeek: Date;
    mijnOpleidingKlasgroepen: string[];
    isSelected: (sel: OLODSelectie) => boolean;
    colorOf: (olodNaam: string) => string;
    ensureColor: (olodNaam: string) => void;
    onToggle: (sel: OLODSelectie) => void;
}

function topPct(d: Date, totalMin: number): number {
    const m = (d.getHours() - DAY_START_HOUR) * 60 + d.getMinutes();
    return Math.max(0, (m / totalMin) * 100);
}

function heightPct(start: Date, eind: Date, totalMin: number): number {
    const m =
        (eind.getHours() - DAY_START_HOUR) * 60 +
        eind.getMinutes() -
        ((start.getHours() - DAY_START_HOUR) * 60 + start.getMinutes());
    return Math.max(1, (m / totalMin) * 100);
}

interface HoverInfo {
    olodNaam: string;
    anchor: { left: number; top: number; right: number; bottom: number };
}

const POPOVER_MAX_W = 580;
const POPOVER_MAX_H = 520;

export function KlasgroepRooster({
    klasgroep,
    initialWeek,
    mijnOpleidingKlasgroepen,
    isSelected,
    colorOf,
    ensureColor,
    onToggle,
}: Props) {
    const [weekMonday, setWeekMonday] = useState<Date>(() => mondayOf(initialWeek));
    const [blokken, setBlokken] = useState<Lesblok[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [otherBlokkenPerKlas, setOtherBlokkenPerKlas] = useState<Record<string, Lesblok[]>>({});
    const [otherLoading, setOtherLoading] = useState(false);

    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
    const hideTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!klasgroep) {
            setBlokken([]);
            return;
        }
        const van = new Date(weekMonday);
        const tot = fridayEndOf(weekMonday);
        setBusy(true);
        setError(null);
        trajectUntisService
            .getLesblokken(klasgroep, van, tot)
            .then(bs => {
                setBlokken(bs);
                bs.forEach(b => ensureColor(b.olodNaam));
            })
            .catch(e => {
                const msg: string = e?.message ?? '';
                setError(msg.includes('404') ? OUTSIDE_YEAR_MSG : (msg || 'Rooster ophalen mislukt'));
            })
            .finally(() => setBusy(false));
    }, [klasgroep, weekMonday]);

    // Prefetch other shortlist klasgroepen for the current week — used by hover popover.
    useEffect(() => {
        if (!klasgroep) {
            setOtherBlokkenPerKlas({});
            return;
        }
        const others = mijnOpleidingKlasgroepen.filter(k => k !== klasgroep);
        if (others.length === 0) {
            setOtherBlokkenPerKlas({});
            return;
        }
        let cancelled = false;
        const van = new Date(weekMonday);
        const tot = fridayEndOf(weekMonday);
        setOtherBlokkenPerKlas({});
        setOtherLoading(true);
        Promise.all(
            others.map(k =>
                trajectUntisService
                    .getLesblokken(k, van, tot)
                    .then(bs => [k, bs] as const)
                    .catch(() => [k, [] as Lesblok[]] as const)
            )
        ).then(results => {
            if (cancelled) return;
            const map: Record<string, Lesblok[]> = {};
            results.forEach(([k, bs]) => {
                map[k] = bs;
                bs.forEach(b => ensureColor(b.olodNaam));
            });
            setOtherBlokkenPerKlas(map);
            setOtherLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [klasgroep, weekMonday.getTime(), mijnOpleidingKlasgroepen.join('|')]);

    // Hide popover when week or klasgroep changes
    useEffect(() => {
        setHoverInfo(null);
    }, [klasgroep, weekMonday.getTime()]);

    const dagen = useMemo(
        () => Array.from({ length: 5 }, (_, i) => addDays(weekMonday, i)),
        [weekMonday]
    );

    // Grid loopt standaard tot 18u; rekt uit tot max 22u zodra deze week een
    // avondschoolblok bevat dat later eindigt.
    const dayEndHour = useMemo(() => gridEndHour(blokken), [blokken]);
    const totalMin = (dayEndHour - DAY_START_HOUR) * 60;

    const prevWeek = () => setWeekMonday(w => addDays(w, -7));
    const nextWeek = () => setWeekMonday(w => addDays(w, 7));

    const weekLabel = `${formatDateBE(weekMonday)} – ${formatDateBE(addDays(weekMonday, 4))}`;

    const showHover = (e: React.MouseEvent, olodNaam: string) => {
        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setHoverInfo({
            olodNaam,
            anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        });
    };

    const hideHover = () => {
        if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = window.setTimeout(() => {
            setHoverInfo(null);
            hideTimerRef.current = null;
        }, 80);
    };

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader}>
                {klasgroep ? `Rooster ${klasgroep}` : 'Rooster'}
                {busy && <Loader2 size={14} className="animate-spin" />}
            </div>

            <div className={styles.weekNav}>
                <button onClick={prevWeek} disabled={!klasgroep}>
                    <ChevronLeft size={14} />
                </button>
                <div className={styles.weekNavTitle}>{weekLabel}</div>
                <button onClick={nextWeek} disabled={!klasgroep}>
                    <ChevronRight size={14} />
                </button>
            </div>

            {!klasgroep ? (
                <div className={styles.emptyState}>
                    Selecteer een klasgroep links om het rooster te bekijken.
                </div>
            ) : error ? (
                <div className={styles.emptyState}>
                    {error}
                    {error === OUTSIDE_YEAR_MSG && (
                        <button
                            className={styles.toolbarBtn}
                            style={{ marginTop: '0.75rem' }}
                            onClick={() => setWeekMonday(mondayOf(defaultRoosterWeek()))}
                        >
                            <CalendarClock size={14} /> Ga naar {formatDateBE(mondayOf(defaultRoosterWeek()))}
                        </button>
                    )}
                </div>
            ) : (
                <div className={styles.roosterGrid}>
                    <div className={styles.roosterHeader}></div>
                    {dagen.map((d, i) => (
                        <div key={i} className={styles.roosterHeader}>
                            {DAG_HEADERS[i]} {d.getDate()}/{d.getMonth() + 1}
                        </div>
                    ))}

                    <div className={styles.roosterTimeCol}>
                        {Array.from({ length: dayEndHour - DAY_START_HOUR + 1 }).map((_, i) => (
                            <div
                                key={i}
                                className={styles.roosterTimeLabel}
                                style={{ top: `${(i * 60 / totalMin) * 100}%` }}
                            >
                                {DAY_START_HOUR + i}:00
                            </div>
                        ))}
                    </div>

                    {dagen.map((d, idx) => {
                        const dayBlokken = blokken.filter(b => sameDay(b.start, d));
                        const laidOut = layoutDay(dayBlokken);
                        return (
                            <div key={idx} className={styles.roosterDayCol}>
                                {Array.from({ length: dayEndHour - DAY_START_HOUR }).map((_, i) => (
                                    <div
                                        key={i}
                                        className={styles.roosterGridLine}
                                        style={{ top: `${((i + 1) * 60 / totalMin) * 100}%` }}
                                    />
                                ))}
                                {laidOut.map(({ blok: b, col, cols }, i) => {
                                    const sel = { klasgroep: b.klasgroep, olodNaam: b.olodNaam };
                                    const selected = isSelected(sel);
                                    const widthPct = 100 / cols;
                                    const leftPct = col * widthPct;
                                    return (
                                        <div
                                            key={i}
                                            className={`${styles.roosterBlok} ${selected ? styles.roosterBlokSelected : ''}`}
                                            style={{
                                                top: `${topPct(b.start, totalMin)}%`,
                                                height: `${heightPct(b.start, b.eind, totalMin)}%`,
                                                left: `calc(${leftPct}% + 2px)`,
                                                width: `calc(${widthPct}% - 4px)`,
                                                backgroundColor: colorOf(b.olodNaam),
                                            }}
                                            onClick={() => onToggle(sel)}
                                            onMouseEnter={(e) => showHover(e, b.olodNaam)}
                                            onMouseLeave={hideHover}
                                        >
                                            <div className={styles.roosterBlokTime}>
                                                <LesblokIcon type={b.type} size={11} className={styles.roosterBlokIcon} />
                                                {formatTime(b.start)}
                                            </div>
                                            <div>{b.olodNaam}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            )}

            {hoverInfo && klasgroep && (
                <OlodHoverPopover
                    info={hoverInfo}
                    weekMonday={weekMonday}
                    otherBlokkenPerKlas={otherBlokkenPerKlas}
                    otherLoading={otherLoading}
                    colorOf={colorOf}
                />
            )}
        </div>
    );
}

interface PopoverProps {
    info: HoverInfo;
    weekMonday: Date;
    otherBlokkenPerKlas: Record<string, Lesblok[]>;
    otherLoading: boolean;
    colorOf: (olodNaam: string) => string;
}

function OlodHoverPopover({
    info,
    weekMonday,
    otherBlokkenPerKlas,
    otherLoading,
    colorOf,
}: PopoverProps) {
    const matches = useMemo(() => {
        const out: { klasgroep: string; allBlokken: Lesblok[]; matchBlokken: Lesblok[] }[] = [];
        const sortedKeys = Object.keys(otherBlokkenPerKlas).sort((a, b) => a.localeCompare(b));
        for (const k of sortedKeys) {
            const all = otherBlokkenPerKlas[k] ?? [];
            const match = all.filter(b => b.olodNaam === info.olodNaam);
            if (match.length > 0) out.push({ klasgroep: k, allBlokken: all, matchBlokken: match });
        }
        return out;
    }, [otherBlokkenPerKlas, info.olodNaam]);

    const anchorMidX = (info.anchor.left + info.anchor.right) / 2;
    const placeLeft = anchorMidX > window.innerWidth / 2;
    const left = placeLeft
        ? Math.max(8, info.anchor.left - POPOVER_MAX_W - 8)
        : Math.min(window.innerWidth - POPOVER_MAX_W - 8, info.anchor.right + 8);
    const top = Math.max(
        8,
        Math.min(window.innerHeight - POPOVER_MAX_H - 8, info.anchor.top)
    );

    return (
        <div
            className={styles.hoverPopover}
            style={{ left, top, width: POPOVER_MAX_W, maxHeight: POPOVER_MAX_H }}
        >
            <div className={styles.hoverPopoverTitle}>
                <span
                    className={styles.legendSwatch}
                    style={{ backgroundColor: colorOf(info.olodNaam) }}
                />
                <strong>{info.olodNaam}</strong>
                <span className={styles.hoverPopoverSubtitle}>
                    in andere klasgroepen deze week
                </span>
            </div>
            {matches.length === 0 ? (
                <div className={styles.hoverPopoverEmpty}>
                    {otherLoading
                        ? 'Andere klasgroepen laden…'
                        : 'Dit vak komt deze week niet voor in andere klasgroepen uit jouw shortlist.'}
                </div>
            ) : (
                <div className={styles.hoverMiniGrid}>
                    {matches.map(({ klasgroep: kg, allBlokken, matchBlokken }) => (
                        <MiniWeek
                            key={kg}
                            klasgroep={kg}
                            weekMonday={weekMonday}
                            allBlokken={allBlokken}
                            highlightOlod={info.olodNaam}
                            matchBlokken={matchBlokken}
                            colorOf={colorOf}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface MiniWeekProps {
    klasgroep: string;
    weekMonday: Date;
    allBlokken: Lesblok[];
    highlightOlod: string;
    matchBlokken: Lesblok[];
    colorOf: (olodNaam: string) => string;
}

function MiniWeek({
    klasgroep,
    weekMonday,
    allBlokken,
    highlightOlod,
    matchBlokken,
    colorOf,
}: MiniWeekProps) {
    const dagen = useMemo(
        () => Array.from({ length: 5 }, (_, i) => addDays(weekMonday, i)),
        [weekMonday]
    );

    const totalMin = useMemo(
        () => (gridEndHour(allBlokken) - DAY_START_HOUR) * 60,
        [allBlokken]
    );

    return (
        <div className={styles.hoverMiniCol}>
            <div className={styles.hoverMiniLabel}>{klasgroep}</div>
            <div className={styles.hoverMiniWeek}>
                {dagen.map((d, di) => {
                    const dayBlokken = allBlokken.filter(b => sameDay(b.start, d));
                    const laidOut = layoutDay(dayBlokken);
                    return (
                        <div key={di} className={styles.miniDay}>
                            <div className={styles.miniDayHeader}>{DAG_HEADERS[di]}</div>
                            <div className={styles.miniDayBody}>
                                {laidOut.map(({ blok: b, col, cols }, bi) => {
                                    const isMatch = b.olodNaam === highlightOlod;
                                    const widthPct = 100 / cols;
                                    const leftPct = col * widthPct;
                                    return (
                                        <div
                                            key={bi}
                                            className={`${styles.hoverMiniBlok} ${isMatch ? styles.hoverMiniBlokMatch : styles.hoverMiniBlokDim}`}
                                            style={{
                                                top: `${topPct(b.start, totalMin)}%`,
                                                height: `${heightPct(b.start, b.eind, totalMin)}%`,
                                                left: `calc(${leftPct}% + 1px)`,
                                                width: `calc(${widthPct}% - 2px)`,
                                                backgroundColor: isMatch
                                                    ? colorOf(b.olodNaam)
                                                    : undefined,
                                            }}
                                            title={`${b.olodNaam}${b.type ? ` (${b.type})` : ''}\n${formatTime(b.start)}–${formatTime(b.eind)}`}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className={styles.hoverMiniDetails}>
                {matchBlokken
                    .slice()
                    .sort((a, b) => a.start.getTime() - b.start.getTime())
                    .map((b, i) => {
                        const dayIdx = (b.start.getDay() + 6) % 7;
                        return (
                            <div key={i}>
                                <strong>{DAG_HEADERS[dayIdx] ?? ''}</strong>{' '}
                                {formatTime(b.start)}–{formatTime(b.eind)}
                                {b.type ? ` · ${b.type}` : ''}
                            </div>
                        );
                    })}
            </div>
        </div>
    );
}
