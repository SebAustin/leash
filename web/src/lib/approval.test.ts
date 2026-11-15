import { expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { approvalTypedData } from "./approval";

// Expected signature produced independently with `cast wallet sign --data` (key 0xa11ce).
test("owner approval typed data matches LeashVault's EIP-712 schema", async () => {
  const account = privateKeyToAccount(`0x${"a11ce".padStart(64, "0")}`);
  const typed = approvalTypedData({
    vault: "0x0D2D3434c50B7df9D368504D9CdC664Da3D24E74",
    chainId: 5042002,
    market: "GEMI-BTC15M2611142115-UP",
    outcomeYes: true,
    amount: 5_000_000n,
    nonce: 0n,
    deadline: 1_794_744_600n,
  });
  expect(await account.signTypedData(typed)).toBe(
    "0xe42f12ce91c2b209dcbd7ec94de1373505da33752abc06847b5a23088924804909868bf9286c8749984bc5d59cdc4543961bcd6860bbb0074a7198bcf9ec1b941c",
  );
});
