export interface MppRiskBumpBand {
  propMin: number;
  propMax: number;
  netLoss: number;
  lft: number;
}

export interface MppRiskBump extends MppRiskBumpBand {
  avgDailyPnl: number;
  bumpLevel: number;
  currentMPP: number;
  isCappedAtTopBand: boolean;
}

export const MPP_RISK_BUMP_PROJECTION_DAYS = 20;

export const MPP_RISK_BUMP_TABLE: readonly MppRiskBumpBand[] = [
  { propMin: 0, propMax: 119.99, netLoss: 30, lft: 48 },
  { propMin: 120, propMax: 199.99, netLoss: 50, lft: 80 },
  { propMin: 200, propMax: 219.99, netLoss: 55, lft: 90 },
  { propMin: 220, propMax: 259.99, netLoss: 65, lft: 105 },
  { propMin: 260, propMax: 299.99, netLoss: 75, lft: 120 },
  { propMin: 300, propMax: 339.99, netLoss: 85, lft: 135 },
  { propMin: 340, propMax: 419.99, netLoss: 105, lft: 170 },
  { propMin: 420, propMax: 499.99, netLoss: 125, lft: 200 },
  { propMin: 500, propMax: 599.99, netLoss: 150, lft: 240 },
  { propMin: 600, propMax: 659.99, netLoss: 165, lft: 260 },
  { propMin: 660, propMax: 719.99, netLoss: 180, lft: 290 },
  { propMin: 720, propMax: 799.99, netLoss: 200, lft: 320 },
  { propMin: 800, propMax: 899.99, netLoss: 225, lft: 360 },
  { propMin: 900, propMax: 999.99, netLoss: 275, lft: 440 }
];

export const MPP_RISK_BUMP_TOOLTIP =
  "Stock shutdown uses the current Stock MPP band to set max daily net loss and LFT. Values above 999.99 use the top band.";

const getNormalizedMpp = (mpp: number): number => (Number.isFinite(mpp) ? Math.max(0, mpp) : 0);

const getMppRiskBumpBandIndex = (mpp: number): number => {
  const currentMPP = getNormalizedMpp(mpp);
  const bandIndex = MPP_RISK_BUMP_TABLE.findIndex(
    (entry) => currentMPP >= entry.propMin && currentMPP <= entry.propMax
  );

  return bandIndex >= 0 ? bandIndex : MPP_RISK_BUMP_TABLE.length - 1;
};

export const getMppRiskBumpLevel = (mpp: number): number => Math.min(3, getMppRiskBumpBandIndex(mpp));

export const getMppRiskBump = (mpp: number): MppRiskBump => {
  const currentMPP = getNormalizedMpp(mpp);
  const topBand = MPP_RISK_BUMP_TABLE[MPP_RISK_BUMP_TABLE.length - 1];
  const bandIndex = getMppRiskBumpBandIndex(mpp);
  const band = MPP_RISK_BUMP_TABLE[bandIndex] ?? topBand;

  return {
    ...band,
    avgDailyPnl: band.propMin / MPP_RISK_BUMP_PROJECTION_DAYS,
    bumpLevel: Math.min(3, bandIndex),
    currentMPP,
    isCappedAtTopBand: currentMPP > topBand.propMax
  };
};

const formatBandLimit = (value: number): string =>
  Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { minimumFractionDigits: 2 });

export const getMppRiskBumpRangeLabel = (band: MppRiskBumpBand): string =>
  `${formatBandLimit(band.propMin)} - ${formatBandLimit(band.propMax)}`;
