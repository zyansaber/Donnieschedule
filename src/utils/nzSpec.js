export const NZ_SPEC_DEALERS = [
  'Christchurch',
  'CMG Campers',
  'Vanari',
  'Marsden Point',
];

export const isNzSpecDealer = (dealerName) => {
  const normalizedDealer = String(dealerName || '').trim().toLowerCase();
  return NZ_SPEC_DEALERS.some((dealer) => dealer.toLowerCase() === normalizedDealer);
};

export const formatChassisWithNzSpec = (chassis, dealerName) => {
  const chassisText = String(chassis || '').trim();
  if (!chassisText) return chassisText;
  return isNzSpecDealer(dealerName) ? `${chassisText} (NZspec)` : chassisText;
};

export const shouldRequireNzSpecConfirmation = (currentDealer, newDealer) => (
  isNzSpecDealer(currentDealer) || isNzSpecDealer(newDealer)
);

export const buildNzSpecMessage = (currentDealer, newDealer, vehicleLabel = 'vehicle') => {
  if (isNzSpecDealer(currentDealer)) {
    return `This ${vehicleLabel} is NZ spec.`;
  }
  if (isNzSpecDealer(newDealer)) {
    return `Please confirm whether this ${vehicleLabel} is NZ spec.`;
  }
  return '';
};
