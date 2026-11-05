import type { Grain } from './types';

export const canarySeed: Grain = {
  id: 'canary-seed',
  name: 'Canary seed',
  symbol: 'Cs',
  number: 18,
  family: 'special',
  commodities: ['canary_seed'],
  tileFacts: ['Grade'],
  facts: [
    {
      label: 'Grade',
      value: 'Canada Canary Seed',
      source: 'cgc-oggg',
      where: 'Chapter 23, Canary Seed, Canada (CAN), standard of quality',
    },
    {
      label: 'Types',
      value: 'There are two main types of canary seed, itchy and hairless.',
      source: 'cgc-oggg',
      where: 'Chapter 23, Classes, types and varieties',
    },
    {
      label: 'Itchy',
      value:
        'The term refers to varieties which have tiny, sharp hairs (spicules) attached to the hull.',
      source: 'cgc-oggg',
      where: 'Chapter 23, Classes, types and varieties',
    },
    {
      label: 'Hairless',
      value:
        'The term refers to varieties which don’t have tiny hairs (spicules) attached to the hull. These varieties are commonly referred to as glabrous.',
      source: 'cgc-oggg',
      where: 'Chapter 23, Classes, types and varieties',
    },
    {
      label: 'Varieties eligible for the top grades',
      value:
        'Only varieties registered in Canada under the Seeds Act are eligible for the top grades of canary seed.',
      source: 'cgc-oggg',
      where: 'Chapter 23, Grading factors, Variety (VAR)',
    },
    {
      label: 'Export shipments',
      value:
        'Cargoes containing dockage may not be shipped except with permission from the Canadian Grain Commission.',
      source: 'cgc-oggg',
      where: 'Chapter 23, Export shipments',
    },
  ],
  classes: [
    {
      name: 'Canary Seed, Canada',
      abbreviation: 'CAN',
      grades: ['Canada Canary Seed'],
      gradesCitation: {
        source: 'cgc-oggg',
        where: 'Chapter 23, Canary Seed, Canada (CAN), standard of quality',
      },
      tables: [
        {
          title: 'Standard of quality',
          columns: ['Grading factor', 'Canada Canary Seed'],
          rows: [
            ['Degree of soundness', 'Reasonably well mature, cool and sweet'],
            ['Fireburnt %', '0.0'],
            ['Heated and binburnt %', '1.0'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 23, Canary Seed, Canada (CAN), standard of quality',
        },
        {
          title: 'Foreign material included in dockage, maximum',
          columns: ['Grading factor', 'Canada Canary Seed'],
          rows: [
            ['Ergot %', '0.04'],
            ['Excreta %', '0.01'],
            ['Inert material %', '0.2'],
            ['Total foreign material %', '1.0'],
          ],
          source: 'cgc-oggg',
          where: 'Chapter 23, Canary Seed, Canada (CAN), foreign material included in dockage',
        },
      ],
    },
  ],
  tables: [
    {
      title: 'Moisture: straight, tough and damp',
      columns: ['Grain', 'Straight (%)', 'Tough (%)', 'Damp (%)'],
      rows: [['Canary seed', 'less than 13.1', '13.1-17.0', 'over 17.0']],
      source: 'cgc-oggg',
      where: 'Chapter 2, Moisture specifications',
    },
  ],
};
