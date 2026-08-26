import { useEffect, useMemo, useRef, useState } from 'react';
import { Printer, RotateCcw, Settings as SettingsIcon, LayoutGrid, ArrowLeft, Palette, Copy, Check, Info, X, Save } from 'lucide-react';
import styles from './Traject.module.css';
import {
    useBewaardeTrajecten,
    useKleurMap,
    useLastBackup,
    useStudentTraject,
    useTrajectSettings,
    zelfdeTrajectNaam,
    type BewaardTraject,
} from './hooks';
import { LaadTrajectKnop } from './BewaardeTrajecten';
import { TrajectSettingsView } from './TrajectSettings';
import { KlasgroepSelector } from './KlasgroepSelector';
import { KlasgroepRooster } from './KlasgroepRooster';
import { StudentOverzicht } from './StudentOverzicht';
import { PeriodeSwitcher } from './PeriodeSwitcher';
import { TrajectPrintView, buildTrajectClipboardText } from './TrajectPrintView';
import { defaultRoosterWeek, periodesVoor } from './academicYear';
import { selectieStatussen, useTrajectBlokken, type KlasgroepPreview } from './useTrajectBlokken';
import { backupFilename, buildBackup, downloadBackup, parseBackup } from './trajectBackup';

type Tab = 'werkblad' | 'instellingen';

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
    const { traject, toggleBlok, selectieVoor, remove, setPeriode, setKlasgroep, reset, replaceTraject } = useStudentTraject();
    const { map: kleurmap, ensureColor, colorOf, replaceMap, resetColors } = useKleurMap();
    const { lastBackup, markBackup } = useLastBackup();
    const { bewaard: bewaardeTrajecten, bewaar: bewaarTraject, verwijder: verwijderBewaard } = useBewaardeTrajecten();

    const [tab, setTab] = useState<Tab>(
        settings.mijnOpleidingKlasgroepen.length === 0 ? 'instellingen' : 'werkblad'
    );
    const [actieveKlasgroep, setActieveKlasgroep] = useState<string | null>(
        settings.mijnOpleidingKlasgroepen[0] ?? null
    );
    const [copied, setCopied] = useState(false);
    const [bewaardFeedback, setBewaardFeedback] = useState(false);
    const [bannerDismissed, setBannerDismissed] = useState(false);

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

    const handleReset = () => {
        if (traject.length === 0) return;
        const ok = window.confirm(
            `Weet je zeker dat je het volledige studenttraject wil wissen? (${traject.length} OLODs)`
        );
        if (ok) reset();
    };

    // Bewaart het huidige traject mét zijn instellingen (klasgroepen,
    // periode-indeling, actieve periode) onder een naam in localStorage. Een
    // bestaande naam wordt (na bevestiging) overschreven.
    const handleBewaar = () => {
        if (traject.length === 0) return;
        const voorstel = `Traject ${bewaardeTrajecten.length + 1}`;
        const naam = window.prompt('Geef dit traject een naam:', voorstel)?.trim();
        if (!naam) return;
        const bestaand = bewaardeTrajecten.find(x => zelfdeTrajectNaam(x.naam, naam));
        if (
            bestaand &&
            !window.confirm(
                `Er is al een bewaard traject "${bestaand.naam}" (${bestaand.traject.length} OLODs). Overschrijven met het huidige traject (${traject.length} OLODs) en de huidige instellingen?`
            )
        ) {
            return;
        }
        bewaarTraject(naam, settings, traject, bestaand?.id);
        setBewaardFeedback(true);
        window.setTimeout(() => setBewaardFeedback(false), 1500);
    };

    // Vervangt het huidige traject én de instellingen door die van een
    // bewaard traject (zoals een back-up-import, maar zonder kleurmap).
    const handleLaad = (item: BewaardTraject): boolean => {
        const heeftData = traject.length > 0 || settings.mijnOpleidingKlasgroepen.length > 0;
        if (
            heeftData &&
            !window.confirm(
                `"${item.naam}" laden (${item.traject.length} OLODs)? Dit vervangt je huidige traject (${traject.length} OLODs) en je instellingen (klasgroepen en periode).`
            )
        ) {
            return false;
        }
        if (item.settings) replaceSettings(item.settings);
        replaceTraject(item.traject);
        setTab('werkblad');
        return true;
    };

    const handleVerwijderBewaard = (item: BewaardTraject) => {
        const ok = window.confirm(
            `Bewaard traject "${item.naam}" (${item.traject.length} OLODs) verwijderen? Dit kan niet ongedaan gemaakt worden.`
        );
        if (ok) verwijderBewaard(item.id);
    };

    const handleResetColors = () => {
        const count = Object.keys(kleurmap).length;
        if (count === 0) return;
        const ok = window.confirm(
            `Kleurmap wissen en opnieuw genereren? (${count} kleuren worden opnieuw toegewezen zodra de OLODs in beeld komen)`
        );
        if (ok) resetColors();
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

    const handleImport = async (file: File): Promise<boolean> => {
        const text = await file.text();
        const backup = parseBackup(text);
        const confirmMsg =
            traject.length > 0 || settings.mijnOpleidingKlasgroepen.length > 0
                ? 'Importeren overschrijft je huidige instellingen, traject en kleurmap. Doorgaan?'
                : 'Back-up importeren?';
        if (!window.confirm(confirmMsg)) {
            return false;
        }
        replaceSettings(backup.settings);
        replaceTraject(backup.traject);
        replaceMap(backup.kleurmap);
        return true;
    };

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
                    className={`${styles.toolbarBtn} ${styles.toolbarBtnDanger}`}
                    onClick={handleReset}
                    disabled={traject.length === 0}
                >
                    <RotateCcw size={14} /> Reset traject
                </button>
                <button
                    className={styles.toolbarBtn}
                    onClick={handleBewaar}
                    disabled={traject.length === 0}
                    title="Bewaar het huidige traject onder een naam in deze browser, om het later opnieuw te laden"
                >
                    {bewaardFeedback ? <Check size={14} /> : <Save size={14} />}
                    {bewaardFeedback ? 'Bewaard!' : 'Bewaar traject'}
                </button>
                <LaadTrajectKnop
                    items={bewaardeTrajecten}
                    onLaad={handleLaad}
                    onVerwijder={handleVerwijderBewaard}
                />
                <button
                    className={styles.toolbarBtn}
                    onClick={handleResetColors}
                    disabled={Object.keys(kleurmap).length === 0}
                    title="Wis de opgeslagen kleurmap en wijs nieuwe unieke kleuren toe"
                    style={{ display: 'none' }}
                >
                    <Palette size={14} /> Reset kleuren
                </button>
                <button
                    className={styles.toolbarBtn}
                    onClick={handleCopy}
                    disabled={traject.length === 0}
                    title="Kopieer het studenttraject (zoals het wordt afgedrukt) naar het klembord"
                >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Gekopieerd!' : 'Kopieer naar klembord'}
                </button>
                <button className={styles.toolbarBtn} onClick={handlePrint}>
                    <Printer size={14} /> Print / PDF
                </button>
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
                        colorOf={colorOf}
                        onRemoveOlod={remove}
                        onSetPeriode={setPeriode}
                        onSetKlasgroep={setKlasgroep}
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
        <TrajectPrintView traject={traject} settings={settings} />
      </>
    );
}
