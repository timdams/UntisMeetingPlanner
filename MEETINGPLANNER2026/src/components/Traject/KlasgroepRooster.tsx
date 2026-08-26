import { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
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
    parseIsoDate,
    sameDay,
    toIsoDate,
} from './dateUtils';
import styles from './Traject.module.css';
import { Loader2, ChevronLeft, ChevronRight, ChevronDown, CalendarClock, Users, X, Check } from 'lucide-react';
import { LesblokIcon } from './LesblokIcon';
import { layoutDay } from './layout';

// Untis geeft 404 op roosterdata van een week buiten het geselecteerde
// academiejaar. We vangen die specifiek op met een begrijpelijke melding.
const OUTSIDE_YEAR_MSG = 'Deze week valt buiten het geselecteerde academiejaar. Ga naar een week van het juiste academiejaar.';

interface Props {
    klasgroep: string | null;
    // De week waarop het rooster opent; verandert mee met de actieve periode.
    initialWeek: Date;
    mijnOpleidingKlasgroepen: string[];
    // De selectie die een klik op dit lesblok zou weghalen, of null.
    selectieVoor: (klasgroep: string, olodNaam: string, datum: Date) => OLODSelectie | null;
    colorOf: (olodNaam: string) => string;
    ensureColor: (olodNaam: string) => void;
    onToggleBlok: (blok: Lesblok) => void;
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

export function KlasgroepRooster({
    klasgroep,
    initialWeek,
    mijnOpleidingKlasgroepen,
    selectieVoor,
    colorOf,
    ensureColor,
    onToggleBlok,
}: Props) {
    const [weekMonday, setWeekMonday] = useState<Date>(() => mondayOf(initialWeek));

    // Springt naar de openingsweek van een nieuw gekozen periode. Bij mount is
    // de week al gelijk; dan behouden we het bestaande Date-object zodat de
    // fetch-effecten hieronder niet nog eens vuren.
    useEffect(() => {
        const next = mondayOf(initialWeek);
        setWeekMonday(w => (w.getTime() === next.getTime() ? w : next));
    }, [initialWeek.getTime()]);
    const [blokken, setBlokken] = useState<Lesblok[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Het vak waarvoor de klasgroep-kiezer openstaat (null = dialoog dicht).
    const [dialogOlod, setDialogOlod] = useState<string | null>(null);
    const [otherBlokkenPerKlas, setOtherBlokkenPerKlas] = useState<Record<string, Lesblok[]>>({});
    const [otherLoading, setOtherLoading] = useState(false);
    // Roosters van de andere klasgroepen per week, zodat een tweede klik op een
    // knopje in dezelfde week niet opnieuw hoeft te fetchen.
    const otherCacheRef = useRef<Map<string, Record<string, Lesblok[]>>>(new Map());

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
    }, [klasgroep, weekMonday.getTime()]);

    const andereKlasgroepen = useMemo(
        () => mijnOpleidingKlasgroepen.filter(k => k !== klasgroep),
        [mijnOpleidingKlasgroepen.join('|'), klasgroep]
    );

    // De roosters van de andere klasgroepen halen we pas op wanneer de kiezer
    // opengaat: met een lange shortlist zou dat anders bij elke weekwissel een
    // stapel overbodige requests zijn.
    const dialogOpen = dialogOlod !== null;
    useEffect(() => {
        if (!dialogOpen || !klasgroep) return;
        if (andereKlasgroepen.length === 0) {
            setOtherBlokkenPerKlas({});
            setOtherLoading(false);
            return;
        }
        const cacheKey = `${weekMonday.getTime()}|${andereKlasgroepen.join('|')}`;
        const cached = otherCacheRef.current.get(cacheKey);
        if (cached) {
            setOtherBlokkenPerKlas(cached);
            setOtherLoading(false);
            return;
        }
        let cancelled = false;
        const van = new Date(weekMonday);
        const tot = fridayEndOf(weekMonday);
        setOtherBlokkenPerKlas({});
        setOtherLoading(true);
        Promise.all(
            andereKlasgroepen.map(k =>
                trajectUntisService
                    .getLesblokken(k, van, tot)
                    .then(bs => [k, bs] as const)
                    .catch(() => [k, [] as Lesblok[]] as const)
            )
        ).then(results => {
            const map: Record<string, Lesblok[]> = {};
            results.forEach(([k, bs]) => {
                map[k] = bs;
            });
            otherCacheRef.current.set(cacheKey, map);
            if (cancelled) return;
            results.forEach(([, bs]) => bs.forEach(b => ensureColor(b.olodNaam)));
            setOtherBlokkenPerKlas(map);
            setOtherLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [dialogOpen, klasgroep, weekMonday.getTime(), andereKlasgroepen]);

    // Sluit de kiezer wanneer de week of de klasgroep wisselt.
    useEffect(() => {
        setDialogOlod(null);
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
    const jumpToDate = (iso: string) => {
        if (!iso) return;
        setWeekMonday(mondayOf(parseIsoDate(iso)));
    };

    const weekLabel = `${formatDateBE(weekMonday)} – ${formatDateBE(addDays(weekMonday, 4))}`;

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader}>
                {klasgroep ? `Rooster ${klasgroep}` : 'Rooster'}
                {busy && <Loader2 size={14} className="animate-spin" />}
            </div>

            <div className={styles.weekNav}>
                <div className={styles.weekNavArrows}>
                    <button onClick={prevWeek} disabled={!klasgroep}>
                        <ChevronLeft size={14} />
                    </button>
                    <div className={styles.weekNavTitle}>{weekLabel}</div>
                    <button onClick={nextWeek} disabled={!klasgroep}>
                        <ChevronRight size={14} />
                    </button>
                </div>
                <input
                    type="date"
                    className={styles.weekNavDate}
                    value={toIsoDate(weekMonday)}
                    onChange={e => jumpToDate(e.target.value)}
                    disabled={!klasgroep}
                    title="Ga naar een specifieke week"
                />
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
                            onClick={() => setWeekMonday(mondayOf(initialWeek))}
                        >
                            <CalendarClock size={14} /> Ga naar {formatDateBE(mondayOf(initialWeek))}
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
                                    const selected = selectieVoor(b.klasgroep, b.olodNaam, b.start) !== null;
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
                                            onClick={() => onToggleBlok(b)}
                                        >
                                            <button
                                                type="button"
                                                className={styles.roosterBlokBtn}
                                                title={`Toon ${b.olodNaam} in de andere klasgroepen en kies er een`}
                                                aria-label={`Toon ${b.olodNaam} in de andere klasgroepen`}
                                                onClick={ev => {
                                                    ev.stopPropagation();
                                                    setDialogOlod(b.olodNaam);
                                                }}
                                            >
                                                <Users size={13} strokeWidth={2.25} />
                                                <ChevronDown
                                                    size={10}
                                                    strokeWidth={2.75}
                                                    className={styles.roosterBlokBtnChevron}
                                                />
                                            </button>
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

            {dialogOlod && klasgroep && (
                <KlasgroepKiezer
                    olodNaam={dialogOlod}
                    huidigeKlasgroep={klasgroep}
                    weekMonday={weekMonday}
                    eigenBlokken={blokken}
                    otherBlokkenPerKlas={otherBlokkenPerKlas}
                    otherLoading={otherLoading}
                    aantalShortlist={mijnOpleidingKlasgroepen.length}
                    colorOf={colorOf}
                    selectieVoor={selectieVoor}
                    onToggleBlok={onToggleBlok}
                    onClose={() => setDialogOlod(null)}
                />
            )}
        </div>
    );
}

interface Kandidaat {
    klasgroep: string;
    huidig: boolean;
    allBlokken: Lesblok[];
    matchBlokken: Lesblok[];
}

interface KiezerProps {
    olodNaam: string;
    huidigeKlasgroep: string;
    weekMonday: Date;
    // Het rooster van de klasgroep die het werkblad toont, deze week.
    eigenBlokken: Lesblok[];
    otherBlokkenPerKlas: Record<string, Lesblok[]>;
    otherLoading: boolean;
    // Aantal klasgroepen in de shortlist (de huidige meegeteld) — enkel voor
    // de toelichting onderaan.
    aantalShortlist: number;
    colorOf: (olodNaam: string) => string;
    selectieVoor: (klasgroep: string, olodNaam: string, datum: Date) => OLODSelectie | null;
    onToggleBlok: (blok: Lesblok) => void;
    onClose: () => void;
}

/**
 * Modale kiezer achter het knopje op een lesblok: toont per klasgroep uit de
 * shortlist het weekrooster met dit vak erin gemarkeerd. Een klik op een kaart
 * zet het vak in het traject bij díe klasgroep (of haalt het er weer uit).
 * De lijst scrollt zelf, zodat ook een lange shortlist bereikbaar blijft.
 */
function KlasgroepKiezer({
    olodNaam,
    huidigeKlasgroep,
    weekMonday,
    eigenBlokken,
    otherBlokkenPerKlas,
    otherLoading,
    aantalShortlist,
    colorOf,
    selectieVoor,
    onToggleBlok,
    onClose,
}: KiezerProps) {
    const closeRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const kandidaten = useMemo<Kandidaat[]>(() => {
        const maak = (kg: string, all: Lesblok[], huidig: boolean): Kandidaat | null => {
            const match = all
                .filter(b => b.olodNaam === olodNaam)
                .sort((a, b) => a.start.getTime() - b.start.getTime());
            return match.length > 0
                ? { klasgroep: kg, huidig, allBlokken: all, matchBlokken: match }
                : null;
        };
        const out: Kandidaat[] = [];
        const eigen = maak(huidigeKlasgroep, eigenBlokken, true);
        if (eigen) out.push(eigen);
        Object.keys(otherBlokkenPerKlas)
            .sort((a, b) => a.localeCompare(b))
            .forEach(k => {
                const kandidaat = maak(k, otherBlokkenPerKlas[k] ?? [], false);
                if (kandidaat) out.push(kandidaat);
            });
        return out;
    }, [olodNaam, huidigeKlasgroep, eigenBlokken, otherBlokkenPerKlas]);

    // Kiezen voegt het vak toe bij deze klasgroep en sluit af; een tweede klik
    // op een al gekozen kaart haalt het weer weg en houdt de kiezer open, zodat
    // je meteen een andere klasgroep kan aanduiden.
    const kies = (kandidaat: Kandidaat, gekozen: boolean) => {
        onToggleBlok(kandidaat.matchBlokken[0]);
        if (!gekozen) onClose();
    };

    return createPortal(
        <div className={styles.zoomBackdrop} onClick={onClose}>
            <div
                className={styles.kiesDialog}
                role="dialog"
                aria-modal="true"
                aria-label={`${olodNaam} — kies een klasgroep`}
                onClick={e => e.stopPropagation()}
            >
                <div className={styles.zoomHeaderBar}>
                    <span
                        className={styles.legendSwatch}
                        style={{ backgroundColor: colorOf(olodNaam) }}
                    />
                    <span className={styles.zoomTitle}>{olodNaam}</span>
                    <span className={styles.zoomSubtitle}>
                        week {formatDateBE(weekMonday)} – {formatDateBE(addDays(weekMonday, 4))}
                    </span>
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

                <div className={styles.kiesHint}>
                    Klik op de klasgroep waarbij je dit vak wil volgen — het vak komt dan bij
                    die klasgroep in je traject.
                </div>

                <div className={styles.kiesBody}>
                    {kandidaten.length === 0 ? (
                        <div className={styles.kiesEmpty}>
                            {otherLoading ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" /> Klasgroepen laden…
                                </>
                            ) : aantalShortlist > 1 ? (
                                'Dit vak komt deze week in geen enkele klasgroep uit je shortlist voor.'
                            ) : (
                                'Je shortlist bevat maar één klasgroep. Voeg er in de instellingen meer toe om te kunnen vergelijken.'
                            )}
                        </div>
                    ) : (
                        <>
                            <div className={styles.kiesGrid}>
                                {kandidaten.map(kandidaat => {
                                    const gekozen =
                                        selectieVoor(
                                            kandidaat.klasgroep,
                                            olodNaam,
                                            kandidaat.matchBlokken[0].start
                                        ) !== null;
                                    return (
                                        <button
                                            key={kandidaat.klasgroep}
                                            type="button"
                                            aria-pressed={gekozen}
                                            className={`${styles.kiesKaart} ${gekozen ? styles.kiesKaartActief : ''}`}
                                            onClick={() => kies(kandidaat, gekozen)}
                                        >
                                            <div className={styles.kiesKaartKop}>
                                                <span className={styles.kiesKaartNaam}>
                                                    {kandidaat.klasgroep}
                                                </span>
                                                {kandidaat.huidig && (
                                                    <span className={styles.kiesKaartBadge}>huidig</span>
                                                )}
                                                {gekozen && (
                                                    <span className={styles.kiesKaartGekozen}>
                                                        <Check size={12} strokeWidth={3} /> in traject
                                                    </span>
                                                )}
                                            </div>
                                            <MiniWeek
                                                weekMonday={weekMonday}
                                                allBlokken={kandidaat.allBlokken}
                                                highlightOlod={olodNaam}
                                                colorOf={colorOf}
                                            />
                                            <div className={styles.kiesMiniDetails}>
                                                {kandidaat.matchBlokken.map((b, i) => {
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
                                            <div className={styles.kiesKaartActie}>
                                                {gekozen
                                                    ? 'Klik om uit je traject te halen'
                                                    : 'Klik om deze klasgroep te kiezen'}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                            {otherLoading ? (
                                <div className={styles.kiesEmpty}>
                                    <Loader2 size={14} className="animate-spin" /> Overige klasgroepen laden…
                                </div>
                            ) : (
                                <div className={styles.kiesVoet}>
                                    {aantalShortlist > 1
                                        ? `${kandidaten.length} van je ${aantalShortlist} klasgroepen geven dit vak in deze week.`
                                        : 'Je shortlist bevat maar één klasgroep. Voeg er in de instellingen meer toe om te kunnen vergelijken.'}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

interface MiniWeekProps {
    weekMonday: Date;
    allBlokken: Lesblok[];
    highlightOlod: string;
    colorOf: (olodNaam: string) => string;
}

function MiniWeek({ weekMonday, allBlokken, highlightOlod, colorOf }: MiniWeekProps) {
    const dagen = useMemo(
        () => Array.from({ length: 5 }, (_, i) => addDays(weekMonday, i)),
        [weekMonday]
    );

    const totalMin = useMemo(
        () => (gridEndHour(allBlokken) - DAY_START_HOUR) * 60,
        [allBlokken]
    );

    return (
        <div className={styles.kiesMiniWeek}>
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
                                        className={`${styles.kiesMiniBlok} ${isMatch ? styles.kiesMiniBlokMatch : styles.kiesMiniBlokDim}`}
                                        style={{
                                            top: `${topPct(b.start, totalMin)}%`,
                                            height: `${heightPct(b.start, b.eind, totalMin)}%`,
                                            left: `calc(${leftPct}% + 1px)`,
                                            width: `calc(${widthPct}% - 2px)`,
                                            backgroundColor: isMatch ? colorOf(b.olodNaam) : undefined,
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
    );
}
