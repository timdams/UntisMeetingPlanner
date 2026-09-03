import { Fragment, useEffect, useState } from 'react';
import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import { groepeerKlasgroepen } from '../Traject/settingsSummaries';
import tstyles from '../Traject/Traject.module.css';
import { examenService } from './examenService';
import { sorteerKlasgroepen } from './types';

interface Props {
    geselecteerd: string[];
    onToggle: (klasgroep: string) => void;
    onSet: (klasgroepen: string[]) => void;
}

/**
 * Klasgroepen kiezen uit Untis: de selectie gebundeld bovenaan als chips, een
 * zoekveld, en daaronder het volledige raster gegroepeerd per jaar. Zelfde
 * vorm als "Mijn opleiding" in de Traject Planner, maar hier per opleiding.
 */
export function KlasgroepKiezer({ geselecteerd, onToggle, onSet }: Props) {
    const [alle, setAlle] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');

    useEffect(() => {
        let cancelled = false;
        setBusy(true);
        examenService
            .getKlasgroepen()
            .then(ks => {
                if (!cancelled) setAlle(ks);
            })
            .catch(e => {
                if (!cancelled) setError(e?.message ?? 'Klasgroepen ophalen mislukt');
            })
            .finally(() => {
                if (!cancelled) setBusy(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const selected = new Set(geselecteerd);
    const gesorteerd = sorteerKlasgroepen(geselecteerd);
    const f = filter.trim().toLowerCase();
    const zichtbaar = f ? alle.filter(k => k.toLowerCase().includes(f)) : alle;
    const alleZichtbaarGeselecteerd = zichtbaar.length > 0 && zichtbaar.every(k => selected.has(k));
    const groepen = groepeerKlasgroepen(zichtbaar);

    const toggleAlleZichtbare = () => {
        if (zichtbaar.length === 0) return;
        if (alleZichtbaarGeselecteerd) {
            const set = new Set(zichtbaar);
            onSet(geselecteerd.filter(k => !set.has(k)));
        } else {
            onSet(Array.from(new Set([...geselecteerd, ...zichtbaar])));
        }
    };

    return (
        <>
            <div className={tstyles.klasSelectedBox} aria-label="Geselecteerde klasgroepen">
                <div className={tstyles.klasSelectedHeader}>
                    <span className={tstyles.klasSelectedTitle}>
                        Geselecteerd
                        <span className={tstyles.klasSelectedCount}>{gesorteerd.length}</span>
                    </span>
                    {gesorteerd.length > 0 && (
                        <button
                            type="button"
                            className={tstyles.klasSelectedClear}
                            onClick={() => onSet([])}
                            title="Verwijder alle klasgroepen uit deze opleiding"
                        >
                            <RotateCcw size={12} /> Wis selectie
                        </button>
                    )}
                </div>
                {gesorteerd.length === 0 ? (
                    <div className={tstyles.klasSelectedEmpty}>
                        Nog geen klasgroepen gekozen — vink ze hieronder aan.
                    </div>
                ) : (
                    <div className={tstyles.klasSelectedChips}>
                        {gesorteerd.map(k => (
                            <span key={k} className={tstyles.klasChip}>
                                {k}
                                <button
                                    type="button"
                                    className={tstyles.klasChipRemove}
                                    onClick={() => onToggle(k)}
                                    title={`${k} uit de opleiding verwijderen`}
                                    aria-label={`${k} verwijderen`}
                                >
                                    <X size={12} />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className={tstyles.klasFilterRow}>
                <input
                    className={tstyles.searchInput}
                    type="text"
                    placeholder="Zoek klasgroep..."
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                />
                <button
                    type="button"
                    className={tstyles.toolbarBtn}
                    onClick={toggleAlleZichtbare}
                    disabled={zichtbaar.length === 0}
                    title={
                        alleZichtbaarGeselecteerd
                            ? `Deselecteer de ${zichtbaar.length} getoonde klasgroepen`
                            : `Selecteer de ${zichtbaar.length} getoonde klasgroepen`
                    }
                >
                    {alleZichtbaarGeselecteerd ? <RotateCcw size={14} /> : <Check size={14} />}
                    {alleZichtbaarGeselecteerd ? 'Selecteer geen' : 'Selecteer alle'}
                </button>
            </div>

            {busy && (
                <div className={tstyles.emptyState}>
                    <Loader2 className="animate-spin" size={20} /> Laden...
                </div>
            )}
            {error && <div className={tstyles.emptyState}>{error}</div>}
            {!busy && !error && (
                <div className={tstyles.klasList}>
                    {groepen.map(g => (
                        <Fragment key={g.label}>
                            <div className={tstyles.klasGroepHeader}>{g.label}</div>
                            {g.items.map(k => {
                                const checked = selected.has(k);
                                return (
                                    <label
                                        key={k}
                                        className={`${tstyles.klasRow} ${checked ? tstyles.klasRowChecked : ''}`}
                                    >
                                        <input type="checkbox" checked={checked} onChange={() => onToggle(k)} />
                                        <span>{k}</span>
                                    </label>
                                );
                            })}
                        </Fragment>
                    ))}
                    {zichtbaar.length === 0 && (
                        <div className={tstyles.emptyState}>Geen klasgroepen gevonden.</div>
                    )}
                </div>
            )}
        </>
    );
}
