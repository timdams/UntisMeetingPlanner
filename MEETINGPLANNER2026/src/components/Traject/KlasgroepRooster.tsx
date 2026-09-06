import { useEffect, useState, useMemo, useRef } from 'react';
import { isActief, Lesblok, OLODSelectie } from './types';
import { trajectUntisService } from './trajectService';
import { actievePeriode, allePeriodes, type PeriodeGrenzen, type PeriodeType } from './academicYear';
import { isSemesterOlod } from './semesterOlods';
import {
    addDays,
    bereikOverlapt,
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
import {
    Loader2,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    CalendarClock,
    Users,
    AlertTriangle,
    MousePointerClick,
    ListPlus,
} from 'lucide-react';
import { LesblokIcon } from './LesblokIcon';
import { layoutDay } from './layout';
import { OlodKlasgroepDialoog, type KiezerKandidaat } from './OlodKlasgroepDialoog';

// Untis geeft 404 op roosterdata van een week buiten het geselecteerde
// academiejaar. We vangen die specifiek op met een begrijpelijke melding.
const OUTSIDE_YEAR_MSG = 'Deze week valt buiten het geselecteerde academiejaar. Ga naar een week van het juiste academiejaar.';

interface Props {
    klasgroep: string | null;
    // De week waarop het rooster opent; verandert mee met de actieve periode.
    initialWeek: Date;
    mijnOpleidingKlasgroepen: string[];
    // De actieve periode: bepaalt aan welke periode een klik het vak toevoegt.
    // Wordt boven het rooster benoemd, want dat gevolg is anders onzichtbaar.
    actiefBereik: { van: string; tot: string };
    // Nodig om die periode een naam te geven (S1, M2, …).
    periodeGrenzen: PeriodeGrenzen;
    // Indeling van de opleiding: enkel in modulemodus bestaat het onderscheid
    // tussen een modulevak en een semestervak, en dus ook de tag-knop.
    periodeType: PeriodeType;
    // OLOD-namen die als semestervak gemarkeerd zijn (zie semesterOlods.ts),
    // en de schakelaar om dat per vak aan of uit te zetten. De knop op een
    // lesblok is meteen de indicator: aan = semestervak, uit = modulevak.
    semesterOlods: string[];
    onToggleSemesterOlod: (olodNaam: string) => void;
    // De selectie die een klik op dit lesblok zou weghalen, of null.
    selectieVoor: (klasgroep: string, olodNaam: string, datum: Date) => OLODSelectie | null;
    colorOf: (olodNaam: string) => string;
    ensureColor: (olodNaam: string) => void;
    onToggleBlok: (blok: Lesblok) => void;
    // Zet alle meegegeven blokken in één keer in het traject (de knop "Alles
    // toevoegen"): één blok per vak dat deze week nog niet gekozen is.
    onAddAlleBlokken: (blokken: Lesblok[]) => void;
}

function vakken(n: number): string {
    return `${n} ${n === 1 ? 'vak' : 'vakken'}`;
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
    actiefBereik,
    periodeGrenzen,
    periodeType,
    semesterOlods,
    onToggleSemesterOlod,
    selectieVoor,
    colorOf,
    ensureColor,
    onToggleBlok,
    onAddAlleBlokken,
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

    // De klasgroepen die dit vak deze week geven — de eigen klasgroep voorop,
    // de rest alfabetisch. Voedt de kiezer achter het knopje op een lesblok.
    const kiezerKandidaten = useMemo<KiezerKandidaat[]>(() => {
        if (!dialogOlod || !klasgroep) return [];
        const maak = (kg: string, all: Lesblok[], huidig: boolean): KiezerKandidaat | null => {
            const match = all
                .filter(b => b.olodNaam === dialogOlod)
                .sort((a, b) => a.start.getTime() - b.start.getTime());
            if (match.length === 0) return null;
            const gekozen = selectieVoor(kg, dialogOlod, match[0].start) !== null;
            return {
                klasgroep: kg,
                huidig,
                allBlokken: all,
                matchBlokken: match,
                gekozen,
                actie: gekozen
                    ? 'Klik om uit je traject te halen'
                    : 'Klik om deze klasgroep te kiezen',
            };
        };
        const out: KiezerKandidaat[] = [];
        const eigen = maak(klasgroep, blokken, true);
        if (eigen) out.push(eigen);
        Object.keys(otherBlokkenPerKlas)
            .sort((a, b) => a.localeCompare(b))
            .forEach(k => {
                const kandidaat = maak(k, otherBlokkenPerKlas[k] ?? [], false);
                if (kandidaat) out.push(kandidaat);
            });
        return out;
    }, [dialogOlod, klasgroep, blokken, otherBlokkenPerKlas, selectieVoor]);

    // Kiezen voegt het vak toe bij deze klasgroep en sluit af; een tweede klik
    // op een al gekozen kaart haalt het weer weg en houdt de kiezer open, zodat
    // je meteen een andere klasgroep kan aanduiden.
    const kiesKlasgroep = (kandidaat: KiezerKandidaat) => {
        onToggleBlok(kandidaat.matchBlokken[0]);
        if (!kandidaat.gekozen) setDialogOlod(null);
    };

    const dagen = useMemo(
        () => Array.from({ length: 5 }, (_, i) => addDays(weekMonday, i)),
        [weekMonday]
    );

    // Wat "Alles toevoegen" zou toevoegen: per vak dat deze week op het rooster
    // staat en nog niet in het traject zit één blok — het vroegste van de week.
    // Eén blok volstaat, want een selectie geldt voor het hele vak in de hele
    // periode; en al gekozen vakken laten we staan, zodat de knop enkel aanvult.
    const nogToeTeVoegen = useMemo(() => {
        const perOlod = new Map<string, Lesblok>();
        for (const b of blokken) {
            if (selectieVoor(b.klasgroep, b.olodNaam, b.start) !== null) continue;
            const eerder = perOlod.get(b.olodNaam);
            if (!eerder || b.start.getTime() < eerder.start.getTime()) perOlod.set(b.olodNaam, b);
        }
        return Array.from(perOlod.values()).sort((a, b) => a.olodNaam.localeCompare(b.olodNaam));
    }, [blokken, selectieVoor]);

    // Alleen nodig om het verschil te benoemen tussen "deze week is leeg" en
    // "alles van deze week staat er al in".
    const aantalOlodsInWeek = useMemo(() => new Set(blokken.map(b => b.olodNaam)).size, [blokken]);

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

    // De week waarop dit rooster opent voor de actieve periode. Staan we daar
    // al, dan zou de knop bij OUTSIDE_YEAR_MSG niets doen; die tonen we dan
    // niet (zie hieronder).
    const openingsWeek = useMemo(() => mondayOf(initialWeek), [initialWeek.getTime()]);
    const kanNaarOpeningsWeek = openingsWeek.getTime() !== weekMonday.getTime();

    // De periode waaraan een klik het vak toevoegt. Een handmatig ingesteld
    // bereik heeft geen naam (S1, M2, …); dan noemen we enkel de datums, in
    // plaats van ze twee keer achter elkaar te zetten.
    const periodeNaam = useMemo(
        () => actievePeriode(allePeriodes(periodeGrenzen), actiefBereik.van, actiefBereik.tot)?.kort ?? null,
        [actiefBereik.van, actiefBereik.tot, periodeGrenzen]
    );
    const periodeDatums = `${formatDateBE(parseIsoDate(actiefBereik.van))} – ${formatDateBE(
        parseIsoDate(actiefBereik.tot)
    )}`;
    // "S1 (21/09 – 31/01)" of, zonder naam, alleen het datumbereik.
    const periodeTekst = periodeNaam ? `${periodeNaam} (${periodeDatums})` : periodeDatums;
    const periodeOmschrijving = periodeNaam ? (
        <>
            <strong>{periodeNaam}</strong> ({periodeDatums})
        </>
    ) : (
        <strong>{periodeDatums}</strong>
    );
    // Buiten de actieve periode blijft een klik toevoegen aan die periode (zie
    // selectieVoorBlok in hooks.ts). Dat is bruikbaar, maar zonder melding een
    // stille verrassing — vandaar de waarschuwende variant van de strip.
    const weekInPeriode = bereikOverlapt(
        toIsoDate(weekMonday),
        toIsoDate(addDays(weekMonday, 4)),
        actiefBereik.van,
        actiefBereik.tot
    );

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader}>
                <span className={styles.panelStap}>2</span>
                Klik vakken aan
                {klasgroep && <span className={styles.panelHeaderSub}>{klasgroep}</span>}
                {busy && <Loader2 size={14} className="animate-spin" />}
            </div>

            {klasgroep && (
                <div
                    className={`${styles.roosterPeriodeStrip} ${
                        weekInPeriode ? '' : styles.roosterPeriodeStripWaarschuwing
                    }`}
                    role="status"
                >
                    {weekInPeriode ? (
                        <>
                            <MousePointerClick size={13} />
                            <span>
                                Een klik voegt het vak toe aan {periodeOmschrijving}.
                                {periodeType === 'module' &&
                                    ' Een vak met een S-knopje is een semestervak en komt altijd in het hele semester.'}
                            </span>
                        </>
                    ) : (
                        <>
                            <AlertTriangle size={13} />
                            <span>
                                Deze week valt buiten de actieve periode — een klik voegt het vak tóch toe
                                aan {periodeOmschrijving}.
                            </span>
                        </>
                    )}
                </div>
            )}

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

            {klasgroep && !error && (
                <div className={styles.roosterActies}>
                    <button
                        type="button"
                        className={styles.roosterAllesBtn}
                        disabled={busy || nogToeTeVoegen.length === 0}
                        title={
                            nogToeTeVoegen.length > 0
                                ? `Zet ${vakken(nogToeTeVoegen.length)} van deze week in één keer in het traject, bij ${klasgroep} en voor ${periodeTekst} — net als een klik op elk blok apart: ${nogToeTeVoegen
                                      .map(b => b.olodNaam)
                                      .join(', ')}`
                                : undefined
                        }
                        onClick={() => onAddAlleBlokken(nogToeTeVoegen)}
                    >
                        <ListPlus size={14} />
                        Alles toevoegen
                        {/* Tijdens het laden staan hier nog de blokken van de vorige
                            week; die teller zou dan liegen. */}
                        {!busy && nogToeTeVoegen.length > 0 && (
                            <span className={styles.roosterAllesTeller}>{nogToeTeVoegen.length}</span>
                        )}
                    </button>
                    {!busy && nogToeTeVoegen.length === 0 && (
                        <span className={styles.roosterActiesHint}>
                            {aantalOlodsInWeek === 0
                                ? 'Geen lessen in deze week.'
                                : 'Alle vakken van deze week staan al in het traject.'}
                        </span>
                    )}
                </div>
            )}

            {!klasgroep ? (
                <div className={styles.emptyState}>
                    Selecteer een klasgroep links om het rooster te bekijken.
                </div>
            ) : error ? (
                <div className={styles.emptyState}>
                    {error}
                    {error === OUTSIDE_YEAR_MSG && kanNaarOpeningsWeek && (
                        <button
                            className={styles.toolbarBtn}
                            style={{ marginTop: '0.75rem' }}
                            onClick={() => setWeekMonday(openingsWeek)}
                        >
                            <CalendarClock size={14} /> Ga naar {formatDateBE(openingsWeek)}
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
                                    const sel = selectieVoor(b.klasgroep, b.olodNaam, b.start);
                                    // Een uitgeschakelde keuze blijft zichtbaar als gekozen,
                                    // maar gestippeld: ze telt niet mee in het totaalrooster.
                                    const selected = sel !== null;
                                    const uit = sel !== null && !isActief(sel);
                                    // In modulemodus draagt elk blok een schakelaar die meteen
                                    // toont wat het vak is: S = semestervak (loopt over beide
                                    // modules), M = modulevak.
                                    const semestervak = isSemesterOlod(b.olodNaam, semesterOlods);
                                    const widthPct = 100 / cols;
                                    const leftPct = col * widthPct;
                                    return (
                                        <div
                                            key={i}
                                            className={`${styles.roosterBlok} ${selected ? styles.roosterBlokSelected : ''} ${
                                                uit ? styles.roosterBlokUit : ''
                                            }`}
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
                                                {/* S/M staat bewust in de uurregel en niet als
                                                    tweede hoekknop: op een gesplitst blok zouden
                                                    twee hoekknoppen samen breder zijn dan het blok
                                                    zelf. Hier schuift het gewoon mee in de tekst. */}
                                                {periodeType === 'module' && (
                                                    <button
                                                        type="button"
                                                        className={`${styles.roosterBlokSemesterBtn} ${
                                                            semestervak ? styles.roosterBlokSemesterBtnAan : ''
                                                        }`}
                                                        title={
                                                            semestervak
                                                                ? `${b.olodNaam} is een semestervak: het loopt over beide modules, bij elke klasgroep. Klik om er weer een modulevak van te maken.`
                                                                : `${b.olodNaam} is een modulevak. Klik om het als semestervak te markeren: het loopt dan over beide modules, bij elke klasgroep.`
                                                        }
                                                        aria-label={
                                                            semestervak
                                                                ? `${b.olodNaam} is een semestervak — klik om er een modulevak van te maken`
                                                                : `${b.olodNaam} is een modulevak — klik om het als semestervak te markeren`
                                                        }
                                                        aria-pressed={semestervak}
                                                        onClick={ev => {
                                                            ev.stopPropagation();
                                                            onToggleSemesterOlod(b.olodNaam);
                                                        }}
                                                    >
                                                        {semestervak ? 'S' : 'M'}
                                                    </button>
                                                )}
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
                <OlodKlasgroepDialoog
                    olodNaam={dialogOlod}
                    weekMonday={weekMonday}
                    kandidaten={kiezerKandidaten}
                    loading={otherLoading}
                    aantalShortlist={mijnOpleidingKlasgroepen.length}
                    hint="Klik op de klasgroep waarbij je dit vak wil volgen — het vak komt dan bij die klasgroep in je traject."
                    colorOf={colorOf}
                    onKies={kiesKlasgroep}
                    onClose={() => setDialogOlod(null)}
                />
            )}
        </div>
    );
}
