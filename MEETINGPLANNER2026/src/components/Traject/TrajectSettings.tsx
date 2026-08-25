import { useEffect, useRef, useState } from 'react';
import { TrajectSettings } from './types';
import {
    ACADEMIEJAAR,
    defaultModuleGrenzen,
    moduleGrensGeldig,
    modulePeriodes,
    semesterPeriodes,
    type ModuleGrenzen,
    type PeriodeType,
} from './academicYear';
import { formatDateBE, parseIsoDate } from './dateUtils';
import { PeriodeSwitcher } from './PeriodeSwitcher';
import { trajectUntisService } from './trajectService';
import { untisService } from '../../services/UntisService';
import { buildShareUrl, copyToClipboard } from './trajectShare';
import styles from './Traject.module.css';
import { AlertTriangle, Check, Copy, Download, Link2, Loader2, QrCode, RotateCcw, Upload } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';

interface Props {
    settings: TrajectSettings;
    onToggleKlasgroep: (k: string) => void;
    onSetKlasgroepen: (list: string[]) => void;
    onSemesterStartChange: (iso: string) => void;
    onSemesterEindChange: (iso: string) => void;
    onSemesterPeriodeChange: (start: string, eind: string) => void;
    onPeriodeTypeChange: (type: PeriodeType) => void;
    onModuleGrenzenChange: (grenzen: ModuleGrenzen) => void;
    onExport: () => void;
    onImport: (file: File) => Promise<boolean>;
    onDone: () => void;
}

export function TrajectSettingsView({
    settings,
    onToggleKlasgroep,
    onSetKlasgroepen,
    onSemesterStartChange,
    onSemesterEindChange,
    onSemesterPeriodeChange,
    onPeriodeTypeChange,
    onModuleGrenzenChange,
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
    const [showQr, setShowQr] = useState(false);
    const qrBoxRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        setBusy(true);
        trajectUntisService
            .getKlasgroepen()
            .then(setAllKlasgroepen)
            .catch(e => setError(e.message ?? 'Klasgroepen ophalen mislukt'))
            .finally(() => setBusy(false));
    }, []);

    // Toon het werkelijk geresolveerde academiejaar uit de Untis-service; val
    // terug op het geplande jaar (constante) zolang discovery niet klaar is.
    const actiefJaar = untisService.getActiveSchoolYearName() ?? ACADEMIEJAAR.naam;

    const selected = new Set(settings.mijnOpleidingKlasgroepen);
    const f = filter.trim().toLowerCase();
    const visible = f ? allKlasgroepen.filter(k => k.toLowerCase().includes(f)) : allKlasgroepen;
    const alleZichtbareGeselecteerd = visible.length > 0 && visible.every(k => selected.has(k));

    // Werkt enkel op de gefilterde (zichtbare) klasgroepen, zodat "Selecteer
    // alle/geen" voorspelbaar blijft ongeacht het zoekveld.
    const handleToggleAlleZichtbare = () => {
        if (visible.length === 0) return;
        if (alleZichtbareGeselecteerd) {
            const zichtbaarSet = new Set(visible);
            onSetKlasgroepen(settings.mijnOpleidingKlasgroepen.filter(k => !zichtbaarSet.has(k)));
        } else {
            onSetKlasgroepen(Array.from(new Set([...settings.mijnOpleidingKlasgroepen, ...visible])));
        }
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

    const handleGenerateQr = () => {
        if (settings.mijnOpleidingKlasgroepen.length === 0) return;
        setShareUrl(buildShareUrl(settings));
        setShowQr(true);
    };

    const handleDownloadQr = () => {
        const canvas = qrBoxRef.current?.querySelector('canvas');
        if (!canvas) return;
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = 'trajectplanner-student-qr.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    // Een gegenereerde link/QR is een momentopname van de instellingen; verberg ze
    // zodra de klasgroepen, de periode of de indeling wijzigen, zodat de
    // trajectbegeleider nooit per ongeluk een verouderde link of QR deelt.
    useEffect(() => {
        setShareUrl(null);
        setShowQr(false);
    }, [
        settings.mijnOpleidingKlasgroepen,
        settings.semesterStart,
        settings.semesterEind,
        settings.periodeType,
        settings.moduleGrenzen.m2Start,
        settings.moduleGrenzen.m4Start,
    ]);

    const noKlasgroepen = settings.mijnOpleidingKlasgroepen.length === 0;

    const [sem1, sem2] = ACADEMIEJAAR.semesters;
    const isModule = settings.periodeType === 'module';
    const grenzenOngeldig =
        isModule &&
        (!moduleGrensGeldig(settings.moduleGrenzen.m2Start, sem1) ||
            !moduleGrensGeldig(settings.moduleGrenzen.m4Start, sem2));
    const standaardGrenzen = defaultModuleGrenzen();
    const modules = modulePeriodes(settings.moduleGrenzen);

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
                <span
                    className={styles.academiejaarBadge}
                    title="Het academiejaar waarvan de klasgroepen en roosters geladen worden"
                >
                    Academiejaar {actiefJaar}
                </span>
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
                <div className={styles.settingsTitle}>Periode</div>
                <div className={styles.settingsHint}>
                    Het studenttraject wordt per periode opgebouwd: elke OLOD-keuze geldt
                    voor de periode die op dat moment actief is. Kies of jouw opleiding
                    per semester of per module (twee modules per semester) plant; in het
                    werkblad wissel je dan snel tussen de periodes van academiejaar{' '}
                    {ACADEMIEJAAR.naam}.
                </div>

                <div className={styles.settingsSubtitle}>Indeling</div>
                <div className={styles.semesterBtnRow}>
                    <button
                        className={`${styles.toolbarBtn} ${!isModule ? styles.semesterBtnActief : ''}`}
                        onClick={() => onPeriodeTypeChange('semester')}
                        aria-pressed={!isModule}
                    >
                        Semesters
                    </button>
                    <button
                        className={`${styles.toolbarBtn} ${isModule ? styles.semesterBtnActief : ''}`}
                        onClick={() => onPeriodeTypeChange('module')}
                        aria-pressed={isModule}
                    >
                        Modules (2 per semester)
                    </button>
                </div>

                {isModule && (
                    <>
                        <div className={styles.settingsSubtitle}>Modulegrenzen</div>
                        <div className={styles.settingsHint}>
                            Eerste dag van module 2 (binnen semester 1) en van module 4
                            (binnen semester 2). Standaard halverwege het semester.
                        </div>
                        <div className={styles.dateRow}>
                            <div className={styles.dateField}>
                                <label>Start module 2</label>
                                <input
                                    type="date"
                                    value={settings.moduleGrenzen.m2Start}
                                    min={sem1.start}
                                    max={sem1.eind}
                                    onChange={e =>
                                        onModuleGrenzenChange({ ...settings.moduleGrenzen, m2Start: e.target.value })
                                    }
                                />
                            </div>
                            <div className={styles.dateField}>
                                <label>Start module 4</label>
                                <input
                                    type="date"
                                    value={settings.moduleGrenzen.m4Start}
                                    min={sem2.start}
                                    max={sem2.eind}
                                    onChange={e =>
                                        onModuleGrenzenChange({ ...settings.moduleGrenzen, m4Start: e.target.value })
                                    }
                                />
                            </div>
                        </div>
                        {grenzenOngeldig && (
                            <div className={styles.importMsgErr}>
                                Een modulegrens is leeg of valt niet binnen haar semester. Tot je
                                dat corrigeert wordt de standaardgrens gebruikt (module 2:{' '}
                                {formatDateBE(parseIsoDate(standaardGrenzen.m2Start))}, module 4:{' '}
                                {formatDateBE(parseIsoDate(standaardGrenzen.m4Start))}).
                            </div>
                        )}
                        <div className={styles.settingsHint}>
                            {modules
                                .map(
                                    p =>
                                        `${p.label}: ${formatDateBE(parseIsoDate(p.start))} – ${formatDateBE(parseIsoDate(p.eind))}`
                                )
                                .join(' · ')}
                        </div>
                    </>
                )}

                <div className={styles.settingsSubtitle}>Actieve periode</div>
                <div className={styles.settingsHint}>
                    Kies een periode of stel de datums handmatig in. Deze keuze kan je ook
                    rechtstreeks in de topbar van het werkblad maken.
                </div>
                <PeriodeSwitcher
                    periodes={semesterPeriodes()}
                    actieveStart={settings.semesterStart}
                    actieveEind={settings.semesterEind}
                    onKies={p => onSemesterPeriodeChange(p.start, p.eind)}
                />
                {isModule && (
                    <PeriodeSwitcher
                        periodes={modules}
                        actieveStart={settings.semesterStart}
                        actieveEind={settings.semesterEind}
                        onKies={p => onSemesterPeriodeChange(p.start, p.eind)}
                    />
                )}
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

                <div className={styles.klasFilterRow}>
                    <input
                        className={styles.searchInput}
                        type="text"
                        placeholder="Zoek klasgroep..."
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                    />
                    <button
                        className={styles.toolbarBtn}
                        onClick={handleToggleAlleZichtbare}
                        disabled={visible.length === 0}
                        title={
                            alleZichtbareGeselecteerd
                                ? `Deselecteer de ${visible.length} getoonde klasgroepen`
                                : `Selecteer de ${visible.length} getoonde klasgroepen`
                        }
                    >
                        {alleZichtbareGeselecteerd ? <RotateCcw size={14} /> : <Check size={14} />}
                        {alleZichtbareGeselecteerd ? 'Selecteer geen' : 'Selecteer alle'}
                    </button>
                </div>

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
                    <button
                        className={styles.toolbarBtn}
                        onClick={handleGenerateQr}
                        disabled={noKlasgroepen}
                        title={
                            noKlasgroepen
                                ? 'Selecteer eerst minstens één klasgroep'
                                : 'Toon de student-link als QR-code'
                        }
                    >
                        <QrCode size={14} /> Genereer QR
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
                {showQr && shareUrl && (
                    <div className={styles.qrSection}>
                        <div className={styles.qrBox} ref={qrBoxRef}>
                            <QRCodeCanvas value={shareUrl} size={240} level="L" marginSize={2} />
                        </div>
                        <div className={styles.qrActions}>
                            <button className={styles.toolbarBtn} onClick={handleDownloadQr}>
                                <Download size={14} /> Download QR (PNG)
                            </button>
                        </div>
                        <div className={styles.settingsHint}>
                            Laat de student deze QR scannen met de telefooncamera, of deel de
                            afbeelding. De QR opent dezelfde voorgeconfigureerde link.
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
