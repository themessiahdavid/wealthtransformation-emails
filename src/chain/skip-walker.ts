// Off-chain re-implementation of WealthTransformation.sol commission routing,
// used to identify EVERYONE who would have earned (and who was skipped)
// for a given Purchased event.
//
// Mirrors the contract logic in src/WealthTransformation.sol:
//   - walkUpQualified(start, tier): walks directSponsor chain until isAffiliate[X][tier] && !blacklisted
//   - _routeCommission(buyer, tier, earningSeller, amount):
//       - increments counter[earningSeller][tier]
//       - if counter % PASSUP_INTERVAL == 0 → passup to tierSponsor[earningSeller][tier]
//       - chain continues up to MAX_CASCADE_STEPS
//
// This is READ-ONLY simulation against contract state at a given block.

import { createPublicClient, http, type AbiEvent } from "viem";
import { base, baseSepolia } from "viem/chains";
import { config } from "../config.js";

const WT_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "directSponsor",
    inputs: [{ name: "buyer", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "tierSponsor",
    inputs: [
      { name: "buyer", type: "address" },
      { name: "tier", type: "uint8" },
    ],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "isAffiliate",
    inputs: [
      { name: "buyer", type: "address" },
      { name: "tier", type: "uint8" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "blacklisted",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "counter",
    inputs: [
      { name: "addr", type: "address" },
      { name: "tier", type: "uint8" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "companyWallet",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "WALK_CAP",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "MAX_CASCADE_STEPS",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "PASSUP_INTERVAL",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export interface SkipReport {
  buyer: `0x${string}`;
  tier: number;
  amount: bigint;
  earningSeller: `0x${string}`;        // who actually got the product commission
  finalRecipient: `0x${string}`;       // after cascade, who keeps it
  isPassup: boolean;
  // Compressed-past addresses: these are uplines we walked over because they
  // weren't qualified at this tier. Each gets a "lost commission" email.
  compressedSkips: Array<{ address: `0x${string}`; reason: "not_affiliate_at_tier" | "blacklisted" }>;
  // Cascade-passup addresses: these are people whose counter rolled over and
  // they had to pass the commission up. They get a "cascade passup" email.
  cascadeSkips: Array<{ address: `0x${string}`; counterAt: bigint }>;
}

interface SkipWalkerOpts {
  blockNumber?: bigint;
}

function chainFor(name: typeof config.chain) {
  return name === "BASE_MAINNET" ? base : baseSepolia;
}

export class SkipWalker {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly client: any;
  private companyWalletCache: `0x${string}` | null = null;
  private constants: { WALK_CAP: bigint; MAX_CASCADE: bigint; PASSUP: bigint } | null =
    null;

  constructor() {
    this.client = createPublicClient({
      chain: chainFor(config.chain),
      transport: http(config.baseRpcUrl),
    });
  }

  private async readContract<T>(functionName: string, args: unknown[] = [], blockNumber?: bigint): Promise<T> {
    return (await this.client.readContract({
      address: config.wtContractAddress,
      abi: WT_ABI,
      functionName,
      args,
      blockNumber,
    })) as T;
  }

  async getCompanyWallet(): Promise<`0x${string}`> {
    if (this.companyWalletCache) return this.companyWalletCache;
    this.companyWalletCache = await this.readContract<`0x${string}`>("companyWallet");
    return this.companyWalletCache;
  }

  async getConstants() {
    if (this.constants) return this.constants;
    const [WALK_CAP, MAX_CASCADE, PASSUP] = await Promise.all([
      this.readContract<bigint>("WALK_CAP"),
      this.readContract<bigint>("MAX_CASCADE_STEPS"),
      this.readContract<bigint>("PASSUP_INTERVAL"),
    ]);
    this.constants = { WALK_CAP, MAX_CASCADE, PASSUP };
    return this.constants;
  }

  // Mirrors walkUpQualified(start, tier). Returns the qualified earner address
  // and the list of addresses we skipped past.
  async walkUpQualified(
    start: `0x${string}`,
    tier: number,
    blockNumber?: bigint,
  ): Promise<{ earner: `0x${string}`; skipped: SkipReport["compressedSkips"] }> {
    const company = await this.getCompanyWallet();
    const { WALK_CAP } = await this.getConstants();
    if (start.toLowerCase() === ZERO) return { earner: company, skipped: [] };

    let cursor: `0x${string}` = start;
    const skipped: SkipReport["compressedSkips"] = [];
    for (let i = 0n; i < WALK_CAP; i++) {
      const [isAff, isBl] = await Promise.all([
        this.readContract<boolean>("isAffiliate", [cursor, tier], blockNumber),
        this.readContract<boolean>("blacklisted", [cursor], blockNumber),
      ]);
      if (isAff && !isBl) return { earner: cursor, skipped };
      skipped.push({
        address: cursor,
        reason: isBl ? "blacklisted" : "not_affiliate_at_tier",
      });
      const next = await this.readContract<`0x${string}`>(
        "directSponsor",
        [cursor],
        blockNumber,
      );
      if (next.toLowerCase() === ZERO) return { earner: company, skipped };
      cursor = next;
    }
    return { earner: company, skipped };
  }

  // Simulate the full _routeCommission cascade for a Purchased event.
  // Reads contract state AT THE BLOCK BEFORE the purchase so we see what was
  // visible at the moment the contract decided routing.
  //
  // Note on accuracy: contract increments counter ATOMICALLY during _routeCommission,
  // so calling this with `blockNumber = purchasedEvent.blockNumber` reads the
  // state AFTER the event. To reproduce the routing we'd ideally read at
  // `blockNumber - 1`. For email purposes that's fine — we use post-block state
  // and the resulting recipient list converges with what actually happened
  // (counter values are off by 1 for that buy but the recipient identity is
  // what matters for who gets emailed).
  async simulate(
    buyer: `0x${string}`,
    tier: number,
    amount: bigint,
    opts: SkipWalkerOpts = {},
  ): Promise<SkipReport> {
    const { MAX_CASCADE, PASSUP } = await this.getConstants();
    const company = await this.getCompanyWallet();
    const block = opts.blockNumber;

    const directSponsorOfBuyer = await this.readContract<`0x${string}`>(
      "directSponsor",
      [buyer],
      block,
    );
    const { earner, skipped: compressedSkips } = await this.walkUpQualified(
      directSponsorOfBuyer,
      tier,
      block,
    );

    if (earner.toLowerCase() === company.toLowerCase()) {
      return {
        buyer,
        tier,
        amount,
        earningSeller: company,
        finalRecipient: company,
        isPassup: false,
        compressedSkips,
        cascadeSkips: [],
      };
    }

    // Cascade simulation. counter[earner][tier] (post-event) tells us its
    // current value. The contract incremented BEFORE checking % PASSUP, so
    // we treat the post-event value as the "after this buy" counter.
    const counterAfter = await this.readContract<bigint>(
      "counter",
      [earner, tier],
      block,
    );
    const cascadeSkips: SkipReport["cascadeSkips"] = [];
    let currentEarner: `0x${string}` = earner;
    let currentCounter = counterAfter;
    let isPassup = false;
    let steps = 0n;
    while (steps < MAX_CASCADE) {
      if (currentCounter % PASSUP === 0n) {
        cascadeSkips.push({ address: currentEarner, counterAt: currentCounter });
        // Find next earner: try tierSponsor first, fall back to walkUpQualified.
        let next = await this.readContract<`0x${string}`>(
          "tierSponsor",
          [currentEarner, tier],
          block,
        );
        const nextIsAff = next.toLowerCase() === ZERO
          ? false
          : await this.readContract<boolean>("isAffiliate", [next, tier], block);
        const nextIsBl = next.toLowerCase() === ZERO
          ? false
          : await this.readContract<boolean>("blacklisted", [next], block);
        if (next.toLowerCase() === ZERO || !nextIsAff || nextIsBl) {
          const directOfCurrent = await this.readContract<`0x${string}`>(
            "directSponsor",
            [currentEarner],
            block,
          );
          const w = await this.walkUpQualified(directOfCurrent, tier, block);
          next = w.earner;
        }
        if (next.toLowerCase() === company.toLowerCase()) {
          return {
            buyer,
            tier,
            amount,
            earningSeller: earner,
            finalRecipient: company,
            isPassup: true,
            compressedSkips,
            cascadeSkips,
          };
        }
        const nextCounterAfter = await this.readContract<bigint>(
          "counter",
          [next, tier],
          block,
        );
        currentEarner = next;
        currentCounter = nextCounterAfter;
        isPassup = true;
        steps += 1n;
      } else {
        return {
          buyer,
          tier,
          amount,
          earningSeller: earner,
          finalRecipient: currentEarner,
          isPassup: isPassup || currentEarner.toLowerCase() !== earner.toLowerCase(),
          compressedSkips,
          cascadeSkips,
        };
      }
    }
    // Cascade overflow — pays last earner.
    return {
      buyer,
      tier,
      amount,
      earningSeller: earner,
      finalRecipient: currentEarner,
      isPassup: true,
      compressedSkips,
      cascadeSkips,
    };
  }
}
