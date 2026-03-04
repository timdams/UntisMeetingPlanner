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
    const [debugInfo, setDebugInfo] = useState<any>(null);

    const downloadDebugInfo = () => {
        if (!debugInfo) return;
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(debugInfo, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `untis_debug_${new Date().getTime()}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

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

        let cleanUsername = username.trim();
        if (cleanUsername.toLowerCase().endsWith('@ap.be')) {
            cleanUsername = cleanUsername.slice(0, -6);
        }

        if (cleanUsername.includes('.')) {
            setStatus("Gebruik je pnummer, niet je naam (geen puntjes).");
            return;
        }

        setIsBusy(true);
        setStatus('Aanmelden...');

        try {
            // Append domain to username as expected by the API
            const apiUser = cleanUsername + "@ap.be";
            const result = await untisService.login(apiUser, password);
            if (result.success) {
                setStatus('Ingelogd.');
                setDebugInfo(null);
                if (rememberMe) {
                    localStorage.setItem('untis_user', cleanUsername);
                } else {
                    localStorage.removeItem('untis_user');
                }
                onLoginSuccess();
            } else {
                setStatus(`Foutieve login: ${result.error || 'Onbekende fout'}`);
                setDebugInfo({
                    timestamp: new Date().toISOString(),
                    usernameAttempt: apiUser,
                    error: result.error,
                    userAgent: navigator.userAgent,
                    localStorageLength: localStorage.length
                });
            }
        } catch (err: any) {
            setStatus('Er ging iets mis: ' + err.message);
            setDebugInfo({
                timestamp: new Date().toISOString(),
                usernameAttempt: cleanUsername + "@ap.be",
                exception: err.message,
                stack: err?.stack,
                userAgent: navigator.userAgent,
                localStorageLength: localStorage.length
            });
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

                    {status && <div className={clsx(styles.status, status.startsWith('Fout') || status.startsWith('Geen') || status.startsWith('Er ging') ? styles.error : styles.success)}>
                        {status}
                    </div>}

                    {debugInfo && (
                        <button type="button" onClick={downloadDebugInfo} className={styles.debugBtn}>
                            Problemen met inloggen? Download Debug Info
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
}
