import { IRouteCoordinate, IRouteDetails, IRoutingProvider } from './types';
import { logger } from '../../utils/logger';

export class MapboxProvider implements IRoutingProvider {
  public readonly name = 'Mapbox';
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  public isAvailable(): boolean {
    return Boolean(this.accessToken && this.accessToken.trim().length > 0);
  }

  public async calculateRoute(
    origin: IRouteCoordinate,
    destination: IRouteCoordinate
  ): Promise<IRouteDetails> {
    if (!this.isAvailable()) {
      throw new Error('Mapbox access token is not configured.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordinates}?geometries=polyline&overview=full&access_token=${this.accessToken}`;
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Mapbox HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error(`Mapbox API error: code=${data.code}, message=${data.message || 'No route found'}`);
      }

      const route = data.routes[0];
      const distanceKm = Math.round((route.distance / 1000) * 10) / 10;
      const durationMinutes = Math.max(2, Math.ceil(route.duration / 60));

      return {
        distanceKm,
        durationMinutes,
        polyline: route.geometry,
        provider: this.name,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      logger.warn(`[MapboxProvider] Routing calculation failed: ${err.message}`);
      throw err;
    }
  }

  public async calculateEta(origin: IRouteCoordinate, destination: IRouteCoordinate): Promise<number> {
    const route = await this.calculateRoute(origin, destination);
    return route.durationMinutes;
  }
}
