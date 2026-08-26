import { Fragment, useEffect, useRef, useState } from 'react';
import { TrajectSettings } from './types';
import {
    ACADEMIEJAAR,
    defaultPeriodeGrenzen,
    grenzenGeldig,
    moduleGrensGeldig,
    modulePeriodes,
    semesterDefs,
    semesterGrensGeldig,
    semesterPeriodes,
    type PeriodeGrenzen,
    type PeriodeType,
} from './academicYear';
import { formatDateBE, parseIsoDate } from './dateUtils';
import { PeriodeSwitcher } from './PeriodeSwitcher';
import { SettingsCard, Uitleg } from './SettingsCard';
import {
    backupSummary,
    deelSummary,
    groepeerKlasgroepen,
    klasgroepenSummary,
    periodeSummary,
} from './settingsSummaries';
import { trajectUntisService } from './trajectService';
import { untisService } from '../../services/UntisService';
import { buildShareUrl, copyToClipboard } from './trajectShare';
import styles from './Traject.module.css';
import {
    AlertTriangle,
    Archive,
    CalendarRange,
    Check,
    Copy,
    Download,
    GraduationCap,
    Link2,
    Loader2,
    Palette,
    QrCode,
    RotateCcw,
    Share2,
    Upload,
    X,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';

interface Props {
    settings: TrajectSettings;
    onToggleKlasgroep: (k: string) => void;
    onSetKlasgroepen: (list: string[]) => void;
    onSemesterStartChange: (iso: string) => void;
    onSemesterEindChange: (iso: string) => void;
    onSemesterPeriodeChange: (start: string, eind: string) => void;
    onPeriodeTypeChange: (type: PeriodeType) => void;
    // Zet alle grensdatums in één keer (semesterstart/-einde, start module 2 en 4).
    onPeriodeGrenzenChange: (grenzen: PeriodeGrenzen) => void;
    onExport: () => void;
    onImport: (file: File) => Promise<boolean>;
    // Wist de kleurmap; de kleuren worden opnieuw toegewezen zodra de OLODs
    // weer in beeld komen. Onderhoud, dus hoort bij back-up & herstel.
    onResetColors: () => void;
    aantalKleuren: number;
    // ISO-tijdstip van de laatste back-upexport (null = nog nooit).
    lastBackup: string | null;
    // Of er een studenttraject is — bepaalt of "nooit geëxporteerd" een
    // waarschuwing verdient.
    heeftTraject: boolean;
    onDone: () => void;
}

type CardId = 'opleiding' | 'periode' | 'delen' | 'backup';

export function TrajectSettingsView({
    settings,
    onToggleKlasgroep,
    onSetKlasgroepen,
    onSemesterStartChange,
    onSemesterEindChange,
    onSemesterPeriodeChange,
    onPeriodeTypeChange,
    onPeriodeGrenzenChange,
    onExport,
    onImport,
    onResetColors,
    aantalKleuren,
    lastBackup,
    heeftTraject,
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

    // Welke kaarten open staan. Enkel "Mijn opleiding" standaard open: dat is
    // wat een nieuwe gebruiker moet doen; de rest leest als samenvatting.
    // Bewust niet gepersisteerd — bij elke terugkeer opnieuw het overzicht.
    const [open, setOpen] = useState<Record<CardId, boolean>>({
        opleiding: true,
        periode: false,
        delen: false,
        backup: false,
    });
    const toggle = (id: CardId) => setOpen(o => ({ ...o, [id]: !o[id] }));

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
    // De selectie staat altijd gebundeld bovenaan (los van het zoekfilter),
    // natuurlijk gesorteerd zodat 1IT2 vóór 1IT10 komt.
    const geselecteerdGesorteerd = settings.mijnOpleidingKlasgroepen
        .slice()
        .sort((a, b) => a.localeCompare(b, 'nl', { numeric: true, sensitivity: 'base' }));
    const f = filter.trim().toLowerCase();
    const visible = f ? allKlasgroepen.filter(k => k.toLowerCase().includes(f)) : allKlasgroepen;
    const alleZichtbareGeselecteerd = visible.length > 0 && visible.every(k => selected.has(k));
    // Groepering per jaar gebeurt op de gefilterde lijst, zodat "Selecteer
    // alle/geen" en de lege-staat op exact dezelfde set blijven werken.
    const groepen = groepeerKlasgroepen(visible);

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
        settings.periodeGrenzen,
    ]);

    const noKlasgroepen = settings.mijnOpleidingKlasgroepen.length === 0;

    // De grenzen zoals ingesteld, en de semesters zoals ze daarmee effectief
    // gelden (een onbruikbare grens valt terug op het standaard-academiejaar).
    const grenzen = settings.periodeGrenzen;
    const [sem1, sem2] = semesterDefs(grenzen);
    const isModule = settings.periodeType === 'module';
    const semesterOngeldig =
        !semesterGrensGeldig(grenzen.s1Start, grenzen.s1Eind) ||
        !semesterGrensGeldig(grenzen.s2Start, grenzen.s2Eind);
    const moduleOngeldig =
        isModule &&
        (!moduleGrensGeldig(grenzen.m2Start, sem1) || !moduleGrensGeldig(grenzen.m4Start, sem2));
    const grenzenOngeldig = !grenzenGeldig(grenzen, settings.periodeType);
    // Standaard van het academiejaar (voor de herstelknop) en, apart, de
    // modulegrenzen die bij de nu ingestelde semesters horen (voor de melding).
    const standaardGrenzen = defaultPeriodeGrenzen();
    const standaardModuleGrenzen = defaultPeriodeGrenzen(grenzen);
    const modules = modulePeriodes(grenzen);
    const zetGrens = (veld: keyof PeriodeGrenzen, iso: string) =>
        onPeriodeGrenzenChange({ ...grenzen, [veld]: iso });
    const dag = (iso: string) => formatDateBE(parseIsoDate(iso));

    const heeftData = heeftTraject || !noKlasgroepen;
    const samenvatting = {
        opleiding: klasgroepenSummary(geselecteerdGesorteerd),
        periode: periodeSummary(settings, grenzenOngeldig),
        delen: deelSummary(settings.mijnOpleidingKlasgroepen.length),
        backup: backupSummary(lastBackup, heeftData),
    };

    return (
        <div className={styles.settings}>
            <div className={styles.settingsTopBar}>
                <div className={styles.settingsTopBarInner}>
                    <button
                        className={styles.settingsDoneBtn}
                        onClick={onDone}
                        title="Sluit de instellingen en ga terug naar het werkblad"
                    >
                        <Check size={16} /> Klaar — terug naar werkblad
                    </button>
                    <span className={styles.settingsPageTitle}>Instellingen</span>
                    <span
                        className={styles.academiejaarBadge}
                        title="Het academiejaar waarvan de klasgroepen en roosters geladen worden"
                    >
                        Academiejaar {actiefJaar}
                    </span>
                </div>
            </div>

            <div className={styles.settingsInner}>
                <SettingsCard
                    id="opleiding"
                    icon={<GraduationCap size={18} />}
                    title="Mijn opleiding"
                    summary={samenvatting.opleiding}
                    open={open.opleiding}
                    onToggle={() => toggle('opleiding')}
                >
                    <div className={styles.settingsHint}>
                        Vink de klasgroepen van jouw opleiding aan — enkel die verschijnen in het
                        werkblad.
                    </div>

                    <div className={styles.klasSelectedBox} aria-label="Geselecteerde klasgroepen">
                        <div className={styles.klasSelectedHeader}>
                            <span className={styles.klasSelectedTitle}>
                                Geselecteerd
                                <span className={styles.klasSelectedCount}>{geselecteerdGesorteerd.length}</span>
                            </span>
                            {geselecteerdGesorteerd.length > 0 && (
                                <button
                                    type="button"
                                    className={styles.klasSelectedClear}
                                    onClick={() => onSetKlasgroepen([])}
                                    title="Verwijder alle klasgroepen uit de selectie"
                                >
                                    <RotateCcw size={12} /> Wis selectie
                                </button>
                            )}
                        </div>
                        {geselecteerdGesorteerd.length === 0 ? (
                            <div className={styles.klasSelectedEmpty}>
                                Nog geen klasgroepen geselecteerd — vink ze hieronder aan.
                            </div>
                        ) : (
                            <div className={styles.klasSelectedChips}>
                                {geselecteerdGesorteerd.map(k => (
                                    <span key={k} className={styles.klasChip}>
                                        {k}
                                        <button
                                            type="button"
                                            className={styles.klasChipRemove}
                                            onClick={() => onToggleKlasgroep(k)}
                                            title={`${k} uit de selectie verwijderen`}
                                            aria-label={`${k} verwijderen`}
                                        >
                                            <X size={12} />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
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
                            {groepen.map(g => (
                                <Fragment key={g.label}>
                                    <div className={styles.klasGroepHeader}>{g.label}</div>
                                    {g.items.map(k => {
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
                                </Fragment>
                            ))}
                            {visible.length === 0 && (
                                <div className={styles.emptyState}>Geen klasgroepen gevonden.</div>
                            )}
                        </div>
                    )}
                </SettingsCard>

                <SettingsCard
                    id="periode"
                    icon={<CalendarRange size={18} />}
                    title="Periode"
                    summary={samenvatting.periode}
                    open={open.periode}
                    onToggle={() => toggle('periode')}
                >
                    <div className={styles.settingsHint}>
                        Plant jouw opleiding per semester of per module (twee modules per semester)?
                    </div>
                    <div className={styles.segmented} role="group" aria-label="Indeling">
                        <button
                            type="button"
                            className={`${styles.segmentedBtn} ${!isModule ? styles.segmentedBtnActief : ''}`}
                            onClick={() => onPeriodeTypeChange('semester')}
                            aria-pressed={!isModule}
                        >
                            Semesters
                        </button>
                        <button
                            type="button"
                            className={`${styles.segmentedBtn} ${isModule ? styles.segmentedBtnActief : ''}`}
                            onClick={() => onPeriodeTypeChange('module')}
                            aria-pressed={isModule}
                        >
                            Modules (2 per semester)
                        </button>
                    </div>

                    <div className={styles.subtitleRow}>
                        <div className={styles.settingsSubtitle}>Semestergrenzen</div>
                        <button
                            type="button"
                            className={styles.toolbarBtn}
                            onClick={() => onPeriodeGrenzenChange(defaultPeriodeGrenzen())}
                            title={`Zet alle grensdatums terug op die van academiejaar ${ACADEMIEJAAR.naam}`}
                        >
                            <RotateCcw size={14} /> Standaarddatums
                        </button>
                    </div>
                    <div className={styles.dateRow}>
                        <div className={styles.dateField}>
                            <label>Semester 1 · start</label>
                            <input
                                type="date"
                                value={grenzen.s1Start}
                                onChange={e => zetGrens('s1Start', e.target.value)}
                            />
                        </div>
                        <div className={styles.dateField}>
                            <label>Semester 1 · einde</label>
                            <input
                                type="date"
                                value={grenzen.s1Eind}
                                min={grenzen.s1Start || undefined}
                                onChange={e => zetGrens('s1Eind', e.target.value)}
                            />
                        </div>
                        <div className={styles.dateField}>
                            <label>Semester 2 · start</label>
                            <input
                                type="date"
                                value={grenzen.s2Start}
                                onChange={e => zetGrens('s2Start', e.target.value)}
                            />
                        </div>
                        <div className={styles.dateField}>
                            <label>Semester 2 · einde</label>
                            <input
                                type="date"
                                value={grenzen.s2Eind}
                                min={grenzen.s2Start || undefined}
                                onChange={e => zetGrens('s2Eind', e.target.value)}
                            />
                        </div>
                    </div>
                    {semesterOngeldig && (
                        <div className={styles.importMsgErr}>
                            Een semestergrens is leeg of loopt achteruit. Tot je dat corrigeert
                            gelden de standaarddatums (semester 1: {dag(standaardGrenzen.s1Start)}
                            {"–"}{dag(standaardGrenzen.s1Eind)}, semester 2:{' '}
                            {dag(standaardGrenzen.s2Start)}{"–"}{dag(standaardGrenzen.s2Eind)}).
                        </div>
                    )}

                    {isModule && (
                        <>
                            <div className={styles.settingsSubtitle}>Modulegrenzen</div>
                            <div className={styles.dateRow}>
                                <div className={styles.dateField}>
                                    <label>Start module 2</label>
                                    <input
                                        type="date"
                                        value={grenzen.m2Start}
                                        min={sem1.start}
                                        max={sem1.eind}
                                        onChange={e => zetGrens('m2Start', e.target.value)}
                                    />
                                </div>
                                <div className={styles.dateField}>
                                    <label>Start module 4</label>
                                    <input
                                        type="date"
                                        value={grenzen.m4Start}
                                        min={sem2.start}
                                        max={sem2.eind}
                                        onChange={e => zetGrens('m4Start', e.target.value)}
                                    />
                                </div>
                            </div>
                            {moduleOngeldig && (
                                <div className={styles.importMsgErr}>
                                    Een modulegrens is leeg of valt niet binnen haar semester. Tot je
                                    dat corrigeert wordt de standaardgrens gebruikt (module 2:{' '}
                                    {dag(standaardModuleGrenzen.m2Start)}, module 4:{' '}
                                    {dag(standaardModuleGrenzen.m4Start)}).
                                </div>
                            )}
                            <div className={styles.moduleStrip} aria-label="Moduleperiodes">
                                {modules.map(p => (
                                    <div key={p.id} className={styles.moduleCell}>
                                        <span className={styles.moduleCellKort}>{p.label}</span>
                                        <span className={styles.moduleCellDatums}>
                                            {dag(p.start)} – {dag(p.eind)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                    <Uitleg>
                        <p>
                            Het studenttraject wordt per periode opgebouwd: elke OLOD-keuze geldt
                            voor de periode die op dat moment actief is. Kies of jouw opleiding
                            per semester of per module (twee modules per semester) plant; in het
                            werkblad wissel je dan snel tussen de periodes van academiejaar{' '}
                            {ACADEMIEJAAR.naam}.
                        </p>
                        <p>
                            Semestergrenzen: de eerste en laatste dag van elk semester. Alle
                            periodes worden hieruit afgeleid, en ze blijven bewaard — de
                            periode-knoppen hierboven en in de topbar gebruiken exact deze datums.
                        </p>
                        <p>
                            Modulegrenzen: de eerste dag van module 2 (binnen semester 1) en van
                            module 4 (binnen semester 2). Standaard halverwege het semester.
                            Module 1 loopt dus tot de dag vóór de start van module 2, en module 2
                            tot het einde van semester 1 (idem voor 3 en 4 in semester 2).
                        </p>
                    </Uitleg>

                    <Uitleg label="Geavanceerd: actieve periode handmatig">
                        <div className={styles.settingsHint}>
                            In het werkblad wissel je van periode via de knoppen in de topbar. Hier
                            kan je de actieve periode ook op een eigen start- en einddatum zetten.
                            Let op: dit is enkel het bereik dat het werkblad nú toont — het
                            verandert de semester- of modulegrenzen hierboven niet, dus een klik op
                            een periodeknop zet die datums weer naar die van de periode.
                        </div>
                        <PeriodeSwitcher
                            periodes={semesterPeriodes(grenzen)}
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
                    </Uitleg>
                </SettingsCard>

                <SettingsCard
                    id="delen"
                    icon={<Share2 size={18} />}
                    title="Deel met student"
                    summary={samenvatting.delen}
                    open={open.delen}
                    onToggle={() => toggle('delen')}
                >
                    <div className={styles.settingsHint}>
                        Geef de student een link of QR-code: de klasgroepen en periode staan dan
                        meteen goed.
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
                            Selecteer eerst minstens één klasgroep onder "Mijn opleiding".
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
                    <Uitleg>
                        <p>
                            De link bevat de hierboven geselecteerde klasgroepen en de
                            periode-instellingen. Een student die via deze link inlogt, ziet meteen
                            de juiste klasgroepen in het werkblad en hoeft niets in te stellen. De
                            student kiest daarna zelf zijn vakken — jouw eigen traject wordt niet
                            meegestuurd.
                        </p>
                        <p>
                            Een gegenereerde link of QR is een momentopname: wijzig je daarna de
                            klasgroepen of de periode, genereer dan een nieuwe.
                        </p>
                    </Uitleg>
                </SettingsCard>

                <SettingsCard
                    id="backup"
                    icon={<Archive size={18} />}
                    title="Back-up & herstel"
                    summary={samenvatting.backup}
                    open={open.backup}
                    onToggle={() => toggle('backup')}
                >
                    <div
                        className={`${styles.cardNote} ${samenvatting.backup.tone === 'warn' ? styles.cardNoteWarn : ''}`}
                    >
                        <AlertTriangle size={16} />
                        <span>
                            Alles wordt enkel in <em>deze browser</em> bewaard. Exporteer regelmatig
                            een back-up en bewaar die veilig.
                        </span>
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
                    <div className={styles.backupMeta}>{samenvatting.backup.text}</div>
                    <div className={styles.backupRow}>
                        <button
                            className={styles.toolbarBtn}
                            onClick={onResetColors}
                            disabled={aantalKleuren === 0}
                            title="Wis de opgeslagen kleurmap en wijs nieuwe unieke kleuren toe zodra de OLODs weer in beeld komen"
                        >
                            <Palette size={14} /> Kleuren opnieuw toewijzen
                            {aantalKleuren > 0 && ` (${aantalKleuren})`}
                        </button>
                    </div>
                    <Uitleg>
                        <p>
                            Het JSON-bestand bevat de periode-instellingen, de geselecteerde
                            klasgroepen, het volledige studenttraject en de OLOD-kleurmap.
                            Importeren overschrijft de huidige gegevens (na bevestiging).
                        </p>
                        <p>
                            Bij het wissen van je browsergegevens, op een ander toestel of bij een
                            andere gebruiker is alles weg — enkel een back-upbestand brengt het
                            terug.
                        </p>
                    </Uitleg>
                </SettingsCard>
            </div>
        </div>
    );
}
