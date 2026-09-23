import { IRouteCoordinate, IRouteDetails, IRoutingProvider } from './types';
import { GoogleMapsProvider } from './googleMapsProvider';
import { MapboxProvider } from './mapboxProvider';
import { OSRMProvider } from './osrmProvider';
import { FallbackRoutingProvider } from './fallbackProvider';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export class RoutingService {
  private static googleProvider = new GoogleMapsProvider(config.mapsApiKey);
  private static mapboxProvider = new MapboxProvider(config.mapboxAccessToken);
  private static osrmProvider = new OSRMProvider();
  private static fallbackProvider = new FallbackRoutingProvider();

  public static getActiveProvider(): IRoutingProvider {
    if (config.routingProvider === 'mapbox' && this.mapboxProvider.isAvailable()) {
      return this.mapboxProvider;
    }
    if (config.routingProvider === 'google' && this.googleProvider.isAvailable()) {
      return this.googleProvider;
    }
    if (config.routingProvider === 'osrm') {
      return this.osrmProvider;
    }

    // Auto resolution: Google -> Mapbox -> OSRM -> Geometric fallback
    if (this.googleProvider.isAvailable()) {
      return this.googleProvider;
    }
    if (this.mapboxProvider.isAvailable()) {
      return this.mapboxProvider;
    }
    return this.osrmProvider;
  }

  public static async calculateRoute(
    origin: IRouteCoordinate,
    destination: IRouteCoordinate
  ): Promise<IRouteDetails> {
    const primary = this.getActiveProvider();

    try {
      return await primary.calculateRoute(origin, destination);
    } catch (primaryErr: any) {
      logger.warn(
        `[RoutingService] Primary provider ${primary.name} failed: ${primaryErr.message}. Cascading to fallback providers.`
      );

      // Attempt Mapbox if primary wasn't Mapbox
      if (primary.name !== 'Mapbox' && this.mapboxProvider.isAvailable()) {
        try {
          return await this.mapboxProvider.calculateRoute(origin, destination);
        } catch {
          // Continue to next provider
        }
      }

      // Attempt OSRM if primary wasn't OSRM
      if (primary.name !== 'OSRM') {
        try {
          return await this.osrmProvider.calculateRoute(origin, destination);
        } catch {
          // Continue to fallback
        }
      }

      // Final resilient urban road topology fallback
      return await this.fallbackProvider.calculateRoute(origin, destination);
    }
  }

  public static async calculateEta(
    origin: IRouteCoordinate,
    destination: IRouteCoordinate
  ): Promise<number> {
    const route = await this.calculateRoute(origin, destination);
    return route.durationMinutes;
  }
}
