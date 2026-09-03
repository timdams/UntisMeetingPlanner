/**
 * PNG-export van een inline SVG-raster, zonder externe library:
 * XMLSerializer → data-URL → Image → canvas op 2× → Blob → klembord of download.
 *
 * Werkt enkel betrouwbaar met systeemfonts: een webfont (Inter) rendert niet
 * mee in de geserialiseerde SVG, dus het raster gebruikt Arial/Helvetica.
 */

const SCHAAL = 2;

function serialiseer(svg: SVGSVGElement): { xml: string; breedte: number; hoogte: number } {
    const kloon = svg.cloneNode(true) as SVGSVGElement;
    const vb = svg.viewBox.baseVal;
    const breedte = vb && vb.width > 0 ? vb.width : svg.clientWidth || 1000;
    const hoogte = vb && vb.height > 0 ? vb.height : svg.clientHeight || 600;
    kloon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    kloon.setAttribute('width', String(breedte));
    kloon.setAttribute('height', String(hoogte));
    kloon.removeAttribute('style');
    const xml = new XMLSerializer().serializeToString(kloon);
    return { xml, breedte, hoogte };
}

export async function svgNaarPng(svg: SVGSVGElement): Promise<Blob> {
    const { xml, breedte, hoogte } = serialiseer(svg);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('SVG kon niet als afbeelding geladen worden'));
        img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(breedte * SCHAAL);
    canvas.height = Math.round(hoogte * SCHAAL);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas niet beschikbaar');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(SCHAAL, SCHAAL);
    ctx.drawImage(img, 0, 0, breedte, hoogte);
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('PNG aanmaken mislukt'))), 'image/png');
    });
}

/** True wanneer de browser afbeeldingen naar het klembord kan schrijven (Chrome/Edge; Firefox niet). */
export function kanPngKopieren(): boolean {
    return (
        typeof navigator !== 'undefined' &&
        !!navigator.clipboard &&
        typeof navigator.clipboard.write === 'function' &&
        typeof ClipboardItem !== 'undefined'
    );
}

export async function kopieerPng(blob: Blob): Promise<boolean> {
    if (!kanPngKopieren()) return false;
    try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
    } catch {
        return false;
    }
}

export function downloadBlob(blob: Blob, bestandsnaam: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = bestandsnaam;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Veilige bestandsnaam: letters, cijfers, streepjes. */
export function bestandsnaam(...delen: string[]): string {
    const schoon = delen
        .map(d =>
            d
                .normalize('NFD')
                .replace(/\p{M}/gu, '')
                .replace(/[^A-Za-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
        )
        .filter(Boolean)
        .join('_');
    return `${schoon || 'examenoverzicht'}.png`;
}
