import { useEffect, useState, useMemo, useRef } from 'react';
import { Lesblok, OLODSelectie } from './types';
import { trajectUntisService } from './trajectService';
import {
    addDays,
    DAG_HEADERS,
    formatDateBE,
    formatTime,
    fridayEndOf,
    mondayOf,
    sameDay,
} from './dateUtils';
import styles from './Traject.module.css';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { LesblokIcon } from './LesblokIcon';

interface Props {
    klasgroep: string | null;
    initialWeek: Date;
    mijnOpleidingKlasgroepen: string[];
    isSelected: (sel: OLODSelectie) => boolean;
    colorOf: (olodNaam: string) => string;
    ensureColor: (olodNaam: string) => void;
    onToggle: (sel: OLODSelectie) => void;
}

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 18;
const TOTAL_MIN = (DAY_END_HOUR - DAY_START_HOUR) * 60;

function topPct(d: Date): number {
    const m = (d.getHours() - DAY_START_HOUR) * 60 + d.getMinutes();
    return Math.max(0, (m / TOTAL_MIN) * 100);
}

function heightPct(start: Date, eind: Date): number {
    const m =
        (eind.getHours() - DAY_START_HOUR) * 60 +
        eind.getMinutes() -
        ((start.getHours() - DAY_START_HOUR) * 60 + start.getMinutes());
    return Math.max(1, (m / TOTAL_MIN) * 100);
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
            .catch(e => setError(e?.message ?? 'Rooster ophalen mislukt'))
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
                <div className={styles.emptyState}>{error}</div>
            ) : (
                <div className={styles.roosterGrid}>
                    <div className={styles.roosterHeader}></div>
                    {dagen.map((d, i) => (
                        <div key={i} className={styles.roosterHeader}>
                            {DAG_HEADERS[i]} {d.getDate()}/{d.getMonth() + 1}
                        </div>
                    ))}

                    <div className={styles.roosterTimeCol}>
                        {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }).map((_, i) => (
                            <div
                                key={i}
                                className={styles.roosterTimeLabel}
                                style={{ top: `${(i * 60 / TOTAL_MIN) * 100}%` }}
                            >
                                {DAY_START_HOUR + i}:00
                            </div>
                        ))}
                    </div>

                    {dagen.map((d, idx) => {
                        const dayBlokken = blokken.filter(b => sameDay(b.start, d));
                        return (
                            <div key={idx} className={styles.roosterDayCol}>
                                {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }).map((_, i) => (
                                    <div
                                        key={i}
                                        className={styles.roosterGridLine}
                                        style={{ top: `${((i + 1) * 60 / TOTAL_MIN) * 100}%` }}
                                    />
                                ))}
                                {dayBlokken.map((b, i) => {
                                    const sel = { klasgroep: b.klasgroep, olodNaam: b.olodNaam };
                                    const selected = isSelected(sel);
                                    return (
                                        <div
                                            key={i}
                                            className={`${styles.roosterBlok} ${selected ? styles.roosterBlokSelected : ''}`}
                                            style={{
                                                top: `${topPct(b.start)}%`,
                                                height: `${heightPct(b.start, b.eind)}%`,
                                                backgroundColor: colorOf(b.olodNaam),
                                            }}
                                            title={`${b.olodNaam}${b.type ? ` (${b.type})` : ''}\n${formatTime(b.start)}–${formatTime(b.eind)}${b.lokaal ? '\n' + b.lokaal : ''}`}
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

    return (
        <div className={styles.hoverMiniCol}>
            <div className={styles.hoverMiniLabel}>{klasgroep}</div>
            <div className={styles.hoverMiniWeek}>
                {dagen.map((d, di) => {
                    const dayBlokken = allBlokken.filter(b => sameDay(b.start, d));
                    return (
                        <div key={di} className={styles.miniDay}>
                            <div className={styles.miniDayHeader}>{DAG_HEADERS[di]}</div>
                            <div className={styles.miniDayBody}>
                                {dayBlokken.map((b, bi) => {
                                    const isMatch = b.olodNaam === highlightOlod;
                                    return (
                                        <div
                                            key={bi}
                                            className={`${styles.hoverMiniBlok} ${isMatch ? styles.hoverMiniBlokMatch : styles.hoverMiniBlokDim}`}
                                            style={{
                                                top: `${topPct(b.start)}%`,
                                                height: `${heightPct(b.start, b.eind)}%`,
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
