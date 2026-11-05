import type { Grain } from './types';

const cols = ['Grading factor', 'No. 1 Canada', 'No. 2 Canada', 'No. 3 Canada'];

export const safflower: Grain = {
  id: 'safflower',
  name: 'Safflower seed',
  symbol: 'Sa',
  number: 12,
  family: 'oilseed',
  commodities: [],
  tileFacts: ['No. 1 Canada empty hulls, maximum (%)'],
  facts: [
    {
      label: 'No. 1 Canada empty hulls, maximum (%)',
      value: '0.5',
      source: 'cgc-oggg',
      where: 'Chapter 15, Safflower Seed, Canada (CAN), standard of quality',
    },
    {
      label: 'Varieties eligible for the top grades',
      value:
        'Only varieties registered in Canada under the Seeds Act are eligible for the top grades of safflower seed.',
      source: 'cgc-oggg',
      where: 'Chapter 15, Grading factors, Variety (VAR)',
    },
  ],
  classes: [
    {
      name: 'Safflower Seed, Canada',
      abbreviation: 'CAN',
      grades: ['No. 1 Canada', 'No. 2 Canada', 'No. 3 Canada'],
      gradesCitation: {
        source: 'cgc-oggg',
        where: 'Chapter 15, Safflower Seed, Canada (CAN), standard of quality',
      },
      tables: [
        {
          title: 'Standard of quality',
          columns: cols,
          rows: [
            [
              'Variety',
              'Any variety of safflower registered under the Seeds Act',
              'Any variety of safflower registered under the Seeds Act',
              'Any variety of safflower',
            ],
            ['Empty hulls %', '0.5', '1.0', '2.0'],
            ['Dehulled seeds %', '2', '5', '8'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 15, Safflower Seed, Canada (CAN), standard of quality',
        },
        {
          title: 'Damage, maximum',
          columns: cols,
          rows: [
            ['Heated %', '0.0', '0.0', '1.0'],
            ['Total damage %', '3', '10', '10'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 15, Safflower Seed, Canada (CAN), damage',
        },
        {
          title: 'Foreign material, maximum',
          columns: cols,
          rows: [
            ['Excreta %', '0.02', '0.02', '0.02'],
            ['Material other than cereal grains %', '0.2', '0.5', '1.0'],
            ['Stones %', '0.1', '0.1', '0.1'],
            ['Total foreign material %', '0.5', '2.0', '5.0'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 15, Safflower Seed, Canada (CAN), foreign material',
        },
      ],
    },
  ],
  tables: [
    {
      title: 'Moisture specifications',
      columns: ['Grain', 'Straight (%)', 'Tough (%)', 'Damp (%)', 'Moist (%)', 'Wet (%)'],
      rows: [
        ['Safflower seed', 'less than 9.6', '9.6-13.5', '13.6-17.0', '17.1-22.0', 'over 22.0'],
      ],
      note: 'Moisture meter: calibrate at 73.',
      source: 'cgc-oggg',
      where: 'Chapter 2, Moisture specifications',
    },
  ],
};
