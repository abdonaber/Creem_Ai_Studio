import { IRouteCoordinate, IRouteDetails, IRoutingProvider } from './types';
import { logger } from '../../utils/logger';

/**
 * Open Source Routing Machine (OSRM) Provider
 * Uses real-world road networks and topological routing without requiring third-party API keys.
 */
export class OSRMProvider implements IRoutingProvider {
  public readonly name = 'OSRM';
  private baseUrl: string;

  constructor(baseUrl: string = 'https://router.project-osrm.org') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  public isAvailable(): boolean {
    return true;
  }

  public async calculateRoute(
    origin: IRouteCoordinate,
    destination: IRouteCoordinate
  ): Promise<IRouteDetails> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
      const url = `${this.baseUrl}/route/v1/driving/${coordinates}?overview=full&geometries=polyline`;

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`OSRM HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error(`OSRM API error: code=${data.code}, message=${data.message || 'No route found'}`);
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
      logger.warn(`[OSRMProvider] Road network calculation failed: ${err.message}`);
      throw err;
    }
  }

  public async calculateEta(origin: IRouteCoordinate, destination: IRouteCoordinate): Promise<number> {
    const route = await this.calculateRoute(origin, destination);
    return route.durationMinutes;
  }
}
