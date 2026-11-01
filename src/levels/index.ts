import { LevelDef } from '../world/level';
import { FLIGHT_SCHOOL } from './flightSchool';
import { HEAVY_LIFT } from './heavyLift';
import { MOUNTAIN_RESCUE } from './mountainRescue';
import { SEA_RESCUE } from './seaRescue';
import { WILDFIRE } from './wildfire';

export interface CampaignEntry {
  id: string;
  title: string;
  aircraft: string;
  skill: string;
  summary: string;
  level?: LevelDef;
}

const entry = (level: LevelDef, aircraft: string): CampaignEntry => ({
  id: level.mission.id,
  title: level.mission.title,
  aircraft,
  skill: level.mission.skill,
  summary: level.mission.summary,
  level,
});

/** Missions in play order. Entries without a level are shown as coming soon. */
export const CAMPAIGN: CampaignEntry[] = [
  entry(FLIGHT_SCHOOL, 'Kestrel K-1'),
  entry(SEA_RESCUE, 'Albatross HAR-3'),
  entry(HEAVY_LIFT, 'Hauler CH-4'),
  entry(WILDFIRE, 'Bucketeer FH-2'),
  entry(MOUNTAIN_RESCUE, 'Chamois AS-5'),
  { id: 'medevac', title: 'Night Medevac', aircraft: 'Lifeline EC-1', skill: 'Speed and tight landings', summary: 'Race casualties across the city by searchlight.' },
  { id: 'sky-crane', title: 'Sky Crane', aircraft: 'Mantis S-64', skill: 'Precise placement', summary: 'Lower a transmitter mast onto its mountings.' },
  { id: 'escort', title: 'Convoy Escort', aircraft: 'Viper AH-6', skill: 'Combat and awareness', summary: 'Protect a relief convoy from hostile positions.' },
];

export const CAMPAIGN_ORDER = CAMPAIGN.map((c) => c.id);
