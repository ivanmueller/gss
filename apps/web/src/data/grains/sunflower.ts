import type { Grain } from './types';

const cols = ['Grading factor', 'No. 1 Canada', 'No. 2 Canada'];

export const sunflower: Grain = {
  id: 'sunflower',
  name: 'Sunflower seed',
  symbol: 'Sf',
  number: 11,
  family: 'oilseed',
  commodities: ['sunflower_seed'],
  tileFacts: ['No. 1 Canada Oil minimum test weight (kg/hL)'],
  facts: [
    {
      label: 'Classes',
      value: 'There are two classes of sunflower seeds: Confectionary and Oil.',
      source: 'cgc-oggg',
      where: 'Chapter 14, Classes',
    },
    {
      label: 'How the class is determined',
      value:
        'The method of determining the class of sunflower seed is by the size and colour of the sunflower seed hull.',
      source: 'cgc-oggg',
      where: 'Chapter 14, Classes',
    },
    {
      label: 'No. 1 Canada Oil minimum test weight (kg/hL)',
      value: '35',
      source: 'cgc-oggg',
      where: 'Chapter 14, Sunflower Seed, Canada Oil (CAN), standard of quality (kg/hL (g/0.5 L))',
    },
    {
      label: 'No. 1 Canada Confectionery minimum test weight (kg/hL)',
      value: '31',
      source: 'cgc-oggg',
      where:
        'Chapter 14, Sunflower Seed, Canada Confectionery (CAN), standard of quality (kg/hL (g/0.5 L))',
    },
    {
      label: 'Varieties eligible for the top grades',
      value:
        'Only varieties registered in Canada under the Seeds Act are eligible for the top grades of sunflower seed.',
      source: 'cgc-oggg',
      where: 'Chapter 14, Grading factors, Variety (VAR)',
    },
  ],
  classes: [
    {
      name: 'Sunflower Seed, Canada Confectionery',
      abbreviation: 'CAN',
      grades: ['No. 1 Canada', 'No. 2 Canada'],
      gradesCitation: {
        source: 'cgc-oggg',
        where: 'Chapter 14, Sunflower Seed, Canada Confectionery (CAN), standard of quality',
      },
      facts: [
        {
          label: 'Description',
          value:
            'Confectionary sunflower seeds typically have dark grey hulls with whitish portions along the edges, or white stripes or blotches. They are larger than oil sunflower seeds.',
          source: 'cgc-oggg',
          where: 'Chapter 14, Classes',
        },
      ],
      tables: [
        {
          title: 'Standard of quality',
          columns: cols,
          rows: [
            ['Degree of soundness', 'Well matured and sweet', 'Reasonably well matured and sweet'],
            ['Minimum test weight kg/hL (g/0.5 L)', '31 (155)', '29 (144)'],
            [
              'Variety',
              'Any variety of confectionary sunflower registered under the Seeds Act',
              'Any variety of confectionary sunflower',
            ],
            ['Dehulled seeds %', '5', '5'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 14, Sunflower Seed, Canada Confectionery (CAN), standard of quality',
        },
        {
          title: 'Damage, maximum',
          columns: cols,
          rows: [
            ['Head rot %', '2', '5'],
            ['Heated %', '0.5', '1.0'],
            ['Insect damage %', '2', '4'],
            ['Total damage %', '4', '8'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 14, Sunflower Seed, Canada Confectionery (CAN), damage',
        },
        {
          title: 'Foreign material included in dockage, maximum',
          columns: cols,
          rows: [
            ['Excreta %', '0.01', '0.01'],
            ['Other grains %', '2.5', '2.5'],
            ['Sclerotinia %', '1', '2'],
            ['Soft earth pellets %', '2.5', '2.5'],
            ['Stones %', '0.1', '0.1'],
          ],
          source: 'cgc-oggg',
          where:
            'Chapter 14, Sunflower Seed, Canada Confectionery (CAN), foreign material included in dockage',
        },
      ],
    },
    {
      name: 'Sunflower Seed, Canada Oil',
      abbreviation: 'CAN',
      grades: ['No. 1 Canada', 'No. 2 Canada'],
      gradesCitation: {
        source: 'cgc-oggg',
        where: 'Chapter 14, Sunflower Seed, Canada Oil (CAN), standard of quality',
      },
      facts: [
        {
          label: 'Description',
          value:
            'Oil sunflower seeds have hulls that are almost solid black in colour, although faint stripes may be visible. They are smaller than confectionary sunflower seeds.',
          source: 'cgc-oggg',
          where: 'Chapter 14, Classes',
        },
      ],
      tables: [
        {
          title: 'Standard of quality',
          columns: cols,
          rows: [
            ['Degree of soundness', 'Well matured and sweet', 'Reasonably well matured and sweet'],
            ['Minimum test weight kg/hL (g/0.5 L)', '35 (169)', '31 (148)'],
            [
              'Variety',
              'Any variety of oil sunflower registered under the Seeds Act',
              'Any variety of oil sunflower',
            ],
            ['Dehulled seeds %', '5', '5'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 14, Sunflower Seed, Canada Oil (CAN), standard of quality',
        },
        {
          title: 'Damage, maximum',
          columns: cols,
          rows: [
            ['Head rot %', '2', '5'],
            ['Heated %', '0.5', '1.0'],
            ['Insect damage %', '2', '4'],
            ['Total damage %', '5', '10'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 14, Sunflower Seed, Canada Oil (CAN), damage',
        },
        {
          title: 'Foreign material included in dockage, maximum',
          columns: cols,
          rows: [
            ['Excreta %', '0.02', '0.02'],
            ['Other grains %', '2.5', '2.5'],
            ['Sclerotinia %', '1', '2'],
            ['Soft earth pellets %', '2.5', '2.5'],
            ['Stones %', '0.1', '0.1'],
          ],
          source: 'cgc-oggg',
          where:
            'Chapter 14, Sunflower Seed, Canada Oil (CAN), foreign material included in dockage',
        },
      ],
    },
  ],
  tables: [
    {
      title: 'Moisture specifications',
      columns: ['Grain', 'Straight (%)', 'Tough (%)', 'Damp (%)', 'Moist (%)', 'Wet (%)'],
      rows: [
        ['Sunflower seed', 'less than 9.6', '9.6-13.5', '13.6-17.0', '17.1-22.0', 'over 22.0'],
      ],
      note: 'Moisture meter: calibrate at 73.',
      source: 'cgc-oggg',
      where: 'Chapter 2, Moisture specifications',
    },
  ],
};
