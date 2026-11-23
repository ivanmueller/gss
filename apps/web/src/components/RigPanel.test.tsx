import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RigPanel, RigTip } from './RigPanel';
import type { RigMove } from './Rigs';

// A rig's box and panel (F-282, F-283): what it is drilling for, in words. A made-up rig.

const move: RigMove = {
  key: 'rig:0',
  rig: 'C1XX|7',
  now: true,
  wellId: '00/15-08-050-17W5/0',
  wellName: 'SYNTHETIC HZ EDSON 15-8-50-17',
  licenceNumber: '0500001',
  licenseeBaId: 'A1XX',
  licenseeName: 'Synthetic Oil Corp.',
  contractorBaId: 'C1XX',
  contractorName: 'Synthetic Drilling Corp.',
  rigNumber: '7',
  activityType: 'Resumption',
  activityAt: '2026-11-21T15:30:00.000Z',
  listDate: '2026-11-22',
  surfaceLocation: '15-08-050-17W5',
  place: 'well',
  targetZone: 'SPIRIT RIVER FM',
  longitude: -116.5,
  latitude: 53.3,
};

describe('a rig’s box and panel', () => {
  it('says what the rig is drilling for', () => {
    render(<RigTip move={move} now={new Date('2026-11-23T18:00:00Z')} />);
    expect(screen.getByText('Drilling for Spirit River Formation')).toBeInTheDocument();
  });

  it('says so when it is not known yet', () => {
    render(
      <RigPanel
        move={{ ...move, targetZone: null }}
        movesOf={() => []}
        goTo={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByRole('region', { name: 'Drilling for' })).toHaveTextContent('Not known yet');
  });
});
