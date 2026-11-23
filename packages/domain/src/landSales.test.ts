import { describe, expect, it } from 'vitest';

import {
  landKeyPart,
  landKeysTownship,
  landKeyText,
  landKeyTownship,
  parseSaleNotice,
  parseSaleResults,
  placeParcel,
  saleDocumentLinks,
  saleDocumentPath,
  sectionCorners,
  sectionKey,
  sectionPartRing,
  type SectionCorners,
} from './landSales';

// Crown land sales (F-242). Made-up parcels, buyers and prices only.

describe('landKeyPart', () => {
  it('reads a whole section, a legal subdivision, a quarter and a half', () => {
    expect(landKeyPart('41203424')).toEqual({
      meridian: 4,
      range: 12,
      township: 34,
      section: 24,
      rect: [0, 0, 1, 1],
    });
    expect(landKeyPart('40303921SW')?.rect).toEqual([0, 0, 0.5, 0.5]);
    expect(landKeyPart('40303921NE')?.rect).toEqual([0.5, 0.5, 1, 1]);
    expect(landKeyPart('41400717S')?.rect).toEqual([0, 0, 1, 0.5]);
    expect(landKeyPart('41202620E')?.rect).toEqual([0.5, 0, 1, 1]);
  });

  it('places the sixteen legal subdivisions from the south-east, back and forth', () => {
    expect(landKeyPart('4140133301')?.rect).toEqual([0.75, 0, 1, 0.25]);
    expect(landKeyPart('4140133304')?.rect).toEqual([0, 0, 0.25, 0.25]);
    expect(landKeyPart('4140133305')?.rect).toEqual([0, 0.25, 0.25, 0.5]);
    expect(landKeyPart('4140133308')?.rect).toEqual([0.75, 0.25, 1, 0.5]);
    expect(landKeyPart('4140133313')?.rect).toEqual([0, 0.75, 0.25, 1]);
    expect(landKeyPart('4140133316')?.rect).toEqual([0.75, 0.75, 1, 1]);
  });

  it('reads a quarter or a half of a legal subdivision', () => {
    expect(landKeyPart('4060361514NW')?.rect).toEqual([0.25, 0.875, 0.375, 1]);
    expect(landKeyPart('4060361513S')?.rect).toEqual([0, 0.75, 0.25, 0.875]);
  });

  it('refuses what is not a land key', () => {
    for (const key of ['', '4120342', '31203424', '41203437', '4140133317', '41203424XX']) {
      expect(landKeyPart(key), key).toBeNull();
    }
  });
});

const SQUARE: SectionCorners = [
  [-116, 54],
  [-115.975, 54],
  [-115.975, 54.0145],
  [-116, 54.0145],
];

describe('sectionCorners and sectionPartRing', () => {
  it('finds the four corners of a section, whatever point its outline starts at', () => {
    const ring = [
      [-115.975, 54.0145],
      [-116, 54.0145],
      [-116, 54.007],
      [-116, 54],
      [-115.975, 54],
      [-115.975, 54.0145],
    ];
    expect(sectionCorners(ring)).toEqual(SQUARE);
    expect(sectionCorners([[1, 2]])).toBeNull();
    expect(sectionCorners('x')).toBeNull();
  });

  it('draws a part of a section as a closed ring', () => {
    expect(sectionPartRing(SQUARE, [0, 0, 0.5, 0.5])).toEqual([
      [-116, 54],
      [-115.9875, 54],
      [-115.9875, 54.00725],
      [-116, 54.00725],
      [-116, 54],
    ]);
  });
});

const NOTICE = `<?xml version="1.0" encoding="utf-8"?>
<PublicOfferingNotice xmlns="http://tempuri.org/PON.xsd">
  <MineralType>PETROLEUM AND NATURAL GAS</MineralType>
  <SaleDate>2026-12-02</SaleDate>
  <Schedule>
    <ContractType>LEASE</ContractType>
    <Region>
      <Name>PLAINS</Name>
      <Contract>
        <ContractNo>A0001</ContractNo>
        <Hectares>320</Hectares>
        <RestrictionCodeApplies>SHA009801</RestrictionCodeApplies>
        <Tract>
          <TractNo>0</TractNo>
          <LandDescription>
            <Land><LandKey>41203424</LandKey><Portion></Portion><MetesBoundsIndicator></MetesBoundsIndicator><MetesBounds></MetesBounds></Land>
            <Land><LandKey>40303921SW</LandKey><Portion></Portion><MetesBoundsIndicator>P</MetesBoundsIndicator><MetesBounds></MetesBounds></Land>
          </LandDescription>
          <ZoneDescription>
            <Line><Substance>PETROLEUM AND NATURAL GAS</Substance><Qualifier>BELOW THE BASE OF THE</Qualifier><ZoneName>EXAMPLE FM</ZoneName><DRRZDCode>D00013</DRRZDCode></Line>
            <Line><Qualifier>TO</Qualifier><ZoneName>BASEMENT</ZoneName></Line>
          </ZoneDescription>
        </Tract>
      </Contract>
    </Region>
  </Schedule>
  <Schedule>
    <ContractType>LICENCE</ContractType>
    <Region>
      <Name>NORTHERN</Name>
      <Contract>
        <ContractNo>B0018</ContractNo>
        <Hectares>139.28</Hectares>
        <Tract>
          <LandDescription>
            <Land><LandKey>50603419</LandKey><Portion></Portion><MetesBoundsIndicator></MetesBoundsIndicator><MetesBounds></MetesBounds></Land>
          </LandDescription>
          <ZoneDescription>
            <Line><Substance>PETROLEUM AND NATURAL GAS</Substance><Qualifier>IN THE</Qualifier><ZoneName>EXAMPLE &amp; SAMPLE FM</ZoneName></Line>
          </ZoneDescription>
        </Tract>
      </Contract>
    </Region>
  </Schedule>
  <AddendaAndContacts>
    <RestrictionDetail><AppliesTo><ContractType>LICENCE</ContractType><ContractNo>B0018</ContractNo>
      <RestrictionLandDescription><RestrictionLand><LandKey>50603419</LandKey></RestrictionLand></RestrictionLandDescription>
    </AppliesTo></RestrictionDetail>
  </AddendaAndContacts>
</PublicOfferingNotice>`;

describe('parseSaleNotice', () => {
  it('keeps each clause of the rights whole, once, over a contract of several tracts', () => {
    const line = (substance: string | null, qualifier: string, zone: string) =>
      `<Line>${substance ? `<Substance>${substance}</Substance>` : ''}<Qualifier>${qualifier}</Qualifier><ZoneName>${zone}</ZoneName></Line>`;
    const png = 'PETROLEUM AND NATURAL GAS';
    const tract = (lines: string) =>
      `<Tract><LandDescription><Land><LandKey>41203424</LandKey></Land></LandDescription><ZoneDescription>${lines}</ZoneDescription></Tract>`;
    const xml = NOTICE.replace(
      /<Contract>[\s\S]*?<\/Contract>/,
      `<Contract><ContractNo>A0001</ContractNo><Hectares>64</Hectares>${tract(
        line(png, 'FROM', 'SURFACE') + line(null, 'TO', 'BASEMENT'),
      )}${tract(
        line(png, 'FROM', 'SURFACE') + line(null, 'TO THE BASE OF THE', 'EXAMPLE FM'),
      )}${tract(line(png, 'FROM', 'SURFACE') + line(null, 'TO', 'BASEMENT'))}</Contract>`,
    );
    expect(parseSaleNotice(xml)?.parcels[0]?.zone).toBe(
      `${png} FROM SURFACE TO BASEMENT ${png} FROM SURFACE TO THE BASE OF THE EXAMPLE FM`,
    );
  });

  it('keeps the rights tract by tract as written, a wording once (F-276)', () => {
    const line = (substance: string | null, qualifier: string, zone: string, excepting = false) =>
      `<Line>${excepting ? '<Excepting>EXCEPTING</Excepting>' : ''}${substance ? `<Substance>${substance}</Substance>` : ''}<Qualifier>${qualifier}</Qualifier><ZoneName>${zone}</ZoneName></Line>`;
    const png = 'PETROLEUM AND NATURAL GAS';
    const tract = (lines: string) =>
      `<Tract><LandDescription><Land><LandKey>41203424</LandKey></Land></LandDescription><ZoneDescription>${lines}</ZoneDescription></Tract>`;
    const deep = line(png, 'BELOW THE BASE OF THE', 'EXAMPLE GRP') + line(null, 'TO', 'BASEMENT');
    const xml = NOTICE.replace(
      /<Contract>[\s\S]*?<\/Contract>/,
      `<Contract><ContractNo>A0001</ContractNo><Hectares>64</Hectares>${tract(
        // Two intervals in one tract: one entry, a line of the notice a part of it.
        line(png, 'FROM', 'SURFACE') + line(null, 'TO THE TOP OF THE', 'SAMPLE FM') + deep,
      )}${tract(deep)}${tract(
        // The notice leaves an empty line between two substances: not a part.
        line('NATURAL GAS', 'IN THE', 'SAMPLE FM') + line(null, ' ', ' ') + deep,
      )}${tract(deep)}${tract(deep + line(png, 'IN THE', 'OTHER FM', true))}</Contract>`,
    );
    expect(parseSaleNotice(xml)?.parcels[0]?.tractRights).toEqual([
      `${png} FROM SURFACE; TO THE TOP OF THE SAMPLE FM; ${png} BELOW THE BASE OF THE EXAMPLE GRP; TO BASEMENT`,
      `${png} BELOW THE BASE OF THE EXAMPLE GRP; TO BASEMENT`,
      `NATURAL GAS IN THE SAMPLE FM; ${png} BELOW THE BASE OF THE EXAMPLE GRP; TO BASEMENT`,
      // What a tract excepts keeps its word.
      `${png} BELOW THE BASE OF THE EXAMPLE GRP; TO BASEMENT; EXCEPTING ${png} IN THE OTHER FM`,
    ]);
  });

  it('keeps as many whole tract wordings as fit (F-276)', () => {
    const tract = (n: number) =>
      `<Tract><LandDescription><Land><LandKey>41203424</LandKey></Land></LandDescription><ZoneDescription><Line><Substance>PETROLEUM AND NATURAL GAS</Substance><Qualifier>IN THE</Qualifier><ZoneName>${'EXAMPLE '.repeat(20)}${String(n)} FM</ZoneName></Line></ZoneDescription></Tract>`;
    const xml = NOTICE.replace(
      /<Contract>[\s\S]*?<\/Contract>/,
      `<Contract><ContractNo>A0001</ContractNo><Hectares>64</Hectares>${Array.from(
        { length: 60 },
        (_, n) => tract(n),
      ).join('')}</Contract>`,
    );
    const kept = parseSaleNotice(xml)?.parcels[0]?.tractRights ?? [];
    expect(kept.length).toBeGreaterThan(10);
    expect(kept.length).toBeLessThan(40);
    expect(kept.join('').length).toBeLessThanOrEqual(4000);
    expect(kept.every((wording) => wording.endsWith(' FM'))).toBe(true);
  });

  it('keeps a clause that takes rights away as one, with its codes (F-265)', () => {
    const png = 'PETROLEUM AND NATURAL GAS';
    const xml = NOTICE.replace(
      /<Contract>[\s\S]*?<\/Contract>/,
      `<Contract><ContractNo>A0001</ContractNo><Hectares>64</Hectares>
        <RestrictionCodeApplies>SHA010301</RestrictionCodeApplies>
        <RestrictionCodeApplies>SHA010401</RestrictionCodeApplies>
        <RestrictionCodeApplies>not a code</RestrictionCodeApplies>
        <Tract><LandDescription><Land><LandKey>41203424</LandKey></Land></LandDescription><ZoneDescription>
        <Line><Substance>${png}</Substance><Qualifier>BELOW THE BASE OF THE</Qualifier><ZoneName>EXAMPLE GRP</ZoneName><DRRZDCode>D00004</DRRZDCode></Line>
        <Line><Qualifier>TO</Qualifier><ZoneName>BASEMENT</ZoneName></Line>
        <Line><Excepting>EXCEPTING</Excepting><Substance>${png}</Substance><Qualifier>IN THE</Qualifier><ZoneName>SAMPLE FM</ZoneName><DRRZDCode>D00009</DRRZDCode></Line>
        </ZoneDescription></Tract>
        <Tract><LandDescription><Land><LandKey>41203425</LandKey></Land></LandDescription><ZoneDescription>
        <Line><Substance>${png}</Substance><Qualifier>IN THE</Qualifier><ZoneName>EXAMPLE GRP</ZoneName><DRRZDCode>D00004</DRRZDCode></Line>
        </ZoneDescription></Tract>
        <Tract><LandDescription><Land><LandKey>41203426</LandKey></Land></LandDescription><ZoneDescription>
        <Line><Substance>${png}</Substance><Qualifier>BELOW THE BASE OF THE</Qualifier><ZoneName>EXAMPLE GRP</ZoneName><DRRZDCode>D00004</DRRZDCode></Line>
        <Line><Qualifier>TO</Qualifier><ZoneName>BASEMENT</ZoneName></Line>
        </ZoneDescription></Tract></Contract>`,
    );
    const parcel = parseSaleNotice(xml)?.parcels[0];
    expect(parcel?.zone).toBe(
      // The exception stays with its own clause; the same clause without one is another.
      `${png} BELOW THE BASE OF THE EXAMPLE GRP TO BASEMENT EXCEPTING ${png} IN THE SAMPLE FM ${png} IN THE EXAMPLE GRP ${png} BELOW THE BASE OF THE EXAMPLE GRP TO BASEMENT`,
    );
    expect(parcel?.restrictions).toEqual(['SHA010301', 'SHA010401']);
    // Each zone once, in the notice's order.
    expect(parcel?.reversionZones).toEqual(['D00004', 'D00009']);
  });

  it('knows the department\u2019s links to a notice or results as a PDF, and nothing else', () => {
    expect(saleDocumentPath('/download/?s=png&id=20260819PON&ft=.pdf')).toBe(true);
    expect(saleDocumentPath('/download/?s=png&id=20040107PSR&ft=.PDF&y=2004')).toBe(true);
    expect(saleDocumentPath('/download/?s=png&id=20260819PON&ft=.xml')).toBe(false);
    expect(saleDocumentPath('https://example.test/download/?s=png&id=20260819PON&ft=.pdf')).toBe(
      false,
    );
    expect(saleDocumentPath('/download/?s=png&id=20260819PON&ft=.pdf&next=//example.test')).toBe(
      false,
    );
    expect(saleDocumentPath(null)).toBe(false);
  });

  it('reads a page\u2019s links to each sale\u2019s notice and results as PDF files', () => {
    const html = `
      <a href='/download/?s=png&amp;id=20260819PON&amp;ft=.pdf'>Notice</a>
      <a href='/download/?s=png&amp;id=20260819PON&amp;ft=.xml'>Notice (XML)</a>
      <a href='/download/?s=png&amp;id=20260819PSR&amp;ft=.pdf'>Results</a>
      <a href="/download/?s=png&amp;id=20040107PON&amp;ft=.PDF&amp;y=2004">Notice</a>
      <a href='/download/?s=png&amp;id=20260819POC&amp;ft=.pdf'>Changes</a>
      <a href='https://example.test/download/?s=png&amp;id=20260902PON&amp;ft=.pdf&amp;x=1'>Elsewhere</a>`;
    expect(saleDocumentLinks(html)).toEqual({
      '2026-08-19': {
        notice: '/download/?s=png&id=20260819PON&ft=.pdf',
        results: '/download/?s=png&id=20260819PSR&ft=.pdf',
      },
      '2004-01-07': { notice: '/download/?s=png&id=20040107PON&ft=.PDF&y=2004' },
    });
    expect(saleDocumentLinks('<p>No sales.</p>')).toEqual({});
  });

  it('reads each contract with its land and its rights, and not the addenda', () => {
    expect(parseSaleNotice(NOTICE)).toEqual({
      saleDate: '2026-12-02',
      parcels: [
        {
          contractNo: 'A0001',
          contractType: 'LEASE',
          region: 'PLAINS',
          hectares: '320',
          zone: 'PETROLEUM AND NATURAL GAS BELOW THE BASE OF THE EXAMPLE FM TO BASEMENT',
          lands: ['41203424', '40303921SW'],
          portion: true,
          restrictions: ['SHA009801'],
          reversionZones: ['D00013'],
          tractRights: ['PETROLEUM AND NATURAL GAS BELOW THE BASE OF THE EXAMPLE FM; TO BASEMENT'],
        },
        {
          contractNo: 'B0018',
          contractType: 'LICENCE',
          region: 'NORTHERN',
          hectares: '139.28',
          zone: 'PETROLEUM AND NATURAL GAS IN THE EXAMPLE & SAMPLE FM',
          lands: ['50603419'],
          portion: false,
          restrictions: [],
          reversionZones: [],
          tractRights: ['PETROLEUM AND NATURAL GAS IN THE EXAMPLE & SAMPLE FM'],
        },
      ],
    });
  });

  it('refuses a file that is not a notice of petroleum and natural gas rights', () => {
    expect(parseSaleNotice('<p>File not found.</p>')).toBeNull();
    expect(parseSaleNotice(NOTICE.replace('PETROLEUM AND NATURAL GAS', 'OIL SANDS'))).toBeNull();
    expect(parseSaleNotice(NOTICE.replace('2026-12-02', 'soon'))).toBeNull();
  });
});

const RESULTS =
  '<ROOT xmlns:sql="urn:schemas-microsoft-com:xml-sql"><MineralType>PETROLEUM AND NATURAL GAS<SaleDate>2026/11/04' +
  '<Parcel><ParcelNumber>0001</ParcelNumber><Region>PLAINS REGION</Region><ContractFlag>A</ContractFlag><MRT>(4-14-013)</MRT><Status>ACCEPTED</Status><Bonus>2296.32</Bonus><DollarPerHectare>35.88</DollarPerHectare>' +
  '<Clients><ClientName>EXAMPLE LAND LTD.</ClientName><Percentage>60.0000000</Percentage></Clients><Clients><ClientName>SAMPLE &amp; CO.</ClientName><Percentage>40.0000000</Percentage></Clients></Parcel>' +
  '<Parcel><ParcelNumber>0059</ParcelNumber><Region>NORTHERN REGION</Region><ContractFlag>B</ContractFlag><Status>NO OFFERS</Status><Clients /></Parcel>' +
  '</SaleDate></MineralType></ROOT>';

describe('parseSaleResults', () => {
  it('reads each parcel’s status, money as text and buyers with their shares', () => {
    expect(parseSaleResults(RESULTS)).toEqual({
      saleDate: '2026-11-04',
      parcels: [
        {
          contractNo: 'A0001',
          status: 'ACCEPTED',
          bonus: '2296.32',
          dollarsPerHectare: '35.88',
          buyers: 'EXAMPLE LAND LTD. 60%; SAMPLE & CO. 40%',
        },
        {
          contractNo: 'B0059',
          status: 'NO OFFERS',
          bonus: null,
          dollarsPerHectare: null,
          buyers: null,
        },
      ],
    });
  });

  it('refuses a file that is not results', () => {
    expect(parseSaleResults('<p>File not found.</p>')).toBeNull();
  });
});

describe('placeParcel', () => {
  const sections = new Map([
    [sectionKey({ meridian: 4, range: 12, township: 34, section: 24 }), SQUARE],
  ]);

  it('draws the land that is on the grid, and says how much of the parcel that is', () => {
    const placed = placeParcel(['41203424SW', '4120342416', '50603419', 'nonsense'], sections);
    expect(placed?.placed).toBe(2);
    expect(placed?.of).toBe(4);
    expect(placed?.shape).toHaveLength(2);
    expect(placed?.shape[0]?.[0]?.[0]).toEqual([-116, 54]);
    expect(placed?.bounds).toEqual([-116, 54, -115.975, 54.0145]);
  });

  it('gives nothing for a parcel with no land on the grid', () => {
    expect(placeParcel(['50603419'], sections)).toBeNull();
    expect(placeParcel([], sections)).toBeNull();
  });
});

describe('land keys for reading (F-265)', () => {
  it('writes a section, a quarter or half, and a legal subdivision as land is usually written', () => {
    expect(landKeyText('50103806')).toBe('6-38-1-W5');
    expect(landKeyText('50103718NE')).toBe('NE-18-37-1-W5');
    expect(landKeyText('41203424N')).toBe('N-24-34-12-W4');
    expect(landKeyText('4140133301')).toBe('LSD 1-33-13-14-W4');
    expect(landKeyText('4140133301SW')).toBe('SW of LSD 1-33-13-14-W4');
    expect(landKeyText('not a key')).toBeNull();
  });

  it('names the township a key lies in', () => {
    expect(landKeyTownship('50103718NE')).toBe('5-01-037');
    expect(landKeyTownship('')).toBeNull();
  });

  it('names the township a parcel is filed under: the lowest among its lands (F-276)', () => {
    // Range before township, as the department's results write it: (5-07-045).
    expect(landKeysTownship(['50904420', '50704507', '50804501', '50704606'])).toBe('5-07-045');
    expect(landKeysTownship(['50103718NE', 'not a key', '41203424'])).toBe('4-12-034');
    expect(landKeysTownship(['not a key'])).toBeNull();
    expect(landKeysTownship([])).toBeNull();
  });
});
