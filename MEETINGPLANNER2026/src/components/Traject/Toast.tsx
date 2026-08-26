import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Undo2, X } from 'lucide-react';
import styles from './Traject.module.css';

const TOAST_DUUR = 8000;

interface UndoMelding {
    // Oplopend nummer: zorgt dat een tweede melding met dezelfde tekst de
    // timer opnieuw start.
    id: number;
    tekst: string;
}

/**
 * Eén "… — Ongedaan maken"-melding tegelijk. De aanroeper geeft de herstelactie
 * mee; die is in deze module altijd "zet het volledige traject terug", omdat
 * een bulkwissel selecties kan laten samensmelten en dus niet omkeerbaar is
 * door de wissel te herhalen.
 */
export function useUndo() {
    const [melding, setMelding] = useState<UndoMelding | null>(null);
    const timerRef = useRef<number | null>(null);
    const tellerRef = useRef(0);
    // De herstelactie hoort niet in de state: ze uitvoeren vanuit een
    // state-updater zou haar in StrictMode twee keer laten lopen.
    const herstelRef = useRef<(() => void) | null>(null);

    const stopTimer = () => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const sluit = useCallback(() => {
        stopTimer();
        herstelRef.current = null;
        setMelding(null);
    }, []);

    const meld = useCallback((tekst: string, herstelActie: () => void) => {
        stopTimer();
        tellerRef.current += 1;
        const id = tellerRef.current;
        herstelRef.current = herstelActie;
        setMelding({ id, tekst });
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            herstelRef.current = null;
            setMelding(m => (m && m.id === id ? null : m));
        }, TOAST_DUUR);
    }, []);

    const herstel = useCallback(() => {
        stopTimer();
        const actie = herstelRef.current;
        herstelRef.current = null;
        setMelding(null);
        actie?.();
    }, []);

    useEffect(() => stopTimer, []);

    return { melding, meld, sluit, herstel };
}

interface Props {
    melding: UndoMelding | null;
    onHerstel: () => void;
    onSluit: () => void;
}

export function UndoToast({ melding, onHerstel, onSluit }: Props) {
    if (!melding) return null;
    return createPortal(
        <div className={styles.toast} role="status">
            <span className={styles.toastTekst}>{melding.tekst}</span>
            <button type="button" className={styles.toastActie} onClick={onHerstel}>
                <Undo2 size={13} /> Ongedaan maken
            </button>
            <button
                type="button"
                className={styles.toastSluit}
                onClick={onSluit}
                title="Melding sluiten"
                aria-label="Melding sluiten"
            >
                <X size={13} />
            </button>
        </div>,
        document.body
    );
}
