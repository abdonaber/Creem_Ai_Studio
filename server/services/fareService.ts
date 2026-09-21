import { VehicleCategory } from '../types';

export class FareService {
  /**
   * Calculates Haversine distance in kilometers between two GPS coordinates
   */
  public static calculateDistanceKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) *
        Math.cos(this.deg2rad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c;
    return Math.max(0.5, Math.round(d * 10) / 10); // Minimum 0.5 km
  }

  private static deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Estimates duration in minutes based on urban driving speed (avg 35 km/h)
   */
  public static estimateDurationMinutes(distanceKm: number): number {
    const avgSpeedKmH = 35;
    const hours = distanceKm / avgSpeedKmH;
    const minutes = Math.ceil(hours * 60);
    return Math.max(3, minutes); // Minimum 3 minutes
  }

  /**
   * Calculates fare based on category and dynamic parameters
   */
  public static calculateFare(
    distanceKm: number,
    durationMinutes: number,
    category: VehicleCategory = 'STANDARD',
    surgeMultiplier: number = 1.0
  ): {
    baseFare: number;
    distanceFare: number;
    timeFare: number;
    subtotal: number;
    surgeMultiplier: number;
    total: number;
  } {
    const rates: Record<
      VehicleCategory,
      { base: number; perKm: number; perMin: number; minimumFare: number }
    > = {
      ECO: { base: 8, perKm: 1.5, perMin: 0.35, minimumFare: 12 },
      STANDARD: { base: 10, perKm: 1.8, perMin: 0.45, minimumFare: 15 },
      COMFORT: { base: 15, perKm: 2.4, perMin: 0.6, minimumFare: 22 },
      VIP: { base: 25, perKm: 3.5, perMin: 0.9, minimumFare: 35 },
    };

    const rate = rates[category] || rates.STANDARD;

    const baseFare = rate.base;
    const distanceFare = distanceKm * rate.perKm;
    const timeFare = durationMinutes * rate.perMin;
    const subtotal = baseFare + distanceFare + timeFare;
    const calculatedTotal = Math.max(rate.minimumFare, subtotal * surgeMultiplier);

    return {
      baseFare: Math.round(baseFare * 100) / 100,
      distanceFare: Math.round(distanceFare * 100) / 100,
      timeFare: Math.round(timeFare * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100,
      surgeMultiplier,
      total: Math.round(calculatedTotal * 100) / 100,
    };
  }
}
