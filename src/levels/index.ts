import { LevelDef } from '../world/level';
import { FLIGHT_SCHOOL } from './flightSchool';
import { HEAVY_LIFT } from './heavyLift';
import { MOUNTAIN_RESCUE } from './mountainRescue';
import { NIGHT_MEDEVAC } from './nightMedevac';
import { SEA_RESCUE } from './seaRescue';
import { SKY_CRANE } from './skyCrane';
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
  entry(NIGHT_MEDEVAC, 'Lifeline EC-1'),
  entry(SKY_CRANE, 'Mantis MK-9'),
  { id: 'escort', title: 'Convoy Escort', aircraft: 'Viper AH-6', skill: 'Combat and awareness', summary: 'Protect a relief convoy from hostile positions.' },
];

export const CAMPAIGN_ORDER = CAMPAIGN.map((c) => c.id);
