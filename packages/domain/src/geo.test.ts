import { describe, expect, it } from 'vitest';

import { parseBbox } from './geo';

describe('parseBbox', () => {
  it('reads west,south,east,north in degrees', () => {
    expect(parseBbox('-110.5,49,-95.25,60.123456')).toEqual({
      west: -110.5,
      south: 49,
      east: -95.25,
      north: 60.123456,
    });
  });

  it('accepts the edges of the world and a box a millionth of a degree wide', () => {
    expect(parseBbox('-180,-90,180,90')).toEqual({ west: -180, south: -90, east: 180, north: 90 });
    expect(parseBbox('-97,49,-96.999999,49.000001')).toEqual({
      west: -97,
      south: 49,
      east: -96.999999,
      north: 49.000001,
    });
  });

  it.each([
    ['', 'empty'],
    ['-110,49,-95', 'three values'],
    ['-110,49,-95,60,0', 'five values'],
    ['-110, 49, -95, 60', 'spaces'],
    ['-110,49,-95,', 'an empty value'],
    ['-1.1e2,49,-95,60', 'an exponent'],
    ['+110,49,120,60', 'a plus sign'],
    ['Infinity,49,-95,60', 'not a number'],
    ['0x10,49,20,60', 'hexadecimal'],
    ['-110.,49,-95,60', 'a trailing point'],
    ['-110,49,-95,60.1234567890123456', 'more than 15 decimals'],
    ['-180.000001,49,-95,60', 'west beyond -180'],
    ['-110,49,180.5,60', 'east beyond 180'],
    ['-110,-90.5,-95,60', 'south beyond -90'],
    ['-110,49,-95,91', 'north beyond 90'],
    ['170,49,-170,60', 'a box crossing the antimeridian'],
    ['-110,60,-95,49', 'south above north'],
    ['-97,49,-97,60', 'no width'],
    ['-110,49,-95,49', 'no height'],
  ])('refuses %j (%s)', (text) => {
    expect(parseBbox(text)).toBeNull();
  });
});
