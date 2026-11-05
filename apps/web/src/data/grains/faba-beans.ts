import type { Grain } from './types';

const OGGG = 'Chapter 21, Faba beans, Canada (CAN)';
const GRADES = ['No. 1 Canada', 'No. 2 Canada', 'No. 3 Canada'];
const COLUMNS = ['Grading factor', ...GRADES];

export const fabaBeans: Grain = {
  id: 'faba-beans',
  name: 'Faba beans',
  symbol: 'Fb',
  number: 16,
  family: 'pulse',
  commodities: ['faba_beans'],
  tileFacts: ['Straight moisture'],
  facts: [
    {
      label: 'Varieties eligible for the top grades',
      value: 'Any variety of faba beans registered under the Seeds Act',
      source: 'cgc-oggg',
      where: `${OGGG}, standard of quality`,
    },
    {
      label: 'Straight moisture',
      value: 'less than 16.1',
      source: 'cgc-oggg',
      where: 'Chapter 2, Moisture specifications, Faba beans',
    },
    {
      label: 'Flower colour and tannin',
      value: 'W = white flower, low tannin; C = colored flower, tannin',
      source: 'asg-rvt-2026',
      where: 'Faba bean, remarks',
    },
  ],
  classes: [
    {
      name: 'Faba beans, Canada',
      abbreviation: 'CAN',
      grades: GRADES,
      gradesCitation: { source: 'cgc-oggg', where: `${OGGG}, standard of quality` },
      tables: [
        {
          title: 'Standard of quality',
          columns: COLUMNS,
          rows: [
            [
              'Degree of soundness',
              'Reasonably well matured, reasonably good natural colour',
              'Fairly well matured, fair colour',
              'Cool and sweet, excluded from higher grades on account of immaturity, poor colour or damage',
            ],
            [
              'Variety',
              'Any variety of faba beans registered under the Seeds Act',
              'Any variety of faba beans registered under the Seeds Act',
              'Any variety of faba beans',
            ],
            ['Splits %', '6', '9', '12'],
          ],
          source: 'cgc-oggg',
          where: `${OGGG}, standard of quality`,
        },
        {
          title: 'Damage, maximum',
          columns: COLUMNS,
          rows: [
            ['Heated or rotted %', '0.0', '0.3', '1.0'],
            ['Mouldy %', '0.0', '0.6', '2.0'],
            ['Perforated damage %', '1', '3', '3'],
            ['Total damage %', '4', '6', '10'],
          ],
          source: 'cgc-oggg',
          where: `${OGGG}, damage`,
        },
        {
          title: 'Foreign material, maximum',
          columns: COLUMNS,
          rows: [
            ['Ergot %', '0.05', '0.05', '0.05'],
            ['Excreta %', '0.01', '0.01', '0.01'],
            ['Insect parts %', '0.02', '0.02', '0.02'],
            ['Sclerotinia %', '0.05', '0.05', '0.05'],
            ['Stones or shale %', '0.1', '0.2', '0.5'],
            ['Total foreign material %', '0.2', '0.5', '2.0'],
          ],
          source: 'cgc-oggg',
          where: `${OGGG}, foreign material`,
        },
      ],
    },
  ],
  tables: [
    {
      title: 'Moisture: straight, tough and damp',
      columns: ['Faba beans', 'Straight (%)', 'Tough (%)', 'Damp (%)'],
      rows: [['Faba beans', 'less than 16.1', '16.1-18.0', 'over 18.0']],
      source: 'cgc-oggg',
      where: 'Chapter 2, Moisture specifications',
    },
    {
      title: 'Faba bean varieties in Alberta trials',
      columns: [
        'Variety',
        'Type',
        'Flower colour',
        'Low vicine/convicine',
        'Most recent year of RVT testing',
        'Overall yield (% of Fabelle)',
        'Overall site years of testing',
        'Maturity (days)',
        'Plant height (cm)',
        'Thousand seed weight (g)',
      ],
      rows: [
        ['Fabelle', 'Tannin', 'C', 'Yes', '2025', '100', '86', '105', '104', '533'],
        ['219-16', 'Low Tannin', 'W', 'No', '2023', '85', '58', '106', '94', '328'],
        ['CDC 1089', 'Low Tannin', 'W', 'Yes', '2025', '97', '17', '106', '96', '375'],
        ['CDC 1142', 'Low Tannin', 'W', 'Yes', '2025', '85', '17', '107', '90', '341'],
        ['CDC 1310', 'Low Tannin', 'W', 'Yes', '2025', '93', '17', '106', '99', '341'],
        ['Dosis', 'Tannin', 'C', 'Yes', '2025', '92', '27', '103', '106', '521'],
        ['Futura', 'Tannin', 'C', 'Yes', '2025', '103', '28', '106', '107', '530'],
        ['Hammer', 'Tannin', 'C', 'Yes', '2025', '105', '20', '106', '102', '536'],
        ['Juno', 'Low Tannin', 'W', 'Yes', '2025', '92', '15', '108', '96', '423'],
        ['Navi', 'Low Tannin', 'W', 'Yes', '2025', '90', '17', '111', '94', '401'],
        ['Snowbird', 'Low Tannin', 'W', 'No', '2022', '90', '51', '104', '95', '448'],
        ['Victus', 'Tannin', 'C', 'Yes', '2024', '99', '24', '105', '101', '444'],
      ],
      note: 'Yield and agronomic data only directly comparable to Fabelle (overall yield 78 bu/ac). Flower Colour: W = white flower, low tannin; C = colored flower, tannin. All colored flower types have seed coats that contain tannins and may be suitable for export food markets if seed size and quality match customer demand. Varieties tested for a minimum of three years are considered fully tested.',
      source: 'asg-rvt-2026',
      where: 'Faba bean',
    },
  ],
};
