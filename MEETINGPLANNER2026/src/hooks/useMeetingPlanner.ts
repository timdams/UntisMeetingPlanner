import { useState, useEffect } from 'react';
import { untisService } from '../services/UntisService';
import { Teacher, ClassGroup } from '../types';

export interface PlannerState {
    teachers: Teacher[];
    classes: ClassGroup[];
    selectedTeachers: Teacher[];
    selectedClasses: ClassGroup[];
    weekDate: Date;
    meetingOptions: FreeSlot[];
    isBusy: boolean;
    error: string | null;
    searchOnlyInLessonDays: boolean;
}

export interface FreeSlot {
    day: string; // ISO Date YYYY-MM-DD
    start: string; // HH:mm
    end: string; // HH:mm
}

export function useMeetingPlanner() {
    const [state, setState] = useState<PlannerState>({
        teachers: [],
        classes: [],
        selectedTeachers: [],
        selectedClasses: [],
        weekDate: new Date(),
        meetingOptions: [],
        isBusy: false,
        error: null,
        searchOnlyInLessonDays: true, // Default to strict mode (only days with lessons)
    });

    useEffect(() => {
        loadResources();
    }, []);

    const loadResources = async () => {
        setState(s => ({ ...s, isBusy: true, error: null }));
        try {
            const [teachers, classes] = await Promise.all([
                untisService.getTeachers(),
                untisService.getClasses()
            ]);
            // Sort by display name
            teachers.sort((a, b) => a.displayName.localeCompare(b.displayName));
            classes.sort((a, b) => a.displayName.localeCompare(b.displayName));

            setState(s => ({ ...s, teachers, classes, isBusy: false }));
        } catch (err: any) {
            setState(s => ({ ...s, isBusy: false, error: err.message }));
        }
    };

    const toggleTeacher = (teacher: Teacher) => {
        setState(s => {
            const exists = s.selectedTeachers.find(t => t.id === teacher.id);
            const newList = exists
                ? s.selectedTeachers.filter(t => t.id !== teacher.id)
                : [...s.selectedTeachers, teacher];
            return { ...s, selectedTeachers: newList };
        });
    };

    const toggleClass = (cls: ClassGroup) => {
        setState(s => {
            const exists = s.selectedClasses.find(c => c.id === cls.id);
            const newList = exists
                ? s.selectedClasses.filter(c => c.id !== cls.id)
                : [...s.selectedClasses, cls];
            return { ...s, selectedClasses: newList };
        });
    };

    const setWeekDate = (date: Date) => {
        setState(s => ({ ...s, weekDate: date }));
    };

    const toggleSearchOnlyInLessonDays = () => {
        setState(s => ({ ...s, searchOnlyInLessonDays: !s.searchOnlyInLessonDays }));
    };

    const findMeetingOptions = async () => {
        const { selectedTeachers, selectedClasses, weekDate, searchOnlyInLessonDays } = state;
        if (selectedTeachers.length === 0 && selectedClasses.length === 0) return;

        setState(s => ({ ...s, isBusy: true, error: null, meetingOptions: [] }));

        try {
            // Calculate Monday-Friday range
            const d = new Date(weekDate);
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
            const monday = new Date(d);
            monday.setDate(diff);
            monday.setHours(0, 0, 0, 0); // normalize

            const friday = new Date(monday);
            friday.setDate(monday.getDate() + 4);
            friday.setHours(23, 59, 59, 999);

            const teacherPromises = selectedTeachers.map(t => untisService.getRoster(t.id, 'TEACHER', monday, friday));
            const classPromises = selectedClasses.map(c => untisService.getRoster(c.id, 'CLASS', monday, friday));

            const allRosters = await Promise.all([...teacherPromises, ...classPromises]);

            // Flatten rosters into a single list of objects { type, resourceId, entries: [] }
            // Using mapped structure for validation
            const resourcesData: { resourceId: number, entries: any[] }[] = [];

            let i = 0;
            for (const t of selectedTeachers) {
                resourcesData.push({ resourceId: t.id, entries: allRosters[i] });
                i++;
            }
            for (const c of selectedClasses) {
                resourcesData.push({ resourceId: c.id, entries: allRosters[i] });
                i++;
            }

            const freeSlots: FreeSlot[] = [];

            // Working hours 08:00 - 18:00
            const startHour = 8;
            const endHour = 18;

            for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
                const currentDailyDate = new Date(monday);
                currentDailyDate.setDate(monday.getDate() + dayOffset);

                // Fix: use local YYYY-MM-DD to avoid timezone issues with toISOString()
                // Construct string manually to be safe:
                const year = currentDailyDate.getFullYear();
                const month = String(currentDailyDate.getMonth() + 1).padStart(2, '0');
                const day = String(currentDailyDate.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;

                console.log(`Checking Day: ${dateStr}, Strict: ${searchOnlyInLessonDays}`);

                // 1. Strict Mode Filter
                if (searchOnlyInLessonDays && selectedTeachers.length > 0) {
                    const teachersData = resourcesData.slice(0, selectedTeachers.length);
                    const allHaveLesson = teachersData.every(r =>
                        r.entries.some((e: any) => e.start.startsWith(dateStr))
                    );

                    if (!allHaveLesson) {
                        console.log(`Skipping ${dateStr} - not all teachers have lessons`);
                        continue; // Skip this day
                    }
                }

                // 2. Calculate busy intervals
                const dayStart = new Date(currentDailyDate);
                dayStart.setHours(startHour, 0, 0, 0);
                const dayEnd = new Date(currentDailyDate);
                dayEnd.setHours(endHour, 0, 0, 0);

                const busyIntervals: { start: number, end: number }[] = [];

                for (const res of resourcesData) {
                    for (const entry of res.entries) {
                        const s = new Date(entry.start);
                        const e = new Date(entry.end);

                        // Check if entry falls on this day
                        if (s.getDate() !== currentDailyDate.getDate() || s.getMonth() !== currentDailyDate.getMonth()) {
                            continue;
                        }

                        // Clamp to working hours
                        if (e <= dayStart || s >= dayEnd) continue;

                        const clampedStart = s < dayStart ? dayStart : s;
                        const clampedEnd = e > dayEnd ? dayEnd : e;

                        busyIntervals.push({ start: clampedStart.getTime(), end: clampedEnd.getTime() });
                    }
                }

                console.log(`Busy intervals for ${dateStr}:`, busyIntervals.length);

                // 3. Merge busy intervals
                busyIntervals.sort((a, b) => a.start - b.start);

                const mergedBusy: { start: number, end: number }[] = [];
                for (const b of busyIntervals) {
                    if (mergedBusy.length === 0) {
                        mergedBusy.push(b);
                    } else {
                        const last = mergedBusy[mergedBusy.length - 1];
                        if (b.start < last.end) {
                            // Overlap
                            last.end = Math.max(last.end, b.end);
                        } else {
                            mergedBusy.push(b);
                        }
                    }
                }

                // 4. Invert to finding free slots
                let currentTime = dayStart.getTime();
                const slots: FreeSlot[] = [];

                for (const b of mergedBusy) {
                    if (b.start > currentTime) {
                        // Free slot found
                        slots.push({
                            day: dateStr,
                            start: formatTime(new Date(currentTime)),
                            end: formatTime(new Date(b.start))
                        });
                    }
                    if (b.end > currentTime) {
                        currentTime = b.end;
                    }
                }

                // Final slot after last busy interval
                if (currentTime < dayEnd.getTime()) {
                    slots.push({
                        day: dateStr,
                        start: formatTime(new Date(currentTime)),
                        end: formatTime(dayEnd)
                    });
                }

                freeSlots.push(...slots);
            }

            setState(s => ({ ...s, isBusy: false, meetingOptions: freeSlots }));
        } catch (err: any) {
            console.error(err);
            setState(s => ({ ...s, isBusy: false, error: err.message }));
        }
    };

    const formatTime = (d: Date) => {
        return d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
    };

    return {
        ...state,
        toggleTeacher,
        toggleClass,
        setWeekDate,
        findMeetingOptions,
        loadResources,
        toggleSearchOnlyInLessonDays,
    };
}
