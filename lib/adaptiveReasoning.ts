/**
 * Adaptive Reasoning Engine
 * Determines the optimal GPT-5 model configuration based on message complexity and risk.
 */

import OpenAI from 'openai';
import crypto from 'crypto';

// --- Types ---
export interface ReasoningDecision {
    model: string;
    reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    is_thinking: boolean;
    mode: 'instant' | 'instant_plus' | 'thinking' | 'professional' | 'safety';
    suggestion_text?: string;
    log_data: DecisionLogData;
}

export interface DecisionLogData {
    text_hash: string;
    step2_breakdown: {
        length: number;
        date_count: number;
        has_attachment: boolean;
        level_a_hit: boolean;
        level_b_hit: boolean;
        lead_hit: boolean;
    };
    llm_result?: {
        soft_score: number;
        risk: 'low' | 'medium' | 'high';
        booking_recommended: boolean;
    };
    final_decision: {
        total_score: number;
        mode: string;
        model: string;
        effort?: string;
    };
    latency: {
        classifier_ms: number;
        main_ms?: number;
        total_ms?: number;
    };
}

// --- Constants: Keyword Patterns ---
const LEVEL_A_PATTERN = /簡易課税|インボイス|課税事業者|源泉徴収|給与|外注|扶養|社保|36協定|解雇|残業代|労基|違法|脱税|契約書|就業規則|訴訟|裁判|調査/;
const LEVEL_B_PATTERN = /税|経費|確定申告|控除|申告|年末調整/;
const LEAD_PATTERN = /予約|料金|アクセス|導入/;
const DATE_PATTERN = /\d{4}[\/年]\d{1,2}[\/月]\d{1,2}日?|\d{1,2}月\d{1,2}日/g;

// --- Scoring Constants ---
const SCORE_LEVEL_A = 999;
const SCORE_LEVEL_B = 3;
const SCORE_LEAD_REDUCTION = -3;
const SCORE_LONG_TEXT = 2;
const SCORE_MULTIPLE_DATES = 2;
const SCORE_ATTACHMENT = 5;
const TEXT_LENGTH_THRESHOLD = 600;

// --- Decision Thresholds ---
const THRESHOLD_INSTANT_PLUS = 4;
const THRESHOLD_THINKING = 8;
const THRESHOLD_PROFESSIONAL = 12;

// --- Suggestion Template ---
const BOOKING_SUGGESTION = 'この内容は前提が多いので、15分対談の方が安全に早いです。予約しますか？（チャットで続けることもできます）';

/**
 * Main entry point: Determine the reasoning mode for a given message.
 */
export async function determineReasoningMode(
    text: string,
    tenantBaseModel: string,
    openaiApiKey: string,
    hasAttachment: boolean = false
): Promise<ReasoningDecision> {
    const startTime = Date.now();
    const textHash = crypto.createHash('sha256').update(text).digest('hex').substring(0, 16);

    // --- Step 1: Level A Check (Hard Rule - Highest Priority) ---
    const levelAHit = LEVEL_A_PATTERN.test(text);
    if (levelAHit) {
        const logData = buildLogData(textHash, text, hasAttachment, true, false, false, undefined, SCORE_LEVEL_A, 'safety', tenantBaseModel, 'high', Date.now() - startTime);
        return {
            model: resolveModel(tenantBaseModel, 'safety'),
            reasoning_effort: 'high',
            is_thinking: true,
            mode: 'safety',
            log_data: logData
        };
    }

    // --- Step 2: Calculate Base Score ---
    let step2Score = 0;
    const levelBHit = LEVEL_B_PATTERN.test(text);
    const leadHit = LEAD_PATTERN.test(text);
    const dateMatches = text.match(DATE_PATTERN) || [];

    if (levelBHit) step2Score += SCORE_LEVEL_B;
    if (text.length > TEXT_LENGTH_THRESHOLD) step2Score += SCORE_LONG_TEXT;
    if (dateMatches.length >= 2) step2Score += SCORE_MULTIPLE_DATES;
    if (hasAttachment) step2Score += SCORE_ATTACHMENT;

    // Lead reduction: Only if NOT Level B hit
    if (leadHit && !levelBHit) {
        step2Score += SCORE_LEAD_REDUCTION;
    }

    // Ensure score is not negative
    step2Score = Math.max(0, step2Score);

    // --- Step 3: LLM Classification ---
    let llmResult: { soft_score: number; risk: 'low' | 'medium' | 'high'; booking_recommended: boolean } | undefined;
    let classifierLatency = 0;

    try {
        const classifierStart = Date.now();
        llmResult = await classifyWithLLM(text, step2Score, openaiApiKey);
        classifierLatency = Date.now() - classifierStart;
    } catch (e) {
        console.error('[AdaptiveReasoning] LLM classification failed, using rule-based only:', e);
        classifierLatency = Date.now() - startTime;
    }

    // --- Step 4: Calculate Final Score ---
    let finalSoftScore = 0;
    if (llmResult) {
        // Apply weighting and capping
        let cappedScore = llmResult.soft_score;
        if (llmResult.risk === 'low') cappedScore = Math.min(cappedScore, 4);
        else if (llmResult.risk === 'medium') cappedScore = Math.min(cappedScore, 7);
        finalSoftScore = Math.round(cappedScore * 0.7);
    }

    const totalScore = step2Score + finalSoftScore;

    // --- Step 5: Determine Mode ---
    let mode: ReasoningDecision['mode'];
    let effort: ReasoningDecision['reasoning_effort'];
    let suggestionText: string | undefined;

    if (totalScore >= THRESHOLD_PROFESSIONAL) {
        mode = 'professional';
        effort = 'high'; // Could use 'xhigh' for extreme cases
        suggestionText = BOOKING_SUGGESTION;
    } else if (totalScore >= THRESHOLD_THINKING) {
        mode = 'thinking';
        effort = 'high';
    } else if (totalScore >= THRESHOLD_INSTANT_PLUS) {
        mode = 'instant_plus';
        effort = 'medium';
    } else {
        mode = 'instant';
        effort = 'minimal';
    }

    const model = resolveModel(tenantBaseModel, mode);
    const logData = buildLogData(
        textHash, text, hasAttachment, false, levelBHit, leadHit,
        llmResult, totalScore, mode, model, effort, classifierLatency
    );

    return {
        model,
        reasoning_effort: effort,
        is_thinking: totalScore >= THRESHOLD_THINKING || totalScore === SCORE_LEVEL_A,
        mode,
        suggestion_text: suggestionText,
        log_data: logData
    };
}

/**
 * Resolve the actual model ID based on tenant's base model and decision mode.
 */
function resolveModel(baseModel: string, mode: ReasoningDecision['mode']): string {
    // GPT-5 mini handling
    if (baseModel === 'gpt-5-mini') {
        return 'gpt-5-mini'; // Same model, effort changes
    }

    // GPT-5.1 handling
    if (baseModel === 'gpt-5.1' || baseModel === 'gpt-5.1-chat-latest') {
        if (mode === 'instant' || mode === 'instant_plus') {
            return 'gpt-5.1-chat-latest';
        }
        return 'gpt-5.1';
    }

    // GPT-5.2 handling
    if (baseModel === 'gpt-5.2' || baseModel === 'gpt-5.2-chat-latest') {
        if (mode === 'instant' || mode === 'instant_plus') {
            return 'gpt-5.2-chat-latest';
        }
        return 'gpt-5.2';
    }

    // Fallback: return base model as-is
    return baseModel;
}

/**
 * Lightweight LLM classification using GPT-4o-mini.
 */
async function classifyWithLLM(
    text: string,
    currentScore: number,
    apiKey: string
): Promise<{ soft_score: number; risk: 'low' | 'medium' | 'high'; booking_recommended: boolean }> {
    const openai = new OpenAI({ apiKey });

    const systemPrompt = `You are a message complexity classifier. Analyze the user's message and return a JSON object with:
- "soft_score": 0-10, how complex/risky is the inquiry (0=simple chat, 10=requires expert review)
- "risk": "low" | "medium" | "high"
- "booking_recommended": boolean, true if a live consultation would be significantly safer/faster

Consider: numerical calculations, legal/tax implications, multi-step conditions, assertions requested, missing information.
Current rule-based score: ${currentScore}. Factor this in but make independent judgment.
Respond ONLY with valid JSON, no explanation.`;

    const response = await openai.chat.completions.create({
        model: 'gpt-5-nano',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text.substring(0, 1000) } // Truncate for speed
        ],
        temperature: 0.1,
        max_tokens: 100
    });

    const content = response.choices[0].message.content || '{}';
    try {
        const parsed = JSON.parse(content);
        return {
            soft_score: Math.min(10, Math.max(0, parsed.soft_score || 0)),
            risk: ['low', 'medium', 'high'].includes(parsed.risk) ? parsed.risk : 'low',
            booking_recommended: !!parsed.booking_recommended
        };
    } catch {
        return { soft_score: 0, risk: 'low', booking_recommended: false };
    }
}

/**
 * Build structured log data for analytics.
 */
function buildLogData(
    textHash: string,
    text: string,
    hasAttachment: boolean,
    levelAHit: boolean,
    levelBHit: boolean,
    leadHit: boolean,
    llmResult: { soft_score: number; risk: 'low' | 'medium' | 'high'; booking_recommended: boolean } | undefined,
    totalScore: number,
    mode: string,
    model: string,
    effort: string | undefined,
    classifierMs: number
): DecisionLogData {
    const dateMatches = text.match(DATE_PATTERN) || [];
    return {
        text_hash: textHash,
        step2_breakdown: {
            length: text.length,
            date_count: dateMatches.length,
            has_attachment: hasAttachment,
            level_a_hit: levelAHit,
            level_b_hit: levelBHit,
            lead_hit: leadHit
        },
        llm_result: llmResult,
        final_decision: {
            total_score: totalScore,
            mode,
            model,
            effort
        },
        latency: {
            classifier_ms: classifierMs
        }
    };
}
