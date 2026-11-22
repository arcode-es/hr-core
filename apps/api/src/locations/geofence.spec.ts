import { evaluateGeofence } from './geofence';

describe('evaluateGeofence', () => {
  it('dentro del radio', () => {
    expect(evaluateGeofence(150, 200)).toEqual({ within: true, outsideByMeters: 0 });
    expect(evaluateGeofence(200, 200)).toEqual({ within: true, outsideByMeters: 0 });
  });

  it('fuera del radio indica cuántos metros faltan', () => {
    expect(evaluateGeofence(260.2, 200)).toEqual({ within: false, outsideByMeters: 61 });
  });

  it('la imprecisión del GPS juega a favor del trabajador', () => {
    expect(evaluateGeofence(220, 200, 30)).toEqual({ within: true, outsideByMeters: 0 });
  });

  it('pero el margen está limitado a 50 m', () => {
    expect(evaluateGeofence(600, 200, 800)).toEqual({ within: false, outsideByMeters: 350 });
  });

  it('ignora precisiones negativas', () => {
    expect(evaluateGeofence(210, 200, -5)).toEqual({ within: false, outsideByMeters: 10 });
  });
});
