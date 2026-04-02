import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FreeSlot, BlockedSlot, BlockedDetail } from '../../hooks/useMeetingPlanner';
import styles from './WeekView.module.css';

interface PopoverData {
    details: BlockedDetail[];
    rect: DOMRect;
}

interface Props {
    weekDate: Date;
    meetingOptions: FreeSlot[];
    blockedSlots: BlockedSlot[];
    onWeekDateChange: (date: Date) => void;
    onSlotClick?: (slot: FreeSlot) => void;
}

export function WeekView({ weekDate, meetingOptions, blockedSlots, onWeekDateChange, onSlotClick }: Props) {
    const [popover, setPopover] = useState<PopoverData | null>(null);
    const hideTimeout = useRef<number | null>(null);

    const showPopover = (details: BlockedDetail[], el: HTMLElement) => {
        if (hideTimeout.current) { clearTimeout(hideTimeout.current); hideTimeout.current = null; }
        setPopover({ details, rect: el.getBoundingClientRect() });
    };

    const scheduleHide = () => {
        hideTimeout.current = window.setTimeout(() => setPopover(null), 200);
    };

    const cancelHide = () => {
        if (hideTimeout.current) { clearTimeout(hideTimeout.current); hideTimeout.current = null; }
    };
    // Helper to get Mon-Fri dates
    const getDays = () => {
        const d = new Date(weekDate);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));

        const days = [];
        for (let i = 0; i < 5; i++) {
            const temp = new Date(monday);
            temp.setDate(monday.getDate() + i);
            days.push(temp);
        }
        return days;
    };

    const days = getDays();

    // Time constants
    const startHour = 8;
    const endHour = 18;
    const totalMinutes = (endHour - startHour) * 60;

    const getPosition = (timeStr: string) => {
        const [h, m] = timeStr.split(':').map(Number);
        const minutesFromStart = (h - startHour) * 60 + m;
        return (minutesFromStart / totalMinutes) * 100;
    };

    const getDuration = (startStr: string, endStr: string) => {
        const [h1, m1] = startStr.split(':').map(Number);
        const [h2, m2] = endStr.split(':').map(Number);
        const diffMinutes = ((h2 * 60) + m2) - ((h1 * 60) + m1);
        return (diffMinutes / totalMinutes) * 100;
    };

    const nextWeek = () => {
        const d = new Date(weekDate);
        d.setDate(d.getDate() + 7);
        onWeekDateChange(d);
    };

    const prevWeek = () => {
        const d = new Date(weekDate);
        d.setDate(d.getDate() - 7);
        onWeekDateChange(d);
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'numeric' });
    };

    const formatWeekRange = () => {
        const m = days[0];
        const f = days[4];
        return `Week van ${m.toLocaleDateString('nl-BE')} tem ${f.toLocaleDateString('nl-BE')}`;
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <button onClick={prevWeek}>&lt;</button>
                <div className={styles.weekTitle}>{formatWeekRange()}</div>
                <button onClick={nextWeek}>&gt;</button>
            </div>

            <div className={styles.grid}>
                <div className={styles.timeColumn}>
                    <div className={styles.dayHeader} style={{ visibility: 'hidden' }}>
                        _
                    </div>
                    <div className={styles.dayContent}>
                        {Array.from({ length: endHour - startHour + 1 }).map((_, i) => (
                            <div key={i} className={styles.timeLabel} style={{ top: `${(i * 60 / totalMinutes) * 100}%` }}>
                                {startHour + i}:00
                            </div>
                        ))}
                    </div>
                </div>

                {days.map(day => {
                    const dateStr = day.toISOString().split('T')[0];
                    const slots = meetingOptions.filter(s => s.day === dateStr);
                    const dayBlocked = blockedSlots.filter(s => s.day === dateStr);

                    return (
                        <div key={dateStr} className={styles.dayColumn}>
                            <div className={styles.dayHeader}>
                                {formatDate(day)}
                            </div>
                            <div className={styles.dayContent}>
                                {/* Grid lines */}
                                {Array.from({ length: endHour - startHour }).map((_, i) => (
                                    <div key={i} className={styles.gridLine} style={{ top: `${(i + 1) * 60 / totalMinutes * 100}%` }} />
                                ))}

                                {/* Blocked slots (behind free slots) */}
                                {dayBlocked.map((bs, idx) => {
                                    const slotKey = `${dateStr}-blocked-${idx}`;
                                    const details = bs.details && bs.details.length > 0 ? bs.details : undefined;

                                    return (
                                        <div
                                            key={slotKey}
                                            className={styles.blockedSlot}
                                            style={{
                                                top: `${getPosition(bs.start)}%`,
                                                height: `${getDuration(bs.start, bs.end)}%`
                                            }}
                                        >
                                            <span className={styles.blockedText}>{bs.reason}</span>
                                            {details && (
                                                <span
                                                    className={styles.infoIcon}
                                                    onMouseEnter={(e) => showPopover(details, e.currentTarget as HTMLElement)}
                                                    onMouseLeave={scheduleHide}
                                                >i</span>
                                            )}
                                        </div>
                                    );
                                })}

                                {/* Free slots */}
                                {slots.map((slot, idx) => (
                                    <div
                                        key={idx}
                                        className={`${styles.slot} ${onSlotClick ? styles.slotClickable : ''}`}
                                        style={{
                                            top: `${getPosition(slot.start)}%`,
                                            height: `${getDuration(slot.start, slot.end)}%`
                                        }}
                                        title={onSlotClick ? `${slot.start} - ${slot.end} — Klik om .ics te downloaden` : `${slot.start} - ${slot.end}`}
                                        onClick={() => onSlotClick?.(slot)}
                                    >
                                        {slot.start} - {slot.end}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Popover portal - renders above everything */}
            {popover && createPortal(
                <div
                    className={styles.blockedPopover}
                    style={{
                        top: popover.rect.bottom + 4,
                        left: popover.rect.left + popover.rect.width / 2,
                    }}
                    onMouseEnter={cancelHide}
                    onMouseLeave={scheduleHide}
                >
                    <div className={styles.popoverTitle}>Roosterdetails</div>
                    {popover.details.map((d, di) => (
                        <div key={di} className={styles.popoverEntry}>
                            <strong>{d.name}</strong>
                            <span className={styles.popoverTime}>{d.start} – {d.end}</span>
                            {d.lessonText && <span>{d.lessonText}</span>}
                            {d.lessonInfo && <span className={styles.popoverInfo}>{d.lessonInfo}</span>}
                            {!d.lessonText && !d.lessonInfo && <span className={styles.popoverInfo}>bezet</span>}
                        </div>
                    ))}
                </div>,
                document.body
            )}

            {/* Mobile List View */}
            <div className={styles.listContainer}>
                {days.map(day => {
                    const dateStr = day.toISOString().split('T')[0];
                    const slots = meetingOptions.filter(s => s.day === dateStr);

                    if (slots.length === 0) {
                        return (
                            <div key={dateStr} className={styles.missingDay}>
                                <div className={styles.listDayHeader}>{formatDate(day)}</div>
                                <div className={styles.missingLabel}>Geen overlappende vrije momenten</div>
                            </div>
                        );
                    }

                    return (
                        <div key={dateStr} className={styles.listDayGroup}>
                            <div className={styles.listDayHeader}>{formatDate(day)}</div>
                            <div className={styles.listSlotsContainer}>
                                {slots.map((slot, idx) => (
                                    <div key={idx} className={styles.listSlot}>
                                        <div
                                            className={`${styles.listTimeBadge} ${onSlotClick ? styles.listTimeBadgeClickable : ''}`}
                                            title={onSlotClick ? 'Klik om .ics te downloaden' : undefined}
                                            onClick={() => onSlotClick?.(slot)}
                                        >
                                            {slot.start} - {slot.end}
                                            {onSlotClick && <span className={styles.downloadHint}>↓ .ics</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
