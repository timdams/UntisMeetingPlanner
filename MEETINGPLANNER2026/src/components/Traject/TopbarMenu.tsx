import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './Traject.module.css';

interface Props {
    // Inhoud van de knop zelf (icoon + tekst).
    label: ReactNode;
    title?: string;
    ariaLabel?: string;
    disabled?: boolean;
    // Menu rechts uitlijnen op de knop (standaard) of links.
    align?: 'left' | 'right';
    // Chevron tonen; uit voor een knop die al als icoon leest (bv. "⋯").
    chevron?: boolean;
    // Extra klasse op de knop, naast `toolbarBtn`: laat een oproeper de knop
    // als icoonknop of als dossierknop tonen zonder het menu te dupliceren.
    btnClass?: string;
    // De menu-inhoud. Krijgt een `close` mee zodat een item het menu kan
    // sluiten nadat het zijn actie heeft uitgevoerd.
    children: (close: () => void) => ReactNode;
}

/**
 * Knop in de topbar met een uitklapmenu eronder. Sluit bij Escape of een klik
 * buiten de knop + het menu. Eén implementatie voor "Laad traject",
 * "Exporteren" en het overloopmenu, zodat dat gedrag niet drie keer bestaat.
 */
export function TopbarMenu({
    label,
    title,
    ariaLabel,
    disabled = false,
    align = 'right',
    chevron = true,
    btnClass,
    children,
}: Props) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // Een uitgeschakelde knop mag geen open menu achterlaten.
    useEffect(() => {
        if (disabled) setOpen(false);
    }, [disabled]);

    return (
        <div className={styles.menuWrap} ref={wrapRef}>
            <button
                type="button"
                className={`${styles.toolbarBtn} ${btnClass ?? ''}`}
                onClick={() => setOpen(o => !o)}
                disabled={disabled}
                title={title}
                aria-label={ariaLabel}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                {label}
                {chevron && <ChevronDown size={12} />}
            </button>
            {open && (
                <div
                    className={`${styles.menuPaneel} ${align === 'left' ? styles.menuPaneelLinks : ''}`}
                    role="menu"
                >
                    {children(() => setOpen(false))}
                </div>
            )}
        </div>
    );
}

interface ItemProps {
    onClick: () => void;
    icon?: ReactNode;
    title?: string;
    disabled?: boolean;
    // Rode weergave voor een destructieve actie (bv. "Reset traject").
    danger?: boolean;
    // Rechts uitgelijnde toelichting, bv. de sneltoets "Ctrl+S".
    hint?: ReactNode;
    children: ReactNode;
}

/** Eén regel in een `TopbarMenu`. */
export function TopbarMenuItem({ onClick, icon, title, disabled, danger, hint, children }: ItemProps) {
    return (
        <button
            type="button"
            role="menuitem"
            className={`${styles.menuItem} ${danger ? styles.menuItemDanger : ''}`}
            onClick={onClick}
            disabled={disabled}
            title={title}
        >
            {icon}
            <span>{children}</span>
            {hint && <span className={styles.menuKbd}>{hint}</span>}
        </button>
    );
}
