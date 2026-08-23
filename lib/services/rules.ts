import { prisma } from "@/lib/db";
import type { RuleDef } from "@/lib/types";
import type { Rule } from "@prisma/client";

export function toRuleDef(rule: Rule): RuleDef {
  return {
    id: rule.id,
    code: rule.code,
    incidentType: rule.incidentType,
    description: rule.description,
    conditions: JSON.parse(rule.conditionsJson),
    authoritySource: rule.authoritySource,
  };
}

export async function loadRulesFor(incidentType: string): Promise<RuleDef[]> {
  const rows = await prisma.rule.findMany({ where: { incidentType } });
  return rows.map(toRuleDef);
}
