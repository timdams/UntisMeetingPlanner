import { useEffect, useMemo, useRef, useState } from 'react';
import { Lesblok, StudentTraject, Conflict } from './types';
import {
    addDays,
    bereikOverlapt,
    DAG_HEADERS,
    DAY_START_HOUR,
    datumInBereik,
    formatDateBE,
    formatDateTime,
    formatTime,
    fridayEndOf,
    gridEndHour,
    isoWeekNumber,
    parseIsoDate,
    periodeBereik,
    sameDay,
    toIsoDate,
    weeksBetween,
} from './dateUtils';
import { academiejaarBereik, periodeGrenzen, type ModuleGrenzen, type PeriodeType } from './academicYear';
import styles from './Traject.module.css';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { LesblokIcon } from './LesblokIcon';
import { layoutDay } from './layout';

interface Props {
    traject: StudentTraject;
    // Lesblokken van het volledige academiejaar per klasgroep in het traject
    // (zie useTrajectBlokken), plus laad-/foutstatus van die fetch.
    blokkenPerKlas: Record<string, Lesblok[]>;
    busy: boolean;
    error: string | null;
    // De actieve periode van het werkblad (inclusieve ISO-datums): haar weken
    // worden gemarkeerd en in beeld gescrold. Het overzicht zelf toont altijd
    // het volledige academiejaar.
    actiefBereik: { van: string; tot: string };
    periodeType: PeriodeType;
    moduleGrenzen: ModuleGrenzen;
    colorOf: (olodNaam: string) => string;
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
    blokkenPerKlas,
    busy,
    error,
    actiefBereik,
    periodeType,
    moduleGrenzen,
    colorOf,
}: Props) {
    const [conflictsOpen, setConflictsOpen] = useState(true);

    // Het overzicht beslaat altijd het volledige academiejaar; elke selectie
    // draagt enkel binnen haar eigen periode bij.
    const jaar = useMemo(() => academiejaarBereik(), []);
    const { van: start, tot: eind } = useMemo(() => periodeBereik(jaar.van, jaar.tot), [jaar]);

    const klasgroepen = useMemo(
        () => Array.from(new Set(traject.map(s => s.klasgroep))),
        [traject]
    );

    // Een blok telt zodra een selectie van dat vak bij die klasgroep het blok in
    // haar periode heeft. Twee selecties kunnen elkaar overlappen (bv. een
    // S1-keuze naast een M2-keuze van hetzelfde vak); hetzelfde blok mag dan
    // maar één keer in het overzicht komen.
    const effectieveBlokken = useMemo<Lesblok[]>(() => {
        const perTuple = new Map<string, StudentTraject>();
        for (const s of traject) {
            const key = `${s.klasgroep}||${s.olodNaam}`;
            const arr = perTuple.get(key);
            if (arr) arr.push(s);
            else perTuple.set(key, [s]);
        }
        const out: Lesblok[] = [];
        for (const k of klasgroepen) {
            const bs = blokkenPerKlas[k] ?? [];
            for (const b of bs) {
                const sels = perTuple.get(`${b.klasgroep}||${b.olodNaam}`);
                if (!sels) continue;
                if (b.start.getTime() < start.getTime() || b.eind.getTime() > eind.getTime()) continue;
                if (sels.some(s => datumInBereik(b.start, s.van, s.tot))) out.push(b);
            }
        }
        return out;
    }, [blokkenPerKlas, traject, klasgroepen, start, eind]);

    // Alle weekstroken delen dezelfde hoogte: standaard tot 18u, uitgerekt tot
    // max 22u zodra het traject een avondschoolblok bevat dat later eindigt.
    const totalMin = useMemo(
        () => (gridEndHour(effectieveBlokken) - DAY_START_HOUR) * 60,
        [effectieveBlokken]
    );

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

    // Grensmarkeringen (semester-/modulestart) per week: de week waarin de
    // grensdatum valt krijgt er een boven zich.
    const grenzen = useMemo(
        () => periodeGrenzen(periodeType, moduleGrenzen),
        [periodeType, moduleGrenzen.m2Start, moduleGrenzen.m4Start]
    );
    const grenzenVoorWeek = (wkMonday: Date) => {
        const ma = toIsoDate(wkMonday);
        const zo = toIsoDate(addDays(wkMonday, 6));
        return grenzen.filter(g => g.datum >= ma && g.datum <= zo);
    };
    const weekInActievePeriode = (wkMonday: Date) =>
        bereikOverlapt(toIsoDate(wkMonday), toIsoDate(addDays(wkMonday, 4)), actiefBereik.van, actiefBereik.tot);

    // Bij een periodewissel scrollen we de eerste week van die periode in beeld.
    const eersteActieveRij = useRef<HTMLDivElement | null>(null);
    const heeftRijen = !error && traject.length > 0;
    useEffect(() => {
        eersteActieveRij.current?.scrollIntoView({ block: 'start' });
    }, [actiefBereik.van, actiefBereik.tot, heeftRijen]);

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
                            const actief = weekInActievePeriode(wkMonday);
                            const eersteActief = actief && (wi === 0 || !weekInActievePeriode(weken[wi - 1]));
                            const wkGrenzen = grenzenVoorWeek(wkMonday);
                            return (
                                <div key={wi} ref={eersteActief ? eersteActieveRij : undefined}>
                                    {wkGrenzen.map(g => (
                                        <div key={g.datum} className={styles.periodeGrens}>
                                            <span>{g.label}</span>
                                            <small>{formatDateBE(parseIsoDate(g.datum))}</small>
                                        </div>
                                    ))}
                                <div className={`${styles.weekRow} ${actief ? styles.weekRowActief : ''}`}>
                                    <div className={styles.weekLabel}>
                                        Week {isoWeekNumber(wkMonday)}
                                        <small>{formatDateBE(wkMonday)}</small>
                                    </div>
                                    <div className={styles.miniWeek}>
                                        {dagen.map((dag, di) => {
                                            const dayBlokken = wkBlokken.filter(b => sameDay(b.start, dag));
                                            const laidOut = layoutDay(dayBlokken);
                                            return (
                                                <div key={di} className={styles.miniDay}>
                                                    <div className={styles.miniDayHeader}>
                                                        {DAG_HEADERS[di]}
                                                    </div>
                                                    <div className={styles.miniDayBody}>
                                                        {laidOut.map(({ blok: b, col, cols }, bi) => {
                                                            const conflictsFor = conflictMap.get(b);
                                                            const conflict = !!conflictsFor;
                                                            const widthPct = 100 / cols;
                                                            const leftPct = col * widthPct;
                                                            const baseTip =
                                                                `${b.olodNaam}\n${b.klasgroep}${b.type ? ` · ${b.type}` : ''}` +
                                                                `\n${formatTime(b.start)}–${formatTime(b.eind)}` +
                                                                (b.lokaal ? `\n${b.lokaal}` : '');
                                                            const conflictTip = conflictsFor
                                                                ? '\n\n⚠ Conflict met:\n' +
                                                                  conflictsFor
                                                                      .map(
                                                                          o =>
                                                                              `• ${o.olodNaam} (${o.klasgroep}${o.type ? `, ${o.type}` : ''})` +
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
                                                                        top: `${topPct(b.start, totalMin)}%`,
                                                                        height: `${heightPct(b.start, b.eind, totalMin)}%`,
                                                                        left: `calc(${leftPct}% + 1px)`,
                                                                        width: `calc(${widthPct}% - 2px)`,
                                                                        backgroundColor: colorOf(b.olodNaam),
                                                                    }}
                                                                >
                                                                    <LesblokIcon
                                                                        type={b.type}
                                                                        size={10}
                                                                        strokeWidth={2.5}
                                                                        className={styles.miniBlokIcon}
                                                                    />
                                                                    {conflict && (
                                                                        <AlertTriangle
                                                                            size={10}
                                                                            strokeWidth={2.5}
                                                                            className={styles.miniBlokConflictIcon}
                                                                        />
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
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
