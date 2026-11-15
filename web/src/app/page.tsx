import { getAddress } from "viem";
import { LeashConsole } from "@/components/console/LeashConsole";

export default function Home() {
  const vault = process.env.VAULT_ADDRESS;
  if (!vault) {
    return <p className="p-8">VAULT_ADDRESS is not configured.</p>;
  }
  return <LeashConsole vaultAddress={getAddress(vault)} />;
}
