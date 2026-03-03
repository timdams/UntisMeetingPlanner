export interface UntisResource {
    id: number;
    shortName: string;
    longName: string;
    displayName: string;
}

export interface Teacher extends UntisResource {
}

export interface ClassGroup extends UntisResource {
}

export interface Room extends UntisResource {
}

export interface Subject extends UntisResource {
}

export interface RosterData {
    format: number;
    days: Day[];
    errors: any[];
}

export interface Day {
    date: string; // YYYY-MM-DD
    resourceType: string;
    resource: UntisResource;
    status: string;
    dayEntries: any[];
    gridEntries: GridEntry[]; // This is what we need
}

export interface GridEntry {
    ids: number[];
    duration: { start: string, end: string }; // HH:mm
    type: string; // "ls" (lesson)
    status: string;
    lessonText: string;
    lessonInfo: string;
    // ... other fields as needed
}

export interface RosterEntry {
    id: number;
    start: string; // ISO DateTime
    end: string;   // ISO DateTime
    classes: UntisResource[];
    teachers: UntisResource[];
    rooms: UntisResource[];
    subjects: UntisResource[];
}
