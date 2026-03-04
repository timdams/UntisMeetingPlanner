import { useMeetingPlanner } from '../../hooks/useMeetingPlanner';
import { PlannerSidebar } from './PlannerSidebar';
import { WeekView } from './WeekView';
import { Loader2, Filter } from 'lucide-react';
import styles from './PlannerDashboard.module.css';
import { useState } from 'react';

export function PlannerDashboard() {
    const planner = useMeetingPlanner();
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

    return (
        <div className={styles.dashboard}>
            <PlannerSidebar
                teachers={planner.teachers}
                classes={planner.classes}
                selectedTeachers={planner.selectedTeachers}
                selectedClasses={planner.selectedClasses}
                onToggleTeacher={planner.toggleTeacher}
                onToggleClass={planner.toggleClass}
                isOpenOnMobile={isMobileSidebarOpen}
                onCloseMobile={() => setIsMobileSidebarOpen(false)}
            />

            <div className={styles.main}>
                {planner.error && <div className={styles.error}>{planner.error}</div>}

                <div className={styles.toolbar}>
                    <button
                        className={styles.mobileFilterBtn}
                        onClick={() => setIsMobileSidebarOpen(true)}
                    >
                        <Filter size={18} />
                        Filters & Selectie
                    </button>

                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            checked={!planner.searchOnlyInLessonDays}
                            onChange={planner.toggleSearchOnlyInLessonDays}
                        />
                        Ook zoeken in dagen dat klas/lector geen lessen heeft
                    </label>

                    {planner.isBusy && <Loader2 className="animate-spin text-primary" size={20} />}
                </div>

                <WeekView
                    weekDate={planner.weekDate}
                    meetingOptions={planner.meetingOptions}
                    onWeekDateChange={planner.setWeekDate}
                />
            </div>
        </div>
    );
}
