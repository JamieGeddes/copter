import { LevelDef } from '../world/level';
import { FLIGHT_SCHOOL } from './flightSchool';
import { SEA_RESCUE } from './seaRescue';

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
  { id: 'heavy-lift', title: 'Heavy Lift', aircraft: 'Hauler CH-4 (twin rotor)', skill: 'Swinging underslung loads', summary: 'Carry bridge sections to a village cut off by floods.' },
  { id: 'wildfire', title: 'Wildfire', aircraft: 'Bucketeer UH-2', skill: 'Route planning and timing', summary: 'Scoop water from the lake and stop the fire reaching the town.' },
  { id: 'mountain', title: 'Mountain Rescue', aircraft: 'Chamois AS-5', skill: 'Terrain flying in thin air', summary: 'Pluck stranded climbers from narrow ledges.' },
  { id: 'medevac', title: 'Night Medevac', aircraft: 'Lifeline EC-1', skill: 'Speed and tight landings', summary: 'Race casualties across the city by searchlight.' },
  { id: 'sky-crane', title: 'Sky Crane', aircraft: 'Mantis S-64', skill: 'Precise placement', summary: 'Lower a transmitter mast onto its mountings.' },
  { id: 'escort', title: 'Convoy Escort', aircraft: 'Viper AH-6', skill: 'Combat and awareness', summary: 'Protect a relief convoy from hostile positions.' },
];

export const CAMPAIGN_ORDER = CAMPAIGN.map((c) => c.id);
