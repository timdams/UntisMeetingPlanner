import { useState } from 'react';
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
                <div className={styles.workbench}>
                    <KlasgroepSelector
                        klasgroepen={settings.mijnOpleidingKlasgroepen}
                        actief={actieveKlasgroep}
                        onSelect={setActieveKlasgroep}
                        traject={traject}
                        colorOf={colorOf}
                        onRemoveOlod={toggle}
                    />
                    <KlasgroepRooster
                        klasgroep={actieveKlasgroep}
                        initialWeek={initialWeek}
                        mijnOpleidingKlasgroepen={settings.mijnOpleidingKlasgroepen}
                        isSelected={isSelected}
                        colorOf={colorOf}
                        ensureColor={ensureColor}
                        onToggle={toggle}
                    />
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
