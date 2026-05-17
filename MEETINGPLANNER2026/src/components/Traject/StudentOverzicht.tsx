import { useEffect, useMemo, useState } from 'react';
import { Lesblok, StudentTraject, Conflict } from './types';
import { trajectUntisService } from './trajectService';
import {
    addDays,
    DAG_HEADERS,
    formatDateBE,
    formatDateTime,
    formatTime,
    fridayEndOf,
    isoWeekNumber,
    parseIsoDate,
    sameDay,
    weeksBetween,
} from './dateUtils';
import styles from './Traject.module.css';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

interface Props {
    traject: StudentTraject;
    semesterStart: string;
    semesterEind: string;
    colorOf: (olodNaam: string) => string;
    ensureColor: (olodNaam: string) => void;
}

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 18;
const TOTAL_MIN = (DAY_END_HOUR - DAY_START_HOUR) * 60;

function topPct(d: Date): number {
    const m = (d.getHours() - DAY_START_HOUR) * 60 + d.getMinutes();
    return Math.max(0, Math.min(100, (m / TOTAL_MIN) * 100));
}

function heightPct(start: Date, eind: Date): number {
    const m =
        (eind.getHours() - DAY_START_HOUR) * 60 +
        eind.getMinutes() -
        ((start.getHours() - DAY_START_HOUR) * 60 + start.getMinutes());
    return Math.max(2, Math.min(100, (m / TOTAL_MIN) * 100));
}

function overlapt(a: Lesblok, b: Lesblok): boolean {
    return a.start.getTime() < b.eind.getTime() && b.start.getTime() < a.eind.getTime();
}

function detectConflicts(blokken: Lesblok[]): Conflict[] {
    const conflicts: Conflict[] = [];
    const sorted = [...blokken].sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
            if (sorted[j].start.getTime() >= sorted[i].eind.getTime()) break;
            if (overlapt(sorted[i], sorted[j])) {
                conflicts.push({ a: sorted[i], b: sorted[j] });
            }
        }
    }
    return conflicts;
}

export function StudentOverzicht({
    traject,
    semesterStart,
    semesterEind,
    colorOf,
    ensureColor,
}: Props) {
    const [blokkenPerKlas, setBlokkenPerKlas] = useState<Record<string, Lesblok[]>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [conflictsOpen, setConflictsOpen] = useState(true);

    const start = useMemo(() => parseIsoDate(semesterStart), [semesterStart]);
    const eind = useMemo(() => {
        const d = parseIsoDate(semesterEind);
        d.setHours(23, 59, 59, 999);
        return d;
    }, [semesterEind]);

    const klasgroepen = useMemo(
        () => Array.from(new Set(traject.map(s => s.klasgroep))),
        [traject]
    );

    useEffect(() => {
        if (klasgroepen.length === 0) {
            setBlokkenPerKlas({});
            return;
        }
        let cancelled = false;
        setBusy(true);
        setError(null);
        Promise.all(
            klasgroepen.map(k =>
                trajectUntisService
                    .getLesblokken(k, start, eind)
                    .then(bs => [k, bs] as const)
            )
        )
            .then(results => {
                if (cancelled) return;
                const map: Record<string, Lesblok[]> = {};
                results.forEach(([k, bs]) => {
                    map[k] = bs;
                    bs.forEach(b => ensureColor(b.olodNaam));
                });
                setBlokkenPerKlas(map);
            })
            .catch(e => {
                if (!cancelled) setError(e?.message ?? 'Rooster ophalen mislukt');
            })
            .finally(() => {
                if (!cancelled) setBusy(false);
            });
        return () => {
            cancelled = true;
        };
    }, [klasgroepen.join('|'), start.getTime(), eind.getTime()]);

    const effectieveBlokken = useMemo<Lesblok[]>(() => {
        const selectedKeys = new Set(traject.map(s => `${s.klasgroep}||${s.olodNaam}`));
        const out: Lesblok[] = [];
        for (const k of klasgroepen) {
            const bs = blokkenPerKlas[k] ?? [];
            for (const b of bs) {
                if (
                    selectedKeys.has(`${b.klasgroep}||${b.olodNaam}`) &&
                    b.start.getTime() >= start.getTime() &&
                    b.eind.getTime() <= eind.getTime()
                ) {
                    out.push(b);
                }
            }
        }
        return out;
    }, [blokkenPerKlas, traject, start, eind]);

    const conflicts = useMemo(() => detectConflicts(effectieveBlokken), [effectieveBlokken]);
    const conflictMap = useMemo(() => {
        const map = new Map<Lesblok, Lesblok[]>();
        const push = (key: Lesblok, val: Lesblok) => {
            const arr = map.get(key);
            if (arr) arr.push(val);
            else map.set(key, [val]);
        };
        conflicts.forEach(c => {
            push(c.a, c.b);
            push(c.b, c.a);
        });
        return map;
    }, [conflicts]);

    const weken = useMemo(() => weeksBetween(start, eind), [start, eind]);

    const olodLegend = useMemo(() => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const b of effectieveBlokken) {
            if (!seen.has(b.olodNaam)) {
                seen.add(b.olodNaam);
                out.push(b.olodNaam);
            }
        }
        return out.sort((a, b) => a.localeCompare(b));
    }, [effectieveBlokken]);

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader}>
                Studenttraject
                {busy && <Loader2 size={14} className="animate-spin" />}
                <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: '0.8rem', color: '#64748b' }}>
                    {traject.length} OLOD{traject.length === 1 ? '' : 's'}
                </span>
            </div>

            <div className={styles.panelBodyFlex}>
                {error && <div className={styles.emptyState}>{error}</div>}

                {!error && traject.length === 0 ? (
                    <div className={styles.emptyState}>
                        Klik op lesblokken in het klasgroeprooster om OLODs aan het traject toe te voegen.
                    </div>
                ) : (
                    <div className={styles.overzichtScroll}>
                        {weken.map((wkMonday, wi) => {
                            const wkVrijdagEnd = fridayEndOf(wkMonday);
                            const dagen = Array.from({ length: 5 }, (_, i) => addDays(wkMonday, i));
                            const wkBlokken = effectieveBlokken.filter(
                                b =>
                                    b.start.getTime() >= wkMonday.getTime() &&
                                    b.start.getTime() <= wkVrijdagEnd.getTime()
                            );
                            return (
                                <div key={wi} className={styles.weekRow}>
                                    <div className={styles.weekLabel}>
                                        Week {isoWeekNumber(wkMonday)}
                                        <small>{formatDateBE(wkMonday)}</small>
                                    </div>
                                    <div className={styles.miniWeek}>
                                        {dagen.map((dag, di) => {
                                            const dayBlokken = wkBlokken.filter(b => sameDay(b.start, dag));
                                            return (
                                                <div key={di} className={styles.miniDay}>
                                                    <div className={styles.miniDayHeader}>
                                                        {DAG_HEADERS[di]}
                                                    </div>
                                                    <div className={styles.miniDayBody}>
                                                        {dayBlokken.map((b, bi) => {
                                                            const conflictsFor = conflictMap.get(b);
                                                            const conflict = !!conflictsFor;
                                                            const baseTip =
                                                                `${b.olodNaam}\n${b.klasgroep} · ${b.type}` +
                                                                `\n${formatTime(b.start)}–${formatTime(b.eind)}` +
                                                                (b.lokaal ? `\n${b.lokaal}` : '');
                                                            const conflictTip = conflictsFor
                                                                ? '\n\n⚠ Conflict met:\n' +
                                                                  conflictsFor
                                                                      .map(
                                                                          o =>
                                                                              `• ${o.olodNaam} (${o.klasgroep})` +
                                                                              ` · ${formatTime(o.start)}–${formatTime(o.eind)}`
                                                                      )
                                                                      .join('\n')
                                                                : '';
                                                            const tip = baseTip + conflictTip;
                                                            return (
                                                                <div
                                                                    key={bi}
                                                                    className={`${styles.miniBlok} ${conflict ? styles.miniBlokConflict : ''}`}
                                                                    data-tip={tip}
                                                                    style={{
                                                                        top: `${topPct(b.start)}%`,
                                                                        height: `${heightPct(b.start, b.eind)}%`,
                                                                        backgroundColor: colorOf(b.olodNaam),
                                                                    }}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Color legend */}
            {olodLegend.length > 0 && (
                <div className={styles.legendRow}>
                    {olodLegend.map(name => (
                        <span key={name} className={styles.legendChip}>
                            <span className={styles.legendSwatch} style={{ backgroundColor: colorOf(name) }} />
                            {name}
                        </span>
                    ))}
                </div>
            )}

            {/* Conflicts */}
            {conflicts.length > 0 && (
                <div className={styles.conflicts}>
                    <div
                        className={`${styles.conflictsHeader} ${styles.conflictsHeaderError}`}
                        onClick={() => setConflictsOpen(o => !o)}
                    >
                        {conflictsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <AlertTriangle size={14} />
                        {conflicts.length} conflict{conflicts.length === 1 ? '' : 'en'}
                    </div>
                    {conflictsOpen && (
                        <div className={styles.conflictsList}>
                            {conflicts.map((c, i) => (
                                <div key={i} className={styles.conflictItem}>
                                    <div>
                                        <strong>{c.a.olodNaam}</strong> ({c.a.klasgroep}) ·{' '}
                                        {formatDateTime(c.a.start)} – {formatTime(c.a.eind)}
                                    </div>
                                    <div>
                                        <strong>{c.b.olodNaam}</strong> ({c.b.klasgroep}) ·{' '}
                                        {formatDateTime(c.b.start)} – {formatTime(c.b.eind)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

        </div>
    );
}
