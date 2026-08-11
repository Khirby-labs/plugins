export { PokeloPlugin } from './pokelo.plugin';
import { PokeloPlugin } from './pokelo.plugin';
import type { CrmPlugin } from '@khirby/plugin-sdk';

export function createPlugin(): CrmPlugin {
  return new PokeloPlugin();
}
