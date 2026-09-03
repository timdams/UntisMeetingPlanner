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

export interface SavedGroup {
    id: string;
    name: string;
    teacherIds: number[];
    classIds: number[];
}

export interface RosterEntry {
    id: number;
    // Alle entry-ids van Untis (id = ids[0]). Eén les die voor meerdere
    // klasgroepen geldt kan meerdere ids dragen.
    ids?: number[];
    start: string; // ISO DateTime
    end: string;   // ISO DateTime
    // Afgeleid uit de CLASS/TEACHER/ROOM/SUBJECT-posities (position1..5) van
    // de gridEntry. Ontbreekt een positie, dan is de lijst leeg.
    classes: UntisResource[];
    teachers: UntisResource[];
    rooms: UntisResource[];
    subjects: UntisResource[];
    lessonText?: string;  // e.g. "Wiskunde 3A"
    lessonInfo?: string;  // extra info from Untis
    info?: string;        // INFO-type label uit positions, bv. "Theorie", "Labo"
    // Ruwe Untis-velden: `status` (bv. REGULAR, CANCELLED) en `type` van de
    // gridEntry. Niet genormaliseerd — consumenten beslissen zelf wat een
    // afwijkende status betekent.
    status?: string;
    type?: string;
}
