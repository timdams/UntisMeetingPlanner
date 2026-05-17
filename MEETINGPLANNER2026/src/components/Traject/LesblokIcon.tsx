import {
    BookOpen,
    FlaskConical,
    Beaker,
    Lightbulb,
    Users,
    GraduationCap,
    LucideProps,
} from 'lucide-react';
import { ComponentType } from 'react';

type IconCmp = ComponentType<LucideProps>;

export function iconForType(type?: string): IconCmp {
    if (!type) return GraduationCap;
    const t = type.toLowerCase().trim();
    if (t.includes('open lab')) return Beaker;
    if (t.includes('lab')) return FlaskConical;
    if (t.includes('theor')) return BookOpen;
    if (t.includes('project')) return Lightbulb;
    if (t.includes('groep')) return Users;
    return GraduationCap;
}

interface Props {
    type?: string;
    size?: number;
    className?: string;
    strokeWidth?: number;
}

export function LesblokIcon({ type, size = 14, className, strokeWidth = 2 }: Props) {
    const Cmp = iconForType(type);
    const label = type ?? 'les';
    return <Cmp size={size} className={className} strokeWidth={strokeWidth} aria-label={label} />;
}
