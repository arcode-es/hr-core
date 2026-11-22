import { formatAddress } from './geo.service';

describe('formatAddress', () => {
  it('calle, número, código postal y ciudad', () => {
    expect(
      formatAddress({
        display_name: 'largo…',
        address: { road: 'Calle de Xàtiva', house_number: '24', postcode: '46002', city: 'Valencia', state: 'Comunidad Valenciana', country: 'España' },
      }),
    ).toBe('Calle de Xàtiva 24, 46002 Valencia');
  });

  it('antepone el nombre propio del lugar', () => {
    expect(
      formatAddress({ name: 'Estación del Norte', address: { road: 'Calle de Xàtiva', house_number: '24', postcode: '46002', city: 'Valencia' } }),
    ).toBe('Estación del Norte, Calle de Xàtiva 24, 46002 Valencia');
  });

  it('no repite el nombre si coincide con la calle', () => {
    expect(formatAddress({ name: 'Calle Mayor', address: { road: 'Calle Mayor', town: 'Alcoy' } })).toBe('Calle Mayor, Alcoy');
  });

  it('en zona rural usa el municipio', () => {
    expect(formatAddress({ address: { village: 'Bocairent', postcode: '46880' } })).toBe('46880 Bocairent');
  });

  it('sin desglose recurre al texto completo', () => {
    expect(formatAddress({ display_name: 'Algún sitio' })).toBe('Algún sitio');
    expect(formatAddress({ display_name: 'Otro', address: {} })).toBe('Otro');
  });
});
