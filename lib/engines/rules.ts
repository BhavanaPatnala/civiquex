// ---------------------------------------------------------------------------
// Context / Rule Engine
//
// Core product principle: computer vision NEVER independently decides
// legality. A detection only becomes a "potential violation" after being
// gated through geospatial + temporal + regulatory context. The same visual
// scene (a parked vehicle) is legal at one place/time and prohibited at
// another — this module is where that distinction actually happens.
//
//   VISION  +  GEOSPATIAL REASONING  +  TEMPORAL REASONING  +  RULE KNOWLEDGE
//                              -> POTENTIAL VIOLATION | INSUFFICIENT | NEEDS VERIFICATION
// ---------------------------------------------------------------------------

import type {
  DetectionLike,
  RoadSegmentContext,
  RuleDef,
  RuleVerdict,
} from "@/lib/types";

export interface RuleEvaluationInput {
  incidentType: string;
  capturedAt: Date;
  roadSegment: RoadSegmentContext | null;
  detections: DetectionLike[];
  visualQuality: number;
  candidateRules: RuleDef[];
}

export interface RuleEvaluationResult {
  verdict: RuleVerdict;
  matchedRule: RuleDef | null;
  ruleConfidence: number; // 0-1
  reasoning: string;
  contextChecks: { label: string; passed: boolean; detail: string }[];
}

function timeWindowMatches(rule: RuleDef, at: Date): { matches: boolean; detail: string } {
  const windows = rule.conditions.timeWindows;
  if (!windows || windows.length === 0) return { matches: true, detail: "No time restriction on this rule" };

  const hour = at.getHours() + at.getMinutes() / 60;
  const day = at.getDay();

  for (const w of windows) {
    const dayOk = !w.days || w.days.includes(day);
    const hourOk =
      w.startHour <= w.endHour
        ? hour >= w.startHour && hour < w.endHour
        : hour >= w.startHour || hour < w.endHour; // window crosses midnight
    if (dayOk && hourOk) {
      return { matches: true, detail: `Within restricted window ${w.startHour}:00–${w.endHour}:00` };
    }
  }
  return {
    matches: false,
    detail: `Captured at ${at.getHours()}:${String(at.getMinutes()).padStart(2, "0")}, outside all restricted windows for this rule`,
  };
}

export function evaluateRule(input: RuleEvaluationInput): RuleEvaluationResult {
  const { incidentType, capturedAt, roadSegment, detections, visualQuality, candidateRules } = input;

  const applicableRules = candidateRules.filter((r) => r.incidentType === incidentType);

  const avgDetectionConfidence =
    detections.length === 0
      ? 0
      : detections.reduce((s, d) => s + d.confidence, 0) / detections.length;

  const contextChecks: RuleEvaluationResult["contextChecks"] = [];

  if (applicableRules.length === 0) {
    contextChecks.push({
      label: "Codified rule lookup",
      passed: false,
      detail: `No codified rule found for incident type "${incidentType}" in the rule knowledge base`,
    });
    return {
      verdict: "requires_verification",
      matchedRule: null,
      ruleConfidence: 0.35,
      reasoning:
        "No matching regulation was found for this incident type at this location. Flagged for manual authority review rather than an automated verdict.",
      contextChecks,
    };
  }

  if (visualQuality < 0.55 || avgDetectionConfidence < 0.5) {
    contextChecks.push({
      label: "Visual evidence quality",
      passed: false,
      detail: `Visual quality ${(visualQuality * 100).toFixed(0)}%, avg detection confidence ${(avgDetectionConfidence * 100).toFixed(0)}% — below the threshold to reason about further`,
    });
    return {
      verdict: "evidence_insufficient",
      matchedRule: null,
      ruleConfidence: 0.3,
      reasoning: "Visual evidence quality is too low to reliably support rule evaluation. More or clearer observations are needed.",
      contextChecks,
    };
  }
  contextChecks.push({
    label: "Visual evidence quality",
    passed: true,
    detail: `Visual quality ${(visualQuality * 100).toFixed(0)}%, avg detection confidence ${(avgDetectionConfidence * 100).toFixed(0)}%`,
  });

  let best: { rule: RuleDef; score: number; checks: typeof contextChecks } | null = null;

  for (const rule of applicableRules) {
    const localChecks: typeof contextChecks = [];
    let score = 0.5;

    const tw = timeWindowMatches(rule, capturedAt);
    localChecks.push({ label: `Temporal window (${rule.code})`, passed: tw.matches, detail: tw.detail });
    score += tw.matches ? 0.2 : -0.35;

    if (rule.conditions.roadClasses && rule.conditions.roadClasses.length > 0) {
      const roadClassOk = roadSegment ? rule.conditions.roadClasses.includes(roadSegment.roadClass) : false;
      localChecks.push({
        label: `Road class (${rule.code})`,
        passed: roadClassOk,
        detail: roadSegment
          ? `Road segment "${roadSegment.name}" is class "${roadSegment.roadClass}"`
          : "No road segment matched to this location",
      });
      score += roadClassOk ? 0.15 : -0.25;
    }

    if (rule.conditions.requiresSchoolNearby) {
      const ok = !!roadSegment?.schoolNearby;
      localChecks.push({
        label: `School proximity (${rule.code})`,
        passed: ok,
        detail: ok ? "School zone confirmed near this location" : "No school zone registered near this location",
      });
      score += ok ? 0.15 : -0.3;
    }

    if (rule.conditions.requiresHospitalNearby) {
      const ok = !!roadSegment?.hospitalNearby;
      localChecks.push({
        label: `Hospital / emergency-access proximity (${rule.code})`,
        passed: ok,
        detail: ok ? "Hospital / emergency access point confirmed nearby" : "No hospital or emergency access point nearby",
      });
      score += ok ? 0.15 : -0.3;
    }

    const minConf = rule.conditions.minVisualConfidence ?? 0.5;
    const confOk = avgDetectionConfidence >= minConf;
    localChecks.push({
      label: `Minimum visual confidence (${rule.code})`,
      passed: confOk,
      detail: `Requires ${(minConf * 100).toFixed(0)}%, observed ${(avgDetectionConfidence * 100).toFixed(0)}%`,
    });
    score += confOk ? 0.1 : -0.2;

    score = Math.max(0, Math.min(1, score));

    if (!best || score > best.score) {
      best = { rule, score, checks: localChecks };
    }
  }

  if (!best) {
    return {
      verdict: "requires_verification",
      matchedRule: null,
      ruleConfidence: 0.3,
      reasoning: "Rule evaluation inconclusive.",
      contextChecks,
    };
  }

  contextChecks.push(...best.checks);

  if (best.score >= 0.72) {
    return {
      verdict: "potential_violation",
      matchedRule: best.rule,
      ruleConfidence: best.score,
      reasoning: `Context matches rule ${best.rule.code} (${best.rule.description}). This is a potential violation, not a confirmed one — final determination rests with ${best.rule.authoritySource}.`,
      contextChecks,
    };
  }

  if (best.score >= 0.45) {
    return {
      verdict: "requires_verification",
      matchedRule: best.rule,
      ruleConfidence: best.score,
      reasoning: `Partial match against rule ${best.rule.code}, but one or more contextual conditions were not confirmed. Requires additional observation or manual verification before treating as a violation.`,
      contextChecks,
    };
  }

  return {
    verdict: "evidence_insufficient",
    matchedRule: best.rule,
    ruleConfidence: best.score,
    reasoning: `Context does not support rule ${best.rule.code} at this time/location — the same visual scene would be legal here. No violation is asserted.`,
    contextChecks,
  };
}
