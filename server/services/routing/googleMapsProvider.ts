import { IRouteCoordinate, IRouteDetails, IRoutingProvider } from './types';
import { logger } from '../../utils/logger';

export class GoogleMapsProvider implements IRoutingProvider {
  public readonly name = 'GoogleMaps';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  public isAvailable(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  public async calculateRoute(
    origin: IRouteCoordinate,
    destination: IRouteCoordinate
  ): Promise<IRouteDetails> {
    if (!this.isAvailable()) {
      throw new Error('Google Maps API key is not configured.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&departure_time=now&key=${this.apiKey}`;
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Google Maps HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      if (data.status !== 'OK' || !data.routes || data.routes.length === 0) {
        throw new Error(`Google Maps API error: status=${data.status}, message=${data.error_message || 'No route found'}`);
      }

      const route = data.routes[0];
      const leg = route.legs[0];
      const distanceMeters = leg.distance.value;
      const durationSeconds = leg.duration_in_traffic ? leg.duration_in_traffic.value : leg.duration.value;

      const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;
      const durationMinutes = Math.max(2, Math.ceil(durationSeconds / 60));
      const polyline = route.overview_polyline ? route.overview_polyline.points : undefined;

      return {
        distanceKm,
        durationMinutes,
        polyline,
        provider: this.name,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      logger.warn(`[GoogleMapsProvider] Routing calculation failed: ${err.message}`);
      throw err;
    }
  }

  public async calculateEta(origin: IRouteCoordinate, destination: IRouteCoordinate): Promise<number> {
    const route = await this.calculateRoute(origin, destination);
    return route.durationMinutes;
  }
}
