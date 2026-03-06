type DiversityComparable = {
  question: string;
  questionType?: string;
  difficulty?: string;
};

export interface DiversityGuardOptions {
  textSimilarityThreshold: number;
  fingerprintSimilarityThreshold: number;
  minimumQuestionLength: number;
}

export interface DiversityCheckResult {
  isDuplicate: boolean;
  score: number;
  reason: 'exact' | 'near-text' | 'near-fingerprint' | 'none';
  matchedQuestion?: string;
}

export const DEFAULT_DIVERSITY_GUARD_OPTIONS: DiversityGuardOptions = {
  textSimilarityThreshold: 0.9,
  fingerprintSimilarityThreshold: 0.82,
  minimumQuestionLength: 12,
};

function normalizeQuestionText(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/\$+/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}\[\]()]/g, ' ')
    .replace(/\d+(?:\.\d+)?/g, '#')
    .replace(/[a-zA-Z]/g, 'v')
    .replace(/[，。、“”‘’：；！？,.!?:;"'`~@#$%&*_+=<>|\\/\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(text: string): string[] {
  if (text.length < 2) return text ? [text] : [];
  const grams: string[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    grams.push(text.slice(i, i + 2));
  }
  return grams;
}

function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  if (aBigrams.length === 0 || bBigrams.length === 0) return 0;

  const countMap = new Map<string, number>();
  aBigrams.forEach((gram) => countMap.set(gram, (countMap.get(gram) || 0) + 1));

  let overlap = 0;
  bBigrams.forEach((gram) => {
    const count = countMap.get(gram) || 0;
    if (count > 0) {
      overlap += 1;
      countMap.set(gram, count - 1);
    }
  });

  return (2 * overlap) / (aBigrams.length + bBigrams.length);
}

function jaccardSimilarityByToken(a: string, b: string): number {
  if (!a || !b) return 0;
  const aSet = new Set(a.split(' ').filter(Boolean));
  const bSet = new Set(b.split(' ').filter(Boolean));
  if (aSet.size === 0 || bSet.size === 0) return 0;

  let intersection = 0;
  aSet.forEach(token => {
    if (bSet.has(token)) intersection += 1;
  });

  const union = aSet.size + bSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function buildQuestionFingerprint(item: DiversityComparable): string {
  const rawQuestion = item.question || '';
  const latexCommands = (rawQuestion.match(/\\[a-zA-Z]+/g) || []).slice(0, 12);
  const operators = rawQuestion
    .replace(/\s+/g, '')
    .replace(/[a-zA-Z]/g, 'v')
    .replace(/\d+(?:\.\d+)?/g, '#')
    .replace(/[^+\-*/^=<>≤≥(){}\[\]|]/g, '')
    .slice(0, 80);
  const lengthBucket = Math.min(9, Math.floor(rawQuestion.length / 30));

  return [
    item.questionType || '未知题型',
    item.difficulty || '未知难度',
    `len${lengthBucket}`,
    latexCommands.join('_') || 'no_cmd',
    operators || 'no_op',
  ].join('|');
}

function jaccardByPipeFingerprint(a: string, b: string): number {
  const aSet = new Set(a.split('|').filter(Boolean));
  const bSet = new Set(b.split('|').filter(Boolean));
  if (aSet.size === 0 || bSet.size === 0) return 0;

  let intersection = 0;
  aSet.forEach((token) => {
    if (bSet.has(token)) intersection += 1;
  });
  const union = aSet.size + bSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function checkProblemNearDuplicate(
  candidate: DiversityComparable,
  existing: DiversityComparable[],
  options: DiversityGuardOptions = DEFAULT_DIVERSITY_GUARD_OPTIONS,
): DiversityCheckResult {
  const candidateNormalized = normalizeQuestionText(candidate.question || '');
  if (candidateNormalized.length < options.minimumQuestionLength) {
    return { isDuplicate: false, score: 0, reason: 'none' };
  }

  const candidateFingerprint = buildQuestionFingerprint(candidate);

  let bestScore = 0;
  let bestQuestion: string | undefined;
  let bestReason: DiversityCheckResult['reason'] = 'none';

  for (const one of existing) {
    const existingNormalized = normalizeQuestionText(one.question || '');
    if (!existingNormalized) continue;

    if (candidateNormalized === existingNormalized) {
      return {
        isDuplicate: true,
        score: 1,
        reason: 'exact',
        matchedQuestion: one.question,
      };
    }

    const textScore = Math.max(
      diceCoefficient(candidateNormalized, existingNormalized),
      jaccardSimilarityByToken(candidateNormalized, existingNormalized),
    );

    const fingerprintScore = jaccardByPipeFingerprint(candidateFingerprint, buildQuestionFingerprint(one));

    if (textScore >= options.textSimilarityThreshold && textScore > bestScore) {
      bestScore = textScore;
      bestQuestion = one.question;
      bestReason = 'near-text';
    }

    if (
      textScore >= 0.72
      && fingerprintScore >= options.fingerprintSimilarityThreshold
      && Math.max(textScore, fingerprintScore) > bestScore
    ) {
      bestScore = Math.max(textScore, fingerprintScore);
      bestQuestion = one.question;
      bestReason = 'near-fingerprint';
    }
  }

  if (bestReason !== 'none') {
    return {
      isDuplicate: true,
      score: bestScore,
      reason: bestReason,
      matchedQuestion: bestQuestion,
    };
  }

  return { isDuplicate: false, score: 0, reason: 'none' };
}
