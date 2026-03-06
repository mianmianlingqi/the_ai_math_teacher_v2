export interface PdfExtractResult {
  text: string;
  pageCount: number;
  charCount: number;
  truncated: boolean;
  scannedLike: boolean;
}

export async function extractPdfText(file: File, maxChars: number = 12000): Promise<PdfExtractResult> {
  const pdfjsLib = await import('pdfjs-dist');
  const raw = await file.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({
    data: raw,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  } as any);

  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const chunks: string[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const onePage = (textContent.items || [])
      .map((item: any) => item?.str || '')
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (onePage) chunks.push(onePage);
  }

  const merged = chunks.join('\n').trim();
  const scannedLike = merged.length === 0;

  if (scannedLike) {
    return {
      text: '',
      pageCount,
      charCount: 0,
      truncated: false,
      scannedLike: true,
    };
  }

  const text = merged.length > maxChars ? merged.slice(0, maxChars) : merged;
  return {
    text,
    pageCount,
    charCount: merged.length,
    truncated: merged.length > maxChars,
    scannedLike: false,
  };
}
