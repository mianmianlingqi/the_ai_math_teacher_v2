import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  SectionType,
  ImportedXmlComponent,
} = require('docx');
const { latexToOMML } = require('latex-to-omml');

const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];
const DEFAULT_FONT = 'Microsoft YaHei';
const MATH_CONVERT_FAILED_TEXT = '【公式转换失败，请检查公式语法】';

const mathXmlCache = new Map();

function escapeXmlTextContent(xml) {
  return String(xml || '').replace(/(<m:t\b[^>]*>)([\s\S]*?)(<\/m:t>)/g, (_, openTag, text, closeTag) => {
    const escapedText = text
      .replace(/&(?!(?:amp|lt|gt|quot|apos);|#[0-9]+;|#x[0-9a-fA-F]+;)/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `${openTag}${escapedText}${closeTag}`;
  });
}

function createPlainParagraph(text, options = {}) {
  return new Paragraph({
    alignment: options.alignment,
    spacing: { after: 160 },
    children: [
      new TextRun({
        text: text || ' ',
        bold: options.bold,
        size: options.size ?? 22,
        color: options.color,
        font: DEFAULT_FONT,
      }),
    ],
  });
}

function createTitle(title) {
  return new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 320 },
    children: [
      new TextRun({
        text: title,
        bold: true,
        size: 36,
        font: DEFAULT_FONT,
      }),
    ],
  });
}

function createSectionHeading(title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 260, after: 220 },
    children: [
      new TextRun({ text: title, bold: true, size: 28, font: DEFAULT_FONT }),
    ],
  });
}

function isEscaped(source, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor--) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findClosingDelimiter(source, startIndex, delimiter) {
  for (let index = startIndex; index < source.length; index++) {
    if (source.startsWith(delimiter, index) && !isEscaped(source, index)) {
      return index;
    }
  }
  return -1;
}

function findNextMathDelimiter(source, startIndex) {
  for (let index = startIndex; index < source.length; index++) {
    if (isEscaped(source, index)) {
      continue;
    }

    if (source.startsWith('$$', index)) {
      return { index, open: '$$', close: '$$', type: 'blockMath' };
    }
    if (source.startsWith('\\[', index)) {
      return { index, open: '\\[', close: '\\]', type: 'blockMath' };
    }
    if (source.startsWith('\\(', index)) {
      return { index, open: '\\(', close: '\\)', type: 'inlineMath' };
    }
    if (source[index] === '$') {
      return { index, open: '$', close: '$', type: 'inlineMath' };
    }
  }
  return null;
}

function tokenizeMathText(text) {
  const source = text || '';
  const tokens = [];
  let lastIndex = 0;

  while (lastIndex < source.length) {
    const delimiter = findNextMathDelimiter(source, lastIndex);
    if (!delimiter) {
      tokens.push({ type: 'text', content: source.slice(lastIndex) });
      break;
    }

    if (delimiter.index > lastIndex) {
      tokens.push({ type: 'text', content: source.slice(lastIndex, delimiter.index) });
    }

    const contentStart = delimiter.index + delimiter.open.length;
    const contentEnd = findClosingDelimiter(source, contentStart, delimiter.close);
    if (contentEnd === -1) {
      tokens.push({ type: 'text', content: source.slice(delimiter.index) });
      break;
    }

    const content = source.slice(contentStart, contentEnd).trim();
    if (content) {
      tokens.push({ type: delimiter.type, content });
    }
    lastIndex = contentEnd + delimiter.close.length;
  }

  if (tokens.length === 0) {
    tokens.push({ type: 'text', content: source });
  }

  return tokens;
}

function normalizeLatexForOmml(latex) {
  return String(latex || '')
    // mathml2omml 对 \left / \right 后再接上标、下标的结构兼容性较差，
    // 例如：\left(...\right)^{\frac{1}{x}} 会触发 “reading 'length'” 异常。
    // 去掉自适应定界符命令后，Word 仍能渲染括号/竖线等定界符，同时避免转换失败。
    .replace(/\\(?:left|right)\s*(\\[a-zA-Z]+|\\[{}[\]()]|[()[\]{}|.]|\\\.)/g, (_, delimiter) => {
      if (delimiter === '.' || delimiter === '\\.') {
        return '';
      }
      return delimiter;
    })
    // mathml2omml 生成的 MathML 在部分场景不会转义字面量 < / >，
    // 尤其是 cases 条件中的 “x < 0”，会导致 docx 解析 XML 时报 Unencoded <。
    // 预先改成 LaTeX 关系命令，既保持数学语义，也保证后续 OMML XML 合法。
    .replace(/</g, '\\lt ')
    .replace(/>/g, '\\gt ')
    .replace(/\\displaystyle\b/g, '')
    .replace(/\\textstyle\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function createMathRun(latex, displayMode) {
  const normalizedLatex = normalizeLatexForOmml(latex);
  const cacheKey = `${displayMode ? 'block' : 'inline'}:${normalizedLatex}`;
  if (!mathXmlCache.has(cacheKey)) {
    const omml = await latexToOMML(normalizedLatex, { displayMode });
    mathXmlCache.set(cacheKey, escapeXmlTextContent(omml));
  }

  const importedComponent = ImportedXmlComponent.fromXmlString(mathXmlCache.get(cacheKey));
  // docx 的 fromXmlString 会返回一个包装节点，直接写入段落会序列化成非法的 <undefined>。
  // 这里取出真实 OMML 根节点，确保 document.xml 中只出现 <m:oMath> / <m:oMathPara> 等合法节点。
  return importedComponent.root?.[0] || importedComponent;
}

async function createRichParagraphs(text, options = {}) {
  const paragraphs = [];
  const children = [];

  const flushParagraph = () => {
    if (children.length === 0) return;
    paragraphs.push(new Paragraph({
      alignment: options.alignment,
      spacing: { after: 160 },
      children: [...children],
    }));
    children.length = 0;
  };

  const pushText = (textSegment) => {
    const lines = textSegment.split('\n');
    lines.forEach((line, index) => {
      if (line) {
        children.push(new TextRun({ text: line, size: 22, font: DEFAULT_FONT }));
      }
      if (index < lines.length - 1) {
        flushParagraph();
      }
    });
  };

  const tokens = tokenizeMathText(`${options.prefix || ''}${text || ''}`);
  for (const token of tokens) {
    if (token.type === 'text') {
      pushText(token.content);
      continue;
    }

    try {
      const mathComponent = await createMathRun(token.content, token.type === 'blockMath');
      if (token.type === 'blockMath') {
        flushParagraph();
        paragraphs.push(new Paragraph({
          alignment: options.alignment,
          spacing: { after: 160 },
          children: [mathComponent],
        }));
      } else {
        children.push(mathComponent);
      }
    } catch (error) {
      options.logger?.warn?.('[wordExport] 公式转换为 OMML 失败', {
        latex: token.content.slice(0, 200),
        displayMode: token.type === 'blockMath',
        error: error?.message || String(error),
      });
      pushText(MATH_CONVERT_FAILED_TEXT);
    }
  }

  flushParagraph();
  return paragraphs.length > 0 ? paragraphs : [createPlainParagraph(' ')];
}

async function createQuestionBlock(item, includeScore, options = {}) {
  const title = includeScore ? `${item.order}.（${item.score} 分）` : `${item.order}.`;
  const paragraphs = [
    new Paragraph({
      spacing: { before: 180, after: 120 },
      children: [new TextRun({ text: title, bold: true, size: 24, font: DEFAULT_FONT })],
    }),
    ...(await createRichParagraphs(item.question, { logger: options.logger })),
  ];

  for (let index = 0; index < item.options.length; index++) {
    const option = item.options[index];
    const optionParagraphs = await createRichParagraphs(option, {
      prefix: `${LABELS[index] ?? index + 1}. `,
      logger: options.logger,
    });
    paragraphs.push(...optionParagraphs);
  }

  return paragraphs;
}

async function createAnswerLookupParagraphs(paper, options = {}) {
  const paragraphs = [createSectionHeading('一、答案速查')];
  for (const item of paper.questions) {
    paragraphs.push(...(await createRichParagraphs(item.answer || '（暂无答案）', {
      prefix: `${item.order}. `,
      logger: options.logger,
    })));
  }
  return paragraphs;
}

async function createDetailedAnswerBlock(item, options = {}) {
  return [
    new Paragraph({
      spacing: { before: 260, after: 140 },
      children: [new TextRun({ text: `第 ${item.order} 题`, bold: true, size: 26, font: DEFAULT_FONT })],
    }),
    ...(await createRichParagraphs(item.question, { prefix: '题目：', logger: options.logger })),
    ...(await createRichParagraphs(item.answer || '（暂无答案）', { prefix: '答案：', logger: options.logger })),
    ...(await createRichParagraphs(item.explanation || '暂无解析。', { prefix: '解析：', logger: options.logger })),
  ];
}

async function buildQuestionPaperDocument(paper, options = {}) {
  const children = [
    createTitle(paper.title),
    createPlainParagraph('姓名：__________    班级：__________    得分：__________'),
    createSectionHeading('一、试题部分'),
  ];

  for (const item of paper.questions) {
    children.push(...(await createQuestionBlock(item, true, options)));
  }

  return new Document({
    sections: [{
      properties: {
        type: SectionType.CONTINUOUS,
        page: { margin: { top: 1134, right: 1247, bottom: 1134, left: 1247 } },
      },
      children,
    }],
  });
}

async function buildAnswerPaperDocument(paper, options = {}) {
  const children = [
    createTitle(`${paper.title} - 答案解析`),
    ...(await createAnswerLookupParagraphs(paper, options)),
    createSectionHeading('二、详细解析'),
  ];

  for (const item of paper.questions) {
    children.push(...(await createDetailedAnswerBlock(item, options)));
  }

  return new Document({
    sections: [{
      properties: {
        type: SectionType.CONTINUOUS,
        page: { margin: { top: 1134, right: 1247, bottom: 1134, left: 1247 } },
      },
      children,
    }],
  });
}

export async function buildPaperWordBuffers(paper, options = {}) {
  if (!paper?.questions?.length) {
    throw new Error('试卷中还没有题目，无法导出 Word。');
  }

  const [questionDoc, answerDoc] = await Promise.all([
    buildQuestionPaperDocument(paper, options),
    buildAnswerPaperDocument(paper, options),
  ]);

  const [questionBuffer, answerBuffer] = await Promise.all([
    Packer.toBuffer(questionDoc),
    Packer.toBuffer(answerDoc),
  ]);

  return { questionBuffer, answerBuffer };
}
