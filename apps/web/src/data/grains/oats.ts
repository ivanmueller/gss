import type { Grain } from './types';

export const oats: Grain = {
  id: 'oats',
  name: 'Oats',
  symbol: 'Oa',
  number: 4,
  family: 'coarse',
  commodities: ['oats'],
  tileFacts: ['No. 1 CW minimum test weight (kg/hL)'],
  facts: [
    {
      label: 'No. 1 CW minimum test weight (kg/hL)',
      value: '56',
      source: 'cgc-oggg',
      where: 'Chapter 7, Oats, Canada Western (CW), standard of quality (kg/hL)',
    },
    {
      label: 'Varieties eligible for grades 1 to 3',
      value: 'Any variety of oats registered under the Seeds Act',
      source: 'cgc-oggg',
      where: 'Chapter 7, Oats, Canada Western (CW), standard of quality',
    },
    {
      label: 'Area seeded in Canada, 2025 (million hectares)',
      value: '1.213',
      source: 'cgc-oats-2025',
      where: 'Table 3 (Statistics Canada, estimated as of September 17, 2025)',
    },
  ],
  classes: [
    {
      name: 'Oats, Canada Western',
      abbreviation: 'CW',
      region: 'Western',
      grades: ['No. 1 CW', 'No. 2 CW', 'No. 3 CW', 'No. 4 CW'],
      gradesCitation: {
        source: 'cgc-oggg',
        where: 'Chapter 7, Oats, Canada Western (CW), standard of quality',
      },
      tables: [
        {
          title: 'Standard of quality',
          columns: ['Grading factor', 'No. 1 CW', 'No. 2 CW', 'No. 3 CW', 'No. 4 CW'],
          rows: [
            [
              'Degree of soundness',
              'Good colour, 98% sound groats',
              'Good colour, 96% sound groats',
              'Fair colour, 94% sound groats',
              'Poor colour, 92% sound groats',
            ],
            ['Minimum test weight kg/hL (g/0.5 L)', '56 (260)', '53 (245)', '51 (235)', '48 (220)'],
            ['Hulled and hulless %', '6', '8', '20', 'No limit'],
          ],
          note: 'Samples of Oats, CW will be graded no lower than No. 4 CW account colour.',
          source: 'cgc-oggg',
          where: 'Chapter 7, Oats, Canada Western (CW), standard of quality',
        },
        {
          title: 'Damage, maximum',
          columns: ['Grading factor', 'No. 1 CW', 'No. 2 CW', 'No. 3 CW', 'No. 4 CW'],
          rows: [
            ['Fireburnt %', '0.0', '0.0', '0.0', '0.2'],
            ['Frost %', '0.1', '4.0', '6.0', 'No limit.'],
            ['Fusarium %', '0.1', '2.0', '4.0', '6.0'],
            ['Heated / rotted %', '0.0', '0.1', '0.5', '1.0'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 7, Oats, Canada Western (CW), damage',
        },
      ],
    },
    {
      name: 'Oats, Canada Eastern',
      abbreviation: 'CE',
      region: 'Eastern',
      grades: ['No. 1 CE', 'No. 2 CE', 'No. 3 CE', 'No. 4 CE'],
      gradesCitation: {
        source: 'cgc-oggg',
        where: 'Chapter 7, Oats, Canada Eastern (CE), standard of quality',
      },
      tables: [
        {
          title: 'Standard of quality',
          columns: ['Grading factor', 'No. 1 CE', 'No. 2 CE', 'No. 3 CE', 'No. 4 CE'],
          rows: [['Minimum test weight kg/hL (g/0.5 L)', '51 (235)', '49 (225)', '46 (210)', '43 (195)']],
          source: 'cgc-oggg',
          where: 'Chapter 7, Oats, Canada Eastern (CE), standard of quality',
        },
      ],
    },
  ],
  tables: [
    {
      title: 'Moisture: straight, tough and damp',
      columns: ['Oats', 'Straight (%)', 'Tough (%)', 'Damp (%)'],
      rows: [
        ['Hulled oats', 'less than 13.6', '13.6-17.0', 'over 17.0'],
        ['Hulless oats', 'less than 13.6', '13.6-17.0', 'over 17.0'],
      ],
      source: 'cgc-oggg',
      where: 'Chapter 2, Moisture specifications',
    },
    {
      title: 'Average protein by grade, western Canada (%, dry basis)',
      columns: ['Year', 'No. 1 CW', 'No. 2 CW', 'No. 3 CW'],
      rows: [
        ['2025', '11.5', '12.1', '12.3'],
        ['5-year average', '11.8', '12.2', '12.2'],
      ],
      note: 'Harvest Sample Program, preliminary, as of October 24, 2025.',
      source: 'cgc-oats-2025',
      where: 'Figure 2, graph data',
    },
    {
      title: 'Milling varieties in Alberta trials',
      columns: ['Variety', 'Test weight (lb/bu)', 'TKW (g)', 'Height (cm)', 'Lodging resistance', 'Smuts', 'BYDV'],
      rows: [
        ['CS Camden', '40', '41', '99', 'VG', 'I', 'S'],
        ['AAC Anthony', '39', '45', '104', 'G', 'R', 'R'],
        ['AAC Douglas', '39', '43', '101', 'G', 'R', 'I'],
        ['AAC Fedak', '40', '45', '98', 'VG', 'R', 'MS'],
        ['AAC Neville', '41', '41', '94', 'VG', 'R', 'R'],
        ['AAC Wesley', '40', '40', '93', 'VG', 'R', 'R'],
        ['AC Morgan', '41', '42', '105', 'VG', 'I', 'MS'],
        ['CDC Anson', '40', '41', '88', 'VG', 'R', 'MS'],
        ['CDC Arborg', '41', '40', '109', 'G', 'R', 'S'],
        ['CDC Byer', '40', '40', '98', 'VG', 'R', 'I'],
        ['CDC Endure', '41', '40', '105', 'G', 'R', 'I'],
        ['CDC Hank', '39', '40', '103', 'VG', 'R', 'MS'],
        ['Kalio', '40', '39', '97', 'G', 'R', 'NT'],
        ['Kyron', '40', '40', '99', 'G', 'R', 'NT'],
        ['ORe 3542M', '40', '39', '97', 'VG', 'R', 'S'],
        ['ORe Level48', '40', '41', '98', 'G', 'R', 'XX'],
      ],
      note: 'VG very good, G good; R resistant, I intermediate, MS moderately susceptible, S susceptible; NT not tested; XX insufficient data. TKW: thousand kernel weight.',
      source: 'asg-rvt-2026',
      where: 'Oat, Milling',
    },
  ],
};
