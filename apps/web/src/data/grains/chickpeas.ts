import type { Grain } from './types';

const KABULI = 'Chapter 22, Chickpeas, Canada Western Kabuli (CW)';
const DESI = 'Chapter 22, Chickpeas, Canada Western Desi (CW)';
const GRADES = ['No. 1 CW', 'No. 2 CW', 'No. 3 CW'];
const COLUMNS = ['Grading factor', ...GRADES];
const FOREIGN_MATERIAL: string[][] = [
  ['Ergot %', '0.05', '0.05', '0.05'],
  ['Excreta %', '0.01', '0.01', '0.01'],
  ['Insect parts %', '0.02', '0.02', '0.02'],
  ['Total foreign material %', '0.1', '0.2', '0.2'],
];

export const chickpeas: Grain = {
  id: 'chickpeas',
  name: 'Chickpeas',
  symbol: 'Ch',
  number: 17,
  family: 'pulse',
  commodities: ['chickpeas'],
  tileFacts: ['Straight moisture'],
  facts: [
    {
      label: 'Classes',
      value: 'There are two classes of chickpeas, Kabuli and Desi.',
      source: 'cgc-oggg',
      where: 'Chapter 22, Classes, types and varieties, Classes',
    },
    {
      label: 'Class in the grade name',
      value: 'Chickpeas, No. 1 CW Kabuli',
      source: 'cgc-oggg',
      where: 'Chapter 22, Classes, types and varieties, Classes',
    },
    {
      label: 'How the class is determined',
      value: 'by the size and colour of the chickpea',
      source: 'cgc-oggg',
      where: 'Chapter 22, Classes, types and varieties, Classes',
    },
    {
      label: 'Straight moisture',
      value: 'less than 14.1',
      source: 'cgc-oggg',
      where: 'Chapter 2, Moisture specifications, Chickpeas',
    },
  ],
  classes: [
    {
      name: 'Chickpeas, Canada Western Kabuli',
      abbreviation: 'CW',
      region: 'Western',
      grades: GRADES,
      gradesCitation: { source: 'cgc-oggg', where: `${KABULI}, standard of quality` },
      facts: [
        {
          label: 'Description',
          value:
            'Kabuli chickpeas are typically whitish to light tan in colour however there are new varieties that are black or green in color.',
          source: 'cgc-oggg',
          where: 'Chapter 22, Classes, types and varieties, Classes',
        },
      ],
      tables: [
        {
          title: 'Standard of quality',
          columns: COLUMNS,
          rows: [
            ['Colour', 'Good natural colour', 'Fair colour', 'Poor colour'],
            [
              'Variety',
              'Any variety of Kabuli Chickpeas',
              'Any variety of Kabuli Chickpeas',
              'Any variety of Kabuli Chickpeas',
            ],
          ],
          source: 'cgc-oggg',
          where: `${KABULI}, standard of quality`,
        },
        {
          title: 'Damage, maximum',
          columns: COLUMNS,
          rows: [
            ['Damage %', '0.5', '1.0', '2.0'],
            ['Mechanical damage including splits %', '1', '2', '3'],
            ['Green %', '0.5', '1.0', '2.0'],
          ],
          source: 'cgc-oggg',
          where: `${KABULI}, damage`,
        },
        {
          title: 'Foreign material, maximum',
          columns: COLUMNS,
          rows: FOREIGN_MATERIAL,
          source: 'cgc-oggg',
          where: `${KABULI}, foreign material`,
        },
      ],
    },
    {
      name: 'Chickpeas, Canada Western Desi',
      abbreviation: 'CW',
      region: 'Western',
      grades: GRADES,
      gradesCitation: { source: 'cgc-oggg', where: `${DESI}, standard of quality` },
      facts: [
        {
          label: 'Description',
          value: 'Desi chickpeas are typically brown in colour and smaller than Kabuli.',
          source: 'cgc-oggg',
          where: 'Chapter 22, Classes, types and varieties, Classes',
        },
      ],
      tables: [
        {
          title: 'Standard of quality',
          columns: COLUMNS,
          rows: [
            [
              'Variety',
              'Any variety of Desi Chickpeas',
              'Any variety of Desi Chickpeas',
              'Any variety of Desi Chickpeas',
            ],
          ],
          source: 'cgc-oggg',
          where: `${DESI}, standard of quality`,
        },
        {
          title: 'Damage, maximum',
          columns: COLUMNS,
          rows: [
            ['Damage %', '1', '2', '3'],
            ['Mechanical damage including splits %', '2.0', '3.5', '5.0'],
            ['Green %', '1.0', '2.0', '3.0'],
          ],
          source: 'cgc-oggg',
          where: `${DESI}, damage`,
        },
        {
          title: 'Foreign material, maximum',
          columns: COLUMNS,
          rows: FOREIGN_MATERIAL,
          source: 'cgc-oggg',
          where: `${DESI}, foreign material`,
        },
      ],
    },
  ],
  tables: [
    {
      title: 'Moisture: straight, tough and damp',
      columns: ['Chickpeas', 'Straight (%)', 'Tough (%)', 'Damp (%)'],
      rows: [['Chickpeas', 'less than 14.1', '14.1-16.0', 'over 16.0']],
      source: 'cgc-oggg',
      where: 'Chapter 2, Moisture specifications',
    },
  ],
};
