/** Strategic logistics aggregates for one country. */
export interface CountryLogisticsState {
  hubCount: number;
  /** 0..1 network throughput after disruption and bottlenecks. */
  throughput: number;
  /** Abstract convoy / lift capacity from ports and transport formations. */
  convoyCapacity: number;
  /** 0..1 average route disruption. */
  disruption: number;
  /** Regions where the network is weakest. */
  bottlenecks: string[];
  /** Cumulative abstract convoy losses. */
  convoyLosses: number;
  lastUpdateDay: number;
}

export const createLogisticsState = (): CountryLogisticsState => ({
  hubCount: 0,
  throughput: 0.6,
  convoyCapacity: 1,
  disruption: 0,
  bottlenecks: [],
  convoyLosses: 0,
  lastUpdateDay: 0,
});
