export type LesblokType = "theorie" | "lab";

export interface Lesblok {
    klasgroep: string;
    olodNaam: string;
    type: LesblokType;
    start: Date;
    eind: Date;
    lokaal?: string;
}

export interface OLODSelectie {
    klasgroep: string;
    olodNaam: string;
}

export type StudentTraject = OLODSelectie[];

export interface TrajectSettings {
    mijnOpleidingKlasgroepen: string[];
    semesterStart: string;
    semesterEind: string;
}

export type KleurMap = Record<string, string>;

export interface Conflict {
    a: Lesblok;
    b: Lesblok;
}

export interface TrajectUntisService {
    getKlasgroepen(): Promise<string[]>;
    getLesblokken(klasgroep: string, van: Date, tot: Date): Promise<Lesblok[]>;
}
