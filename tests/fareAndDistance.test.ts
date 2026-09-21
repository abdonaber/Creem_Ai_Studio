import { describe, it, expect } from 'vitest';
import { FareService } from '../server/services/fareService';

describe('Fare & Distance Calculation Engine', () => {
  it('calculates Haversine distance correctly between Riyadh coordinates', () => {
    // Kingdom Tower (24.7112, 46.6744) to KAFD (24.7743, 46.6386)
    const distance = FareService.calculateDistanceKm(24.7112, 46.6744, 24.7743, 46.6386);
    expect(distance).toBeGreaterThan(7);
    expect(distance).toBeLessThan(11);
  });

  it('enforces a minimum distance threshold of 0.5 km', () => {
    const distance = FareService.calculateDistanceKm(24.7112, 46.6744, 24.7112, 46.6744);
    expect(distance).toBe(0.5);
  });

  it('estimates duration based on distance', () => {
    const duration = FareService.estimateDurationMinutes(10);
    expect(duration).toBeGreaterThanOrEqual(15);
  });

  it('calculates fares across all vehicle categories with base and per-km rates', () => {
    const standardFare = FareService.calculateFare(10, 20, 'STANDARD', 1.0);
    const vipFare = FareService.calculateFare(10, 20, 'VIP', 1.0);
    const ecoFare = FareService.calculateFare(10, 20, 'ECO', 1.0);

    expect(standardFare.total).toBeGreaterThan(standardFare.baseFare);
    expect(vipFare.total).toBeGreaterThan(standardFare.total);
    expect(ecoFare.total).toBeLessThan(standardFare.total);
  });

  it('applies surge pricing multipliers correctly', () => {
    const normalFare = FareService.calculateFare(10, 20, 'STANDARD', 1.0);
    const surgeFare = FareService.calculateFare(10, 20, 'STANDARD', 1.5);

    expect(surgeFare.total).toBeCloseTo(normalFare.total * 1.5, 1);
  });
});
