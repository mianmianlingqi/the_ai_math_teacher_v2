export interface PdfExtractResult {
  text: string;
  pageCount: number;
  charCount: number;
  truncated: boolean;
  scannedLike: boolean;
}

export interface PdfConversionResult {
  text: string;
  truncated: boolean;
  scannedLike: boolean;
  encoding: 'MarkItDown' | 'PDF.js';
  fallbackMessage?: string;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('读取 PDF 文件失败'));
    reader.readAsDataURL(file);
  });
}

async function readFileAsBase64(file: File): Promise<string> {
  const dataUrl = await readFileAsDataURL(file);
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

export async function convertPdfToMarkdown(file: File, maxChars: number = 12000): Promise<PdfConversionResult> {
  try {
    const response = await fetch('/api/convert-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name || 'upload.pdf',
        dataBase64: await readFileAsBase64(file),
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data?.success || !data?.markdown) {
      throw new Error(data?.error || 'markitdown 转换失败');
    }

    const originalText = String(data.markdown || '');
    const truncated = originalText.length > maxChars;
    return {
      text: truncated ? originalText.slice(0, maxChars) : originalText,
      truncated,
      scannedLike: false,
      encoding: 'MarkItDown',
    };
  } catch (error: any) {
    const pdf = await extractPdfText(file, maxChars);
    return {
      text: pdf.text,
      truncated: pdf.truncated,
      scannedLike: pdf.scannedLike,
      encoding: 'PDF.js',
      fallbackMessage: error?.message || 'MarkItDown 转换失败',
    };
  }
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
