import { useEffect, useState } from 'react';
import { TrajectSettings } from './types';
import { trajectUntisService } from './trajectService';
import styles from './Traject.module.css';
import { Loader2 } from 'lucide-react';

interface Props {
    settings: TrajectSettings;
    onToggleKlasgroep: (k: string) => void;
    onSemesterStartChange: (iso: string) => void;
    onSemesterEindChange: (iso: string) => void;
}

export function TrajectSettingsView({
    settings,
    onToggleKlasgroep,
    onSemesterStartChange,
    onSemesterEindChange,
}: Props) {
    const [allKlasgroepen, setAllKlasgroepen] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');

    useEffect(() => {
        setBusy(true);
        trajectUntisService
            .getKlasgroepen()
            .then(setAllKlasgroepen)
            .catch(e => setError(e.message ?? 'Klasgroepen ophalen mislukt'))
            .finally(() => setBusy(false));
    }, []);

    const selected = new Set(settings.mijnOpleidingKlasgroepen);
    const f = filter.trim().toLowerCase();
    const visible = f ? allKlasgroepen.filter(k => k.toLowerCase().includes(f)) : allKlasgroepen;

    return (
        <div className={styles.settings}>
            <div className={styles.settingsSection}>
                <div className={styles.settingsTitle}>Semesterperiode</div>
                <div className={styles.settingsHint}>
                    Het studenttraject wordt opgebouwd binnen deze periode.
                </div>
                <div className={styles.dateRow}>
                    <div className={styles.dateField}>
                        <label>Start</label>
                        <input
                            type="date"
                            value={settings.semesterStart}
                            onChange={e => onSemesterStartChange(e.target.value)}
                        />
                    </div>
                    <div className={styles.dateField}>
                        <label>Einde</label>
                        <input
                            type="date"
                            value={settings.semesterEind}
                            onChange={e => onSemesterEindChange(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className={styles.settingsSection}>
                <div className={styles.settingsTitle}>
                    Mijn opleiding — klasgroepen ({settings.mijnOpleidingKlasgroepen.length} geselecteerd)
                </div>
                <div className={styles.settingsHint}>
                    Vink de klasgroepen aan die tot jouw opleiding behoren. Enkel deze
                    verschijnen in het selectiewerkblad.
                </div>

                <input
                    className={styles.searchInput}
                    type="text"
                    placeholder="Zoek klasgroep..."
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                />

                {busy && (
                    <div className={styles.emptyState}>
                        <Loader2 className="animate-spin" size={20} /> Laden...
                    </div>
                )}
                {error && <div className={styles.emptyState}>{error}</div>}
                {!busy && !error && (
                    <div className={styles.klasList}>
                        {visible.map(k => {
                            const checked = selected.has(k);
                            return (
                                <label
                                    key={k}
                                    className={`${styles.klasRow} ${checked ? styles.klasRowChecked : ''}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => onToggleKlasgroep(k)}
                                    />
                                    <span>{k}</span>
                                </label>
                            );
                        })}
                        {visible.length === 0 && (
                            <div className={styles.emptyState}>Geen klasgroepen gevonden.</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
