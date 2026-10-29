/**
 * Map skins: purely cosmetic looks for the island (backdrop painting, ground texture, cliff tint, props).
 * Art lives in public/assets/maps/<id>_sky.jpg and <id>_ground.jpg (scripts/prep_maps.py); props in assets/deco.
 * `ads` is how many rewarded videos unlock the skin; 0 means it is owned from the start.
 */
export interface MapSkin {
  id: string;
  name: string;
  desc: string;
  ads: number;
  /** Tall props for the back rim, small ones for the front rim (they stand in front of the grid). */
  tall: string[];
  small: string[];
  cliffTint: string; // multiplied over the shared cliff texture
  lip: number; // grass / snow lip along the island edge
  path: number; // the dirt path to the hall
  cellShade: number; // shade for ground patches, the path's edge and the pointer's local grid
  /**
   * A painted city around an empty plaza (public/assets/maps/<id>_city.webp, fitted to the grid by
   * scripts/prep_city_map.py). When set it replaces the drawn island top, cliff and rim props.
   */
  city?: boolean;
}

export const MAP_SKINS: MapSkin[] = [
  { id: 'jade', name: '青玉仙城', desc: '玉台楼阁 · 初始地图', ads: 0, tall: ['bamboo', 'pine', 'tree', 'bamboo'], small: ['rock', 'flowers', 'lantern'], cliffTint: '#ffffff', lip: 0x6cbf4e, path: 0xd8c096, cellShade: 0x2f7a3a, city: true },
  { id: 'sakura', name: '樱落神社', desc: '晚霞樱雨', ads: 1, tall: ['sakura', 'sakura', 'tree'], small: ['lantern', 'flowers', 'rock'], cliffTint: '#f7e0dc', lip: 0x86c85c, path: 0xe4cdb8, cellShade: 0x7a3a5a, city: true },
  { id: 'snow', name: '雪顶天宫', desc: '极光雪峰', ads: 2, tall: ['snowpine', 'snowpine', 'snowpine'], small: ['snowrock', 'lantern', 'snowrock'], cliffTint: '#dfe8f4', lip: 0xf4f8ff, path: 0xcdd6e2, cellShade: 0x4a6a9a, city: true },
  { id: 'autumn', name: '秋枫金谷', desc: '金秋枫林', ads: 2, tall: ['maple', 'maple', 'tree'], small: ['autumnbush', 'rock', 'lantern'], cliffTint: '#f3dcbc', lip: 0xb8b24a, path: 0xdcbf8c, cellShade: 0x8a5a1a, city: true },
];

export const DEFAULT_SKIN = 'jade';
export const skinById = (id: string | undefined) => MAP_SKINS.find((m) => m.id === id) ?? MAP_SKINS[0];
/** The look of an AI base of the given faction: each culture shows off one of the maps. */
export const FACTION_SKIN: Record<string, string> = { cn: 'jade', jp: 'sakura', eu: 'snow' };
