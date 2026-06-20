import { CalendarDays, Route, LogOut, ExternalLink } from 'lucide-react';
import styles from './AppChoice.module.css';

interface AppChoiceProps {
    // null = beschikbaarheid wordt nog gecontroleerd; false = geen toegang (bv. student).
    meetingAvailable: boolean | null;
    onSelect: (choice: 'meeting' | 'traject') => void;
    onLogout: () => void;
}

export function AppChoice({ meetingAvailable, onSelect, onLogout }: AppChoiceProps) {
    const meetingDisabled = meetingAvailable === false;
    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <button
                    type="button"
                    className={styles.logoutButton}
                    onClick={onLogout}
                >
                    <LogOut size={16} />
                    <span>Afmelden</span>
                </button>
                <h1 className={styles.title}>Wat wil je doen?</h1>
                <p className={styles.subtitle}>Kies een van de onderstaande opties.</p>

                <div className={styles.options}>
                    <button
                        type="button"
                        className={`${styles.option} ${meetingDisabled ? styles.optionDisabled : ''}`}
                        onClick={() => onSelect('meeting')}
                        disabled={meetingDisabled}
                        aria-disabled={meetingDisabled}
                    >
                        {meetingDisabled && <div className={styles.badge}>Niet beschikbaar</div>}
                        <CalendarDays size={40} className={styles.icon} />
                        <div className={styles.optionTitle}>Meeting Planner</div>
                        <div className={styles.optionDesc}>
                            {meetingDisabled
                                ? 'Niet beschikbaar voor dit account — je hebt geen toegang tot de lerarenroosters.'
                                : 'Plan vergaderingen op basis van de Untis-uurroosters.'}
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

                <div className={styles.moreToolsWrapper}>
                    <a
                        href="https://timdams.github.io/TimsTools/docs/category/tools"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.moreToolsButton}
                    >
                        <ExternalLink size={15} />
                        <span>Bekijk meer tools van Tim Dams</span>
                    </a>
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
