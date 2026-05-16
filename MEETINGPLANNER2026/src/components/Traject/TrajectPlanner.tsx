import { useState } from 'react';
import { Printer, RotateCcw, Settings as SettingsIcon, LayoutGrid, ArrowLeft } from 'lucide-react';
import styles from './Traject.module.css';
import { useKleurMap, useStudentTraject, useTrajectSettings } from './hooks';
import { TrajectSettingsView } from './TrajectSettings';
import { KlasgroepSelector } from './KlasgroepSelector';
import { KlasgroepRooster } from './KlasgroepRooster';
import { StudentOverzicht } from './StudentOverzicht';
import { parseIsoDate } from './dateUtils';

type Tab = 'werkblad' | 'instellingen';

interface Props {
    onBack: () => void;
}

export function TrajectPlanner({ onBack }: Props) {
    const { settings, toggleKlasgroep, setSemesterStart, setSemesterEind } = useTrajectSettings();
    const { traject, toggle, isSelected, reset } = useStudentTraject();
    const { ensureColor, colorOf } = useKleurMap();

    const [tab, setTab] = useState<Tab>(
        settings.mijnOpleidingKlasgroepen.length === 0 ? 'instellingen' : 'werkblad'
    );
    const [actieveKlasgroep, setActieveKlasgroep] = useState<string | null>(
        settings.mijnOpleidingKlasgroepen[0] ?? null
    );

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

    const handlePrint = () => {
        window.print();
    };

    const initialWeek = parseIsoDate(settings.semesterStart);

    return (
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
                <button className={styles.toolbarBtn} onClick={handlePrint}>
                    <Printer size={14} /> Print / PDF
                </button>
            </div>

            {tab === 'instellingen' ? (
                <TrajectSettingsView
                    settings={settings}
                    onToggleKlasgroep={toggleKlasgroep}
                    onSemesterStartChange={setSemesterStart}
                    onSemesterEindChange={setSemesterEind}
                />
            ) : (
                <div className={styles.workbench}>
                    <KlasgroepSelector
                        klasgroepen={settings.mijnOpleidingKlasgroepen}
                        actief={actieveKlasgroep}
                        onSelect={setActieveKlasgroep}
                    />
                    <KlasgroepRooster
                        klasgroep={actieveKlasgroep}
                        initialWeek={initialWeek}
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
    );
}
