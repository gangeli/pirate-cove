import type { Fact, Message } from './types';

/**
 * Attach what a letter reports, as facts the UI draws (coins, figures, flags). Display only: nothing in the sim
 * reads `data` back, and building it draws no random numbers, so the simulation is unchanged by it.
 */
export function tell(m: Message, ...facts: (Fact | false | null | undefined)[]): Message {
  m.data = { kind: 'event', facts: facts.filter((f): f is Fact => !!f) };
  return m;
}
