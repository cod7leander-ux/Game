/**
 * Renderer-independent unit silhouettes.
 *
 * The renderer builds a placeholder mesh per archetype. A future GLB replaces
 * that mesh through the asset manifest without gameplay knowing the difference.
 */
export type UnitArchetype =
  | 'infantry'
  | 'tank'
  | 'artillery'
  | 'aircraft'
  | 'helicopter'
  | 'drone'
  | 'ship'
  | 'installation';
