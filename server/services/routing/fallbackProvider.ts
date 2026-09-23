import { IRouteCoordinate, IRouteDetails, IRoutingProvider } from './types';

export class FallbackRoutingProvider implements IRoutingProvider {
  public readonly name = 'UrbanGeometricFallback';

  public isAvailable(): boolean {
    return true;
  }

  public async calculateRoute(
    origin: IRouteCoordinate,
    destination: IRouteCoordinate
  ): Promise<IRouteDetails> {
    const R = 6371; // Earth's radius in km
    const dLat = (destination.lat - origin.lat) * (Math.PI / 180);
    const dLon = (destination.lng - origin.lng) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(origin.lat * (Math.PI / 180)) *
        Math.cos(destination.lat * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const directDistance = R * c;

    // Urban street network curvature factor (Manhattan / city grid routing multiplier ~1.28)
    const urbanMultiplier = 1.28;
    const distanceKm = Math.max(0.5, Math.round(directDistance * urbanMultiplier * 10) / 10);

    // Dynamic speed based on time of day (rush hours in Riyadh 7-9am, 4-7pm)
    const currentHour = new Date().getHours();
    const isRushHour = (currentHour >= 7 && currentHour <= 9) || (currentHour >= 16 && currentHour <= 19);
    const avgUrbanSpeed = isRushHour ? 28 : 38; // km/h

    const hours = distanceKm / avgUrbanSpeed;
    const durationMinutes = Math.max(3, Math.ceil(hours * 60));

    return {
      distanceKm,
      durationMinutes,
      provider: this.name,
    };
  }

  public async calculateEta(origin: IRouteCoordinate, destination: IRouteCoordinate): Promise<number> {
    const route = await this.calculateRoute(origin, destination);
    return route.durationMinutes;
  }
}
