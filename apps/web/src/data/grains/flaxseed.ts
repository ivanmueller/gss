import type { Grain } from './types';

const soundness = [
  'Degree of soundness',
  'Mature and sweet',
  'Reasonably well matured and sweet',
  'Excluded from higher grades on account of light weight or damaged seeds, may have the natural odour associated with low-quality seed, not distinctly sour, musty, rancid or any odour that would indicate serious deterioration',
];

export const flaxseed: Grain = {
  id: 'flaxseed',
  name: 'Flaxseed',
  symbol: 'Fx',
  number: 8,
  family: 'oilseed',
  commodities: ['flaxseed'],
  tileFacts: ['No. 1 CW minimum test weight (kg/hL)', 'Oil content, brown No. 1 CW, 2025 (%)'],
  facts: [
    {
      label: 'No. 1 CW minimum test weight (kg/hL)',
      value: '65',
      source: 'cgc-oggg',
      where: 'Chapter 11, Flaxseed, Canada Western (CW), standard of quality (kg/hL (g/0.5 L))',
    },
    {
      label: 'Brown and yellow flaxseed',
      value:
        'Brown flaxseed applies to varieties with brown seed coats. Yellow flaxseed applies to varieties with yellow seed coats.',
      source: 'cgc-oggg',
      where: 'Chapter 11, Classes and varieties',
    },
    {
      label: 'Varieties eligible for the top grades',
      value:
        'Only varieties registered in Canada under the Seeds Act are eligible for the top grades of flaxseed.',
      source: 'cgc-oggg',
      where: 'Chapter 11, Grading factors, Variety (VAR)',
    },
    {
      label: 'Oil content, brown No. 1 CW, 2025 (%)',
      value: '45.1',
      source: 'cgc-flaxseed-2025',
      where:
        'Table 1, Quality data for 2025 harvest samples of brown flaxseed graded No. 1 CW (dry matter basis)',
    },
    {
      label: 'Area seeded in western Canada, 2025 (thousand hectares)',
      value: '619.2',
      source: 'cgc-flaxseed-2025',
      where:
        'Table 5, Seeded area and production of western Canadian flaxseed in 2025 (Statistics Canada)',
    },
    {
      label: 'Production in western Canada, 2025 (thousand metric tonnes)',
      value: '453.1',
      source: 'cgc-flaxseed-2025',
      where:
        'Table 5, Seeded area and production of western Canadian flaxseed in 2025 (Statistics Canada)',
    },
  ],
  classes: [
    {
      name: 'Flaxseed, Canada Western',
      abbreviation: 'CW',
      region: 'Western',
      grades: ['No. 1 CW', 'No. 2 CW', 'No. 3 CW'],
      gradesCitation: {
        source: 'cgc-oggg',
        where: 'Chapter 11, Flaxseed, Canada Western (CW), standard of quality',
      },
      tables: [
        {
          title: 'Standard of quality',
          columns: ['Grading factor', 'No. 1 CW', 'No. 2 CW', 'No. 3 CW'],
          rows: [
            soundness,
            ['Minimum test weight kg/hL (g/0.5 L)', '65 (305)', '62 (290)', 'No minimum'],
            [
              'Variety',
              'Any variety of flaxseed registered under the Seeds Act',
              'Any variety of flaxseed registered under the Seeds Act',
              'Any variety of flaxseed',
            ],
            ['Yellow seeded flax % (in brown flax)', '2', '3', '4'],
            ['Brown seeded flax % (in yellow flax)', '2', '2', '2'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 11, Flaxseed, Canada Western (CW), standard of quality',
        },
        {
          title: 'Damage, maximum',
          columns: ['Grading factor', 'No. 1 CW', 'No. 2 CW', 'No. 3 CW'],
          rows: [
            ['Broken %', '13', '25', '35'],
            ['Heated %', '0.1', '0.2', '10.0'],
            ['Total damage %', '13', '25', 'No limit'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 11, Flaxseed, Canada Western (CW), damage',
        },
        {
          title: 'Foreign material included in dockage, maximum',
          columns: ['Grading factor', 'No. 1 CW', 'No. 2 CW', 'No. 3 CW'],
          rows: [
            ['Ergot %', '0.05', '0.05', '0.05'],
            ['Sclerotinia %', '0.10', '0.20', '0.25'],
            ['Stones %', '0.05', '0.05', '0.05'],
            ['Inseparable seeds %', '1.0', '1.5', '2.0'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 11, Flaxseed, Canada Western (CW), foreign material included in dockage',
        },
      ],
    },
    {
      name: 'Flaxseed, Canada Eastern',
      abbreviation: 'CE',
      region: 'Eastern',
      grades: ['No. 1 CE', 'No. 2 CE', 'No. 3 CE'],
      gradesCitation: {
        source: 'cgc-oggg',
        where: 'Chapter 11, Flaxseed, Canada Eastern (CE), standard of quality',
      },
      tables: [
        {
          title: 'Standard of quality',
          columns: ['Grading factor', 'No. 1 CE', 'No. 2 CE', 'No. 3 CE'],
          rows: [
            ['Minimum test weight kg/hL (g/0.5 L)', '65 (305)', '62 (290)', 'No minimum'],
            ['Yellow seeded flax % (in brown flax)', '2', '3', '4'],
            ['Brown seeded flax % (in yellow flax)', '2', '2', '2'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 11, Flaxseed, Canada Eastern (CE), standard of quality',
        },
        {
          title: 'Damage, maximum',
          columns: ['Grading factor', 'No. 1 CE', 'No. 2 CE', 'No. 3 CE'],
          rows: [
            ['Broken %', '13', '25', '35'],
            ['Heated %', '0.1', '0.2', '10.0'],
            ['Total damage %', '13', '25', 'No limit'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 11, Flaxseed, Canada Eastern (CE), damage',
        },
      ],
    },
  ],
  tables: [
    {
      title: 'Moisture: straight, tough and damp',
      columns: ['Grain', 'Straight (%)', 'Tough (%)', 'Damp (%)'],
      rows: [['Flaxseed', 'less than 10.1', '10.1-13.5', 'over 13.5']],
      source: 'cgc-oggg',
      where: 'Chapter 2, Moisture specifications',
    },
    {
      title: 'Harvest quality of brown flaxseed, No. 1 CW',
      columns: ['Quality parameter', '2025', '2024', '2020 to 2024 mean'],
      rows: [
        ['Oil content', '45.1', '44.5', '44.8'],
        ['Protein content', '23.1', '24.7', '24.6'],
        ['Free fatty acids, %', '0.3', '0.2', '0.2'],
        ['Iodine value, units in oil', '191.3', '192.0', '188.7'],
      ],
      note: 'Oil and protein in %, dry matter basis; protein calculated from nitrogen (N) content using N x 6.25.',
      source: 'cgc-flaxseed-2025',
      where: 'Table 1, Quality data for 2025 harvest samples of brown flaxseed graded No. 1 CW',
    },
    {
      title: 'Harvest quality of yellow flaxseed, No. 1 CW',
      columns: ['Quality parameter', '2025', '2024', '2020 to 2024 mean'],
      rows: [
        ['Oil content', '46.1', '44.9', '45.7'],
        ['Protein content', '24.3', '25.6', '25.0'],
        ['Free fatty acids, %', '0.3', '0.2', '0.2'],
        ['Iodine value, units in oil', '195.4', '194.3', '198.0'],
      ],
      note: 'Oil and protein in %, dry matter basis. The report’s summary and Figure 6 give the 2020 to 2024 mean iodine value of yellow flaxseed as 198.5 units, and Figure 3 gives its 2020 to 2024 mean protein as 25.1%.',
      source: 'cgc-flaxseed-2025',
      where: 'Table 3, Quality data for 2025 harvest samples of yellow flaxseed graded No. 1 CW',
    },
    {
      title: 'Brown flaxseed, No. 1 CW, by province, 2025 (means)',
      columns: [
        'Location',
        'Number of samples',
        'Oil content (%)',
        'Protein content (%)',
        'Iodine value (units)',
      ],
      rows: [
        ['Manitoba', '8', '44.6', '23.7', '193.0'],
        ['Saskatchewan', '91', '45.2', '23.0', '190.7'],
        ['Alberta', '15', '45.3', '23.1', '193.4'],
        ['Western Canada', '114', '45.1', '23.3', '193.0'],
      ],
      note: 'As printed in Table 6; the report’s Table 1 gives the western Canada means as 23.1% protein and 191.3 units.',
      source: 'cgc-flaxseed-2025',
      where:
        'Table 6, Oil content, protein content and iodine value for 2025 harvest samples of brown flaxseed graded No. 1 CW',
    },
    {
      title: 'Flax varieties in Alberta trials',
      columns: [
        'Variety',
        'Seed colour',
        'Yield (% CDC Glas)',
        'Maturity (days +/- CDC Glas)',
        'Seed size',
        'Height (cm)',
        'Lodging resistance',
        'Powdery mildew',
        'Oil (%)',
        'ALA (%)',
        'Iodine value',
      ],
      rows: [
        ['CDC Glas', 'brown', '100', '108', 'M', '62', 'G', 'MR', '46', '57', '192'],
        ['AAC Marvelous', 'brown', '101', '1', 'M', '60', 'G', 'MR', '47', '56', '192'],
        ['CDC Bethune', 'brown', '96', '-1', 'M', '61', 'G', 'MR', '46', '55', '189'],
        ['CDC Dorado', 'yellow', '89', '-2', 'L', '55', 'G', 'MR', '45', '64', '204'],
        ['CDC Esme', 'brown', '105', '4', 'L', '61', 'G', 'NT', '46', '59', '195'],
        ['CDC Kernen', 'brown', '101', '2', 'M', '64', 'G', 'MR', '45', '57', '191'],
        ['CDC Neela', 'brown', '104', '0', 'M', '54', 'G', 'MR', '46', '59', '194'],
        ['CDC Plava', 'brown', '96', '-3', 'M', '51', 'G', 'NT', '47', '57', '196'],
        ['CDC Rowland', 'brown', '104', '4', 'L', '61', 'G', 'MR', '45', '59', '195'],
        ['CDC Sorrel', 'brown', '104', '0', 'L', '61', 'F', 'MR', '45', '58', '193'],
        ['VT50', 'yellow', '98', '3', 'S', '49', 'VG', 'NT', '47', '68', '209'],
        ['WestLin 60', 'brown', '95', '-2', 'M', '48', 'G', 'NT', '46', '60', '198'],
        ['WestLin 72', 'brown', '96', '2', 'S', '51', 'VG', 'MR', '47', '57', '193'],
      ],
      note: 'Maturity column as printed: Rating (Days +/- CDC Glas). CDC Glas overall yield: 44 bu/ac. Yield and agronomic data only directly comparable to CDC Glas. All listed varieties are immune to flax rust and MR to Fusarium wilt. NT - Not tested for disease. Data heavily weighted on Saskatchewan registration data. AAC Marvelous, CDC Bethune, CDC Neela, CDC Plava and CDC Sorrel are flagged for possible removal in 2027.',
      source: 'asg-rvt-2026',
      where: 'Flax',
    },
  ],
};
