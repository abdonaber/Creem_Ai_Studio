export interface IRouteCoordinate {
  lat: number;
  lng: number;
}

export interface IRouteDetails {
  distanceKm: number;
  durationMinutes: number;
  polyline?: string;
  provider: string;
  trafficDelayMinutes?: number;
}

export interface IRoutingProvider {
  readonly name: string;
  isAvailable(): boolean;
  calculateRoute(origin: IRouteCoordinate, destination: IRouteCoordinate): Promise<IRouteDetails>;
  calculateEta(origin: IRouteCoordinate, destination: IRouteCoordinate): Promise<number>;
}
