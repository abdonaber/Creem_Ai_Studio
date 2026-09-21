import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { LocationCoordinate, IDriver } from '../../types';

interface MapViewProps {
  pickup?: LocationCoordinate | null;
  destination?: LocationCoordinate | null;
  driverLocation?: { lat: number; lng: number; heading?: number } | null;
  fleetDrivers?: IDriver[];
  onSelectLocation?: (coord: { lat: number; lng: number; address: string }, type: 'pickup' | 'destination') => void;
  selectionMode?: 'pickup' | 'destination' | null;
  className?: string;
  zoom?: number;
}

export const MapView: React.FC<MapViewProps> = ({
  pickup,
  destination,
  driverLocation,
  fleetDrivers = [],
  onSelectLocation,
  selectionMode,
  className = 'h-full w-full',
  zoom = 13,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const destinationMarkerRef = useRef<L.Marker | null>(null);
  const driverMarkerRef = useRef<L.Marker | null>(null);
  const fleetMarkersRef = useRef<L.Marker[]>([]);
  const polylineRef = useRef<L.Polyline | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialLat = pickup?.lat || 24.7136;
    const initialLng = pickup?.lng || 46.6753;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom,
      zoomControl: false,
    });

    // Dark/Clean CartoDB Positron / Voyager style map tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    map.on('click', (e) => {
      if (onSelectLocation && selectionMode) {
        onSelectLocation(
          {
            lat: e.latlng.lat,
            lng: e.latlng.lng,
            address: `إحداثيات (${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)})`,
          },
          selectionMode
        );
      }
    });

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Pickup Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (pickupMarkerRef.current) {
      map.removeLayer(pickupMarkerRef.current);
      pickupMarkerRef.current = null;
    }

    if (pickup) {
      const pickupIcon = L.divIcon({
        className: 'custom-pickup-marker',
        html: `
          <div class="relative flex items-center justify-center">
            <span class="absolute inline-flex h-8 w-8 animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <div class="relative flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg border-2 border-white ring-2 ring-emerald-500">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="6" />
              </svg>
            </div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      pickupMarkerRef.current = L.marker([pickup.lat, pickup.lng], { icon: pickupIcon })
        .addTo(map)
        .bindPopup(`<div class="font-bold text-slate-800 text-sm">نقطة الركوب</div><div class="text-xs text-slate-600">${pickup.address}</div>`);
    }
  }, [pickup]);

  // Update Destination Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (destinationMarkerRef.current) {
      map.removeLayer(destinationMarkerRef.current);
      destinationMarkerRef.current = null;
    }

    if (destination) {
      const destIcon = L.divIcon({
        className: 'custom-dest-marker',
        html: `
          <div class="relative flex items-center justify-center">
            <div class="flex h-9 w-9 items-center justify-center rounded-full bg-rose-600 text-white shadow-xl border-2 border-white ring-2 ring-rose-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </div>
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      });

      destinationMarkerRef.current = L.marker([destination.lat, destination.lng], { icon: destIcon })
        .addTo(map)
        .bindPopup(`<div class="font-bold text-slate-800 text-sm">الوجهة</div><div class="text-xs text-slate-600">${destination.address}</div>`);
    }
  }, [destination]);

  // Update Route Polyline & Auto-Fit Bounds
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    if (pickup && destination) {
      const latlngs: [number, number][] = [
        [pickup.lat, pickup.lng],
        // Add a slight realistic curve midpoint for natural road visualization
        [(pickup.lat + destination.lat) / 2 + 0.002, (pickup.lng + destination.lng) / 2 + 0.003],
        [destination.lat, destination.lng],
      ];

      const polyline = L.polyline(latlngs, {
        color: '#059669', // Emerald 600
        weight: 5,
        opacity: 0.85,
        dashArray: '8, 8',
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      polylineRef.current = polyline;

      const bounds = L.latLngBounds([
        [pickup.lat, pickup.lng],
        [destination.lat, destination.lng],
      ]);

      if (driverLocation) {
        bounds.extend([driverLocation.lat, driverLocation.lng]);
      }

      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
    }
  }, [pickup, destination]);

  // Update Driver Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (driverMarkerRef.current) {
      map.removeLayer(driverMarkerRef.current);
      driverMarkerRef.current = null;
    }

    if (driverLocation) {
      const heading = driverLocation.heading || 0;
      const driverCarIcon = L.divIcon({
        className: 'custom-driver-car-marker',
        html: `
          <div class="relative flex items-center justify-center transition-all duration-700" style="transform: rotate(${heading}deg)">
            <div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-emerald-400 shadow-2xl border-2 border-emerald-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.04 3H5.81l1.04-3zM19 17H5v-4.66l.12-.34h13.77l.11.34V17z"/>
                <circle cx="7.5" cy="14.5" r="1.5"/>
                <circle cx="16.5" cy="14.5" r="1.5"/>
              </svg>
            </div>
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });

      driverMarkerRef.current = L.marker([driverLocation.lat, driverLocation.lng], { icon: driverCarIcon })
        .addTo(map)
        .bindPopup('<div class="font-bold text-slate-900 text-sm">موقع الكابتن المباشر</div>');
    }
  }, [driverLocation]);

  // Update Fleet Markers (for Admin view)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    fleetMarkersRef.current.forEach((m) => map.removeLayer(m));
    fleetMarkersRef.current = [];

    if (fleetDrivers && fleetDrivers.length > 0) {
      fleetDrivers.forEach((driver) => {
        if (!driver.currentLocation) return;

        const fleetIcon = L.divIcon({
          className: 'custom-fleet-marker',
          html: `
            <div class="flex items-center justify-center">
              <div class="flex h-8 w-8 items-center justify-center rounded-xl ${
                driver.isOnline ? 'bg-emerald-600' : 'bg-slate-500'
              } text-white shadow-md border border-white">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.04 3H5.81l1.04-3z"/>
                </svg>
              </div>
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        const m = L.marker([driver.currentLocation.lat, driver.currentLocation.lng], { icon: fleetIcon })
          .addTo(map)
          .bindPopup(`
            <div class="p-1">
              <div class="font-bold text-slate-800">${driver.userName || 'كابتن'}</div>
              <div class="text-xs text-slate-500">${driver.vehicle?.make || ''} ${driver.vehicle?.model || ''} - ${driver.vehicle?.category || ''}</div>
              <div class="text-xs text-emerald-600 font-semibold mt-1">${driver.isOnline ? '🟢 متاح الآن' : '⚪ غير متصل'}</div>
            </div>
          `);

        fleetMarkersRef.current.push(m);
      });
    }
  }, [fleetDrivers]);

  return (
    <div className={`relative ${className} overflow-hidden rounded-2xl border border-slate-200 shadow-inner`}>
      <div ref={mapContainerRef} className="h-full w-full" />
      {selectionMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 text-white px-4 py-2 rounded-full text-xs font-medium shadow-lg backdrop-blur-md flex items-center gap-2 border border-slate-700">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></span>
          انقر على الخريطة لتحديد {selectionMode === 'pickup' ? 'نقطة الانطلاق' : 'الوجهة المطلوبة'}
        </div>
      )}
    </div>
  );
};
