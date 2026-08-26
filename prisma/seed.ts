// ---------------------------------------------------------------------------
// CiviqueX demo dataset seed.
//
// This is a deterministic, offline, clearly-labeled DEMO dataset modeled on
// a Chennai-style city zone (road names/geography are illustrative, chosen
// to make the map/demo legible — this is NOT sourced from a live government
// system; see README §Data Providers / DATA_MODE). It exercises every core
// engine through the real pipeline (not hand-faked rows) so the seeded data
// is internally consistent with what the app would compute live:
//   - multi-observation incidents built via the real correlation engine
//   - a recurring hotspot built by repeating incidents at one location
//   - an authority-routing "wrong department -> learned correction" example
//   - resolved / still-present / reopened incidents via the resolution engine
// ---------------------------------------------------------------------------

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createObservation } from "../lib/services/observationPipeline";
import { runResolutionCheck } from "../lib/services/resolutionService";
import { recordRoutingFeedback, resolveIncidentAuthority } from "../lib/services/authorityService";
import { runVisionInference } from "../lib/ai/vision";
import { INCIDENT_TYPES } from "../lib/types";

const prisma = new PrismaClient();

function rect(minLng: number, minLat: number, maxLng: number, maxLat: number): [number, number][] {
  return [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat],
  ];
}

function daysAgo(d: number, hour = 9, minute = 0): Date {
  const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
  date.setHours(hour, minute, 0, 0);
  return date;
}

async function main() {
  console.log("Seeding CiviqueX demo dataset...");

  await prisma.notification.deleteMany();
  await prisma.uploadSession.deleteMany();
  await prisma.patrolDetection.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.riskScore.deleteMany();
  await prisma.resolutionCheck.deleteMany();
  await prisma.submissionEvent.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.incidentObservation.deleteMany();
  await prisma.evidenceAccessLog.deleteMany();
  await prisma.hotspot.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.observation.deleteMany();
  await prisma.evidence.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.location.deleteMany();
  await prisma.routingFeedback.deleteMany();
  await prisma.authorityBoundary.deleteMany();
  await prisma.roadSegment.deleteMany();
  await prisma.rule.deleteMany();
  await prisma.user.deleteMany();
  await prisma.authority.deleteMany();

  // ---------------------------------------------------------------------
  // Road segments
  // ---------------------------------------------------------------------
  const segmentDefs = [
    {
      key: "anna_salai_gemini",
      name: "Anna Salai near Gemini Flyover",
      city: "Chennai",
      ward: "Zone 9",
      roadClass: "arterial",
      schoolNearby: false,
      hospitalNearby: false,
      junctionType: "signalized",
      line: [
        [80.2496, 13.0604],
        [80.2503, 13.0592],
        [80.251, 13.058],
      ],
    },
    {
      key: "pondy_bazaar",
      name: "Thyagaraya Road, Pondy Bazaar",
      city: "Chennai",
      ward: "Zone 9",
      roadClass: "collector",
      schoolNearby: true,
      hospitalNearby: false,
      junctionType: "unsignalized",
      line: [
        [80.234, 13.041],
        [80.235, 13.0403],
        [80.236, 13.0395],
      ],
    },
    {
      key: "gn_chetty",
      name: "GN Chetty Road",
      city: "Chennai",
      ward: "Zone 9",
      roadClass: "local",
      schoolNearby: false,
      hospitalNearby: false,
      junctionType: "none",
      line: [
        [80.233, 13.045],
        [80.2338, 13.044],
        [80.2345, 13.043],
      ],
    },
    {
      key: "sardar_patel",
      name: "Sardar Patel Road near IIT Madras Gate",
      city: "Chennai",
      ward: "Zone 13",
      roadClass: "arterial",
      schoolNearby: false,
      hospitalNearby: false,
      junctionType: "signalized",
      line: [
        [80.2337, 12.9915],
        [80.2344, 12.9908],
        [80.235, 12.99],
      ],
    },
    {
      key: "poonamallee_egmore",
      name: "Poonamallee High Road near Egmore",
      city: "Chennai",
      ward: "Zone 5",
      roadClass: "arterial",
      schoolNearby: false,
      hospitalNearby: true,
      junctionType: "unsignalized",
      line: [
        [80.253, 13.0778],
        [80.2545, 13.0784],
        [80.256, 13.079],
      ],
    },
    {
      key: "kilpauk_garden",
      name: "Kilpauk Garden Road",
      city: "Chennai",
      ward: "Zone 5",
      roadClass: "school_zone",
      schoolNearby: true,
      hospitalNearby: false,
      junctionType: "none",
      line: [
        [80.241, 13.082],
        [80.2418, 13.0827],
        [80.243, 13.0835],
      ],
    },
    {
      key: "adyar_bridge",
      name: "Adyar Bridge Road",
      city: "Chennai",
      ward: "Zone 13",
      roadClass: "collector",
      schoolNearby: false,
      hospitalNearby: false,
      junctionType: "roundabout",
      line: [
        [80.257, 13.0067],
        [80.2578, 13.0058],
        [80.259, 13.005],
      ],
    },
    {
      key: "velachery_bypass",
      name: "Velachery Bypass Road",
      city: "Chennai",
      ward: "Zone 13",
      roadClass: "arterial",
      schoolNearby: false,
      hospitalNearby: false,
      junctionType: "signalized",
      line: [
        [80.22, 12.975],
        [80.2213, 12.9742],
        [80.223, 12.973],
      ],
    },
    {
      key: "mylapore_luz",
      name: "Luz Church Road, Mylapore",
      city: "Chennai",
      ward: "Zone 13",
      roadClass: "local",
      schoolNearby: true,
      hospitalNearby: false,
      junctionType: "none",
      line: [
        [80.267, 13.034],
        [80.2678, 13.0333],
        [80.2685, 13.0325],
      ],
    },
    {
      key: "omr_sholinganallur",
      name: "OMR IT Corridor, Sholinganallur",
      city: "Chennai",
      ward: "Zone 13",
      roadClass: "arterial",
      schoolNearby: false,
      hospitalNearby: false,
      junctionType: "signalized",
      line: [
        [80.227, 12.901],
        [80.228, 12.9002],
        [80.229, 12.899],
      ],
    },
  ];

  const segments: Record<string, { id: string }> = {};
  for (const def of segmentDefs) {
    const seg = await prisma.roadSegment.create({
      data: {
        name: def.name,
        city: def.city,
        ward: def.ward,
        roadClass: def.roadClass,
        schoolNearby: def.schoolNearby,
        hospitalNearby: def.hospitalNearby,
        junctionType: def.junctionType,
        geometryJson: JSON.stringify(def.line),
      },
    });
    segments[def.key] = seg;
  }

  // ---------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------
  await prisma.rule.createMany({
    data: [
      {
        code: "TN-MVR-WP-01",
        incidentType: "wrong_parking",
        description: "No parking on designated arterial roads during business hours (08:00-20:00)",
        authoritySource: "Tamil Nadu Motor Vehicles Rules, 1989 — Rule 15 (demo reference)",
        conditionsJson: JSON.stringify({ roadClasses: ["arterial"], timeWindows: [{ startHour: 8, endHour: 20 }], minVisualConfidence: 0.55 }),
      },
      {
        code: "GCC-FP-01",
        incidentType: "footpath_obstruction",
        description: "Obstruction of a pedestrian footpath is prohibited at all times",
        authoritySource: "Chennai City Municipal Corporation Act — Footpath Encroachment provisions (demo reference)",
        conditionsJson: JSON.stringify({ minVisualConfidence: 0.55 }),
      },
      {
        code: "GCC-BS-01",
        incidentType: "bus_stop_obstruction",
        description: "Obstructing a designated bus stop or bus bay is prohibited at all times",
        authoritySource: "Chennai City Municipal Corporation Act — Bus Bay provisions (demo reference)",
        conditionsJson: JSON.stringify({ minVisualConfidence: 0.55 }),
      },
      {
        code: "TP-EA-01",
        incidentType: "emergency_access_obstruction",
        description: "Blocking a hospital or emergency-access point is prohibited at all times",
        authoritySource: "Tamil Nadu Motor Vehicles Rules, 1989 — Emergency Access provisions (demo reference)",
        conditionsJson: JSON.stringify({ requiresHospitalNearby: true, minVisualConfidence: 0.5 }),
      },
      {
        code: "TP-SZ-01",
        incidentType: "school_zone_obstruction",
        description: "Obstruction near a school zone is prohibited during arrival/dismissal hours (07:00-09:00, 14:00-16:00)",
        authoritySource: "Tamil Nadu School Zone Safety Guidelines (demo reference)",
        conditionsJson: JSON.stringify({
          requiresSchoolNearby: true,
          timeWindows: [
            { startHour: 7, endHour: 9 },
            { startHour: 14, endHour: 16 },
          ],
          minVisualConfidence: 0.5,
        }),
      },
      {
        code: "GCC-AP-01",
        incidentType: "accessible_parking_obstruction",
        description: "Occupying or obstructing a designated accessible parking space without authorization is prohibited at all times",
        authoritySource: "Rights of Persons with Disabilities Act, 2016 — Accessible Infrastructure provisions (demo reference)",
        conditionsJson: JSON.stringify({ minVisualConfidence: 0.5 }),
      },
      {
        code: "GCC-SG-01",
        incidentType: "signage_obstruction",
        description: "Damaging or obstructing traffic signage or signals is prohibited at all times",
        authoritySource: "Tamil Nadu Motor Vehicles Rules, 1989 — Signage provisions (demo reference)",
        conditionsJson: JSON.stringify({ minVisualConfidence: 0.45 }),
      },
      {
        code: "TP-DO-01",
        incidentType: "dangerous_obstruction",
        description: "Placing a hazardous obstruction on the carriageway is prohibited at all times",
        authoritySource: "Tamil Nadu Motor Vehicles Rules, 1989 — Carriageway Safety provisions (demo reference)",
        conditionsJson: JSON.stringify({ minVisualConfidence: 0.5 }),
      },
      {
        code: "TP-HI-01",
        incidentType: "hazardous_interaction",
        description: "Pattern consistent with a hazardous near-miss interaction between road users, flagged for review",
        authoritySource: "Road Safety Risk Assessment Guidelines (demo reference)",
        conditionsJson: JSON.stringify({ minVisualConfidence: 0.45 }),
      },
      {
        code: "GCC-PH-01",
        incidentType: "pothole_damage",
        description: "Road-surface damage (potholes, cracks, subsidence) posing a hazard to vehicles and pedestrians is a maintenance-and-safety concern at all times",
        authoritySource: "Chennai City Municipal Corporation Act — Road Maintenance provisions (demo reference)",
        conditionsJson: JSON.stringify({ minVisualConfidence: 0.3 }),
      },
    ],
  });

  // ---------------------------------------------------------------------
  // Authorities + boundaries
  // ---------------------------------------------------------------------
  const zone9 = await prisma.authority.create({
    data: {
      name: "Greater Chennai Corporation — Zone 9 (T. Nagar)",
      jurisdiction: "T. Nagar zone",
      supportedIncidentTypesJson: JSON.stringify(["footpath_obstruction", "bus_stop_obstruction", "accessible_parking_obstruction", "signage_obstruction", "dangerous_obstruction", "pothole_damage"]),
      officialUrl: null,
      apiAvailable: false,
      apiDocumentation: null,
      submissionMethod: "assisted_manual",
      authenticationMethod: null,
      requiredFieldsJson: JSON.stringify(["photo_or_video", "location", "description"]),
      evidenceRequirements: "Photo or video clearly showing the obstruction and its location",
      escalationMethod: "Escalated to the Zonal Officer if no action within 7 days",
      statusTrackingAvailable: false,
    },
  });
  await prisma.authorityBoundary.create({
    data: { authorityId: zone9.id, name: "Zone 9 boundary", geojson: JSON.stringify(rect(80.225, 13.03, 80.255, 13.065)) },
  });

  const zone5 = await prisma.authority.create({
    data: {
      name: "Greater Chennai Corporation — Zone 5 (Egmore-Nungambakkam)",
      jurisdiction: "Egmore-Nungambakkam zone",
      supportedIncidentTypesJson: JSON.stringify(["footpath_obstruction", "bus_stop_obstruction", "accessible_parking_obstruction", "signage_obstruction", "dangerous_obstruction", "pothole_damage"]),
      officialUrl: null,
      apiAvailable: false,
      apiDocumentation: null,
      submissionMethod: "assisted_manual",
      authenticationMethod: null,
      requiredFieldsJson: JSON.stringify(["photo_or_video", "location", "description"]),
      evidenceRequirements: "Photo or video clearly showing the obstruction and its location",
      escalationMethod: "Escalated to the Zonal Officer if no action within 7 days",
      statusTrackingAvailable: false,
    },
  });
  await prisma.authorityBoundary.create({
    data: { authorityId: zone5.id, name: "Zone 5 boundary", geojson: JSON.stringify(rect(80.235, 13.07, 80.26, 13.09)) },
  });

  const zone13 = await prisma.authority.create({
    data: {
      name: "Greater Chennai Corporation — Zone 13 (Adyar)",
      jurisdiction: "Adyar-Velachery-OMR zone",
      supportedIncidentTypesJson: JSON.stringify(["footpath_obstruction", "bus_stop_obstruction", "accessible_parking_obstruction", "signage_obstruction", "dangerous_obstruction", "pothole_damage"]),
      officialUrl: null,
      apiAvailable: false,
      apiDocumentation: null,
      submissionMethod: "assisted_manual",
      authenticationMethod: null,
      requiredFieldsJson: JSON.stringify(["photo_or_video", "location", "description"]),
      evidenceRequirements: "Photo or video clearly showing the obstruction and its location",
      escalationMethod: "Escalated to the Zonal Officer if no action within 7 days",
      statusTrackingAvailable: false,
    },
  });
  await prisma.authorityBoundary.create({
    data: { authorityId: zone13.id, name: "Zone 13 boundary", geojson: JSON.stringify(rect(80.215, 12.895, 80.275, 13.04)) },
  });

  const trafficPolice = await prisma.authority.create({
    data: {
      name: "Chennai Traffic Police — Traffic Enforcement Wing",
      jurisdiction: "Chennai city (traffic offences)",
      supportedIncidentTypesJson: JSON.stringify(["wrong_parking", "emergency_access_obstruction", "hazardous_interaction", "dangerous_obstruction", "footpath_obstruction"]),
      officialUrl: null,
      apiAvailable: false,
      apiDocumentation: null,
      submissionMethod: "assisted_manual",
      authenticationMethod: null,
      requiredFieldsJson: JSON.stringify(["photo_or_video", "location", "vehicle_description"]),
      evidenceRequirements: "Photo or video with a legible vehicle description and location",
      escalationMethod: "Escalated to the Traffic Inspector if no action within 5 days",
      statusTrackingAvailable: false,
    },
  });
  await prisma.authorityBoundary.create({
    data: { authorityId: trafficPolice.id, name: "Chennai city boundary", geojson: JSON.stringify(rect(80.2, 12.85, 80.28, 13.1)) },
  });

  const schoolZoneCell = await prisma.authority.create({
    data: {
      name: "Chennai Traffic Police — School Zone & Road Safety Cell",
      jurisdiction: "Chennai city (school zones)",
      supportedIncidentTypesJson: JSON.stringify(["school_zone_obstruction"]),
      officialUrl: null,
      apiAvailable: false,
      apiDocumentation: null,
      submissionMethod: "assisted_manual",
      authenticationMethod: null,
      requiredFieldsJson: JSON.stringify(["photo_or_video", "location", "time_of_day"]),
      evidenceRequirements: "Photo or video captured during school arrival/dismissal hours",
      escalationMethod: "Escalated to the Road Safety Cell Coordinator if no action within 5 days",
      statusTrackingAvailable: false,
    },
  });
  await prisma.authorityBoundary.create({
    data: { authorityId: schoolZoneCell.id, name: "Chennai city boundary", geojson: JSON.stringify(rect(80.2, 12.85, 80.28, 13.1)) },
  });

  // Fallback for anywhere outside the specifically-mapped Chennai zones
  // above. This is deliberately NOT presented as a verified department for
  // the exact reported location — its name and evidenceRequirements say so
  // plainly — it exists so a real submission from anywhere still has
  // somewhere to go, rather than every out-of-area report silently dead-
  // ending. It never claims precision it doesn't have.
  const generalFallback = await prisma.authority.create({
    data: {
      name: "General Traffic Enforcement (unmapped jurisdiction)",
      jurisdiction: "Outside the specific zones this demo has mapped",
      supportedIncidentTypesJson: JSON.stringify(INCIDENT_TYPES.map((t) => t.code)),
      officialUrl: null,
      apiAvailable: false,
      apiDocumentation: null,
      submissionMethod: "assisted_manual",
      authenticationMethod: null,
      requiredFieldsJson: JSON.stringify(["photo_or_video", "location", "description"]),
      evidenceRequirements:
        "This location falls outside the specific authority boundaries this demo has registered — routing is a general placeholder, not a verified match to a real department for this exact address.",
      escalationMethod: null,
      statusTrackingAvailable: false,
    },
  });
  await prisma.authorityBoundary.create({
    data: { authorityId: generalFallback.id, name: "India (broad fallback)", geojson: JSON.stringify(rect(68, 6, 97.5, 37)) },
  });

  // ---------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const citizen1 = await prisma.user.create({
    data: { email: "citizen1@demo.civiquex.app", passwordHash, name: "Aditi Krishnan", role: "CITIZEN" },
  });
  const citizen2 = await prisma.user.create({
    data: { email: "citizen2@demo.civiquex.app", passwordHash, name: "Ravi Kumar", role: "CITIZEN" },
  });
  await prisma.user.create({
    data: { email: "authority.zone9@demo.civiquex.app", passwordHash, name: "Zone 9 Duty Officer", role: "AUTHORITY", authorityId: zone9.id },
  });
  await prisma.user.create({
    data: { email: "authority.traffic@demo.civiquex.app", passwordHash, name: "Traffic Enforcement Duty Officer", role: "AUTHORITY", authorityId: trafficPolice.id },
  });
  await prisma.user.create({
    data: { email: "admin@demo.civiquex.app", passwordHash, name: "Platform Admin", role: "ADMIN" },
  });

  console.log("Created road segments, rules, authorities, users.");

  // ---------------------------------------------------------------------
  // Contract registry (demo data — see lib/engines/contractMatch.ts header)
  // Matched at runtime against real GPS + real reverse-geocoded road names
  // from the AI Road Patrol flow. A mix of boundary-polygon and
  // center+radius matching, and active vs. expired warranties, so the
  // matching engine's full logic is exercised.
  // ---------------------------------------------------------------------
  const now = new Date();
  const future = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const past = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  await prisma.contract.createMany({
    data: [
      {
        tenderNo: "GCC-RD-2025-0142",
        contractorName: "Sundaram Infra Projects Pvt Ltd",
        contractorEmail: "projects@sundaraminfra.demo",
        officerName: "R. Kumaresan, Assistant Executive Engineer",
        officerEmail: "aee.zone9.roads@chennaicorp.demo",
        roadName: "Anna Salai near Gemini Flyover",
        city: "Chennai",
        boundaryGeojson: JSON.stringify(rect(80.2485, 13.056, 80.2515, 13.061)),
        centerLat: null,
        centerLng: null,
        radiusMeters: null,
        keywordsJson: JSON.stringify(["anna salai", "mount road", "gemini"]),
        workStartDate: past(400),
        workEndDate: past(120),
        warrantyEndDate: future(240),
      },
      {
        tenderNo: "GCC-RD-2024-0871",
        contractorName: "Vasanth Road Constructions",
        contractorEmail: "site@vasanthroads.demo",
        officerName: "P. Lakshmi, Junior Engineer",
        officerEmail: "je.zone9.roads@chennaicorp.demo",
        roadName: "Thyagaraya Road, Pondy Bazaar",
        city: "Chennai",
        boundaryGeojson: null,
        centerLat: 13.0403,
        centerLng: 80.235,
        radiusMeters: 250,
        keywordsJson: JSON.stringify(["thyagaraya", "pondy bazaar", "t nagar", "t. nagar"]),
        workStartDate: past(900),
        workEndDate: past(650),
        warrantyEndDate: past(280), // expired — demonstrates the "warranty lapsed" case
      },
      {
        tenderNo: "CTP-SZ-2025-0033",
        contractorName: "Metro Civil Works",
        contractorEmail: "ops@metrocivilworks.demo",
        officerName: "S. Anand, Road Safety Cell Coordinator",
        officerEmail: "coordinator.schoolzone@chennaitrafficpolice.demo",
        roadName: "Kilpauk Garden Road",
        city: "Chennai",
        boundaryGeojson: null,
        centerLat: 13.0827,
        centerLng: 80.2418,
        radiusMeters: 200,
        keywordsJson: JSON.stringify(["kilpauk", "garden road"]),
        workStartDate: past(200),
        workEndDate: past(30),
        warrantyEndDate: future(335),
      },
      {
        tenderNo: "GCC-RD-2025-0209",
        contractorName: "Perungudi Builders & Roadways",
        contractorEmail: "contracts@perungudiroadways.demo",
        officerName: "V. Elango, Assistant Executive Engineer",
        officerEmail: "aee.zone5.roads@chennaicorp.demo",
        roadName: "Poonamallee High Road near Egmore",
        city: "Chennai",
        boundaryGeojson: JSON.stringify(rect(80.2515, 13.0765, 80.2565, 13.0805)),
        centerLat: null,
        centerLng: null,
        radiusMeters: null,
        keywordsJson: JSON.stringify(["poonamallee", "egmore"]),
        workStartDate: past(150),
        workEndDate: past(20),
        warrantyEndDate: future(345),
      },
      {
        tenderNo: "GCC-RD-2024-0655",
        contractorName: "OMR Highway Maintenance Co.",
        contractorEmail: "maintenance@omrhighwayco.demo",
        officerName: "K. Bhuvanesh, Junior Engineer",
        officerEmail: "je.zone13.roads@chennaicorp.demo",
        roadName: "OMR IT Corridor, Sholinganallur",
        city: "Chennai",
        boundaryGeojson: null,
        centerLat: 12.9,
        centerLng: 80.228,
        radiusMeters: 300,
        keywordsJson: JSON.stringify(["omr", "sholinganallur", "old mahabalipuram", "it corridor"]),
        workStartDate: past(500),
        workEndDate: past(300),
        warrantyEndDate: past(30), // recently expired
      },
      {
        tenderNo: "GCC-RD-2023-0410",
        contractorName: "Velachery Bypass Contractors",
        contractorEmail: "info@velacherybypass.demo",
        officerName: "N. Priya, Assistant Executive Engineer",
        officerEmail: "aee.zone13.roads@chennaicorp.demo",
        roadName: "Velachery Bypass Road",
        city: "Chennai",
        boundaryGeojson: null,
        centerLat: 12.974,
        centerLng: 80.2215,
        radiusMeters: 220,
        keywordsJson: JSON.stringify(["velachery", "bypass"]),
        workStartDate: past(1100),
        workEndDate: past(800),
        warrantyEndDate: past(430), // long expired
      },
    ],
  });
  console.log("Created contract registry (demo data, matched against real GPS).");

  // ---------------------------------------------------------------------
  // Scenario 1 — multi-observation incident graph (User A/B/C example)
  // Three independent observers capture the same wrong-parking event on
  // Anna Salai within 25 seconds of each other, during business hours.
  // ---------------------------------------------------------------------
  const s1Base = daysAgo(2, 11, 15);
  const seg1 = segmentDefs.find((s) => s.key === "anna_salai_gemini")!;
  const p1 = seg1.line[1];
  await createObservation({
    userId: citizen1.id,
    sourceType: "CITIZEN",
    observerHash: "obs-hash-a1",
    incidentTypeGuess: "wrong_parking",
    capturedAt: s1Base,
    lat: p1[1],
    lng: p1[0],
    orientationDeg: 40,
    mediaKind: "video",
    mediaRef: "seed-anna-salai-a",
    storageRef: "demo-media://seed-anna-salai-a",
    gpsAccuracyMeters: 8,
    uploadDelaySeconds: 4,
  });
  await createObservation({
    userId: citizen2.id,
    sourceType: "CITIZEN",
    observerHash: "obs-hash-b1",
    incidentTypeGuess: "wrong_parking",
    capturedAt: new Date(s1Base.getTime() + 8000),
    lat: p1[1] + 0.00006,
    lng: p1[0] + 0.00004,
    orientationDeg: 46,
    mediaKind: "video",
    mediaRef: "seed-anna-salai-b",
    storageRef: "demo-media://seed-anna-salai-b",
    gpsAccuracyMeters: 10,
    uploadDelaySeconds: 12,
  });
  const s1c = await createObservation({
    sourceType: "AUTHORIZED_SENSOR",
    observerHash: "obs-hash-c1-sensor",
    incidentTypeGuess: "wrong_parking",
    capturedAt: new Date(s1Base.getTime() + 15000),
    lat: p1[1] + 0.00003,
    lng: p1[0] - 0.00003,
    orientationDeg: 220,
    mediaKind: "image",
    mediaRef: "seed-anna-salai-c",
    storageRef: "demo-media://seed-anna-salai-c",
    gpsAccuracyMeters: 3,
    uploadDelaySeconds: 2,
  });
  console.log(`Scenario 1: incident graph -> ${s1c.isNewIncident ? "unexpectedly new" : "correlated"} incident ${s1c.incidentId}`);

  // ---------------------------------------------------------------------
  // Scenario 2 — same visual scene, different legality (context/rule engine)
  // Same road, same parked-vehicle scenario, but captured at 11pm — outside
  // the arterial no-parking window, so the rule engine must NOT flag it.
  // ---------------------------------------------------------------------
  const s2 = daysAgo(1, 23, 10);
  await createObservation({
    userId: citizen1.id,
    sourceType: "CITIZEN",
    observerHash: "obs-hash-night",
    incidentTypeGuess: "wrong_parking",
    capturedAt: s2,
    lat: p1[1] - 0.0002,
    lng: p1[0] + 0.0001,
    mediaKind: "video",
    mediaRef: "seed-anna-salai-night",
    storageRef: "demo-media://seed-anna-salai-night",
    gpsAccuracyMeters: 9,
    uploadDelaySeconds: 6,
  });

  // ---------------------------------------------------------------------
  // Scenario 3 — recurring hotspot: footpath obstruction at Pondy Bazaar,
  // repeated across several separate days -> crosses the recurrence
  // threshold and becomes a hotspot. Also seeds the authority feedback
  // learning example: this segment/type initially routes to whichever
  // authority the engine defaults to, gets redirected 4 times, and a later
  // incident should show the routing correction.
  // ---------------------------------------------------------------------
  const seg2 = segmentDefs.find((s) => s.key === "pondy_bazaar")!;
  const p2 = seg2.line[1];

  const preFeedback = await resolveIncidentAuthority({
    point: { lat: p2[1], lng: p2[0] },
    incidentType: "footpath_obstruction",
    roadSegmentId: segments["pondy_bazaar"].id,
  });
  const defaultAuthorityId = preFeedback.authorityId!;
  const correctAuthorityId = defaultAuthorityId === zone9.id ? trafficPolice.id : zone9.id;

  for (let i = 0; i < 5; i++) {
    await createObservation({
      userId: i % 2 === 0 ? citizen1.id : citizen2.id,
      sourceType: "CITIZEN",
      observerHash: `obs-hash-fp-${i}`,
      incidentTypeGuess: "footpath_obstruction",
      capturedAt: daysAgo(20 - i * 4, 9 + i, 30),
      lat: p2[1] + i * 0.00002,
      lng: p2[0] + i * 0.00002,
      mediaKind: "video",
      mediaRef: `seed-pondy-fp-${i}`,
      storageRef: `demo-media://seed-pondy-fp-${i}`,
      gpsAccuracyMeters: 7,
      uploadDelaySeconds: 5,
    });

    if (i < 4) {
      await recordRoutingFeedback({
        authorityId: defaultAuthorityId,
        outcome: "redirected",
        redirectedToId: correctAuthorityId,
        roadSegmentId: segments["pondy_bazaar"].id,
        incidentType: "footpath_obstruction",
      });
    }
  }

  const s3learned = await createObservation({
    userId: citizen1.id,
    sourceType: "CITIZEN",
    observerHash: "obs-hash-fp-learned",
    incidentTypeGuess: "footpath_obstruction",
    capturedAt: daysAgo(0, 10, 0),
    lat: p2[1] + 0.0001,
    lng: p2[0] + 0.0001,
    mediaKind: "video",
    mediaRef: "seed-pondy-fp-learned",
    storageRef: "demo-media://seed-pondy-fp-learned",
    gpsAccuracyMeters: 6,
    uploadDelaySeconds: 3,
  });
  const learnedIncident = await prisma.incident.findUnique({ where: { id: s3learned.incidentId } });
  console.log(
    `Scenario 3: hotspot + routing learning -> latest incident routed to authorityId=${learnedIncident?.authorityId} (default was ${defaultAuthorityId}, correct/learned target ${correctAuthorityId})`
  );

  // ---------------------------------------------------------------------
  // Scenario 4 — resolution lifecycle: submitted -> acknowledged -> action
  // reported -> independently re-verified as RESOLVED (object gone).
  // ---------------------------------------------------------------------
  const seg3 = segmentDefs.find((s) => s.key === "kilpauk_garden")!;
  const p3 = seg3.line[0];
  const s4 = await createObservation({
    userId: citizen2.id,
    sourceType: "CITIZEN",
    observerHash: "obs-hash-resolved",
    incidentTypeGuess: "school_zone_obstruction",
    capturedAt: daysAgo(6, 8, 15),
    lat: p3[1],
    lng: p3[0],
    mediaKind: "video",
    mediaRef: "seed-kilpauk-before",
    storageRef: "demo-media://seed-kilpauk-before",
    gpsAccuracyMeters: 5,
    uploadDelaySeconds: 3,
  });

  const beforeObs = await prisma.observation.findUniqueOrThrow({ where: { id: s4.observationId } });
  const beforeScene = JSON.parse(beforeObs.sceneDescriptorJson) as number[];
  const afterVision = runVisionInference({ mediaRef: "seed-kilpauk-after", incidentTypeGuess: "school_zone_obstruction", capturedAt: daysAgo(1, 8, 20).toISOString() });
  const afterScene = beforeScene.map((v, i) => Math.max(-1, Math.min(1, v * 0.4 + afterVision.sceneDescriptor[i] * 0.6)));
  const afterEvidence = await prisma.evidence.create({
    data: {
      kind: "video",
      storageRef: "demo-media://seed-kilpauk-after",
      contentHash: "seed-kilpauk-after",
      retentionUntil: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.observation.create({
    data: {
      sourceType: "AUTHORIZED_SENSOR",
      observerHash: "obs-hash-resolved-check",
      incidentTypeGuess: "school_zone_obstruction",
      capturedAt: daysAgo(1, 8, 20),
      lat: p3[1] + 0.00001,
      lng: p3[0] + 0.00001,
      roadSegmentId: segments["kilpauk_garden"].id,
      sceneDescriptorJson: JSON.stringify(afterScene),
      objectDetectionsJson: JSON.stringify([{ label: "school_zone_sign", confidence: 0.9, bbox: [0.1, 0.1, 0.3, 0.3] }]),
      visionModel: afterVision.model,
      visionModelVersion: afterVision.modelVersion,
      status: "PROCESSED",
      mediaId: afterEvidence.id,
    },
  });

  const zone5Incident = await prisma.incident.update({
    where: { id: s4.incidentId },
    data: { authorityId: schoolZoneCell.id },
  });
  await prisma.submission.create({
    data: {
      incidentId: zone5Incident.id,
      authorityId: schoolZoneCell.id,
      channel: "assisted_manual",
      referenceNumber: "CTP-SZ-2026-00042",
      status: "action_reported",
      submittedAt: daysAgo(5, 12, 0),
      events: {
        create: [
          { eventType: "acknowledged", occurredAt: daysAgo(4, 10, 0), note: "Acknowledged by School Zone Cell" },
          { eventType: "action_reported", occurredAt: daysAgo(2, 16, 0), note: "Vehicle removed by enforcement team" },
        ],
      },
    },
  });
  await prisma.incident.update({ where: { id: zone5Incident.id }, data: { status: "ACTION_REPORTED" } });
  const res1 = await runResolutionCheck(zone5Incident.id);
  console.log(`Scenario 4: resolution check -> ${res1.result.result} (${zone5Incident.publicId})`);

  // ---------------------------------------------------------------------
  // Scenario 5 — resolution lifecycle: authority claims action taken, but
  // independent re-verification shows the obstruction is STILL PRESENT.
  // ---------------------------------------------------------------------
  const seg4 = segmentDefs.find((s) => s.key === "poonamallee_egmore")!;
  const p4 = seg4.line[0];
  const s5 = await createObservation({
    userId: citizen1.id,
    sourceType: "CITIZEN",
    observerHash: "obs-hash-stillpresent",
    incidentTypeGuess: "emergency_access_obstruction",
    capturedAt: daysAgo(5, 13, 0),
    lat: p4[1],
    lng: p4[0],
    mediaKind: "video",
    mediaRef: "seed-poonamallee-before",
    storageRef: "demo-media://seed-poonamallee-before",
    gpsAccuracyMeters: 6,
    uploadDelaySeconds: 4,
  });
  const beforeObs2 = await prisma.observation.findUniqueOrThrow({ where: { id: s5.observationId } });
  const afterVision2 = runVisionInference({ mediaRef: "seed-poonamallee-after", incidentTypeGuess: "emergency_access_obstruction", capturedAt: daysAgo(1, 13, 5).toISOString() });
  const afterEvidence2 = await prisma.evidence.create({
    data: {
      kind: "video",
      storageRef: "demo-media://seed-poonamallee-after",
      contentHash: "seed-poonamallee-after",
      retentionUntil: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.observation.create({
    data: {
      sourceType: "CITIZEN",
      observerHash: "obs-hash-stillpresent-check",
      incidentTypeGuess: "emergency_access_obstruction",
      capturedAt: daysAgo(1, 13, 5),
      lat: p4[1],
      lng: p4[0],
      roadSegmentId: segments["poonamallee_egmore"].id,
      sceneDescriptorJson: beforeObs2.sceneDescriptorJson,
      objectDetectionsJson: beforeObs2.objectDetectionsJson,
      visionModel: afterVision2.model,
      visionModelVersion: afterVision2.modelVersion,
      status: "PROCESSED",
      mediaId: afterEvidence2.id,
    },
  });
  await prisma.submission.create({
    data: {
      incidentId: s5.incidentId,
      authorityId: trafficPolice.id,
      channel: "assisted_manual",
      referenceNumber: "CTP-EA-2026-00019",
      status: "action_reported",
      submittedAt: daysAgo(4, 9, 0),
      events: { create: [{ eventType: "action_reported", occurredAt: daysAgo(2, 11, 0), note: "Reported cleared by field unit" }] },
    },
  });
  await prisma.incident.update({ where: { id: s5.incidentId }, data: { status: "ACTION_REPORTED" } });
  const res2 = await runResolutionCheck(s5.incidentId);
  console.log(`Scenario 5: resolution check -> ${res2.result.result} (still present despite authority report)`);

  // ---------------------------------------------------------------------
  // Scenario 6 — additional variety across remaining segments/types so the
  // dashboard, map and analytics have realistic breadth.
  // ---------------------------------------------------------------------
  const extra: { segKey: string; type: string; dayOffset: number; hour: number }[] = [
    { segKey: "gn_chetty", type: "dangerous_obstruction", dayOffset: 3, hour: 18 },
    { segKey: "sardar_patel", type: "hazardous_interaction", dayOffset: 4, hour: 8 },
    { segKey: "adyar_bridge", type: "accessible_parking_obstruction", dayOffset: 7, hour: 15 },
    { segKey: "velachery_bypass", type: "bus_stop_obstruction", dayOffset: 9, hour: 17 },
    { segKey: "mylapore_luz", type: "signage_obstruction", dayOffset: 12, hour: 12 },
    { segKey: "omr_sholinganallur", type: "wrong_parking", dayOffset: 2, hour: 13 },
    { segKey: "omr_sholinganallur", type: "wrong_parking", dayOffset: 8, hour: 14 },
    { segKey: "gn_chetty", type: "dangerous_obstruction", dayOffset: 15, hour: 19 },
    { segKey: "gn_chetty", type: "dangerous_obstruction", dayOffset: 25, hour: 20 },
    { segKey: "kilpauk_garden", type: "school_zone_obstruction", dayOffset: 30, hour: 7 },
  ];

  for (const [idx, e] of extra.entries()) {
    const seg = segmentDefs.find((s) => s.key === e.segKey)!;
    const pt = seg.line[idx % seg.line.length];
    await createObservation({
      userId: idx % 2 === 0 ? citizen1.id : citizen2.id,
      sourceType: idx % 3 === 0 ? "DASHCAM" : "CITIZEN",
      observerHash: `obs-hash-extra-${idx}`,
      incidentTypeGuess: e.type,
      capturedAt: daysAgo(e.dayOffset, e.hour, 10 * idx),
      lat: pt[1] + (idx % 3) * 0.00002,
      lng: pt[0] + (idx % 3) * 0.00002,
      mediaKind: "video",
      mediaRef: `seed-extra-${idx}`,
      storageRef: `demo-media://seed-extra-${idx}`,
      gpsAccuracyMeters: 6 + idx,
      uploadDelaySeconds: 5 + idx * 3,
    });
  }

  console.log("Seed complete.");
  console.log("");
  console.log("Demo logins (password: Password123!):");
  console.log("  citizen1@demo.civiquex.app        (citizen)");
  console.log("  citizen2@demo.civiquex.app        (citizen)");
  console.log("  authority.zone9@demo.civiquex.app (authority — GCC Zone 9)");
  console.log("  authority.traffic@demo.civiquex.app (authority — Traffic Police)");
  console.log("  admin@demo.civiquex.app           (admin)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
