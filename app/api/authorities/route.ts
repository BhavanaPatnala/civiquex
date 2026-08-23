import { prisma } from "@/lib/db";
import { ok, withApiHandler } from "@/lib/api/respond";

export const GET = withApiHandler(async () => {
  const authorities = await prisma.authority.findMany({
    include: { _count: { select: { incidents: true, submissions: true } } },
    orderBy: { name: "asc" },
  });

  return ok(
    authorities.map((a) => ({
      id: a.id,
      name: a.name,
      jurisdiction: a.jurisdiction,
      supportedIncidentTypes: JSON.parse(a.supportedIncidentTypesJson),
      officialUrl: a.officialUrl,
      apiAvailable: a.apiAvailable,
      apiDocumentation: a.apiDocumentation,
      submissionMethod: a.submissionMethod,
      authenticationMethod: a.authenticationMethod,
      requiredFields: JSON.parse(a.requiredFieldsJson),
      evidenceRequirements: a.evidenceRequirements,
      escalationMethod: a.escalationMethod,
      statusTrackingAvailable: a.statusTrackingAvailable,
      incidentCount: a._count.incidents,
      submissionCount: a._count.submissions,
    }))
  );
});
