import type { Grain } from './types';

export const corn: Grain = {
  id: 'corn',
  name: 'Corn',
  symbol: 'Co',
  number: 6,
  family: 'coarse',
  commodities: ['corn'],
  tileFacts: ['No. 1 CW and No. 1 CE minimum test weight'],
  facts: [
    {
      label: 'No. 1 CW and No. 1 CE minimum test weight',
      value: '68 (343)',
      source: 'cgc-oggg',
      where:
        'Chapter 17, Corn, Canada Western (CW) and Canada Eastern (CE) Yellow, White or Mixed, standard of quality (kg/hL (g/0.5 L))',
    },
    {
      label: 'Classes',
      value: 'Corn is classed as yellow, white, or mixed',
      source: 'cgc-oggg',
      where: 'Chapter 17, Grading factors, Classes',
    },
    {
      label: 'Mixed',
      value:
        'Samples of yellow and white corn containing less than 95% of one class are designated Mixed',
      source: 'cgc-oggg',
      where: 'Chapter 17, Grading factors, Classes',
    },
    {
      label: 'Varieties eligible',
      value: 'Any variety of corn',
      source: 'cgc-oggg',
      where: 'Chapter 17, Corn, Canada Western and Canada Eastern, standard of quality',
    },
    {
      label: 'Test weight',
      value: 'Test weight for corn is determined before removing cracked corn and foreign material',
      source: 'cgc-test-weight',
      where: 'Determining test weight',
    },
  ],
  classes: [
    {
      name: 'Corn, Canada Western Yellow, White or Mixed',
      abbreviation: 'CW',
      region: 'Western',
      grades: ['No. 1 CW', 'No. 2 CW', 'No. 3 CW', 'No. 4 CW', 'No. 5 CW'],
      gradesCitation: {
        source: 'cgc-oggg',
        where: 'Chapter 17, Corn, Canada Western Yellow, White or Mixed (CW), standard of quality',
      },
      tables: [
        {
          title: 'Standard of quality',
          columns: ['Grading factor', 'No. 1 CW', 'No. 2 CW', 'No. 3 CW', 'No. 4 CW', 'No. 5 CW'],
          rows: [
            [
              'Degree of soundness',
              'Cool and sweet, uniform size',
              'Cool and sweet',
              'Cool and sweet',
              'Cool and sweet',
              'May have a slight odour, not sour or musty',
            ],
            [
              'Minimum test weight kg/hL (g/0.5 L)',
              '68 (343)',
              '66 (333)',
              '64 (322)',
              '62 (311)',
              '58 (291)',
            ],
            ['Other classes %', '5', '5', '5', '5', '5'],
          ],
          note: 'The colour is added to the grade name.',
          source: 'cgc-oggg',
          where:
            'Chapter 17, Corn, Canada Western Yellow, White or Mixed (CW), standard of quality',
        },
        {
          title: 'Damage, maximum',
          columns: ['Grading factor', 'No. 1 CW', 'No. 2 CW', 'No. 3 CW', 'No. 4 CW', 'No. 5 CW'],
          rows: [
            ['Heated %', '0.1', '0.2', '0.5', '1.0', '3.0'],
            ['Total damage %', '3', '5', '7', '10', '15'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 17, Corn, Canada Western Yellow, White or Mixed (CW), damage',
        },
        {
          title: 'Foreign material, maximum',
          columns: ['Grading factor', 'No. 1 CW', 'No. 2 CW', 'No. 3 CW', 'No. 4 CW', 'No. 5 CW'],
          rows: [
            ['Excreta %', '0.02', '0.02', '0.02', '0.02', '0.02'],
            ['Total cracked corn and foreign material %', '2', '3', '5', '7', '12'],
            ['Stones %', '0.15', '0.15', '0.15', '0.15', '0.15'],
          ],
          note: 'Stones are not included in total cracked corn and foreign material (CCFM).',
          source: 'cgc-oggg',
          where: 'Chapter 17, Corn, Canada Western Yellow, White or Mixed (CW), foreign material',
        },
      ],
    },
    {
      name: 'Corn, Canada Eastern Yellow, White or Mixed',
      abbreviation: 'CE',
      region: 'Eastern',
      grades: ['No. 1 CE', 'No. 2 CE', 'No. 3 CE', 'No. 4 CE', 'No. 5 CE'],
      gradesCitation: {
        source: 'cgc-oggg',
        where: 'Chapter 17, Corn, Canada Eastern Yellow, White or Mixed (CE), standard of quality',
      },
      tables: [
        {
          title: 'Standard of quality',
          columns: ['Grading factor', 'No. 1 CE', 'No. 2 CE', 'No. 3 CE', 'No. 4 CE', 'No. 5 CE'],
          rows: [
            [
              'Degree of soundness',
              'Cool and sweet, uniform size',
              'Cool and sweet',
              'Cool and sweet',
              'Cool and sweet',
              'May have a slight odour, not sour or musty',
            ],
            [
              'Minimum test weight kg/hL (g/0.5 L)',
              '68 (343)',
              '66 (333)',
              '64 (322)',
              '62 (311)',
              '58 (291)',
            ],
            ['Other classes %', '5', '5', '5', '5', '5'],
          ],
          note: 'The colour is added to the grade name.',
          source: 'cgc-oggg',
          where:
            'Chapter 17, Corn, Canada Eastern Yellow, White or Mixed (CE), standard of quality',
        },
        {
          title: 'Damage, maximum',
          columns: ['Grading factor', 'No. 1 CE', 'No. 2 CE', 'No. 3 CE', 'No. 4 CE', 'No. 5 CE'],
          rows: [
            ['Heated %', '0.1', '0.2', '0.5', '1.0', '3.0'],
            ['Total damage %', '3', '5', '7', '10', '15'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 17, Corn, Canada Eastern Yellow, White or Mixed (CE), damage',
        },
        {
          title: 'Foreign material, maximum',
          columns: ['Grading factor', 'No. 1 CE', 'No. 2 CE', 'No. 3 CE', 'No. 4 CE', 'No. 5 CE'],
          rows: [
            ['Excreta %', '0.02', '0.02', '0.02', '0.02', '0.02'],
            ['Total cracked corn and foreign material %', '2', '3', '5', '7', '12'],
            ['Stones %', '0.15', '0.15', '0.15', '0.15', '0.15'],
          ],
          note: 'Stones are not included in total cracked corn and foreign material (CCFM).',
          source: 'cgc-oggg',
          where: 'Chapter 17, Corn, Canada Eastern Yellow, White or Mixed (CE), foreign material',
        },
      ],
    },
  ],
  tables: [
    {
      title: 'Moisture: straight, tough, damp, moist and wet',
      columns: ['Corn', 'Straight (%)', 'Tough (%)', 'Damp (%)', 'Moist (%)', 'Wet (%)'],
      rows: [
        [
          'Under 19.9% moisture',
          'less than 15.6',
          '15.6-17.5',
          '17.6-21.0',
          '21.1-25.0',
          'Over 25.0',
        ],
        [
          '20.0% moisture and over',
          'less than 15.6',
          '15.6-17.5',
          '17.6-21.0',
          '21.1-25.0',
          'Over 25.0',
        ],
      ],
      note: 'For 20.0% moisture and over: adjusted moisture value using table 11A result and according to test weight.',
      source: 'cgc-oggg',
      where: 'Chapter 2, Moisture specifications',
    },
    {
      title: 'Estimating test weight of well-matured corn after drying: amount to add',
      columns: ['Moisture range', 'kg/hL', 'g/0.5 L'],
      rows: [
        ['15.8 - 16.4', '0.5', '2.6'],
        ['16.5 - 16.9', '1.0', '5.2'],
        ['17.0 - 17.3', '2.0', '10.5'],
        ['17.4 - 17.6', '2.1', '11.0'],
        ['17.7 - 17.9', '2.2', '11.5'],
        ['18.0 - 18.3', '2.3', '12.0'],
        ['18.4 - 18.6', '2.4', '12.5'],
        ['18.7 - 18.9', '2.5', '13.0'],
      ],
      note: 'This is only a guide and works only with well matured corn. Corn samples are not to be downgraded on the basis of an estimated test weight. Questionable samples must be dried by exposure and then have the test weight determined.',
      source: 'cgc-oggg',
      where: 'Chapter 17, Estimating test weight of well-matured corn after drying',
    },
  ],
};
