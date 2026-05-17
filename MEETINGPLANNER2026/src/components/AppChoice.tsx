import { CalendarDays, Route } from 'lucide-react';
import styles from './AppChoice.module.css';

interface AppChoiceProps {
    onSelect: (choice: 'meeting' | 'traject') => void;
}

export function AppChoice({ onSelect }: AppChoiceProps) {
    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <h1 className={styles.title}>Wat wil je doen?</h1>
                <p className={styles.subtitle}>Kies een van de onderstaande opties.</p>

                <div className={styles.options}>
                    <button
                        type="button"
                        className={styles.option}
                        onClick={() => onSelect('meeting')}
                    >
                        <CalendarDays size={40} className={styles.icon} />
                        <div className={styles.optionTitle}>Meeting Planner</div>
                        <div className={styles.optionDesc}>
                            Plan vergaderingen op basis van de Untis-uurroosters.
                        </div>
                    </button>

                    <button
                        type="button"
                        className={styles.option}
                        onClick={() => onSelect('traject')}
                    >
                        <Route size={40} className={styles.icon} />
                        <div className={styles.optionTitle}>Traject Planner</div>
                        <div className={styles.optionDesc}>
                            Stel een individueel studentrooster samen uit OLODs van verschillende klasgroepen.
                        </div>
                    </button>
                </div>

                <div className={styles.bmcWrapper}>
                    <p className={styles.bmcNote}>
                       Deze tools bouw ik in mijn vrije tijd met behulp van AI. Heb je er iets aan? Met een kleine bijdrage help je mijn AI-abonnement betalen, zodat er nieuwe tools kunnen blijven volgen. Bedankt! 🙏
                    </p>
                    <a
                        href="https://www.buymeacoffee.com/timdams"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.bmcButton}
                    >
                        <span className={styles.bmcEmoji}>🥤</span>
                        <span>Buy me a fristi</span>
                    </a>
                </div>
            </div>
        </div>
    );
}
