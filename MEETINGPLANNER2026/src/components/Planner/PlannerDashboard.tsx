import { useMeetingPlanner } from '../../hooks/useMeetingPlanner';
import { PlannerSidebar } from './PlannerSidebar';
import { WeekView } from './WeekView';
import { Loader2 } from 'lucide-react';
import styles from './PlannerDashboard.module.css';

export function PlannerDashboard() {
    const planner = useMeetingPlanner();

    return (
        <div className={styles.dashboard}>
            <PlannerSidebar
                teachers={planner.teachers}
                classes={planner.classes}
                selectedTeachers={planner.selectedTeachers}
                selectedClasses={planner.selectedClasses}
                onToggleTeacher={planner.toggleTeacher}
                onToggleClass={planner.toggleClass}
            />

            <div className={styles.main}>
                {planner.error && <div className={styles.error}>{planner.error}</div>}

                <div className={styles.toolbar}>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            checked={!planner.searchOnlyInLessonDays}
                            onChange={planner.toggleSearchOnlyInLessonDays}
                        />
                        Ook zoeken in dagen dat klas/lector geen lessen heeft
                    </label>

                    <button
                        onClick={planner.findMeetingOptions}
                        disabled={planner.isBusy || (planner.selectedTeachers.length === 0 && planner.selectedClasses.length === 0)}
                        className={styles.searchBtn}
                    >
                        {planner.isBusy ? <Loader2 className="animate-spin" /> : 'Zoek Vergaderopties'}
                    </button>
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
