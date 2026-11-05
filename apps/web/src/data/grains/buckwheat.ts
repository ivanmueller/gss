import type { Grain } from './types';

export const buckwheat: Grain = {
  id: 'buckwheat',
  name: 'Buckwheat',
  symbol: 'Bw',
  number: 19,
  family: 'special',
  commodities: [],
  tileFacts: ['No. 1 Canada minimum test weight'],
  facts: [
    {
      label: 'No. 1 Canada minimum test weight',
      value: '58 (285)',
      source: 'cgc-oggg',
      where: 'Chapter 13, Buckwheat, Canada (CAN), standard of quality (kg/hL (g/0.5 L))',
    },
    {
      label: 'Size',
      value: 'The size, large or small, is added to the grade name',
      source: 'cgc-oggg',
      where: 'Chapter 13, Grading factors, Size',
    },
    {
      label: 'Varieties eligible for No. 1 and No. 2 Canada',
      value: 'Any variety of buckwheat registered under the Seeds Act',
      source: 'cgc-oggg',
      where: 'Chapter 13, Buckwheat, Canada (CAN), standard of quality',
    },
    {
      label: 'Commercially clean export shipments',
      value: 'when the net dockage does not exceed 2.5% of the sample weight',
      source: 'cgc-oggg',
      where: 'Chapter 13, Export shipments, Commercially clean (CCLN)',
    },
  ],
  classes: [
    {
      name: 'Buckwheat, Canada',
      abbreviation: 'CAN',
      grades: ['No. 1 Canada', 'No. 2 Canada', 'No. 3 Canada'],
      gradesCitation: {
        source: 'cgc-oggg',
        where: 'Chapter 13, Buckwheat, Canada (CAN), standard of quality',
      },
      tables: [
        {
          title: 'Standard of quality',
          columns: ['Grading factor', 'No. 1 Canada', 'No. 2 Canada', 'No. 3 Canada'],
          rows: [
            [
              'Degree of soundness',
              'Cool and sweet',
              'Cool and sweet',
              'May have a ground or grassy odour, not musty or sour',
            ],
            ['Minimum test weight kg/hL (g/0.5 L)', '58 (285)', '55 (270)', 'No minimum'],
          ],
          note: 'The size may be added to the grade name.',
          source: 'cgc-oggg',
          where: 'Chapter 13, Buckwheat, Canada (CAN), standard of quality',
        },
        {
          title: 'Damage, maximum',
          columns: ['Grading factor', 'No. 1 Canada', 'No. 2 Canada', 'No. 3 Canada'],
          rows: [
            ['Dehulled %', '1', '2', '5'],
            ['Immature %', '1.5', '1.5', '5.0'],
            ['Total damage %', '4', '8', '20'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 13, Buckwheat, Canada (CAN), damage',
        },
        {
          title: 'Foreign material, maximum',
          columns: ['Grading factor', 'No. 1 Canada', 'No. 2 Canada', 'No. 3 Canada'],
          rows: [
            ['Cereal grains %', '1.0', '2.5', '5.0'],
            ['Ergot %', '0.00', '0.05', '0.25'],
            ['Excreta %', '0.01', '0.01', '0.01'],
            ['Matter other than cereal grains %', '0.2', '1.0', '2.0'],
            ['Sclerotinia %', '0.00', '0.05', '0.25'],
            ['Stones %', '0.03', '0.03', '0.03'],
            ['Total foreign material %', '1', '3', '5'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 13, Buckwheat, Canada (CAN), foreign material',
        },
      ],
    },
  ],
  tables: [
    {
      title: 'Moisture: straight, tough and damp',
      columns: ['Buckwheat', 'Straight (%)', 'Tough (%)', 'Damp (%)'],
      rows: [['Buckwheat', 'less than 16.1', '16.1-18.0', 'over 18.0']],
      source: 'cgc-oggg',
      where: 'Chapter 2, Moisture specifications',
    },
    {
      title: 'Size: large or small',
      columns: ['Percentage of kernels passing through the No. 8 slotted sieve', 'Size'],
      rows: [
        ['20.0 or less', 'Large'],
        ['More than 20.0', 'Small'],
      ],
      note: "Size is evaluated using a No. 8 slotted sieve; for example, 'Buckwheat, No. 1 Canada Large'.",
      source: 'cgc-oggg',
      where: 'Chapter 13, Grading factors, Size',
    },
  ],
};
