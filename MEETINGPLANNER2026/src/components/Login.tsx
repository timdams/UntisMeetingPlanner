import { useState, useEffect } from 'react';
import { untisService } from '../services/UntisService';
import { User, Lock, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import styles from './Login.module.css';

interface LoginProps {
    onLoginSuccess: () => void;
}

export function Login({ onLoginSuccess }: LoginProps) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [status, setStatus] = useState('');
    const [isBusy, setIsBusy] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);

    useEffect(() => {
        const storedUser = localStorage.getItem('untis_user');
        if (storedUser) {
            setUsername(storedUser);
            setRememberMe(true);
        }
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isBusy) return;

        if (username.toLowerCase().endsWith('@ap.be')) {
            setStatus("Geen domein toevoegen, enkel pnummer.");
            return;
        }
        if (username.includes('.')) {
            setStatus("Gebruik je pnummer zonder @ap.be.");
            return;
        }

        setIsBusy(true);
        setStatus('Aanmelden...');

        try {
            // Append domain to username as expected by the API
            const apiUser = username + "@ap.be";
            const result = await untisService.login(apiUser, password);
            if (result.success) {
                setStatus('Ingelogd.');
                if (rememberMe) {
                    localStorage.setItem('untis_user', username);
                } else {
                    localStorage.removeItem('untis_user');
                }
                onLoginSuccess();
            } else {
                setStatus(`Foutieve login: ${result.error || 'Onbekende fout'}`);
            }
        } catch (err: any) {
            setStatus('Er ging iets mis: ' + err.message);
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <div className={styles.loginContainer}>
            <div className={styles.card}>
                <h1 className={styles.title}>Untis Meeting Planner</h1>
                <div className={styles.disclaimer}>
                    Deze applicatie is gemaakt door <strong>Tim Dams</strong> en is <strong>géén</strong> officieel product van AP Hogeschool en Untis.
                </div>
                <div className={styles.browserWarning}>
                    Momenteel werkt deze app enkel in <strong>Chrome, Edge en Brave</strong>.<br />
                    Safari wordt nog niet ondersteund (login zal niet lukken).
                </div>
                <form onSubmit={handleLogin} className={styles.form}>
                    <div className={styles.inputGroup}>
                        <User size={20} className={styles.icon} />
                        <input
                            type="text"
                            placeholder="p-nummer (bijv. p123456)"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            disabled={isBusy}
                            required
                        />
                    </div>
                    <div className={styles.inputGroup}>
                        <Lock size={20} className={styles.icon} />
                        <input
                            type="password"
                            placeholder="Wachtwoord"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={isBusy}
                            required
                        />
                    </div>

                    <div className={styles.checkboxGroup}>
                        <label>
                            <input
                                type="checkbox"
                                checked={rememberMe}
                                onChange={e => setRememberMe(e.target.checked)}
                            />
                            Onthoud p-nummer
                        </label>
                    </div>

                    <button type="submit" disabled={isBusy} className={styles.submitBtn}>
                        {isBusy && <Loader2 className="animate-spin" size={16} style={{ marginRight: 8 }} />}
                        {isBusy ? 'Bezig...' : 'Aanmelden'}
                    </button>

                    {status && <div className={clsx(styles.status, status.startsWith('Fout') || status.startsWith('Geen') ? styles.error : styles.success)}>
                        {status}
                    </div>}
                </form>
            </div>
        </div>
    );
}
