import cveIcon from "../../assets/tickers/cve.png";
import jdIcon from "../../assets/tickers/jd.png";
import airlinesTravelIcon from "../../assets/tickers/sector-airlines-travel.png";
import cryptoMinersIcon from "../../assets/tickers/sector-crypto-miners.png";
import energyIcon from "../../assets/tickers/sector-energy.png";
import financialsIcon from "../../assets/tickers/sector-financials.png";
import healthcareIcon from "../../assets/tickers/sector-healthcare.png";
import materialsMiningIcon from "../../assets/tickers/sector-materials-mining.png";
import socialConsumerAppsIcon from "../../assets/tickers/sector-social-consumer-apps.png";
import technologyIcon from "../../assets/tickers/sector-technology.png";

export type TickerSector =
  | "Airlines / Travel"
  | "Crypto / Digital Asset Miners"
  | "Energy"
  | "Financials"
  | "Healthcare"
  | "Materials / Mining"
  | "Social / Consumer Apps"
  | "Technology / Software / Hardware";

type TickerIconMeta = {
  icon: string;
  sector?: TickerSector;
};

const financialSymbols = ["BAC", "NU", "NWBI", "OWL", "PYPL", "RF", "SOFI"];
const airlinesTravelSymbols = ["AAL", "DAL", "UAL", "JETS", "JBLU", "ALK", "RYAAY", "LUV"];
const energySymbols = ["AR", "BP", "CSAN3", "CVE", "PETR4"];
const materialsMiningSymbols = ["AG", "CDE", "KGC"];
const cryptoMinersSymbols = ["CLSK", "MARA", "RIOT"];
const socialConsumerAppsSymbols = ["BMBL", "PINS", "SNAP"];
const healthcareSymbols = ["BAX", "BFLY", "HAPV3", "PFE", "MRNA", "HIMS", "BMY"];
const technologySymbols = ["ALIT", "FIG", "HPQ", "INTC", "ONDS", "PATH", "RNG", "SMCI", "TOST", "U", "VNET"];

const tickerIconMeta: Record<string, TickerIconMeta> = {
  CVE: { icon: cveIcon, sector: "Energy" },
  JD: { icon: jdIcon },
  ...Object.fromEntries(
    airlinesTravelSymbols.map((symbol) => [
      symbol,
      {
        icon: airlinesTravelIcon,
        sector: "Airlines / Travel" as const
      }
    ])
  ),
  ...Object.fromEntries(
    energySymbols
      .filter((symbol) => symbol !== "CVE")
      .map((symbol) => [
        symbol,
        {
          icon: energyIcon,
          sector: "Energy" as const
        }
      ])
  ),
  ...Object.fromEntries(
    financialSymbols.map((symbol) => [
      symbol,
      {
        icon: financialsIcon,
        sector: "Financials" as const
      }
    ])
  ),
  ...Object.fromEntries(
    materialsMiningSymbols.map((symbol) => [
      symbol,
      {
        icon: materialsMiningIcon,
        sector: "Materials / Mining" as const
      }
    ])
  ),
  ...Object.fromEntries(
    cryptoMinersSymbols.map((symbol) => [
      symbol,
      {
        icon: cryptoMinersIcon,
        sector: "Crypto / Digital Asset Miners" as const
      }
    ])
  ),
  ...Object.fromEntries(
    technologySymbols.map((symbol) => [
      symbol,
      {
        icon: technologyIcon,
        sector: "Technology / Software / Hardware" as const
      }
    ])
  ),
  ...Object.fromEntries(
    socialConsumerAppsSymbols.map((symbol) => [
      symbol,
      {
        icon: socialConsumerAppsIcon,
        sector: "Social / Consumer Apps" as const
      }
    ])
  ),
  ...Object.fromEntries(
    healthcareSymbols.map((symbol) => [
      symbol,
      {
        icon: healthcareIcon,
        sector: "Healthcare" as const
      }
    ])
  )
};

const normalizeTicker = (ticker: string) => ticker.trim().toUpperCase();

export const getTickerIcon = (ticker: string) => tickerIconMeta[normalizeTicker(ticker)]?.icon;

export const getTickerSector = (ticker: string) => tickerIconMeta[normalizeTicker(ticker)]?.sector;

export const tickerIcons: Record<string, string> = Object.fromEntries(
  Object.entries(tickerIconMeta).map(([ticker, meta]) => [ticker, meta.icon])
);
