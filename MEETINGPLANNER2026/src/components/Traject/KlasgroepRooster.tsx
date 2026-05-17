import { useEffect, useState, useMemo } from 'react';
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

interface Props {
    klasgroep: string | null;
    initialWeek: Date;
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

export function KlasgroepRooster({
    klasgroep,
    initialWeek,
    isSelected,
    colorOf,
    ensureColor,
    onToggle,
}: Props) {
    const [weekMonday, setWeekMonday] = useState<Date>(() => mondayOf(initialWeek));
    const [blokken, setBlokken] = useState<Lesblok[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

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

    const dagen = useMemo(
        () => Array.from({ length: 5 }, (_, i) => addDays(weekMonday, i)),
        [weekMonday]
    );

    const prevWeek = () => setWeekMonday(w => addDays(w, -7));
    const nextWeek = () => setWeekMonday(w => addDays(w, 7));

    const weekLabel = `${formatDateBE(weekMonday)} – ${formatDateBE(addDays(weekMonday, 4))}`;

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
                                        >
                                            <div className={styles.roosterBlokTime}>
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
        </div>
    );
}
