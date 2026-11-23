/** Simulation facts. Systems publish; presentation, saves and AI subscribe. */
export type SimEvent =
  | { type: 'researchStart'; countryId: string; techId: string; day: number }
  | { type: 'researchComplete'; countryId: string; techId: string; day: number }
  | { type: 'productionStart'; countryId: string; unitId: string; day: number }
  | { type: 'unitReady'; countryId: string; unitId: string; day: number }
  | { type: 'warDeclared'; aggressorId: string; defenderId: string; day: number }
  | { type: 'peaceSigned'; aId: string; bId: string; day: number }
  | { type: 'allianceFormed'; aId: string; bId: string; day: number }
  | { type: 'tradeOpened'; aId: string; bId: string; day: number }
  | { type: 'lowTreasury'; countryId: string; day: number }
  | { type: 'aiDecision'; countryId: string; focus: string; day: number };

export interface SimEventSink {
  emit(event: SimEvent): void;
}

export class SimEventBus implements SimEventSink {
  private handlers = new Set<(event: SimEvent) => void>();

  emit(event: SimEvent): void {
    for (const handler of this.handlers) handler(event);
  }

  on(handler: (event: SimEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  clear(): void {
    this.handlers.clear();
  }
}
