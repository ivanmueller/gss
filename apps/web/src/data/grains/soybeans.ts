import type { Grain } from './types';

const cls = 'Soybeans, Canada Yellow, Green, Brown, Black or Mixed (CAN)';
const grades = ['No. 1 Canada', 'No. 2 Canada', 'No. 3 Canada', 'No. 4 Canada', 'No. 5 Canada'];
const cols = ['Grading factor', ...grades];

export const soybeans: Grain = {
  id: 'soybeans',
  name: 'Soybeans',
  symbol: 'Sb',
  number: 9,
  family: 'oilseed',
  commodities: ['soybeans'],
  tileFacts: ['No. 1 Canada minimum test weight (kg/hL)'],
  facts: [
    {
      label: 'No. 1 Canada minimum test weight (kg/hL)',
      value: '70',
      source: 'cgc-oggg',
      where: `Chapter 20, ${cls}, standard of quality (kg/hL (g/0.5 L))`,
    },
    {
      label: 'Colours',
      value:
        'Soybeans may be yellow, green, brown, black or mixed. Colour is part of the grade name; for example, ‘Soybeans, No. 1 Canada Yellow’.',
      source: 'cgc-oggg',
      where: 'Chapter 20, Classes, types and varieties',
    },
    {
      label: 'Protein basis',
      value: 'Protein content in soybeans is reported on a dry matter basis.',
      source: 'cgc-oggg',
      where: 'Chapter 20, Grading factors, Protein (PROT)',
    },
    {
      label: 'Varieties eligible for the top grades',
      value:
        'Only varieties registered in Canada under the Seeds Act are eligible for the top grades of soybeans.',
      source: 'cgc-oggg',
      where: 'Chapter 20, Grading factors, Variety (VAR)',
    },
    {
      label: 'Protein content, food-type soybeans, 2025 (g/100 g dry matter)',
      value: '40.7',
      source: 'cgc-soybean-food-2025',
      where: 'Protein and oil content; Table 1, All grades, Canada',
    },
    {
      label: 'Oil content, oilseed-type exports No. 2 Canada Yellow, 2025-2026 (%, dry basis)',
      value: '21.7',
      source: 'cgc-soybean-oilseed-2025-export',
      where: 'August 1, 2025 to July 31, 2026: quality data for export samples',
    },
  ],
  classes: [
    {
      name: 'Soybeans, Canada Yellow, Green, Brown, Black or Mixed',
      abbreviation: 'CAN',
      grades,
      gradesCitation: { source: 'cgc-oggg', where: `Chapter 20, ${cls}, standard of quality` },
      tables: [
        {
          title: 'Standard of quality',
          columns: cols,
          rows: [
            [
              'Degree of soundness',
              'Cool, natural odour, good natural colour',
              'Cool, natural odour, may be slightly stained',
              'Cool, natural odour; may be stained',
              'Cool, may be stained',
              'Cool, may be stained',
            ],
            [
              'Minimum test weight kg/hL (g/0.5 L)',
              '70 (356)',
              '68 (346)',
              '66 (335)',
              '63 (320)',
              '59 (298)',
            ],
            ['Other colours %', '2', '3', '5', '10', '15'],
          ],
          note: 'Variety: any variety of soybeans registered under the Seeds Act for No. 1 to No. 4 Canada; any variety of soybeans for No. 5 Canada. Soybeans of a variety not registered under the Seeds Act and listed in Appendix A to the annual non-registered varieties order are permitted to be assigned a grade that is higher than the lowest grade established by regulation. The colour is added to the grade name. The tolerance for other colours is not applicable for mixed soybeans.',
          source: 'cgc-oggg',
          where: `Chapter 20, ${cls}, standard of quality`,
        },
        {
          title: 'Damage, maximum',
          columns: cols,
          rows: [
            ['Heat-damaged or mouldy %', '0.0', '0.2', '1.0', '3.0', '5.0'],
            ['Total damage %', '2', '3', '5', '8', '15'],
          ],
          source: 'cgc-oggg',
          where: `Chapter 20, ${cls}, damage`,
        },
        {
          title: 'Foreign material, maximum',
          columns: cols,
          rows: [
            ['Ergot %', '0.01', '0.03', '0.10', '0.25', '0.25'],
            ['Excreta %', '0.01', '0.01', '0.01', '0.01', '0.01'],
            ['Foreign material other than grain %', '0.1', '0.3', '0.5', '2.0', '3.0'],
            ['Stones %', '0.0', '0.1', '0.1', '0.1', '0.1'],
            ['Total foreign material %', '1', '2', '3', '5', '8'],
          ],
          source: 'cgc-oggg',
          where: `Chapter 20, ${cls}, foreign material`,
        },
        {
          title: 'Other factors, maximum',
          columns: cols,
          rows: [
            ['Downy mildew %', '2', '10', 'No limit', 'No limit', 'No limit'],
            ['Splits %', '10', '15', '20', '30', '40'],
          ],
          source: 'cgc-oggg',
          where: `Chapter 20, ${cls}, other factors`,
        },
      ],
    },
  ],
  tables: [
    {
      title: 'Moisture specifications',
      columns: ['Grain', 'Straight (%)', 'Tough (%)', 'Damp (%)', 'Moist (%)', 'Wet (%)'],
      rows: [['Soybeans', 'less than 14.1', '14.1-16.0', '16.1-18.0', '18.1-20.0', 'over 20.0']],
      source: 'cgc-oggg',
      where: 'Chapter 2, Moisture specifications',
    },
    {
      title: 'Food-type soybeans by grade, Canada, 2025 (g/100 g dry matter)',
      columns: ['Grade', 'Protein 2025', 'Protein 2024', 'Oil 2025', 'Oil 2024'],
      rows: [
        ['Soybean, No. 1 Canada', '40.6', '42.1', '20.9', '20.6'],
        ['Soybean, No. 2 Canada', '40.9', '42.1', '20.6', '20.3'],
        ['All grades', '40.7', '42.1', '20.8', '20.4'],
      ],
      note: 'Harvest Sample Program. Protein (Nitrogen x 6.25) and oil determined by near-infrared measurement, dry basis.',
      source: 'cgc-soybean-food-2025',
      where: 'Table 1 (protein) and Table 2 (oil), Canada rows',
    },
    {
      title: 'Food-type soybean composites, 2025',
      columns: ['Quality parameter', 'Generic 2025', 'Generic 2024', 'Natto 2025', 'Natto 2024'],
      rows: [
        ['100-seed weight, g/100 seeds', '18.8', '19.4', '8.3', '8.8'],
        ['Water absorption, g H 2 O/g seeds', '1.21', '1.18', '1.25', '1.22'],
        ['Water uptake factor, g soaked seeds/g seeds', '2.21', '2.18', '2.25', '2.22'],
        ['Protein content, g/100 g', '41.0', '42.3', '38.4', '38.1'],
        ['Oil content, g/100 g', '20.7', '20.4', '20.3', '21.1'],
        ['Sucrose, g/kg DM', '56.1', '63.7', '51.9', '59.6'],
        ['Total oligosaccharides', '49.4', '40.9', '57.0', '47.1'],
        ['Total isoflavones', '4.2', '4.0', '4.6', '4.7'],
      ],
      note: 'Soybean, No. 1 Canada and No. 2 Canada combined; chemical composition on a dry basis. Total oligosaccharides (sum of raffinose, stachyose and verbascose) and total isoflavones in g/kg DM. Generic food-type soybeans are used for making tofu, soymilk and miso.',
      source: 'cgc-soybean-food-2025',
      where: 'Table 3 (generic food-type) and Table 4 (natto-type)',
    },
    {
      title: 'Oilseed-type soybean exports, August 1, 2025 to July 31, 2026 (means)',
      columns: ['Parameter', 'Soybean, No. 2 Canada Yellow', 'Soybean, No. 3 Canada Yellow'],
      rows: [
        ['Dockage, %', '1.3', '2.0'],
        ['Moisture, %', '11.1', '10.6'],
        ['Oil content %, dry basis', '21.7', '21.6'],
        ['Oil content, %, 13% mb', '18.8', '18.6'],
        ['Protein content, %, dry basis', '38.0', '38.0'],
        ['Protein content, %, 13% mb', '32.9', '33.0'],
        ['Protein content of defatted meal, %, 13% moisture', '41.5', '41.9'],
        ['Chlorophyll content, mg/kg of seed', '0.9', '1.1'],
        ['Iodine value, units', '135.7', '135.1'],
        ['Free fatty acid content, %', '0.1', '0.2'],
      ],
      source: 'cgc-soybean-oilseed-2025-export',
      where: 'August 1, 2025 to July 31, 2026: quality data for export samples',
    },
  ],
};
