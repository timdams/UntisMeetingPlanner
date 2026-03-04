import { useState } from 'react';
import { Teacher, ClassGroup } from '../../types';
import { Search, ChevronDown, ChevronRight, User, Users, X } from 'lucide-react';
import clsx from 'clsx';
import styles from './PlannerSidebar.module.css';

interface Props {
    teachers: Teacher[];
    classes: ClassGroup[];
    selectedTeachers: Teacher[];
    selectedClasses: ClassGroup[];
    onToggleTeacher: (t: Teacher) => void;
    onToggleClass: (c: ClassGroup) => void;
    isOpenOnMobile: boolean;
    onCloseMobile: () => void;
}

export function PlannerSidebar({
    teachers, classes,
    selectedTeachers, selectedClasses,
    onToggleTeacher, onToggleClass,
    isOpenOnMobile, onCloseMobile
}: Props) {
    const [query, setQuery] = useState('');
    const [expandTeachers, setExpandTeachers] = useState(true);
    const [expandClasses, setExpandClasses] = useState(false);

    const filteredTeachers = teachers.filter(t =>
        t.displayName.toLowerCase().includes(query.toLowerCase()) ||
        t.longName.toLowerCase().includes(query.toLowerCase())
    );

    const filteredClasses = classes.filter(c =>
        c.displayName.toLowerCase().includes(query.toLowerCase()) ||
        c.longName.toLowerCase().includes(query.toLowerCase())
    );

    const hasSelection = selectedTeachers.length > 0 || selectedClasses.length > 0;

    return (
        <>
            {/* Mobile Backdrop */}
            {isOpenOnMobile && (
                <div className={styles.backdrop} onClick={onCloseMobile} />
            )}
            <div className={clsx(styles.sidebar, isOpenOnMobile && styles.openOnMobile)}>
                <div className={styles.mobileHeader}>
                    <span className={styles.mobileTitle}>Filters & Selectie</span>
                    <button className={styles.closeBtn} onClick={onCloseMobile}>
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.searchBox}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        type="text"
                        placeholder="Zoek leerkracht of klas..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        className={styles.searchInput}
                    />
                </div>

                {hasSelection && (
                    <div className={styles.selectedSection}>
                        <div className={styles.selectedHeader}>Geselecteerd</div>
                        <div className={styles.chips}>
                            {selectedTeachers.map(t => (
                                <button key={t.id} className={styles.chip} onClick={() => onToggleTeacher(t)}>
                                    <User size={12} className="mr-1" />
                                    {t.displayName}
                                    <span className={styles.remove}>×</span>
                                </button>
                            ))}
                            {selectedClasses.map(c => (
                                <button key={c.id} className={styles.chip} onClick={() => onToggleClass(c)}>
                                    <Users size={12} className="mr-1" />
                                    {c.displayName}
                                    <span className={styles.remove}>×</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className={styles.scrollArea}>
                    <div className={styles.section}>
                        <button className={styles.sectionHeader} onClick={() => setExpandTeachers(!expandTeachers)}>
                            {expandTeachers ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            <User size={16} className="mr-2" />
                            Leerkrachten ({filteredTeachers.length})
                        </button>
                        {expandTeachers && (
                            <div className={styles.list}>
                                {filteredTeachers.map(t => (
                                    <label key={t.id} className={clsx(styles.item, selectedTeachers.find(x => x.id === t.id) && styles.selected)}>
                                        <input
                                            type="checkbox"
                                            checked={!!selectedTeachers.find(x => x.id === t.id)}
                                            onChange={() => onToggleTeacher(t)}
                                        />
                                        <span className={styles.label}>{t.displayName}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className={styles.section}>
                        <button className={styles.sectionHeader} onClick={() => setExpandClasses(!expandClasses)}>
                            {expandClasses ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            <Users size={16} className="mr-2" />
                            Klassen ({filteredClasses.length})
                        </button>
                        {expandClasses && (
                            <div className={styles.list}>
                                {filteredClasses.map(c => (
                                    <label key={c.id} className={clsx(styles.item, selectedClasses.find(x => x.id === c.id) && styles.selected)}>
                                        <input
                                            type="checkbox"
                                            checked={!!selectedClasses.find(x => x.id === c.id)}
                                            onChange={() => onToggleClass(c)}
                                        />
                                        <span className={styles.label}>{c.displayName}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
