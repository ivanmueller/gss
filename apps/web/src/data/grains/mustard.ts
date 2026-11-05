import type { Grain } from './types';

const grades = ['No. 1 Canada', 'No. 2 Canada', 'No. 3 Canada', 'No. 4 Canada'];
const cols = ['Grading factor', ...grades];
const soundness = [
  'Degree of soundness',
  'Reasonably well matured, sweet, good natural colour',
  'Fairly well matured, sweet, reasonably good colour',
  'May have the natural odour associated with low-quality seed not any odour that would indicate serious deterioration',
  'May have the natural odour associated with low-quality seed not any odour that would indicate serious deterioration',
];
const classNote =
  'Note: The class, whether yellow, oriental, brown or mixed is added to the grade name';

function mustardClass(
  type: 'Brown' | 'Oriental' | 'Yellow',
  variety: string[],
  damage: string[][],
  foreign: string[][],
  quality: string[][],
  mainVariety: string,
): Grain['classes'][number] {
  const name = `Domestic Mustard Seed, ${type}, Canada (CAN)`;
  return {
    name: `Domestic Mustard Seed, ${type}, Canada`,
    abbreviation: 'CAN',
    grades,
    gradesCitation: { source: 'cgc-oggg', where: `Chapter 12, ${name}, standard of quality` },
    facts: [
      {
        label: 'Main variety in 2025 harvest samples',
        value: mainVariety,
        source: 'cgc-mustard-2025',
        where: 'Variety information',
      },
    ],
    tables: [
      {
        title: 'Standard of quality',
        columns: cols,
        rows: [soundness, variety, ['Other classes %', '1', '2', '5', '10']],
        note: classNote,
        source: 'cgc-oggg',
        where: `Chapter 12, ${name}, standard of quality`,
      },
      {
        title: 'Damage, maximum',
        columns: cols,
        rows: damage,
        source: 'cgc-oggg',
        where: `Chapter 12, ${name}, damage`,
      },
      {
        title: 'Foreign material, maximum',
        columns: cols,
        rows: foreign,
        source: 'cgc-oggg',
        where: `Chapter 12, ${name}, foreign material`,
      },
      {
        title: 'Harvest quality by grade, 2025 (means, dry matter basis)',
        columns: [
          'Grade',
          'Location',
          'Number of samples',
          'Oil content (%)',
          'Protein content (%)',
          'Glucosinolates (µmol/g)',
        ],
        rows: quality,
        source: 'cgc-mustard-2025',
        where: `Table 1, Oil, protein and total glucosinolate content of 2025 western Canadian mustard seed, Domestic Mustard Seed, ${type}, Canada`,
      },
    ],
  };
}

const varietyAll = [
  'Variety',
  'Any variety of mustard registered under the Seeds Act',
  'Any variety of mustard registered under the Seeds Act',
  'Any variety of mustard registered under the Seeds Act',
  'Any variety of mustard',
];

export const mustard: Grain = {
  id: 'mustard',
  name: 'Mustard seed',
  symbol: 'Ms',
  number: 10,
  family: 'oilseed',
  otherNames: ['Domestic mustard seed'],
  commodities: ['mustard_seed'],
  tileFacts: ['Production in western Canada, 2025 (metric tonnes)'],
  facts: [
    {
      label: 'Classes',
      value: 'Domestic mustard seed is classed as yellow, brown or oriental, or mixed.',
      source: 'cgc-oggg',
      where: 'Chapter 12, Classes',
    },
    {
      label: 'Mixed',
      value: 'Yellow and brown mustard seed containing less than 90.0% of one class',
      source: 'cgc-oggg',
      where: 'Chapter 12, Classes, Identifying classes of domestic mustard seed',
    },
    {
      label: 'Varieties eligible for the top grades',
      value:
        'Only varieties registered in Canada under the Seeds Act are eligible for the top grades of domestic mustard seed.',
      source: 'cgc-oggg',
      where: 'Chapter 12, Grading factors, Variety (VAR)',
    },
    {
      label: 'Production in western Canada, 2025 (metric tonnes)',
      value: '139,802',
      source: 'cgc-mustard-2025',
      where: 'Production and grade information',
    },
    {
      label: 'Area seeded in western Canada, 2025 (hectares)',
      value: '146,200',
      source: 'cgc-mustard-2025',
      where: 'Production and grade information',
    },
    {
      label: 'Harvest samples graded No. 1, 2025 (%)',
      value: '44.6',
      source: 'cgc-mustard-2025',
      where: 'Production and grade information',
    },
  ],
  classes: [
    mustardClass(
      'Yellow',
      varietyAll,
      [
        ['Distinctly green %', '1.5', '1.5', '3.5', '3.5'],
        ['Heated %', '0.1', '0.2', '0.5', '1.0'],
        ['Total damage %', '1.5', '3.0', '5.0', '10.0'],
      ],
      [
        ['Cow cockle %', '0.1', '0.2', '0.3', '1.0'],
        ['Sclerotinia %', '0.1', '0.2', '0.3', '1.0'],
        ['Wild mustard, canola/rapeseed %', '0.1', '0.2', '0.3', '1.0'],
        ['Total distinctly detrimental %', '0.1', '0.2', '0.3', '1.0'],
        ['Total conspicuous inseparable seeds %', '0.3', '0.5', '0.7', '3.0'],
        ['Ergot %', '0.05', '0.05', '0.05', '0.05'],
        ['Excreta %', '0.01', '0.01', '0.01', '0.01'],
      ],
      [
        ['No. 1', 'Western Canada', '68', '30.4', '32.2', '157'],
        ['No. 1', 'Saskatchewan', '43', '30.2', '32.5', '159'],
        ['No. 1', 'Alberta', '25', '30.6', '31.8', '155'],
        ['No. 2', 'Western Canada', '41', '27.8', '35.7', '150'],
        ['No. 3', 'Western Canada', '19', '28.1', '34.8', '144'],
        ['No. 4', 'Western Canada', '22', '28.9', '33.4', '140'],
      ],
      'Andante and AAC Yellow 80',
    ),
    mustardClass(
      'Brown',
      varietyAll,
      [
        ['Distinctly green %', '1.5', '2.0', '3.5', '3.5'],
        ['Heated %', '0.1', '0.2', '0.5', '1.0'],
        ['Total damage %', '1.5', '3.0', '5.0', '10.0'],
      ],
      [
        ['Cow cockle %', '0.1', '0.2', '0.3', '1.0'],
        ['Sclerotinia %', '0.1', '0.2', '0.3', '1.0'],
        ['Total distinctly detrimental %', '0.1', '0.2', '0.3', '1.0'],
        ['Total conspicuous inseparable seeds %', '0.3', '0.5', '0.7', '3.0'],
        ['Inconspicuous admixture %', '1.0', '1.0', '1.0', '1.0'],
        ['Ergot %', '0.05', '0.05', '0.05', '0.05'],
        ['Excreta %', '0.01', '0.01', '0.01', '0.01'],
      ],
      [
        ['No. 1', 'Western Canada', '30', '34.9', '30.3', '136'],
        ['No. 1', 'Saskatchewan', '27', '35.0', '30.2', '135'],
        ['No. 1', 'Alberta', '3', '33.6', '31.3', '144'],
        ['No. 2', 'Canada', '9', '33.8', '31.9', '146'],
        ['No. 3', 'Canada', '10', '34.7', '31.0', '138'],
      ],
      'Centennial Brown',
    ),
    mustardClass(
      'Oriental',
      [
        'Variety',
        'Any variety of mustard registered under the Seeds Act',
        'Any variety of mustard registered under the Seeds Act',
        'Any variety of mustard registered under the Seeds Act',
        '—',
      ],
      [
        ['Distinctly green %', '1.5', '1.5', '3.5', '3.5'],
        ['Heated %', '0.1', '0.2', '0.5', '1.0'],
        ['Total damage %', '1.5', '3.0', '5.0', '10.0'],
      ],
      [
        ['Cow cockle %', '0.1', '0.2', '0.3', '1.0'],
        ['Sclerotinia %', '0.1', '0.2', '0.3', '1.0'],
        ['Total distinctly detrimental %', '0.1', '0.2', '0.3', '1.0'],
        ['Total conspicuous inseparable seeds %', '0.3', '0.5', '0.7', '3.0'],
        ['Inconspicuous admixture %', '0.5', '1.0', '1.0', '1.0'],
        ['Ergot %', '0.05', '0.05', '0.05', '0.05'],
        ['Excreta %', '0.01', '0.01', '0.01', '0.01'],
      ],
      [
        ['No. 1', 'Western Canada', '10', '40.2', '27.9', '142'],
        ['No. 1', 'Saskatchewan', '6', '41.3', '27.4', '147'],
        ['No. 1', 'Alberta', '4', '38.5', '28.7', '135'],
      ],
      'Forge',
    ),
  ],
  tables: [
    {
      title: 'Moisture: straight, tough and damp',
      columns: ['Mustard seed (domestic)', 'Straight (%)', 'Tough (%)', 'Damp (%)'],
      rows: [
        ['Yellow mustard', 'less than 9.6', '9.6-12.5', 'over 12.5'],
        ['Brown mustard', 'less than 9.6', '9.6-12.5', 'over 12.5'],
        ['Oriental mustard', 'less than 9.6', '9.6-12.5', 'over 12.5'],
      ],
      source: 'cgc-oggg',
      where: 'Chapter 2, Moisture specifications',
    },
    {
      title:
        'Domestic Mustard Seed, No. 1 Canada: oil, protein and glucosinolates (dry matter basis)',
      columns: [
        'Class',
        'Oil 2025 (%)',
        'Oil 2024 (%)',
        'Oil 5-year mean (%)',
        'Protein 2025 (%)',
        'Protein 2024 (%)',
        'Protein 5-year mean (%)',
        'Glucosinolates 2025 (µmol/g)',
        'Glucosinolates 5-year mean (µmol/g)',
      ],
      rows: [
        ['Oriental', '40.2', '34.2', '36.3', '27.9', '31.1', '30.0', '142', '139'],
        ['Brown', '34.9', '32.1', '33.3', '30.3', '32.0', '31.1', '136', '133'],
        ['Yellow', '30.4', '24.1', '25.7', '32.2', '36.5', '35.3', '157', '150'],
      ],
      note: 'Harvest Sample Program, western Canada. 5-year mean: 2020 to 2024.',
      source: 'cgc-mustard-2025',
      where: 'Summary; Figures 8 to 11',
    },
    {
      title: 'Oil composition of No. 1 mustard seed, western Canada, 2025',
      columns: [
        'Class',
        'Oleic C18:1 (%)',
        'Linoleic C18:2 (%)',
        'Linolenic C18:3 (%)',
        'Erucic C22:1 (%)',
        'Iodine value (units)',
        'Chlorophyll (mg/kg)',
        'FFA (%)',
      ],
      rows: [
        ['Oriental', '21.8', '22.3', '11.6', '21.9', '116.6', '0.6', '0.14'],
        ['Brown', '19.6', '20.9', '13.8', '23.2', '119.5', '4.3', '0.10'],
        ['Yellow', '27.6', '9.2', '10.4', '32.7', '101.9', '1.8', '0.05'],
      ],
      note: 'Relative fatty acid composition of the oil.',
      source: 'cgc-mustard-2025',
      where:
        'Table 2, Relative fatty acid composition of the oil, chlorophyll content and free fatty acid content of 2025 western Canadian mustard seed (No. 1, Western Canada rows)',
    },
  ],
};
