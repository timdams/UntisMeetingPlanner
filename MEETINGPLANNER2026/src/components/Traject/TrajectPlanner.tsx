import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Printer,
    RotateCcw,
    Settings as SettingsIcon,
    LayoutGrid,
    ArrowLeft,
    Copy,
    Check,
    Info,
    X,
    Save,
    Share2,
    MoreHorizontal,
} from 'lucide-react';
import styles from './Traject.module.css';
import {
    selectieKey,
    trajectVingerafdruk,
    useActiefTraject,
    useBewaardeTrajecten,
    useKleurMap,
    useLastBackup,
    useStudentTraject,
    useTrajectSettings,
    type BewaardTraject,
} from './hooks';
import { isActief, type OLODSelectie } from './types';
import { LaadTrajectKnop } from './BewaardeTrajecten';
import { TopbarMenu, TopbarMenuItem } from './TopbarMenu';
import { BevestigDialog, BewaarDialog, type DialogItem } from './TrajectDialogs';
import { UndoToast, useUndo } from './Toast';
import { TrajectSettingsView } from './TrajectSettings';
import { KlasgroepSelector } from './KlasgroepSelector';
import { KlasgroepRooster } from './KlasgroepRooster';
import { StudentOverzicht } from './StudentOverzicht';
import { PeriodeSwitcher } from './PeriodeSwitcher';
import { TrajectPrintView, buildTrajectClipboardText } from './TrajectPrintView';
import { defaultRoosterWeek, periodesVoor } from './academicYear';
import { selectieStatussen, useTrajectBlokken, type KlasgroepPreview } from './useTrajectBlokken';
import { backupFilename, buildBackup, downloadBackup, parseBackup, type TrajectBackup } from './trajectBackup';

type Tab = 'werkblad' | 'instellingen';

// De dialoog die momenteel openstaat. Alle bevestigingen en het benoemen van
// een traject lopen hierlangs, in plaats van via window.confirm/prompt.
type Dialoog =
    | { soort: 'bewaar' }
    | { soort: 'reset' }
    | { soort: 'laad'; item: BewaardTraject }
    | { soort: 'verwijderBewaard'; item: BewaardTraject }
    // De import wacht op het antwoord van de gebruiker: `resolve` sluit de
    // Promise die TrajectSettingsView aan de bestandskiezer hangt.
    | { soort: 'import'; backup: TrajectBackup; resolve: (ok: boolean) => void };

interface Props {
    onBack: () => void;
    // True wanneer de student via een trajectbegeleider-link binnenkwam en de
    // klasgroepen + semesterperiode dus al voor hem zijn klaargezet.
    presetApplied?: boolean;
}

const PANEL_A_MIN = 140;
const PANEL_A_MAX = 420;
const PANEL_C_MIN = 280;
const PANEL_C_MAX = 900;
const PANEL_B_MIN = 320;
const KEY_PANEL_A = 'traject_panelA_width';
const KEY_PANEL_C = 'traject_panelC_width';

function clamp(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, v));
}

interface SplitterProps {
    orientation: 'left' | 'right'; // which side this splitter resizes (left=A, right=C)
    onDelta: (dx: number) => void;
}

function Splitter({ orientation, onDelta }: SplitterProps) {
    const [active, setActive] = useState(false);
    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        setActive(true);
        let lastX = e.clientX;
        const move = (ev: PointerEvent) => {
            const dx = ev.clientX - lastX;
            lastX = ev.clientX;
            // For the right splitter, dragging right shrinks panel C → invert.
            onDelta(orientation === 'left' ? dx : -dx);
        };
        const up = (ev: PointerEvent) => {
            try { target.releasePointerCapture(ev.pointerId); } catch { /* ignored */ }
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', up);
            target.removeEventListener('pointercancel', up);
            setActive(false);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
    };
    return (
        <div
            className={`${styles.splitter} ${active ? styles.splitterActive : ''}`}
            onPointerDown={onPointerDown}
            role="separator"
            aria-orientation="vertical"
        />
    );
}

export function TrajectPlanner({ onBack, presetApplied = false }: Props) {
    const {
        settings,
        toggleKlasgroep,
        setSemesterStart,
        setSemesterEind,
        setSemesterPeriode,
        setPeriodeType,
        setPeriodeGrenzen,
        replaceSettings,
        setKlasgroepen,
    } = useTrajectSettings();
    const {
        traject,
        toggleBlok,
        selectieVoor,
        remove,
        removeMany,
        toggleActief,
        setActiefBulk,
        setPeriode,
        setKlasgroep,
        setKlasgroepBulk,
        reset,
        replaceTraject,
    } = useStudentTraject();
    const { map: kleurmap, ensureColor, colorOf, replaceMap, resetColors } = useKleurMap();
    const { lastBackup, markBackup } = useLastBackup();
    const { bewaard: bewaardeTrajecten, bewaar: bewaarTraject, verwijder: verwijderBewaard } = useBewaardeTrajecten();
    const { actief: actiefTraject, markeer: markeerActief, wis: wisActief } = useActiefTraject();
    const { melding: undoMelding, meld: meldUndo, sluit: sluitUndo, herstel: herstelUndo } = useUndo();

    const [tab, setTab] = useState<Tab>(
        settings.mijnOpleidingKlasgroepen.length === 0 ? 'instellingen' : 'werkblad'
    );
    const [actieveKlasgroep, setActieveKlasgroep] = useState<string | null>(
        settings.mijnOpleidingKlasgroepen[0] ?? null
    );
    const [copied, setCopied] = useState(false);
    const [bewaardFeedback, setBewaardFeedback] = useState(false);
    const [bannerDismissed, setBannerDismissed] = useState(false);
    const [dialoog, setDialoog] = useState<Dialoog | null>(null);

    const [panelAWidth, setPanelAWidth] = useState<number>(() => {
        const raw = localStorage.getItem(KEY_PANEL_A);
        const n = raw ? Number(raw) : NaN;
        return Number.isFinite(n) ? clamp(n, PANEL_A_MIN, PANEL_A_MAX) : 200;
    });
    const [panelCWidth, setPanelCWidth] = useState<number>(() => {
        const raw = localStorage.getItem(KEY_PANEL_C);
        const n = raw ? Number(raw) : NaN;
        return Number.isFinite(n) ? clamp(n, PANEL_C_MIN, PANEL_C_MAX) : 460;
    });
    useEffect(() => { localStorage.setItem(KEY_PANEL_A, String(panelAWidth)); }, [panelAWidth]);
    useEffect(() => { localStorage.setItem(KEY_PANEL_C, String(panelCWidth)); }, [panelCWidth]);

    const workbenchRef = useRef<HTMLDivElement | null>(null);
    const adjustPanelA = (dx: number) => {
        setPanelAWidth(prev => {
            const next = clamp(prev + dx, PANEL_A_MIN, PANEL_A_MAX);
            const total = workbenchRef.current?.clientWidth ?? 0;
            const remaining = total - next - panelCWidth - 12; // 12 = two 6px splitters
            return remaining < PANEL_B_MIN ? prev : next;
        });
    };
    const adjustPanelC = (dx: number) => {
        setPanelCWidth(prev => {
            const next = clamp(prev + dx, PANEL_C_MIN, PANEL_C_MAX);
            const total = workbenchRef.current?.clientWidth ?? 0;
            const remaining = total - panelAWidth - next - 12;
            return remaining < PANEL_B_MIN ? prev : next;
        });
    };

    // Keep active klasgroep valid when the shortlist changes
    if (
        actieveKlasgroep &&
        !settings.mijnOpleidingKlasgroepen.includes(actieveKlasgroep)
    ) {
        setActieveKlasgroep(settings.mijnOpleidingKlasgroepen[0] ?? null);
    }
    if (!actieveKlasgroep && settings.mijnOpleidingKlasgroepen[0]) {
        setActieveKlasgroep(settings.mijnOpleidingKlasgroepen[0]);
    }

    // ===== Wijzigingen aan het traject, met undo =====

    // Elke ingrijpende mutatie bewaart eerst het volledige traject en biedt dat
    // als herstelpunt aan. Bewust géén inverse per actie: een bulkwissel kan
    // selecties laten samensmelten (setKlasgroepBulk), en dat is niet ongedaan
    // te maken door nog eens te verzetten.
    const metUndo = (tekst: string, actie: () => void) => {
        const snapshot = traject;
        actie();
        meldUndo(tekst, () => replaceTraject(snapshot));
    };

    const vakken = (n: number) => `${n} ${n === 1 ? 'vak' : 'vakken'}`;

    const handleRemoveOlod = (sel: OLODSelectie) => {
        metUndo(`${sel.olodNaam} verwijderd uit het traject`, () => remove(sel));
    };

    const handleBulkRemove = (sels: OLODSelectie[]) => {
        if (sels.length === 0) return;
        metUndo(`${vakken(sels.length)} verwijderd uit het traject`, () => removeMany(sels));
    };

    // Eén vak (de)activeren is met dezelfde knop meteen terug te draaien;
    // enkel de bulkactie krijgt daarom een undo-melding.
    const handleBulkSetActief = (sels: OLODSelectie[], actief: boolean) => {
        if (sels.length === 0) return;
        metUndo(`${vakken(sels.length)} ${actief ? 'geactiveerd' : 'gedeactiveerd'}`, () =>
            setActiefBulk(sels, actief)
        );
    };

    const handleBulkSetKlasgroep = (sels: OLODSelectie[], klasgroep: string) => {
        if (sels.length === 0) return;
        metUndo(`${vakken(sels.length)} verzet naar ${klasgroep}`, () => setKlasgroepBulk(sels, klasgroep));
    };

    // ===== Globale acties (elk via een dialoog) =====

    const doeReset = () => {
        const aantal = traject.length;
        setDialoog(null);
        metUndo(`Traject gewist (${aantal} ${aantal === 1 ? 'OLOD' : 'OLODs'})`, reset);
    };

    // Bewaart het huidige traject mét zijn instellingen (klasgroepen,
    // periode-indeling, actieve periode) onder een naam in localStorage, en
    // markeert dat item als het geopende dossier.
    const doeBewaar = (naam: string, overschrijfId?: string) => {
        const id = bewaarTraject(naam, settings, traject, overschrijfId);
        markeerActief(id, naam, traject, settings);
        setDialoog(null);
        setBewaardFeedback(true);
        window.setTimeout(() => setBewaardFeedback(false), 1500);
    };

    // Vervangt het huidige traject én de instellingen door die van een
    // bewaard traject (zoals een back-up-import, maar zonder kleurmap).
    const doeLaad = (item: BewaardTraject) => {
        if (item.settings) replaceSettings(item.settings);
        replaceTraject(item.traject);
        markeerActief(item.id, item.naam, item.traject, item.settings ?? settings);
        setDialoog(null);
        setTab('werkblad');
    };

    // Een klik op een bewaard traject vraagt eerst om bevestiging zodra er iets
    // te overschrijven valt; staat het werkblad leeg, dan laadt het meteen.
    const handleLaad = (item: BewaardTraject) => {
        const heeftData = traject.length > 0 || settings.mijnOpleidingKlasgroepen.length > 0;
        if (heeftData) setDialoog({ soort: 'laad', item });
        else doeLaad(item);
    };

    const doeVerwijderBewaard = (item: BewaardTraject) => {
        verwijderBewaard(item.id);
        // Het geopende dossier bestaat niet meer; het werk blijft staan, maar
        // hoort nu bij geen enkel bewaard traject.
        if (actiefTraject?.id === item.id) wisActief();
        setDialoog(null);
    };

    const handlePrint = () => {
        window.print();
    };

    const handleCopy = async () => {
        const text = buildTrajectClipboardText(traject, settings);
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
            } finally {
                document.body.removeChild(ta);
            }
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    const handleExport = () => {
        const backup = buildBackup(settings, traject, kleurmap);
        downloadBackup(backupFilename(), backup);
        markBackup(backup.exportedAt);
    };

    // Leest en valideert het bestand (fouten belanden bij de bestandskiezer in
    // de instellingen) en laat de dialoog het antwoord invullen: de Promise
    // lost pas op wanneer de gebruiker bevestigt of annuleert.
    const handleImport = async (file: File): Promise<boolean> => {
        const text = await file.text();
        const backup = parseBackup(text);
        return new Promise<boolean>(resolve => setDialoog({ soort: 'import', backup, resolve }));
    };

    const doeImport = (backup: TrajectBackup, resolve: (ok: boolean) => void) => {
        replaceSettings(backup.settings);
        replaceTraject(backup.traject);
        replaceMap(backup.kleurmap);
        // Een geïmporteerde back-up is een ander dossier dan het bewaarde
        // traject waar we aan werkten.
        wisActief();
        setDialoog(null);
        resolve(true);
    };

    const annuleerDialoog = () => {
        if (dialoog?.soort === 'import') dialoog.resolve(false);
        setDialoog(null);
    };

    // Bewaarstatus: wijkt het werkblad af van het bewaarde dossier, dan staat
    // er werk open. Zonder geopend dossier is alles wat er staat "niet bewaard".
    const vingerafdruk = useMemo(() => trajectVingerafdruk(traject, settings), [traject, settings]);
    const nietBewaard = actiefTraject ? actiefTraject.baseline !== vingerafdruk : traject.length > 0;

    // De vakken die een reset zou wissen, met hun kleur — zo ziet de gebruiker
    // in de dialoog waar het precies over gaat.
    const resetItems = useMemo<DialogItem[]>(
        () =>
            traject
                .slice()
                .sort(
                    (a, b) =>
                        a.olodNaam.localeCompare(b.olodNaam) || a.klasgroep.localeCompare(b.klasgroep)
                )
                .map(s => ({
                    key: selectieKey(s),
                    naam: s.olodNaam,
                    kleur: colorOf(s.olodNaam),
                    meta: isActief(s) ? s.klasgroep : `${s.klasgroep} · uit`,
                })),
        [traject, colorOf]
    );

    // De periodes waar de topbar-snelkeuze tussen wisselt (semesters of modules).
    const periodes = useMemo(
        () => periodesVoor(settings.periodeType, settings.periodeGrenzen),
        [settings.periodeType, settings.periodeGrenzen]
    );
    const actiefBereik = useMemo(
        () => ({ van: settings.semesterStart, tot: settings.semesterEind }),
        [settings.semesterStart, settings.semesterEind]
    );

    // Open het rooster op de huidige week als die binnen de actieve periode
    // valt, anders op de eerste lesweek van die periode (niet op een week uit
    // het vorige jaar, wat 404's op de roosterdata gaf). Verandert mee wanneer
    // de gebruiker van periode wisselt.
    const initialWeek = useMemo(
        () => defaultRoosterWeek(new Date(), settings.semesterStart, settings.semesterEind),
        [settings.semesterStart, settings.semesterEind]
    );

    // Jaarrooster per klasgroep in het traject: voedt het overzicht (paneel C)
    // en de controle of elke selectie wel lessen oplevert (paneel A).
    const { blokkenPerKlas, busy: blokkenBusy, error: blokkenError } = useTrajectBlokken(
        traject,
        ensureColor,
        settings.periodeGrenzen
    );
    const statussen = useMemo(() => selectieStatussen(traject, blokkenPerKlas), [traject, blokkenPerKlas]);

    // Wat-als-preview vanuit de klasgroep-kiezer (paneel A): zolang de
    // gebruiker over een andere klasgroep beweegt, toont paneel C waar het vak
    // dan zou vallen.
    const [klasgroepPreview, setKlasgroepPreview] = useState<KlasgroepPreview | null>(null);

    return (
      <>
        <div className={styles.screenRoot}>
        <div className={styles.page}>
            <div className={styles.topbar}>
                <button
                    className={styles.toolbarBtn}
                    onClick={onBack}
                    title="Terug naar het hoofdmenu — kies een andere tool"
                >
                    <ArrowLeft size={14} /> Menu
                </button>
                <div className={styles.topbarTitle}>Trajectplanner</div>
                {(actiefTraject || traject.length > 0) && (
                    <span
                        className={`${styles.trajectNaamChip} ${
                            actiefTraject ? '' : styles.trajectNaamChipLeeg
                        }`}
                        title={
                            actiefTraject
                                ? nietBewaard
                                    ? `Je werkt aan "${actiefTraject.naam}" — er zijn wijzigingen die nog niet bewaard zijn.`
                                    : `Je werkt aan "${actiefTraject.naam}" — alles is bewaard.`
                                : 'Dit traject hoort nog bij geen enkel bewaard traject. Gebruik "Bewaar traject" om het een naam te geven.'
                        }
                    >
                        {actiefTraject ? actiefTraject.naam : 'niet bewaard'}
                        {actiefTraject && nietBewaard && <span className={styles.trajectNaamStip} />}
                    </span>
                )}

                <div className={styles.tabs}>
                    <button
                        className={`${styles.tab} ${tab === 'werkblad' ? styles.tabActive : ''}`}
                        onClick={() => setTab('werkblad')}
                    >
                        <LayoutGrid size={14} /> Werkblad
                    </button>
                    <button
                        className={`${styles.tab} ${tab === 'instellingen' ? styles.tabActive : ''}`}
                        onClick={() => setTab('instellingen')}
                    >
                        <SettingsIcon size={14} /> Instellingen
                    </button>
                </div>

                <PeriodeSwitcher
                    compact
                    periodes={periodes}
                    actieveStart={settings.semesterStart}
                    actieveEind={settings.semesterEind}
                    onKies={p => setSemesterPeriode(p.start, p.eind)}
                />

                <div className={styles.topbarSpacer} />

                <button
                    className={styles.toolbarBtn}
                    onClick={() => setDialoog({ soort: 'bewaar' })}
                    disabled={traject.length === 0}
                    title="Bewaar het huidige traject onder een naam in deze browser, om het later opnieuw te laden"
                >
                    {bewaardFeedback ? <Check size={14} /> : <Save size={14} />}
                    {bewaardFeedback ? 'Bewaard!' : 'Bewaar traject'}
                </button>
                <LaadTrajectKnop
                    items={bewaardeTrajecten}
                    onLaad={handleLaad}
                    onVerwijder={item => setDialoog({ soort: 'verwijderBewaard', item })}
                />
                <TopbarMenu
                    label={
                        <>
                            {copied ? <Check size={14} /> : <Share2 size={14} />}
                            {copied ? 'Gekopieerd!' : 'Exporteren'}
                        </>
                    }
                    title="Het studenttraject afdrukken of naar het klembord kopiëren"
                >
                    {close => (
                        <>
                            <TopbarMenuItem
                                icon={<Printer size={14} />}
                                onClick={() => {
                                    close();
                                    handlePrint();
                                }}
                            >
                                Print / PDF
                            </TopbarMenuItem>
                            <TopbarMenuItem
                                icon={<Copy size={14} />}
                                disabled={traject.length === 0}
                                title="Kopieer het studenttraject (zoals het wordt afgedrukt) naar het klembord"
                                onClick={() => {
                                    close();
                                    handleCopy();
                                }}
                            >
                                Kopieer naar klembord
                            </TopbarMenuItem>
                        </>
                    )}
                </TopbarMenu>
                <TopbarMenu
                    label={<MoreHorizontal size={14} />}
                    chevron={false}
                    title="Meer acties"
                    ariaLabel="Meer acties"
                >
                    {close => (
                        <TopbarMenuItem
                            icon={<RotateCcw size={14} />}
                            danger
                            disabled={traject.length === 0}
                            title="Wist alle gekozen OLODs; je instellingen en bewaarde trajecten blijven staan"
                            onClick={() => {
                                close();
                                setDialoog({ soort: 'reset' });
                            }}
                        >
                            Reset traject
                        </TopbarMenuItem>
                    )}
                </TopbarMenu>
            </div>

            {presetApplied && !bannerDismissed && (
                <div className={styles.presetBanner}>
                    <Info size={18} />
                    <div className={styles.presetBannerText}>
                        <strong>Klaargezet door je trajectbegeleider.</strong> De klasgroepen
                        en periode zijn al ingesteld — kies meteen je vakken in het
                        werkblad. Je hoeft niets in de instellingen aan te passen.
                    </div>
                    <button
                        className={styles.presetBannerClose}
                        onClick={() => setBannerDismissed(true)}
                        aria-label="Melding sluiten"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {tab === 'instellingen' ? (
                <TrajectSettingsView
                    settings={settings}
                    onToggleKlasgroep={toggleKlasgroep}
                    onSetKlasgroepen={setKlasgroepen}
                    onSemesterStartChange={setSemesterStart}
                    onSemesterEindChange={setSemesterEind}
                    onSemesterPeriodeChange={setSemesterPeriode}
                    onPeriodeTypeChange={setPeriodeType}
                    onPeriodeGrenzenChange={setPeriodeGrenzen}
                    onExport={handleExport}
                    onImport={handleImport}
                    onResetColors={resetColors}
                    aantalKleuren={Object.keys(kleurmap).length}
                    lastBackup={lastBackup}
                    heeftTraject={traject.length > 0}
                    onDone={() => setTab('werkblad')}
                />
            ) : (
                <div
                    ref={workbenchRef}
                    className={styles.workbench}
                    style={{
                        gridTemplateColumns: `${panelAWidth}px 6px minmax(${PANEL_B_MIN}px, 1fr) 6px ${panelCWidth}px`,
                    }}
                >
                    <KlasgroepSelector
                        klasgroepen={settings.mijnOpleidingKlasgroepen}
                        actief={actieveKlasgroep}
                        onSelect={setActieveKlasgroep}
                        traject={traject}
                        blokkenPerKlas={blokkenPerKlas}
                        colorOf={colorOf}
                        onRemoveOlod={handleRemoveOlod}
                        onSetPeriode={setPeriode}
                        onSetKlasgroep={setKlasgroep}
                        onBulkSetKlasgroep={handleBulkSetKlasgroep}
                        onBulkRemove={handleBulkRemove}
                        onToggleActief={toggleActief}
                        onBulkSetActief={handleBulkSetActief}
                        onPreview={setKlasgroepPreview}
                        statussen={statussen}
                        actiefBereik={actiefBereik}
                        periodeType={settings.periodeType}
                        periodeGrenzen={settings.periodeGrenzen}
                    />
                    <Splitter orientation="left" onDelta={adjustPanelA} />
                    <KlasgroepRooster
                        klasgroep={actieveKlasgroep}
                        initialWeek={initialWeek}
                        mijnOpleidingKlasgroepen={settings.mijnOpleidingKlasgroepen}
                        actiefBereik={actiefBereik}
                        periodeGrenzen={settings.periodeGrenzen}
                        selectieVoor={(k, o, d) => selectieVoor(k, o, d, actiefBereik)}
                        colorOf={colorOf}
                        ensureColor={ensureColor}
                        onToggleBlok={b => toggleBlok(b, actiefBereik)}
                    />
                    <Splitter orientation="right" onDelta={adjustPanelC} />
                    <StudentOverzicht
                        traject={traject}
                        blokkenPerKlas={blokkenPerKlas}
                        busy={blokkenBusy}
                        error={blokkenError}
                        actiefBereik={actiefBereik}
                        periodeType={settings.periodeType}
                        periodeGrenzen={settings.periodeGrenzen}
                        colorOf={colorOf}
                        preview={klasgroepPreview}
                    />
                </div>
            )}
        </div>
        </div>

        {dialoog?.soort === 'bewaar' && (
            <BewaarDialog
                voorstel={actiefTraject?.naam ?? `Traject ${bewaardeTrajecten.length + 1}`}
                bewaarde={bewaardeTrajecten}
                aantalOlods={traject.length}
                onBewaar={doeBewaar}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {dialoog?.soort === 'reset' && (
            <BevestigDialog
                titel="Traject wissen?"
                bericht={
                    <>
                        Alle {traject.length} gekozen {traject.length === 1 ? 'OLOD' : 'OLODs'} verdwijnen
                        uit het studenttraject. Je klasgroepen, periode-instellingen en bewaarde
                        trajecten blijven staan.
                    </>
                }
                itemsKop="Verdwijnt uit het traject"
                items={resetItems}
                bevestigLabel="Traject wissen"
                danger
                onBevestig={doeReset}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {dialoog?.soort === 'laad' && (
            <BevestigDialog
                titel={`"${dialoog.item.naam}" laden?`}
                bericht={
                    <>
                        Dit vervangt je huidige traject ({traject.length}{' '}
                        {traject.length === 1 ? 'OLOD' : 'OLODs'}) en je instellingen (klasgroepen en
                        periode) door die van <strong>{dialoog.item.naam}</strong> (
                        {dialoog.item.traject.length}{' '}
                        {dialoog.item.traject.length === 1 ? 'OLOD' : 'OLODs'}).
                        {nietBewaard && ' Je huidige werk is niet bewaard.'}
                    </>
                }
                bevestigLabel="Laden"
                danger={nietBewaard}
                onBevestig={() => doeLaad(dialoog.item)}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {dialoog?.soort === 'verwijderBewaard' && (
            <BevestigDialog
                titel="Bewaard traject verwijderen?"
                bericht={
                    <>
                        <strong>{dialoog.item.naam}</strong> ({dialoog.item.traject.length}{' '}
                        {dialoog.item.traject.length === 1 ? 'OLOD' : 'OLODs'}) wordt uit deze browser
                        verwijderd. Dit kan niet ongedaan gemaakt worden. Je huidige werkblad verandert
                        niet.
                    </>
                }
                bevestigLabel="Verwijderen"
                danger
                onBevestig={() => doeVerwijderBewaard(dialoog.item)}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {dialoog?.soort === 'import' && (
            <BevestigDialog
                titel="Back-up importeren?"
                bericht={
                    traject.length > 0 || settings.mijnOpleidingKlasgroepen.length > 0 ? (
                        <>
                            De back-up bevat {dialoog.backup.traject.length}{' '}
                            {dialoog.backup.traject.length === 1 ? 'OLOD' : 'OLODs'} en overschrijft je
                            huidige instellingen, traject ({traject.length}{' '}
                            {traject.length === 1 ? 'OLOD' : 'OLODs'}) en kleuren.
                        </>
                    ) : (
                        <>
                            De back-up bevat {dialoog.backup.traject.length}{' '}
                            {dialoog.backup.traject.length === 1 ? 'OLOD' : 'OLODs'} en wordt in dit
                            werkblad geladen.
                        </>
                    )
                }
                bevestigLabel="Importeren"
                danger={traject.length > 0}
                onBevestig={() => doeImport(dialoog.backup, dialoog.resolve)}
                onAnnuleer={annuleerDialoog}
            />
        )}

        <UndoToast melding={undoMelding} onHerstel={herstelUndo} onSluit={sluitUndo} />
        <TrajectPrintView traject={traject} settings={settings} />
      </>
    );
}
