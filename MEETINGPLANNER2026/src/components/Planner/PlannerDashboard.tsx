import { useMeetingPlanner, FreeSlot } from '../../hooks/useMeetingPlanner';
import { PlannerSidebar } from './PlannerSidebar';
import { WeekView } from './WeekView';
import { Loader2, Filter, Info } from 'lucide-react';
import styles from './PlannerDashboard.module.css';
import { useState } from 'react';
import { Teacher } from '../../types';

function generateIcs(slot: FreeSlot, teachers: Teacher[]): string {
    const uid = `meeting-${slot.day}-${slot.start.replace(':', '')}-${Date.now()}@untisMeetingPlanner`;
    const dateFormatted = slot.day.replace(/-/g, '');
    const startFormatted = slot.start.replace(':', '') + '00';
    const endFormatted = slot.end.replace(':', '') + '00';
    const dtstamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
    const names = teachers.map(t => t.displayName);
    const summary = names.length > 0 ? `Meeting: ${names.join(', ')}` : 'Meeting';
    const description = names.length > 0 ? `Genodigden: ${names.join('\\, ')}` : '';

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//UntisMeetingPlanner//NL',
        'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=Europe/Brussels:${dateFormatted}T${startFormatted}`,
        `DTEND;TZID=Europe/Brussels:${dateFormatted}T${endFormatted}`,
        `SUMMARY:${summary}`,
    ];
    if (description) lines.push(`DESCRIPTION:${description}`);
    lines.push('END:VEVENT', 'END:VCALENDAR');

    return lines.join('\r\n');
}

function downloadIcs(slot: FreeSlot, teachers: Teacher[]) {
    const content = generateIcs(slot, teachers);
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-${slot.day}-${slot.start.replace(':', '')}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

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

                <div className={styles.infoBanner}>
                    <Info size={18} className={styles.infoIcon} />
                    <span><strong>Info:</strong> Rode blokken tonen momenten wanneer alle geselecteerde collega's en klassen vrij zijn volgens hun rooster om ingepland te worden.</span>
                </div>

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
                    blockedSlots={planner.blockedSlots}
                    onWeekDateChange={planner.setWeekDate}
                    onSlotClick={(slot) => downloadIcs(slot, planner.selectedTeachers)}
                />
            </div>
        </div>
    );
}
