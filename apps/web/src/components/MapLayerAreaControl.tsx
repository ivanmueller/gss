import { MAP_LAYER_AREA_LABELS, MAP_LAYER_AREAS, type MapLayerArea } from '@grain/domain';

import { SegmentedControl } from './ui/segmented-control';

/**
 * Which side of the platform a map layer is for (F-240): grain layers are offered on the grain
 * maps, oil and gas layers on the oil and gas map (map.torvenco.com).
 */
export function MapLayerAreaControl({
  value,
  onChange,
}: {
  value: MapLayerArea;
  onChange: (area: MapLayerArea) => void;
}) {
  return (
    <SegmentedControl
      label="For"
      options={MAP_LAYER_AREAS.map((area) => ({ value: area, label: MAP_LAYER_AREA_LABELS[area] }))}
      value={value}
      onChange={onChange}
    />
  );
}
