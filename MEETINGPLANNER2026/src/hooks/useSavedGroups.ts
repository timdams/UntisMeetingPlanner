import { useState, useEffect } from 'react';
import { SavedGroup, Teacher, ClassGroup } from '../types';

const STORAGE_KEY = 'untis_saved_groups';

function loadGroups(): SavedGroup[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function persistGroups(groups: SavedGroup[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
}

export function useSavedGroups() {
    const [groups, setGroups] = useState<SavedGroup[]>(loadGroups);

    // Sync state to localStorage on every change
    useEffect(() => {
        persistGroups(groups);
    }, [groups]);

    const saveGroup = (name: string, teachers: Teacher[], classes: ClassGroup[]) => {
        const newGroup: SavedGroup = {
            id: Date.now().toString(36),
            name,
            teacherIds: teachers.map(t => t.id),
            classIds: classes.map(c => c.id),
        };
        setGroups(prev => [...prev, newGroup]);
    };

    const deleteGroup = (id: string) => {
        setGroups(prev => prev.filter(g => g.id !== id));
    };

    return { groups, saveGroup, deleteGroup };
}
