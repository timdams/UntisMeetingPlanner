import { useEffect, useRef, useState } from 'react';
import { Printer, RotateCcw, Settings as SettingsIcon, LayoutGrid, ArrowLeft, Palette, Copy, Check } from 'lucide-react';
import styles from './Traject.module.css';
import { useKleurMap, useStudentTraject, useTrajectSettings } from './hooks';
import { TrajectSettingsView } from './TrajectSettings';
import { KlasgroepSelector } from './KlasgroepSelector';
import { KlasgroepRooster } from './KlasgroepRooster';
import { StudentOverzicht } from './StudentOverzicht';
import { TrajectPrintView, buildTrajectClipboardText } from './TrajectPrintView';
import { parseIsoDate } from './dateUtils';
import { backupFilename, buildBackup, downloadBackup, parseBackup } from './trajectBackup';

type Tab = 'werkblad' | 'instellingen';

interface Props {
    onBack: () => void;
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

export function TrajectPlanner({ onBack }: Props) {
    const {
        settings,
        toggleKlasgroep,
        setSemesterStart,
        setSemesterEind,
        replaceSettings,
        clearKlasgroepen,
    } = useTrajectSettings();
    const { traject, toggle, isSelected, reset, replaceTraject } = useStudentTraject();
    const { map: kleurmap, ensureColor, colorOf, replaceMap, resetColors } = useKleurMap();

    const [tab, setTab] = useState<Tab>(
        settings.mijnOpleidingKlasgroepen.length === 0 ? 'instellingen' : 'werkblad'
    );
    const [actieveKlasgroep, setActieveKlasgroep] = useState<string | null>(
        settings.mijnOpleidingKlasgroepen[0] ?? null
    );
    const [copied, setCopied] = useState(false);

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

    const initialWeek = parseIsoDate(settings.semesterStart);

    return (
      <>
        <div className={styles.screenRoot}>
        <div className={styles.page}>
            <div className={styles.topbar}>
                <button className={styles.toolbarBtn} onClick={onBack}>
                    <ArrowLeft size={14} /> Terug
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

            {tab === 'instellingen' ? (
                <TrajectSettingsView
                    settings={settings}
                    onToggleKlasgroep={toggleKlasgroep}
                    onClearKlasgroepen={clearKlasgroepen}
                    onSemesterStartChange={setSemesterStart}
                    onSemesterEindChange={setSemesterEind}
                    onExport={handleExport}
                    onImport={handleImport}
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
                        onRemoveOlod={toggle}
                    />
                    <Splitter orientation="left" onDelta={adjustPanelA} />
                    <KlasgroepRooster
                        klasgroep={actieveKlasgroep}
                        initialWeek={initialWeek}
                        mijnOpleidingKlasgroepen={settings.mijnOpleidingKlasgroepen}
                        isSelected={isSelected}
                        colorOf={colorOf}
                        ensureColor={ensureColor}
                        onToggle={toggle}
                    />
                    <Splitter orientation="right" onDelta={adjustPanelC} />
                    <StudentOverzicht
                        traject={traject}
                        semesterStart={settings.semesterStart}
                        semesterEind={settings.semesterEind}
                        colorOf={colorOf}
                        ensureColor={ensureColor}
                    />
                </div>
            )}
        </div>
        </div>
        <TrajectPrintView traject={traject} settings={settings} />
      </>
    );
}
