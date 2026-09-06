import { ReactNode, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Lesblok } from './types';
import {
    addDays,
    DAG_HEADERS,
    DAY_START_HOUR,
    formatDateBE,
    formatTime,
    gridEndHour,
    sameDay,
} from './dateUtils';
import styles from './Traject.module.css';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { layoutDay } from './layout';

/**
 * Eén klasgroep als kandidaat voor een vak, met haar weekrooster. De panelen
 * bouwen deze lijst zelf: paneel B vanuit de roosters die het al toont,
 * paneel C vanuit de weekroosters die het bij het openen ophaalt.
 */
export interface KiezerKandidaat {
    klasgroep: string;
    // De klasgroep waar de gebruiker vandaan komt: in paneel B de klasgroep van
    // het getoonde rooster, in paneel C die van het aangeklikte blokje.
    huidig: boolean;
    // Het volledige weekrooster van deze klasgroep — de context rond het vak.
    allBlokken: Lesblok[];
    // Enkel de lessen van dit vak, op starttijd gesorteerd. Nooit leeg: een
    // klasgroep zonder les van dit vak hoort niet in de lijst.
    matchBlokken: Lesblok[];
    // Staat dit vak bij deze klasgroep al in het traject?
    gekozen: boolean;
    // Lessen uit `matchBlokken` die in deze week botsen met de rest van het
    // traject. Enkel paneel C vult dit; paneel B laat het weg.
    botsend?: Lesblok[];
    // Wat een klik op deze kaart doet, in woorden.
    actie: string;
}

interface Props {
    olodNaam: string;
    weekMonday: Date;
    // Enkel klasgroepen die dit vak deze week geven; leeg zolang `loading`.
    kandidaten: KiezerKandidaat[];
    loading: boolean;
    // Aantal klasgroepen in de shortlist — enkel voor de toelichting onderaan.
    aantalShortlist: number;
    // De regel onder de kopbalk: zegt wat een klik op een kaart doet. Verschilt
    // per paneel (toevoegen aan het traject vs. de keuze verhuizen).
    hint: ReactNode;
    // Optionele extra in de kopbalk, bv. de periode die mee verhuist.
    kopExtra?: ReactNode;
    colorOf: (olodNaam: string) => string;
    onKies: (kandidaat: KiezerKandidaat) => void;
    onClose: () => void;
}

/**
 * Modale kiezer: toont per klasgroep uit de shortlist het weekrooster met dit
 * vak erin gemarkeerd, zodat de gebruiker ziet waar het vak elders valt vóór
 * hij kiest. Een klik op een kaart geeft de kandidaat door aan het paneel, dat
 * beslist wat ermee gebeurt. De lijst scrollt zelf, zodat ook een lange
 * shortlist bereikbaar blijft.
 */
export function OlodKlasgroepDialoog({
    olodNaam,
    weekMonday,
    kandidaten,
    loading,
    aantalShortlist,
    hint,
    kopExtra,
    colorOf,
    onKies,
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
                    {kopExtra}
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

                <div className={styles.kiesHint}>{hint}</div>

                <div className={styles.kiesBody}>
                    {kandidaten.length === 0 ? (
                        <div className={styles.kiesEmpty}>
                            {loading ? (
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
                                {kandidaten.map(kandidaat => (
                                    <KiezerKaart
                                        key={kandidaat.klasgroep}
                                        kandidaat={kandidaat}
                                        olodNaam={olodNaam}
                                        weekMonday={weekMonday}
                                        colorOf={colorOf}
                                        onKies={onKies}
                                    />
                                ))}
                            </div>
                            {loading ? (
                                <div className={styles.kiesEmpty}>
                                    <Loader2 size={14} className="animate-spin" /> Overige klasgroepen
                                    laden…
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

interface KaartProps {
    kandidaat: KiezerKandidaat;
    olodNaam: string;
    weekMonday: Date;
    colorOf: (olodNaam: string) => string;
    onKies: (kandidaat: KiezerKandidaat) => void;
}

function KiezerKaart({ kandidaat, olodNaam, weekMonday, colorOf, onKies }: KaartProps) {
    const botsend = useMemo(() => new Set(kandidaat.botsend ?? []), [kandidaat.botsend]);

    return (
        <button
            type="button"
            aria-pressed={kandidaat.gekozen}
            className={`${styles.kiesKaart} ${kandidaat.gekozen ? styles.kiesKaartActief : ''}`}
            onClick={() => onKies(kandidaat)}
        >
            <div className={styles.kiesKaartKop}>
                <span className={styles.kiesKaartNaam}>{kandidaat.klasgroep}</span>
                {kandidaat.huidig && <span className={styles.kiesKaartBadge}>huidig</span>}
                {kandidaat.gekozen && (
                    <span className={styles.kiesKaartGekozen}>
                        <Check size={12} strokeWidth={3} /> in traject
                    </span>
                )}
            </div>
            <MiniWeek
                weekMonday={weekMonday}
                allBlokken={kandidaat.allBlokken}
                highlightOlod={olodNaam}
                botsend={botsend}
                colorOf={colorOf}
            />
            <div className={styles.kiesMiniDetails}>
                {kandidaat.matchBlokken.map((b, i) => {
                    const dayIdx = (b.start.getDay() + 6) % 7;
                    return (
                        <div key={i}>
                            <strong>{DAG_HEADERS[dayIdx] ?? ''}</strong> {formatTime(b.start)}–
                            {formatTime(b.eind)}
                            {b.type ? ` · ${b.type}` : ''}
                        </div>
                    );
                })}
            </div>
            {/* Enkel paneel C levert botsingsinfo mee; zonder `botsend` blijft de
                kaart even sober als voorheen. */}
            {kandidaat.botsend !== undefined &&
                (botsend.size > 0 ? (
                    <div className={`${styles.kiesKaartBotsing} ${styles.kiesKaartBotsingRaakt}`}>
                        <AlertTriangle size={12} />
                        Botst deze week met {botsend.size} {botsend.size === 1 ? 'les' : 'lessen'} uit
                        het traject
                    </div>
                ) : (
                    <div className={styles.kiesKaartBotsing}>
                        <Check size={12} strokeWidth={2.5} />
                        Geen botsing in deze week
                    </div>
                ))}
            <div className={styles.kiesKaartActie}>{kandidaat.actie}</div>
        </button>
    );
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

interface MiniWeekProps {
    weekMonday: Date;
    allBlokken: Lesblok[];
    highlightOlod: string;
    // Lessen van het vak die botsen met de rest van het traject.
    botsend: Set<Lesblok>;
    colorOf: (olodNaam: string) => string;
}

function MiniWeek({ weekMonday, allBlokken, highlightOlod, botsend, colorOf }: MiniWeekProps) {
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
                                const botst = isMatch && botsend.has(b);
                                const widthPct = 100 / cols;
                                const leftPct = col * widthPct;
                                return (
                                    <div
                                        key={bi}
                                        className={`${styles.kiesMiniBlok} ${
                                            isMatch ? styles.kiesMiniBlokMatch : styles.kiesMiniBlokDim
                                        } ${botst ? styles.kiesMiniBlokBotst : ''}`}
                                        style={{
                                            top: `${topPct(b.start, totalMin)}%`,
                                            height: `${heightPct(b.start, b.eind, totalMin)}%`,
                                            left: `calc(${leftPct}% + 1px)`,
                                            width: `calc(${widthPct}% - 2px)`,
                                            backgroundColor: isMatch ? colorOf(b.olodNaam) : undefined,
                                        }}
                                        title={`${b.olodNaam}${b.type ? ` (${b.type})` : ''}\n${formatTime(
                                            b.start
                                        )}–${formatTime(b.eind)}${
                                            botst ? '\n⚠ Botst met een les uit het traject' : ''
                                        }`}
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
