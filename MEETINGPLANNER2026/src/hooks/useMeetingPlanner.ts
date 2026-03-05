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
    blockedSlots: BlockedSlot[];
    isBusy: boolean;
    error: string | null;
    searchOnlyInLessonDays: boolean;
}

export interface FreeSlot {
    day: string; // ISO Date YYYY-MM-DD
    start: string; // HH:mm
    end: string; // HH:mm
}

export interface BlockedSlot {
    day: string; // ISO Date YYYY-MM-DD
    start: string; // HH:mm
    end: string; // HH:mm
    reason: string; // bv. "De Vos bezet" of "De Ridder geen les"
}

export function useMeetingPlanner() {
    const [state, setState] = useState<PlannerState>({
        teachers: [],
        classes: [],
        selectedTeachers: [],
        selectedClasses: [],
        weekDate: new Date(),
        meetingOptions: [],
        blockedSlots: [],
        isBusy: false,
        error: null,
        searchOnlyInLessonDays: true, // Default to strict mode (only days with lessons)
    });

    useEffect(() => {
        loadResources();
    }, []);

    useEffect(() => {
        if (state.selectedTeachers.length > 0 || state.selectedClasses.length > 0) {
            findMeetingOptions();
        } else {
            setState(s => ({ ...s, meetingOptions: [], blockedSlots: [] })); // Clear if empty
        }
    }, [state.selectedTeachers, state.selectedClasses, state.weekDate, state.searchOnlyInLessonDays]);

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

        setState(s => ({ ...s, isBusy: true, error: null, meetingOptions: [], blockedSlots: [] }));

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

            // Build resource list with names for blocked slot attribution
            const resourcesData: { resourceId: number, name: string, entries: any[] }[] = [];

            let i = 0;
            for (const t of selectedTeachers) {
                resourcesData.push({ resourceId: t.id, name: t.displayName, entries: allRosters[i] });
                i++;
            }
            for (const c of selectedClasses) {
                resourcesData.push({ resourceId: c.id, name: c.displayName, entries: allRosters[i] });
                i++;
            }

            const freeSlots: FreeSlot[] = [];
            const blocked: BlockedSlot[] = [];

            // Working hours 08:00 - 18:00
            const startHour = 8;
            const endHour = 18;

            for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
                const currentDailyDate = new Date(monday);
                currentDailyDate.setDate(monday.getDate() + dayOffset);

                // Fix: use local YYYY-MM-DD to avoid timezone issues with toISOString()
                const year = currentDailyDate.getFullYear();
                const month = String(currentDailyDate.getMonth() + 1).padStart(2, '0');
                const day = String(currentDailyDate.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;

                console.log(`Checking Day: ${dateStr}, Strict: ${searchOnlyInLessonDays}`);

                const dayStart = new Date(currentDailyDate);
                dayStart.setHours(startHour, 0, 0, 0);
                const dayEnd = new Date(currentDailyDate);
                dayEnd.setHours(endHour, 0, 0, 0);

                // 1. Strict Mode Filter
                if (searchOnlyInLessonDays && selectedTeachers.length > 0) {
                    const teachersData = resourcesData.slice(0, selectedTeachers.length);
                    const teachersWithoutLessons = teachersData
                        .filter(r => !r.entries.some((e: any) => e.start.startsWith(dateStr)))
                        .map(r => r.name);

                    if (teachersWithoutLessons.length > 0) {
                        console.log(`Skipping ${dateStr} - not all teachers have lessons`);
                        blocked.push({
                            day: dateStr,
                            start: formatTime(dayStart),
                            end: formatTime(dayEnd),
                            reason: formatBlockedReason(teachersWithoutLessons, 'geen les')
                        });
                        continue; // Skip this day
                    }
                }

                // 2. Collect tagged busy intervals (with resource name)
                const taggedBusy: { start: number, end: number, name: string }[] = [];

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

                        taggedBusy.push({ start: clampedStart.getTime(), end: clampedEnd.getTime(), name: res.name });
                    }
                }

                // 3. Merge busy intervals (untagged, for free slot calculation)
                const busyIntervals = taggedBusy.map(b => ({ start: b.start, end: b.end }));
                busyIntervals.sort((a, b) => a.start - b.start);

                const mergedBusy: { start: number, end: number }[] = [];
                for (const b of busyIntervals) {
                    if (mergedBusy.length === 0) {
                        mergedBusy.push({ ...b });
                    } else {
                        const last = mergedBusy[mergedBusy.length - 1];
                        if (b.start < last.end) {
                            last.end = Math.max(last.end, b.end);
                        } else {
                            mergedBusy.push({ ...b });
                        }
                    }
                }

                console.log(`Busy intervals for ${dateStr}:`, taggedBusy.length);

                // 4. Build blocked slots with reason attribution
                for (const mb of mergedBusy) {
                    // Find which resources are busy during this merged interval
                    const busyNames = new Set<string>();
                    for (const tb of taggedBusy) {
                        if (tb.start < mb.end && tb.end > mb.start) {
                            busyNames.add(tb.name);
                        }
                    }
                    blocked.push({
                        day: dateStr,
                        start: formatTime(new Date(mb.start)),
                        end: formatTime(new Date(mb.end)),
                        reason: formatBlockedReason([...busyNames], 'bezet')
                    });
                }

                // 5. Invert to find free slots
                let currentTime = dayStart.getTime();
                const slots: FreeSlot[] = [];

                for (const b of mergedBusy) {
                    if (b.start > currentTime) {
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

                if (currentTime < dayEnd.getTime()) {
                    slots.push({
                        day: dateStr,
                        start: formatTime(new Date(currentTime)),
                        end: formatTime(dayEnd)
                    });
                }

                freeSlots.push(...slots);
            }

            setState(s => ({ ...s, isBusy: false, meetingOptions: freeSlots, blockedSlots: blocked }));
        } catch (err: any) {
            console.error(err);
            setState(s => ({ ...s, isBusy: false, error: err.message }));
        }
    };

    const formatTime = (d: Date) => {
        return d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
    };

    const formatBlockedReason = (names: string[], suffix: string) => {
        if (names.length === 0) return suffix;
        if (names.length === 1) return `${names[0]} ${suffix}`;
        if (names.length === 2) return `${names[0]} en ${names[1]} ${suffix}`;
        const last = names[names.length - 1];
        const rest = names.slice(0, -1).join(', ');
        return `${rest} en ${last} ${suffix}`;
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
