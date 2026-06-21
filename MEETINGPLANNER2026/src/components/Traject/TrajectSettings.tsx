import { useEffect, useRef, useState } from 'react';
import { TrajectSettings } from './types';
import { trajectUntisService } from './trajectService';
import { buildShareUrl, copyToClipboard } from './trajectShare';
import styles from './Traject.module.css';
import { AlertTriangle, Check, Copy, Download, Link2, Loader2, RotateCcw, Upload } from 'lucide-react';

interface Props {
    settings: TrajectSettings;
    onToggleKlasgroep: (k: string) => void;
    onClearKlasgroepen: () => void;
    onSemesterStartChange: (iso: string) => void;
    onSemesterEindChange: (iso: string) => void;
    onExport: () => void;
    onImport: (file: File) => Promise<boolean>;
    onDone: () => void;
}

export function TrajectSettingsView({
    settings,
    onToggleKlasgroep,
    onClearKlasgroepen,
    onSemesterStartChange,
    onSemesterEindChange,
    onExport,
    onImport,
    onDone,
}: Props) {
    const [allKlasgroepen, setAllKlasgroepen] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [shareCopied, setShareCopied] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

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

    const handleClearKlasgroepen = () => {
        const count = settings.mijnOpleidingKlasgroepen.length;
        if (count === 0) return;
        const ok = window.confirm(
            `Alle ${count} geselecteerde klasgroepen deselecteren?`
        );
        if (ok) onClearKlasgroepen();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setImportMsg(null);
        try {
            const applied = await onImport(file);
            if (applied) {
                setImportMsg({ kind: 'ok', text: `Back-up geïmporteerd uit "${file.name}".` });
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Onbekende fout bij importeren.';
            setImportMsg({ kind: 'err', text: msg });
        }
    };

    const flashCopied = () => {
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 1500);
    };

    const handleGenerateLink = async () => {
        if (settings.mijnOpleidingKlasgroepen.length === 0) return;
        const url = buildShareUrl(settings);
        setShareUrl(url);
        if (await copyToClipboard(url)) flashCopied();
    };

    const handleCopyShare = async () => {
        if (shareUrl && (await copyToClipboard(shareUrl))) flashCopied();
    };

    const noKlasgroepen = settings.mijnOpleidingKlasgroepen.length === 0;

    return (
        <div className={styles.settings}>
            <div className={styles.settingsDoneBar}>
                <button
                    className={styles.settingsDoneBtn}
                    onClick={onDone}
                    title="Sluit de instellingen en ga terug naar het werkblad"
                >
                    <Check size={16} /> Klaar — terug naar werkblad
                </button>
            </div>

            <div className={styles.backupWarning}>
                <AlertTriangle size={18} />
                <div>
                    <strong>Bewaar je back-up regelmatig.</strong> Alle instellingen, het
                    studenttraject en de OLOD-kleurmap worden enkel in <em>deze browser</em>{' '}
                    bijgehouden (localStorage). Bij het wissen van je browsergegevens, een ander
                    toestel of een andere gebruiker is alles weg. Exporteer hieronder een
                    back-upbestand en bewaar het veilig.
                </div>
            </div>

            <div className={styles.settingsSection}>
                <div className={styles.settingsTitle}>Back-up & herstel</div>
                <div className={styles.settingsHint}>
                    Het JSON-bestand bevat de semesterperiode, de geselecteerde klasgroepen,
                    het volledige studenttraject en de kleurmap. Importeren overschrijft de
                    huidige gegevens.
                </div>
                <div className={styles.backupRow}>
                    <button className={styles.toolbarBtn} onClick={onExport}>
                        <Download size={14} /> Exporteer back-up
                    </button>
                    <button
                        className={styles.toolbarBtn}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <Upload size={14} /> Importeer back-up...
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/json,.json"
                        onChange={handleFileChange}
                        style={{ display: 'none' }}
                    />
                </div>
                {importMsg && (
                    <div
                        className={
                            importMsg.kind === 'ok'
                                ? styles.importMsgOk
                                : styles.importMsgErr
                        }
                    >
                        {importMsg.text}
                    </div>
                )}
            </div>

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
                <div className={styles.settingsTitleRow}>
                    <div className={styles.settingsTitle}>
                        Mijn opleiding — klasgroepen ({settings.mijnOpleidingKlasgroepen.length} geselecteerd)
                    </div>
                    <button
                        className={`${styles.toolbarBtn} ${styles.toolbarBtnDanger}`}
                        onClick={handleClearKlasgroepen}
                        disabled={settings.mijnOpleidingKlasgroepen.length === 0}
                        title="Deselecteer alle klasgroepen"
                    >
                        <RotateCcw size={14} /> Alles deselecteren
                    </button>
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

            <div className={styles.settingsSection}>
                <div className={styles.settingsTitle}>Deel met student</div>
                <div className={styles.settingsHint}>
                    Genereer een link met de hierboven geselecteerde klasgroepen en de
                    semesterperiode. Een student die via deze link inlogt, ziet meteen de
                    juiste klasgroepen in het werkblad en hoeft niets in te stellen. De
                    student kiest daarna zelf zijn vakken — jouw eigen traject wordt niet
                    meegestuurd.
                </div>
                <div className={styles.backupRow}>
                    <button
                        className={styles.toolbarBtn}
                        onClick={handleGenerateLink}
                        disabled={noKlasgroepen}
                        title={
                            noKlasgroepen
                                ? 'Selecteer eerst minstens één klasgroep'
                                : 'Genereer en kopieer een student-link'
                        }
                    >
                        <Link2 size={14} /> Genereer student-link
                    </button>
                    {shareUrl && (
                        <button className={styles.toolbarBtn} onClick={handleCopyShare}>
                            {shareCopied ? <Check size={14} /> : <Copy size={14} />}
                            {shareCopied ? 'Gekopieerd!' : 'Kopieer link'}
                        </button>
                    )}
                </div>
                {noKlasgroepen && (
                    <div className={styles.settingsHint}>
                        Selecteer eerst minstens één klasgroep hierboven.
                    </div>
                )}
                {shareUrl && (
                    <input
                        className={styles.shareUrlInput}
                        type="text"
                        readOnly
                        value={shareUrl}
                        onFocus={e => e.currentTarget.select()}
                    />
                )}
            </div>
        </div>
    );
}
